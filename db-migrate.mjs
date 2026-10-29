// Minimal, dependency-free SQL migration runner for node:sqlite.
// Files are named NNN_description.sql (NNN = 1, 2, 3 ...). Each file runs in its own
// transaction and is recorded with a checksum, so an edited migration is detected.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const NAME = /^(\d{3,})_([a-z0-9_]+)\.sql$/;

export function listMigrations(dir) {
  return readdirSync(dir)
    .filter((file) => NAME.test(file))
    .map((file) => {
      const [, version, name] = NAME.exec(file);
      const sql = readFileSync(join(dir, file), "utf8");
      return {
        version: Number(version),
        name,
        file,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    })
    .sort((a, b) => a.version - b.version);
}

export function migrate(db, dir, { dryRun = false } = {}) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)",
  );
  const files = listMigrations(dir);
  const seen = new Set();
  for (const m of files) {
    if (seen.has(m.version)) throw Error(`Duplicate migration version ${m.version}`);
    seen.add(m.version);
  }
  const applied = new Map(
    db
      .prepare("SELECT version,name,checksum FROM schema_migrations")
      .all()
      .map((row) => [row.version, row]),
  );
  for (const [version, row] of applied) {
    const file = files.find((m) => m.version === version);
    if (!file) throw Error(`Database has migration ${version} (${row.name}) that is missing from ${dir}`);
    if (file.checksum !== row.checksum)
      throw Error(`Migration ${file.file} was modified after it was applied; add a new migration instead`);
  }
  const pending = files.filter((m) => !applied.has(m.version));
  const from = Math.max(0, ...applied.keys());
  const result = { from, to: from, pending: pending.map((m) => m.file), applied: [] };
  if (dryRun) return result;
  for (const m of pending) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations VALUES(?,?,?,?)").run(
        m.version,
        m.name,
        m.checksum,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
      result.applied.push(m.file);
      result.to = m.version;
    } catch (error) {
      db.exec("ROLLBACK");
      throw Error(`Migration ${m.file} failed and was rolled back: ${error.message}`);
    }
  }
  return result;
}
