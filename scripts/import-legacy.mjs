// Usage: node scripts/import-legacy.mjs <database-file> [--apply]
// Default is a DRY RUN: the full import is executed and verified inside a transaction and rolled back,
// then the report is printed. With --apply a consistent backup is written first (<db>.pre-phase1-<time>.bak)
// and the import is committed only if every verification check passes.
// Run scripts/migrate.mjs first. Stop the CRM server before using --apply.
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { importLegacy } from "../legacy-import.mjs";

const [file, ...flags] = process.argv.slice(2);
if (!file || flags.some((f) => f !== "--apply")) {
  console.error("Usage: node scripts/import-legacy.mjs <database-file> [--apply]");
  process.exit(2);
}
if (!existsSync(file)) {
  console.error(`Database not found: ${file}`);
  process.exit(2);
}
const apply = flags.includes("--apply");
const db = new DatabaseSync(file);
db.exec("PRAGMA foreign_keys=ON");
try {
  if (apply) {
    const backup = `${file}.pre-phase1-${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
    db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    console.log(`Backup written: ${backup}`);
  }
  const report = importLegacy(db, { dryRun: !apply });
  console.log(JSON.stringify(report, null, 2));
  if (!report.verification.ok) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
