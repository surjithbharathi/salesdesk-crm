// Usage: node scripts/migrate.mjs <database-file> [--dry-run]
// Applies pending SQL migrations from ./migrations. Always back up the database first;
// run with --dry-run to see what would change without touching it.
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { migrate } from "../db-migrate.mjs";

const [file, ...flags] = process.argv.slice(2);
if (!file || flags.some((f) => f !== "--dry-run")) {
  console.error("Usage: node scripts/migrate.mjs <database-file> [--dry-run]");
  process.exit(2);
}
if (!existsSync(file)) {
  console.error(`Database not found: ${file}`);
  process.exit(2);
}
const db = new DatabaseSync(file);
db.exec("PRAGMA foreign_keys=ON");
try {
  const result = migrate(db, fileURLToPath(new URL("../migrations/", import.meta.url)), {
    dryRun: flags.includes("--dry-run"),
  });
  console.log(flags.includes("--dry-run") ? "Dry run (nothing changed):" : "Migration complete:");
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
