// Usage: node scripts/rehearse-dummy.mjs
// Builds a throw-away database shaped like the OLD CRM (messy on purpose, all invented), then rehearses the move:
// dry run, apply, keep working in the new app, follow new old-side changes, and verify. Touches nothing but data/rehearsal-dummy.sqlite.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { migrate } from "../db-migrate.mjs";
import { importLegacy, startFollowingLegacy } from "../legacy-import.mjs";
import { createStore } from "../store.mjs";
import { createQueries } from "../queries.mjs";

const dir = fileURLToPath(new URL("../data/", import.meta.url));
const file = `${dir}rehearsal-dummy.sqlite`;
mkdirSync(dir, { recursive: true });
for (const s of ["", "-wal", "-shm"]) if (existsSync(file + s)) rmSync(file + s);
const db = new DatabaseSync(file);
db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL");

let seed = 7;
const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (list) => list[Math.floor(random() * list.length)];

// ---- the old tables
db.exec("CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))");
db.exec("CREATE TABLE mobile_devices(id TEXT PRIMARY KEY, token_hash TEXT UNIQUE, body TEXT)");
db.exec("CREATE TABLE auth_accounts(user_id TEXT PRIMARY KEY, username TEXT, salt TEXT, password_hash TEXT, role TEXT)");
const put = (kind, value) => db.prepare("INSERT OR REPLACE INTO records VALUES(?,?,?)").run(kind, value.id, JSON.stringify(value));
const people = [["u-owner", "Surjith"], ["u-asha", "Asha"], ["u-ravi", "Ravi"], ["u-meena", "Meena"], ["u-karthik", "Karthik"], ["u-left", "Former rep"]];
for (const [id, name] of people) put("users", { id, name, role: id === "u-owner" ? "Manager" : "Sales representative", active: id !== "u-left" });
for (const [i, [id]] of people.slice(1, 5).entries()) db.prepare("INSERT INTO mobile_devices VALUES(?,NULL,?)").run(`dev${i}`, JSON.stringify({ id: `dev${i}`, owner: id }));
put("lists", { id: "list-oct", name: "October enquiries" });

// ---- old-style leads: numbers written many ways, old stage names, some junk
const writeNumber = (n) => pick([String(n), `+91 ${String(n).slice(0, 5)} ${String(n).slice(5)}`, `0${n}`, `91${n}`, `${String(n).slice(0, 5)}-${String(n).slice(5)}`]);
const stages = ["New", "New", "New", "Prospecting", "Prospecting", "Opportunity", "Intrested Customer", "Need Discussion", "Closed", "Weird old stage"];
const sources = ["IndiaMART", "Website", "Meta Ads", "Whatsapp", "Customer Referral", "Exhibition", "  ", "Call Logs"];
const machines = ["Wooden cold press 20 kg/hr", "Filter press 12 plate", "Groundnut decorticator", "Copra cutter", "Tray dryer 20 tray"];
const N = 600;
const owners = ["u-asha", "u-ravi", "u-meena", "u-karthik", "u-left", "ghost"];
for (let i = 1; i <= N; i++) {
  const stage = pick(stages);
  const closed = stage === "Closed";
  const number = 9840000000 + i * 7;
  put("leads", {
    id: `L${i}`, name: `${pick(["Sri", "Sakthi", "Annai", "Murugan", "Lakshmi", "Vel"])} ${pick(["Oils", "Agro", "Traders", "Mills", "Enterprises"])} ${i}`,
    phone: i % 40 === 0 ? "12345" : i % 55 === 0 ? "" : i % 31 === 0 ? writeNumber(9840000000 + (i - 1) * 7) : writeNumber(number), // some invalid, blank, or duplicate numbers
    stage, disposition: closed ? pick(["Won", "Lost", "Lost"]) : undefined, lostReason: closed ? pick(["Price", "No response", "", "Wrong number"]) : undefined,
    owner: pick(owners), source: pick(sources), value: Math.round(random() * 700000), product: pick(machines), city: pick(["Coimbatore", "Salem", "Erode", "Madurai"]),
    archived: i % 97 === 0, repeat: i % 13 === 0, list: i % 5 === 0 ? "list-oct" : i % 17 === 0 ? "gone-list" : undefined,
    firstTouchAt: random() < 0.6 ? `2026-10-${String(1 + (i % 27)).padStart(2, "0")}T11:00:00.000Z` : undefined,
    createdAt: `2026-0${8 + (i % 3)}-${String(1 + (i % 27)).padStart(2, "0")}T10:00:00.000Z`, updatedAt: "2026-10-28T10:00:00.000Z",
  });
  if (random() < 0.7) {
    const connected = random() < 0.55;
    put("mobileCalls", { id: `C${i}`, localId: String(1000 + i), phone: `91${number}`, direction: pick(["Outgoing", "Outgoing", "Incoming", "Missed"]),
      startedAt: Date.parse(`2026-10-${String(1 + (i % 27)).padStart(2, "0")}T0${5 + (i % 4)}:30:00Z`), duration: connected ? 30 + (i % 300) : 0, deviceId: `dev${i % 4}`, leadId: `L${i}` });
  }
  if (random() < 0.4) put("activities", { id: `A${i}`, leadId: `L${i}`, type: "Note", text: "Asked about price and delivery", createdAt: "2026-10-05T09:00:00.000Z", userId: pick(owners) });
  if (random() < 0.35) put("tasks", { id: `T${i}`, leadId: `L${i}`, title: pick(["Send quotation", "Call again", "Send machine details"]), owner: pick(owners), due: `2026-11-${String(1 + (i % 25)).padStart(2, "0")}T10:00:00.000Z`, status: pick(["Open", "Open", "Done"]), createdAt: "2026-10-05T10:00:00.000Z" });
}
put("mobileCalls", { id: "Corphan", localId: "x1", phone: "919000000001", direction: "Outgoing", startedAt: Date.parse("2026-10-06T09:00:00Z"), duration: 30, deviceId: "dev0", leadId: "MISSING" });
put("activities", { id: "Aorphan", leadId: "NOPE", type: "Note", text: "orphan", createdAt: "2026-10-05T09:01:00.000Z" });
put("deals", { id: "D1", leadId: "L1", title: "Stays in the old tables", value: 1 });
console.log(`Dummy old database: ${db.prepare("SELECT count(*) c FROM records WHERE kind='leads'").get().c} leads, ${db.prepare("SELECT count(*) c FROM records WHERE kind='mobileCalls'").get().c} calls`);

