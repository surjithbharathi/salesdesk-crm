import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "./db-migrate.mjs";
import { importLegacy, startFollowingLegacy } from "./legacy-import.mjs";
import { createStore } from "./store.mjs";

const migrations = fileURLToPath(new URL("./migrations/", import.meta.url));

// A deliberately messy copy of what the old server stores.
function legacyFixture(db) {
  db.exec("CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))");
  db.exec("CREATE TABLE mobile_devices(id TEXT PRIMARY KEY, token_hash TEXT UNIQUE, body TEXT)");
  db.exec("CREATE TABLE auth_accounts(user_id TEXT PRIMARY KEY, username TEXT, salt TEXT, password_hash TEXT, role TEXT)");
  const put = (kind, value) => db.prepare("INSERT INTO records VALUES(?,?,?)").run(kind, value.id, JSON.stringify(value));
  put("users", { id: "u-admin", name: "Owner", role: "Manager", active: true });
  put("users", { id: "u-rep", name: "Rep", role: "Sales representative", active: true });
  put("users", { id: "u-old", name: "Left", role: "Sales representative", active: false });
  db.prepare("INSERT INTO auth_accounts VALUES('u-admin','owner','s','h','admin')").run();
  db.prepare("INSERT INTO mobile_devices VALUES('dev1',NULL,?)").run(JSON.stringify({ id: "dev1", owner: "u-rep" }));
  put("lists", { id: "list1", name: "October enquiries" });
  const lead = (id, over) =>
    put("leads", { id, name: "Lead " + id, phone: "", stage: "New", owner: "u-rep", source: "IndiaMART", value: 0, archived: false, repeat: false, createdAt: `2026-10-0${id.slice(-1)}T10:00:00.000Z`, updatedAt: "2026-10-20T10:00:00.000Z", ...over });
  lead("L1", { phone: "+91 98765 43210", stage: "Opportunity", value: 125000.6, firstTouchAt: "2026-10-02T11:00:00.000Z", list: "list1" });
  lead("L2", { phone: "9876543210", stage: "New" }); // same number as L1, written differently -> duplicate
  lead("L3", { phone: "098765 43211", stage: "Prospecting" }); // connected call below -> Requirement Discussion
  lead("L4", { phone: "9876543212", stage: "Prospecting", owner: "ghost" }); // no connected call, unknown owner
  lead("L5", { phone: "9876543213", stage: "Closed", disposition: "Won", archived: true });
  lead("L6", { phone: "9876543214", stage: "Closed", disposition: "Lost", source: "Website" });
  lead("L7", { phone: "12345", stage: "Weird", list: "gone" }); // invalid phone, unmapped stage, unknown list
  lead("L8", { phone: "", repeat: true, source: "  " }); // no phone, blank source
  put("activities", { id: "A1", leadId: "L1", type: "System", text: "Lead captured", createdAt: "2026-10-01T10:00:00.000Z" });
  put("activities", { id: "A2", leadId: "L3", type: "Call", text: "Asked price", outcome: "Interested", direction: "Outgoing", duration: 120, createdAt: "2026-10-03T10:00:00.000Z", userId: "u-rep" });
  put("activities", { id: "A3", leadId: "L1", type: "Call", description: "Phone sync", direction: "Outgoing", deviceId: "dev1", occurredAt: "2026-10-05T09:00:00.000Z", createdAt: "2026-10-05T09:01:00.000Z" });
  put("activities", { id: "A4", leadId: "NOPE", type: "Note", text: "Orphan", createdAt: "2026-10-05T09:01:00.000Z" });
  put("mobileCalls", { id: "C1", localId: "100", phone: "919876543210", direction: "Outgoing", startedAt: Date.parse("2026-10-05T09:00:00Z"), duration: 90, deviceId: "dev1", leadId: "L1", activityId: "A3", matchMode: "auto" });
  put("mobileCalls", { id: "C2", localId: "101", phone: "919876543210", direction: "Missed", startedAt: Date.parse("2026-10-06T09:00:00Z"), duration: 0, deviceId: "dev1", leadId: "L1" });
  put("mobileCalls", { id: "C3", localId: "102", phone: "919000000000", direction: "Outgoing", startedAt: Date.parse("2026-10-06T09:00:00Z"), duration: 30, deviceId: "dev1", leadId: "MISSING" });
  put("tasks", { id: "T1", leadId: "L1", title: "Send quotation", owner: "u-rep", due: "2026-11-02T10:00:00.000Z", status: "Open", origin: "User", createdAt: "2026-10-05T10:00:00.000Z" });
  put("tasks", { id: "T2", leadId: "L1", title: "Later", owner: "u-rep", due: "2026-11-09T10:00:00.000Z", status: "Open", createdAt: "2026-10-05T10:00:00.000Z" });
  put("tasks", { id: "T3", leadId: "", title: "Ad hoc", owner: "u-rep", due: "2026-11-03T10:00:00.000Z", status: "Done", createdAt: "2026-10-05T10:00:00.000Z" });
  put("tasks", { id: "T4", leadId: "NOPE", title: "Orphan", owner: "u-rep", due: "2026-11-03T10:00:00.000Z", status: "Open", createdAt: "2026-10-05T10:00:00.000Z" });
  put("deals", { id: "D1", leadId: "L1", title: "Stays legacy", value: 1 }); // not part of this step
}
const fixture = (t) => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  t.after(() => db.close());
  legacyFixture(db);
  migrate(db, migrations);
  return db;
};
const count = (db, table) => db.prepare(`SELECT count(*) c FROM ${table}`).get().c;
const lead = (db, id) => db.prepare("SELECT * FROM leads WHERE id=?").get(id);

