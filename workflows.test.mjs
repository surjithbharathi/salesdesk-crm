import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { createWorkflows } from "./workflows.mjs";

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))");
  const get = (k, id) => { const r = db.prepare("SELECT body FROM records WHERE kind=? AND id=?").get(k, id); return r && JSON.parse(r.body); };
  const all = (k) => db.prepare("SELECT body FROM records WHERE kind=? ORDER BY rowid").all(k).map((r) => JSON.parse(r.body));
  const put = (k, v) => db.prepare("INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body").run(k, v.id, JSON.stringify(v));
  const tx = (fn) => { db.exec("BEGIN"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } };
  let clock = Date.UTC(2026, 10, 10, 6, 0);
  const iso = () => new Date(clock).toISOString();
  const stamp = (v) => ({ id: randomUUID(), createdAt: iso(), updatedAt: iso(), ...v });
  const log = (leadId, type, text, extra = {}) => { const a = stamp({ leadId, type, text, ...extra }); put("activities", a); return a; };
  const sent = [];
  const people = [{ id: "u1", name: "Priya" }, { id: "u2", name: "Arjun" }, { id: "u3", name: "Meera" }];
  const wf = createWorkflows({ db, get, put, stamp, tx, log, users: () => people, sendWhatsApp: async (leadId, m) => { sent.push({ leadId, ...m }); }, now: () => clock });
  const lead = (v) => { const l = stamp({ name: "Lead", phone: "", stage: "New", owner: "", source: "IndiaMART", city: "Coimbatore", ...v }); put("leads", l); return l; };
  return { db, get, all, put, wf, lead, log, sent, advance: (ms) => { clock += ms; }, iso };
}

test("rules are checked: name, trigger, conditions and actions", () => {
  const { wf } = setup();
  assert.throws(() => wf.create({ trigger: { type: "lead_created" }, actions: [{ type: "note", text: "x" }] }), /name/);
  assert.throws(() => wf.create({ name: "a", trigger: { type: "nope" }, actions: [{ type: "note", text: "x" }] }), /when/);
  assert.throws(() => wf.create({ name: "a", trigger: { type: "lead_created" }, actions: [] }), /at least one action/);
  assert.throws(() => wf.create({ name: "a", trigger: { type: "lead_created" }, actions: [{ type: "assign", to: "nobody" }] }), /who gets/);
  assert.throws(() => wf.create({ name: "a", trigger: { type: "lead_created" }, actions: [{ type: "assign", to: "round_robin", users: ["u1"] }] }), /two people/);
  assert.throws(() => wf.create({ name: "a", trigger: { type: "no_activity", days: 0 }, actions: [{ type: "note", text: "x" }] }), /1 to 365/);
  assert.throws(() => wf.create({ name: "a", trigger: { type: "lead_created" }, conditions: [{ field: "city", op: "is", value: "" }], actions: [{ type: "note", text: "x" }] }), /value/);
  const ok = wf.create({ name: "New IndiaMART leads", trigger: { type: "lead_created" }, conditions: [{ field: "source", op: "is", value: "IndiaMART" }], actions: [{ type: "task", title: "Call {name}", hours: 1 }] }, "u1");
  assert.equal(ok.enabled, true);
  assert.equal(wf.list().rules.length, 1);
  wf.update(ok.id, { ...ok, enabled: false });
  assert.equal(wf.list().rules[0].enabled, false);
  wf.remove(ok.id);
  assert.equal(wf.list().rules.length, 0);
});

test("the first run only takes a snapshot; later new leads are assigned in turn, given a task and a WhatsApp", async () => {
  const s = setup();
  s.lead({ name: "Old lead" });
  s.wf.create({ name: "Round robin", trigger: { type: "lead_created" }, conditions: [{ field: "source", op: "is", value: "indiamart" }],
    actions: [{ type: "assign", to: "round_robin", users: ["u1", "u2"] }, { type: "task", title: "Call {name} from {city}", hours: 2 }, { type: "whatsapp", text: "Hello {name}, this is {owner} from Devi Industries" }] });
  await s.wf.tick();
  assert.equal(s.all("tasks").length, 0, "history does not fire");
  const a = s.lead({ name: "Ravi" }), b = s.lead({ name: "Kumar" }), c = s.lead({ name: "Web", source: "Website" });
  await s.wf.tick();
  assert.equal(s.get("leads", a.id).owner, "u1");
  assert.equal(s.get("leads", b.id).owner, "u2");
  assert.equal(s.get("leads", c.id).owner, "", "condition not met");
  const tasks = s.all("tasks");
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].title, "Call Ravi from Coimbatore");
  assert.equal(tasks[0].owner, "u1");
  assert.equal(tasks[0].origin, "Workflow");
  assert.deepEqual(s.sent.map((m) => m.text), ["Hello Ravi, this is Priya from Devi Industries", "Hello Kumar, this is Arjun from Devi Industries"]);
  await s.wf.tick();
  assert.equal(s.all("tasks").length, 2, "each event runs once");
  const runs = s.wf.list().runs;
  assert.equal(runs.length, 2);
  assert.ok(runs.every((r) => r.ok));
});

