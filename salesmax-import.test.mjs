import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createSalesmaxImport, istToIso, phoneOf, callOf, stageOf } from "./salesmax-import.mjs";
import { initializeLeadPhoneIndex } from "./lead-phone.mjs";

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))");
  initializeLeadPhoneIndex(db);
  const get = (k, id) => { const r = db.prepare("SELECT body FROM records WHERE kind=? AND id=?").get(k, id); return r && JSON.parse(r.body); };
  const all = (k) => db.prepare("SELECT body FROM records WHERE kind=? ORDER BY rowid").all(k).map((r) => JSON.parse(r.body));
  const put = (k, v) => db.prepare("INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body").run(k, v.id, JSON.stringify(v));
  const tx = (fn) => { db.exec("BEGIN"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } };
  const imp = createSalesmaxImport({ db, get, put, tx, users: () => [{ id: "u1", name: "Bala" }, { id: "u2", name: "Bhagya Shree D" }] });
  return { db, get, all, put, imp };
}
const contact = (v) => ({ "LEAD NAME": "Ravi", "LEAD OWNER": "Bala", "LEAD STAGE": "Intrested", "DEAL STAGE": "", "MOBILE NUMBER": "+919876500001", CREATED: "2026-03-06 12:00:53", "LEAD SOURCE": "indiamart", ...v });

test("dates, phones, stages and call lines are read the Salesmax way", () => {
  assert.equal(istToIso("2026-03-06 12:00:53"), "2026-03-06T06:30:53.000Z");
  assert.equal(istToIso("45961.5"), "2025-10-31T06:30:00.000Z");
  assert.equal(phoneOf("+919876500001|+919876500002").phoneKey, "919876500001");
  assert.equal(phoneOf("+919876500002").others.length, 0);
  assert.equal(phoneOf("bad"), null);
  assert.deepEqual(stageOf("Closed", "Won", ""), { deal: "Won", stage: "Closed", disposition: "Won" });
  assert.equal(stageOf("New Lead", "", "").stage, "New");
  assert.equal(stageOf("Closed", "", "NOT_INTRESTED").disposition, "Not interested");
  assert.deepEqual(callOf("Bala made a 00:01:01 duration call to Ravi at 2026-09-10T11:46:00.737Z."), { direction: "Outgoing", duration: 61, outcome: "Connected", at: "2026-09-10T11:46:00.737Z" });
  assert.equal(callOf("Bala received a 00:00:00 duration call from +919876500001 at 2026-09-10T11:46:00.737Z.").direction, "Missed");
});

test("new leads come in; a lead already here keeps owner and stage; a second import adds nothing", () => {
  const s = setup();
  s.put("leads", { id: "mine", name: "Kumar", phone: "+919876500002", phoneKey: "919876500002", owner: "u2", stage: "Opportunity", company: "", city: "Salem" });
  const c1 = s.imp.importBatch("contacts", [contact({ "LAST USER REMARK": "Wants 2 machines", "LAST NOTE BY": "Bala", "LAST NOTE": "2026-03-07 10:00:00" }), contact({ "LEAD NAME": "Kumar", "MOBILE NUMBER": "+919876500002", "LEAD OWNER": "Bala", "LEAD STAGE": "Closed", BUSINESS: "Kumar Mills", CITY: "Erode" }), contact({ "MOBILE NUMBER": "" })]);
  assert.deepEqual([c1.created, c1.updated, c1.skipped], [1, 1, 1]);
  const ravi = s.get("leads", "smx-919876500001");
  assert.equal(ravi.owner, "u1");
  assert.equal(ravi.stage, "Opportunity");
  assert.equal(ravi.source, "IndiaMART");
  assert.equal(ravi.createdAt, "2026-03-06T06:30:53.000Z");
  assert.equal(ravi.importedFrom, "salesmax");
  const kumar = s.get("leads", "mine");
  assert.deepEqual([kumar.owner, kumar.stage, kumar.company, kumar.city], ["u2", "Opportunity", "Kumar Mills", "Salem"], "owner, stage and a filled city stay; the empty company is filled");
  assert.equal(s.all("activities").filter((a) => a.type === "Note").length, 1);
  const c2 = s.imp.importBatch("contacts", [contact({ "LAST USER REMARK": "Wants 2 machines", "LAST NOTE BY": "Bala", "LAST NOTE": "2026-03-07 10:00:00" })]);
  assert.deepEqual([c2.created, c2.updated], [0, 0]);
  assert.equal(s.all("activities").length, 1);
});