test("dry run reports everything and writes nothing", (t) => {
  const db = fixture(t);
  const legacyRows = count(db, "records");
  const report = importLegacy(db);
  assert.match(report.mode, /dry-run/);
  assert.equal(report.verification.ok, true, JSON.stringify(report.verification.checks.filter((c) => !c.ok)));
  assert.equal(report.legacy.leads, 8);
  assert.equal(report.imported.leads, 8);
  assert.equal(count(db, "leads"), 0);
  assert.equal(count(db, "calls"), 0);
  assert.equal(count(db, "users"), 0);
  assert.equal(count(db, "records"), legacyRows); // legacy rows untouched
});

test("apply maps users, stages, sources, duplicates and orphans correctly", (t) => {
  const db = fixture(t);
  const legacyRows = count(db, "records");
  const report = importLegacy(db, { dryRun: false });
  assert.equal(report.applied, true);
  assert.equal(count(db, "records"), legacyRows); // legacy data never touched
  // users and roles
  assert.equal(db.prepare("SELECT role_id r FROM users WHERE id='u-admin'").get().r, "role_admin");
  assert.equal(db.prepare("SELECT role_id r FROM users WHERE id='u-rep'").get().r, "role_caller");
  assert.equal(db.prepare("SELECT active a FROM users WHERE id='u-old'").get().a, 0);
  // stage mapping
  assert.equal(lead(db, "L1").status_id, "st_interested");
  assert.equal(lead(db, "L2").status_id, "st_new_lead");
  assert.equal(lead(db, "L3").status_id, "st_requirement"); // had a connected call
  assert.equal(lead(db, "L4").status_id, "st_contact_attempted"); // none
  assert.equal(lead(db, "L5").status_id, "st_won");
  assert.equal(lead(db, "L6").status_id, "st_lost");
  assert.equal(lead(db, "L6").lost_reason_id, "lr_unknown");
  assert.equal(lead(db, "L7").status_id, "st_new_lead");
  assert.deepEqual(report.unmappedStages, { Weird: 1 });
  // phone keys: canonical, duplicates kept but not keyed, bad/blank numbers flagged
  assert.equal(lead(db, "L1").phone_e164, "919876543210");
  assert.equal(lead(db, "L1").phone_display, "+91 98765 43210");
  assert.equal(lead(db, "L2").phone_e164, null);
  assert.equal(lead(db, "L2").duplicate_of, "L1");
  assert.equal(lead(db, "L3").phone_e164, "919876543211");
  assert.equal(lead(db, "L7").phone_e164, null);
  assert.equal(lead(db, "L8").phone_e164, null);
  assert.deepEqual(report.duplicatePhones, [{ phone: "919876543210", keeper: "L1", others: ["L2"] }]);
  assert.deepEqual(report.issues.filter((i) => ["invalid-phone", "no-phone"].includes(i.type)).map((i) => i.id).sort(), ["L7", "L8"]);
  // other field mapping
  assert.equal(lead(db, "L1").expected_value, 125001);
  assert.equal(lead(db, "L4").owner_id, null);
  assert.ok(report.issues.some((i) => i.type === "unknown-owner" && i.id === "L4"));
  assert.ok(lead(db, "L5").archived_at);
  assert.equal(lead(db, "L8").is_repeat, 1);
  assert.equal(lead(db, "L8").first_source_id, "src_other"); // blank source is explicit
  assert.equal(lead(db, "L1").first_source_id, "src_indiamart");
  assert.equal(lead(db, "L6").first_source_id, "src_website");
  assert.equal(db.prepare("SELECT list_id FROM list_members WHERE lead_id='L1'").get().list_id, "list1");
  assert.ok(report.issues.some((i) => i.type === "unknown-list" && i.id === "L7"));
  // calls: orphan call rejected, activity linked, device owner becomes the user
  assert.equal(count(db, "calls"), 2);
  assert.equal(report.orphans.calls, 1);
  const call = db.prepare("SELECT * FROM calls WHERE id='C1'").get();
  assert.equal(call.user_id, "u-rep");
  assert.equal(call.connected, 1);
  assert.equal(db.prepare("SELECT connected c FROM calls WHERE id='C2'").get().c, 0);
  assert.equal(db.prepare("SELECT call_id FROM activities WHERE id='A3'").get().call_id, "C1");
  assert.equal(count(db, "activities"), 3);
  assert.equal(report.orphans.activities, 1);
  // metrics rebuilt from rows
  const l1 = lead(db, "L1");
  assert.equal(l1.call_count, 2);
  assert.equal(l1.connected_count, 1);
  assert.equal(l1.total_call_seconds, 90);
  assert.equal(l1.attempts, 1);
  assert.equal(l1.last_call_at, "2026-10-06T09:00:00.000Z");
  assert.equal(l1.first_touch_at, "2026-10-02T11:00:00.000Z"); // the earlier recorded touch is kept
  assert.equal(l1.next_followup_at, "2026-11-02T10:00:00.000Z");
  assert.equal(lead(db, "L8").first_touch_at, null);
  // tasks
  assert.equal(count(db, "tasks"), 3);
  assert.equal(report.orphans.tasks, 1);
  assert.equal(db.prepare("SELECT lead_id FROM tasks WHERE id='T3'").get().lead_id, null);
  assert.equal(report.verification.ok, true);
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
});