test("an old lead arriving late (a TeleCRM full read) does not count as new", async () => {
  const s = setup();
  s.wf.create({ name: "Note", trigger: { type: "lead_created" }, actions: [{ type: "note", text: "Welcome" }] });
  await s.wf.tick();
  s.lead({ name: "From 2024", createdAt: "2024-01-01T00:00:00.000Z" });
  await s.wf.tick();
  assert.equal(s.all("activities").length, 0);
});

test("a stage change to a chosen step fires; a missed call fires", async () => {
  const s = setup();
  const l = s.lead({ name: "Selvam", owner: "u3" });
  s.wf.create({ name: "Quotation follow-up", trigger: { type: "stage_changed", to: "Quotation Shared" }, actions: [{ type: "task", title: "Ask about the quotation", hours: 48, owner: "lead_owner" }] });
  s.wf.create({ name: "Missed call", trigger: { type: "call_missed" }, actions: [{ type: "task", title: "Call back {name}", hours: 0 }] });
  await s.wf.tick();
  s.put("leads", { ...s.get("leads", l.id), deal: "Requirement Discussion", stage: "Prospecting" });
  await s.wf.tick();
  assert.equal(s.all("tasks").length, 0, "other step");
  s.put("leads", { ...s.get("leads", l.id), deal: "Quotation Shared", stage: "Quotation given", updatedAt: "x" });
  s.log(l.id, "Call", "Missed", { direction: "Missed", occurredAt: s.iso() });
  await s.wf.tick();
  const titles = s.all("tasks").map((t) => t.title).sort();
  assert.deepEqual(titles, ["Ask about the quotation", "Call back Selvam"]);
  assert.ok(s.all("tasks").every((t) => t.owner === "u3"));
});

test("a stage action moves the lead; two rules cannot bounce a lead forever", async () => {
  const s = setup();
  const l = s.lead({ name: "Loop" });
  s.wf.create({ name: "A", trigger: { type: "stage_changed", to: "Interested Customer" }, actions: [{ type: "stage", stage: "Requirement Discussion" }] });
  s.wf.create({ name: "B", trigger: { type: "stage_changed", to: "Requirement Discussion" }, actions: [{ type: "stage", stage: "Interested Customer" }] });
  await s.wf.tick();
  s.put("leads", { ...s.get("leads", l.id), deal: "Interested Customer", stage: "Opportunity", updatedAt: "1" });
  for (let i = 0; i < 20; i++) { await s.wf.tick(); s.advance(1000); }
  const runs = s.wf.list().runs.filter((r) => r.leadId === l.id);
  assert.ok(runs.length <= 6, `stopped after ${runs.length} runs`);
});

test("no activity for N days fires once for leads that just went quiet, not for long-dead ones", async () => {
  const s = setup();
  const fresh = s.lead({ name: "Quiet" });
  s.log(fresh.id, "Call", "talked", { occurredAt: s.iso() });
  const dead = s.lead({ name: "Dead", createdAt: "2025-01-01T00:00:00.000Z" });
  const won = s.lead({ name: "Won", stage: "Closed", deal: "Won" });
  s.wf.create({ name: "Nudge", trigger: { type: "no_activity", days: 3 }, actions: [{ type: "task", title: "Check on {name}", hours: 0 }] });
  await s.wf.tick();
  s.advance(3.5 * 86400000);
  await s.wf.tick();
  assert.deepEqual(s.all("tasks").map((t) => t.title), ["Check on Quiet"]);
  s.advance(20 * 60000);
  await s.wf.tick();
  assert.equal(s.all("tasks").length, 1, "once per quiet spell");
  assert.ok(dead && won);
});

test("a WhatsApp that cannot be sent is noted on the lead and the run", async () => {
  const s = setup();
  const wf = createWorkflows({ db: s.db, get: s.get, put: s.put, stamp: (v) => ({ id: randomUUID(), createdAt: new Date().toISOString(), ...v }), tx: (f) => f(), log: s.log, users: () => [], sendWhatsApp: async () => { throw new Error("This lead has no valid phone number"); } });
  wf.create({ name: "Hi", trigger: { type: "lead_created" }, actions: [{ type: "whatsapp", text: "Hi" }] });
  await wf.tick();
  const l = s.lead({ name: "No phone", createdAt: new Date().toISOString() });
  await wf.tick();
  const run = wf.list().runs[0];
  assert.equal(run.ok, false);
  assert.match(run.done.join(), /no valid phone/);
  assert.ok(s.all("activities").some((a) => a.leadId === l.id && /WhatsApp not sent/.test(a.text)));
});