// ---- rehearsal
migrate(db, fileURLToPath(new URL("../migrations/", import.meta.url)));
const show = (title, value) => console.log(`\n== ${title}\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`);
const dry = importLegacy(db);
show("1. Dry run (nothing written)", { mode: dry.mode, imported: dry.imported, skipped: dry.skipped, verificationOk: dry.verification.ok,
  failedChecks: dry.verification.checks.filter((c) => !c.ok), duplicateGroups: dry.duplicatePhones.length, orphans: dry.orphans, unmappedStages: dry.unmappedStages,
  issuesByKind: dry.issues.reduce((m, i) => ((m[i.type] = (m[i.type] || 0) + 1), m), {}) });
if (db.prepare("SELECT count(*) c FROM leads").get().c !== 0) throw new Error("dry run wrote data");
const applied = importLegacy(db, { dryRun: false });
show("2. Apply", { applied: applied.applied, verificationOk: applied.verification.ok, summary: applied.summary });

const q = createQueries(db), store = createStore(db);
const before = q.dashboard({});
// work happens in the new app
const someLead = db.prepare("SELECT id, phone_e164 FROM leads WHERE phone_e164 IS NOT NULL AND archived_at IS NULL LIMIT 1").get();
store.logCall({ phone: someLead.phone_e164, direction: "Outgoing", startedAt: new Date().toISOString(), duration: 90, deviceId: "web", localId: "rehearsal-1", userId: "u-asha" });
store.addActivity(someLead.id, "note", "Rehearsal note from the new app", { userId: "u-asha" });
// the old side keeps getting new data
const stamp = Date.now();
put("leads", { id: "L-new", name: "Brand new enquiry", phone: "9840099999", stage: "New", owner: "u-ravi", source: "IndiaMART", createdAt: new Date(stamp).toISOString(), updatedAt: new Date(stamp).toISOString() });
put("mobileCalls", { id: "C-new", localId: "9999", phone: "919840099999", direction: "Outgoing", startedAt: stamp - 60000, duration: 75, deviceId: "dev1", leadId: "L-new" });
const follower = startFollowingLegacy(db, { intervalMs: 3600000, log: () => {} });
const first = follower.tick(), second = follower.tick();
follower.stop();
show("3. Following the old data", { copiedFirstPass: first.imported, verificationOk: first.verification.ok, secondPassCopiedNothing: Object.values(second.imported).every((n) => n === 0) });
const lead = db.prepare("SELECT call_count, connected_count FROM leads WHERE id='L-new'").get();
const kept = db.prepare("SELECT count(*) c FROM activities WHERE text='Rehearsal note from the new app'").get().c;
const after = q.dashboard({});
show("4. Spot checks", { newLeadArrived: Boolean(lead), newLeadCalls: lead, newAppNoteKept: kept === 1,
  dashboardTotalBefore: before.byStatus.reduce((s, r) => s + r.count, 0), dashboardTotalAfter: after.byStatus.reduce((s, r) => s + r.count, 0),
  sourceReportReconciles: q.sourceReport({ from: "2000-01-01T00:00:00Z", to: "2100-01-01T00:00:00Z" }).reconciled,
  foreignKeyProblems: db.prepare("PRAGMA foreign_key_check").all().length });
db.close();
console.log(`\nDone. Rehearsal database: ${file} (git-ignored). Run the app on it with: CRM_DB="${file}" ENABLE_V2=true node server.mjs`);