test("deals, tasks and activities hang on the lead by number; calls already here are not added twice", () => {
  const s = setup();
  s.imp.importBatch("contacts", [contact({})]);
  s.put("activities", { id: "tc1", leadId: "smx-919876500001", type: "Call", direction: "Outgoing", occurredAt: "2026-09-10T11:47:00.000Z", source: "TeleCRM" });
  const d = s.imp.importBatch("deals", [{ "LEAD NUMBER": "+919876500001", "DEAL NAME": "DEAL-Ravi", "DEAL STAGE": "Lost", "LOST REASON": "Price", "CREATED AT": "2026-03-06 12:10:00" }, { "LEAD NUMBER": "+910000000000", "DEAL NAME": "x" }]);
  assert.deepEqual([d.created, d.skipped], [1, 1]);
  assert.equal(s.all("deals")[0].stage, "Lost");
  assert.equal(s.all("deals")[0].lostReason, "Price");
  const t = s.imp.importBatch("tasks", [{ "CONTACT NUMBER": "+919876500001", "TASK ID": "abc", "TASK TYPE": "DEAL_FOLLOW_UP", STATUS: "ACTIVE", "DUE DATE": "46000.5", "TASK OWNER": "Bhagya Shree D", "CREATED AT": "45999" }]);
  assert.equal(t.created, 1);
  assert.deepEqual([s.get("tasks", "smx-t-abc").status, s.get("tasks", "smx-t-abc").owner], ["Open", "u2"]);
  const rows = [
    { "CONTACT NUMBER": "+919876500001", "ACTIVITY TYPE": "CALL_LOGGED", "ACTIVITY TIME": "2026-09-10 17:16:00", "ACTIVITY BY": "Bala", DESCRIPTION: "Bala made a 00:01:01 duration call to Ravi at 2026-09-10T11:46:00.737Z." },
    { "CONTACT NUMBER": "+919876500001", "ACTIVITY TYPE": "CALL_LOGGED", "ACTIVITY TIME": "2026-09-11 10:00:00", "ACTIVITY BY": "Bala", DESCRIPTION: "Bala received a 00:02:00 duration call from Ravi at 2026-09-11T04:30:00.000Z." },
    { "CONTACT NUMBER": "+919876500001", "ACTIVITY TYPE": "CALL_RECORD_AVAILABLE", "ACTIVITY TIME": "2026-09-11 10:00:00", DESCRIPTION: "recording" },
    { "CONTACT NUMBER": "+919876500001", "ACTIVITY TYPE": "CONTACT_ASSIGNED", "ACTIVITY TIME": "2026-03-06 12:01:00", DESCRIPTION: "Contact Ravi Assigned To Bala" },
  ];
  const a = s.imp.importBatch("activities", rows);
  assert.deepEqual([a.created, a.skipped, a.notes.callsAlreadyHere, a.notes.repeats], [2, 2, 1, 1]);
  const call = s.all("activities").find((x) => x.importedFrom && x.type === "Call");
  assert.deepEqual([call.direction, call.duration, call.userId], ["Incoming", 120, "u1"]);
  assert.equal(s.imp.importBatch("activities", rows).created, 0, "a second import adds nothing");
  assert.throws(() => s.imp.importBatch("nope", []), /Unknown/);
  assert.throws(() => s.imp.importBatch("contacts", Array(401).fill({})), /at most/);
});

test("a lead uploaded to TeleCRM from Excel gets Salesmax's real date and source; a real source is kept", () => {
  const s = setup();
  s.put("leads", { id: "tc-1", name: "Ravi", phone: "+919876500001", phoneKey: "919876500001", owner: "u2", stage: "Opportunity", source: "Excel", createdAt: "2026-09-14T09:01:59.733Z", updatedAt: "2026-09-14T09:01:59.733Z" });
  s.put("leads", { id: "tc-2", name: "Kumar", phone: "+919876500002", phoneKey: "919876500002", owner: "u2", stage: "New", source: "TradeIndia", createdAt: "2025-01-01T00:00:00.000Z" });
  const c = s.imp.importBatch("contacts", [contact({}), contact({ "MOBILE NUMBER": "+919876500002", "LEAD SOURCE": "WHATSAPP" })]);
  const ravi = s.get("leads", "tc-1"), kumar = s.get("leads", "tc-2");
  assert.deepEqual([ravi.source, ravi.createdAt, ravi.owner, ravi.stage], ["IndiaMART", "2026-03-06T06:30:53.000Z", "u2", "Opportunity"]);
  assert.ok(ravi.importTouch && ravi.importTouch === ravi.updatedAt);
  assert.deepEqual([kumar.source, kumar.createdAt], ["TradeIndia", "2025-01-01T00:00:00.000Z"], "a real source and an earlier date stay");
  assert.equal(c.updated, 2);
});