test("re-running the import adds nothing and never duplicates", (t) => {
  const db = fixture(t);
  importLegacy(db, { dryRun: false });
  const before = ["users", "leads", "activities", "calls", "tasks", "list_members", "lists"].map((n) => count(db, n));
  const again = importLegacy(db, { dryRun: false });
  assert.deepEqual(["users", "leads", "activities", "calls", "tasks", "list_members", "lists"].map((n) => count(db, n)), before);
  assert.equal(again.verification.ok, true);
  // the duplicate is still unresolved, so it is still reported for review
  assert.deepEqual(again.duplicatePhones, [{ phone: "919876543210", keeper: "L1", others: ["L2"] }]);
  assert.equal(lead(db, "L2").duplicate_of, "L1");
});

test("a failed verification rolls the whole import back", (t) => {
  const db = fixture(t);
  // a phone-less activity type that cannot import cleanly: break an invariant on purpose
  db.exec("CREATE TRIGGER sabotage BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT,'disk full'); END");
  assert.throws(() => importLegacy(db, { dryRun: false }), /disk full/);
  assert.equal(count(db, "leads"), 0);
  assert.equal(count(db, "users"), 0);
});

test("import CLI: dry run is default, --apply writes a backup first", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "salesdesk import "));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "crm copy.sqlite");
  const db = new DatabaseSync(file);
  legacyFixture(db);
  migrate(db, migrations);
  db.close();
  const script = fileURLToPath(new URL("./scripts/import-legacy.mjs", import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [script, file, ...args], { encoding: "utf8" });
  const dry = run();
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /dry-run/);
  assert.equal(readdirSync(dir).filter((f) => f.endsWith(".bak")).length, 0);
  const check = new DatabaseSync(file);
  assert.equal(check.prepare("SELECT count(*) c FROM leads").get().c, 0);
  check.close();
  const real = run("--apply");
  assert.equal(real.status, 0, real.stderr);
  assert.match(real.stdout, /Backup written/);
  assert.equal(readdirSync(dir).filter((f) => f.includes(".pre-phase1-") && f.endsWith(".bak")).length, 1);
  const after = new DatabaseSync(file);
  assert.equal(after.prepare("SELECT count(*) c FROM leads").get().c, 8);
  after.close();
  assert.equal(run("--bogus").status, 2);
});

test("imports a database created by the real server (demo workspace)", async (t) => {
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const dir = mkdtempSync(join(tmpdir(), "salesdesk real "));
  const file = join(dir, "crm.sqlite");
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL(".", import.meta.url),
    env: { ...process.env, CRM_DB: file, PORT: "3295", MOBILE_PORT: "3296" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("server timeout")), 10000);
    child.stdout.on("data", (d) => String(d).includes("Salesdesk CRM:") && (clearTimeout(timer), resolve()));
    child.once("exit", (code) => reject(Error("server exited " + code)));
  });
  const post = (path, body) =>
    fetch("http://127.0.0.1:3295/api/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const state = await (await fetch("http://127.0.0.1:3295/api/state")).json();
  const owner = state.users[0].id;
  await post("leads", { name: "Created via API", phone: "+91 90000 11111", owner, source: "Walk-in", value: 5000 });
  await post("activities", { leadId: state.leads[0].id, type: "Call", text: "Spoke", outcome: "Interested", direction: "Outgoing", duration: 75 });
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
  const db = new DatabaseSync(file);
  t.after(() => {
    db.close(); // close before deleting: Windows keeps the file locked otherwise
    rmSync(dir, { recursive: true, force: true });
  });
  db.exec("PRAGMA foreign_keys=ON");
  migrate(db, migrations);
  const report = importLegacy(db, { dryRun: false });
  assert.equal(report.verification.ok, true, JSON.stringify(report.verification.checks.filter((c) => !c.ok)));
  assert.equal(report.legacy.leads, 9);
  assert.equal(count(db, "leads"), 9);
  assert.equal(count(db, "tasks"), report.legacy.tasks);
  assert.equal(db.prepare("SELECT first_source_id s FROM leads WHERE name='Created via API'").get().s, "src_walk_in");
  assert.equal(db.prepare("SELECT phone_e164 p FROM leads WHERE name='Created via API'").get().p, "919000011111");
  assert.deepEqual(report.issues, []); // a healthy database imports with no warnings
});

test("following the old data adds new leads and calls, keeps work done in the new app, and is quiet when nothing changed", (t) => {
  const db = fixture(t);
  const logs = [];
  const follower = startFollowingLegacy(db, { intervalMs: 3600000, log: (...a) => logs.push(a) });
  t.after(() => follower.stop());
  assert.equal(follower.tick().applied, true);
  const leads = count(db, "leads");
  // someone works the lead in the new app
  const store = createStore(db);
  store.logCall({ phone: "919876543210", direction: "Outgoing", startedAt: "2026-10-10T05:00:00.000Z", duration: 45, deviceId: "web", localId: "n1", userId: "u-rep" });
  store.addActivity("L1", "note", "Asked for 3-phase", { userId: "u-rep" });
  // meanwhile the classic screens and the phone app add a lead and a call
  const put = (kindName, value) => db.prepare("INSERT INTO records VALUES(?,?,?)").run(kindName, value.id, JSON.stringify(value));
  put("leads", { id: "L9", name: "Fresh", phone: "9876543299", stage: "New", owner: "u-rep", source: "IndiaMART", createdAt: "2026-10-12T10:00:00.000Z", updatedAt: "2026-10-12T10:00:00.000Z" });
  put("mobileCalls", { id: "C9", localId: "900", phone: "919876543299", direction: "Outgoing", startedAt: Date.parse("2026-10-12T11:00:00Z"), duration: 60, deviceId: "dev1", leadId: "L9" });
  const before = lead(db, "L1").call_count;
  const report = follower.tick();
  assert.equal(report.applied, true, JSON.stringify(report.verification.checks.filter((c) => !c.ok)));
  assert.equal(count(db, "leads"), leads + 1);
  assert.equal(lead(db, "L9").call_count, 1);
  assert.equal(lead(db, "L1").call_count, before); // the new-app call is still counted, none lost or doubled
  assert.equal(db.prepare("SELECT count(*) c FROM activities WHERE text='Asked for 3-phase'").get().c, 1);
  logs.length = 0;
  follower.tick(); // nothing new
  assert.equal(logs.length, 0);
});
