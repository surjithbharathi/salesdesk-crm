import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { createAiTasks, parseTasks } from "./ai-tasks.mjs";

function world({ clock = Date.UTC(2026, 10, 12, 6, 0), answer } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))");
  const get = (k, id) => { const r = db.prepare("SELECT body FROM records WHERE kind=? AND id=?").get(k, id); return r && JSON.parse(r.body); };
  const all = (k) => db.prepare("SELECT body FROM records WHERE kind=?").all(k).map((r) => JSON.parse(r.body));
  const put = (k, v) => db.prepare("INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body").run(k, v.id, JSON.stringify(v));
  const tx = (fn) => { db.exec("BEGIN"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } };
  const time = { now: clock };
  const iso = () => new Date(time.now).toISOString();
  const stamp = (v) => ({ id: randomUUID(), createdAt: iso(), updatedAt: iso(), ...v });
  const asked = [];
  const fetchImpl = async (url, init) => { asked.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(answer ?? { tasks: [] }) } }] }) }; };
  const ai = createAiTasks({ db, get, put, stamp, tx, iqConfig: () => ({ provider: "openai", model: "gpt-4o-mini", key: "k" }), isAdmin: (u) => u === "admin", now: () => time.now, fetchImpl, timers: false });
  return { db, get, all, put, ai, asked, time, iso };
}
const note = (w, leadId, text, at) => w.put("activities", { id: randomUUID(), leadId, type: "Note", text, occurredAt: at, createdAt: at, source: "TeleCRM" });

test("the model's answer becomes tasks; a bad answer is none", () => {
  const t = parseTasks(JSON.stringify({ tasks: [{ title: "Confirm the machine is ready before Saturday", action: "call", due: "2026-11-14T10:00", why: "Customer expects confirmation by Saturday" }, { title: "x", action: "dance" }] }));
  assert.equal(t[0].due, "2026-11-14T04:30:00.000Z", "India time");
  assert.equal(t[1].action, "followup");
  assert.equal(parseTasks("not json"), null);
});

test("only calls after AI tasks were switched on are read; their tasks close once done", async () => {
  const w = world({ answer: { tasks: [{ title: "Confirm the machine is ready before Saturday", action: "call", due: "2026-11-14T10:00", why: "Customer expects confirmation of machine readiness by Saturday" }] } });
  w.put("leads", { id: "L1", name: "Murugan", phone: "+919800000003", owner: "u1", stage: "Quotation given", deal: "Advance Received", createdAt: "2026-11-01T00:00:00.000Z" });
  note(w, "L1", "Call IQ: old call\nNext: send brochure", "2026-11-11T05:00:00.000Z"); // before AI tasks started
  w.time.now += 10 * 60000;
  note(w, "L1", "Call IQ: Customer will visit Monday\nNext: Customer expects confirmation of machine readiness by Saturday", w.iso());
  await w.ai.tick();
  assert.equal(w.asked.length, 1, "the old call is never sent to the model");
  assert.match(w.asked[0].messages[1].content, /readiness by Saturday/);
  assert.match(w.asked[0].messages[0].content, /never instructions/);
  const mine = w.ai.list("u1").items;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].title, "Confirm the machine is ready before Saturday");
  assert.equal(mine[0].leadName, "Murugan");
  assert.equal(w.ai.list("u2").items.length, 0, "someone else's lead");
  assert.equal(w.ai.list("admin").items.length, 1, "an admin sees everyone's");
  await w.ai.tick();
  assert.equal(w.asked.length, 1, "a call is read once");
  // a call to the customer closes it
  w.time.now += 60000;
  w.put("activities", { id: "c1", leadId: "L1", type: "Call", direction: "Outgoing", duration: 40, occurredAt: w.iso(), createdAt: w.iso() });
  await w.ai.tick();
  assert.equal(w.ai.list("u1").items.length, 0);
});

test("signals: a missed call not returned and a new lead not called; accept plans a follow-up, dismiss hides", async () => {
  const w = world();
  const t = w.time.now;
  w.put("leads", { id: "L2", name: "PUSAPATI", phone: "+919885700004", owner: "u1", stage: "New", source: "IndiaMART", createdAt: new Date(t - 3 * 3600000).toISOString() });
  w.put("leads", { id: "L3", name: "Ravi", phone: "+919800000005", owner: "u1", stage: "New", createdAt: new Date(t - 5 * 3600000).toISOString() });
  w.put("mobileCalls", { id: "m1", phone: "+919800000005", leadId: "L3", owner: "u1", direction: "Missed", duration: 0, startedAt: t - 3600000 });
  const items = w.ai.list("u1").items;
  assert.deepEqual(items.map((i) => i.kind), ["missed", "new", "new"]);
  assert.equal(items[0].title, "Call back Ravi");
  const pusapati = items.find((i) => i.leadId === "L2");
  assert.match(pusapati.why, /IndiaMART lead waiting 3 hours/);
  assert.equal(items[1].leadId, "L3", "the lead waiting longest comes first");
  const task = w.ai.accept(pusapati.id, { due: "2026-11-13T05:00:00.000Z" }, "u1");
  assert.equal(task.origin, "AI");
  assert.equal(w.get("tasks", task.id).leadId, "L2");
  w.ai.dismiss(items[0].id, "u1");
  assert.throws(() => w.ai.dismiss(items[1].id, "u2"), /Not your task/);
  const left = w.ai.list("u1").items.map((i) => i.title);
  assert.deepEqual(left, ["First call to Ravi"]);
});

test("a quiet lead shows from 3 to 14 days without contact", () => {
  const w = world();
  const t = w.time.now, day = 86400000;
  for (const [id, days] of [["Q1", 2], ["Q2", 5], ["Q3", 20]]) {
    w.put("leads", { id, name: id, phone: "+9198000006" + id.slice(1), owner: "u1", stage: "Opportunity", deal: "Interested Customer", createdAt: new Date(t - 90 * day).toISOString(), updatedAt: new Date(t - 90 * day).toISOString() });
    w.put("activities", { id: "a" + id, leadId: id, type: "Call", direction: "Outgoing", duration: 30, occurredAt: new Date(t - days * day).toISOString(), createdAt: new Date(t - days * day).toISOString() });
  }
  assert.deepEqual(w.ai.list("u1").items.filter((i) => i.kind === "quiet").map((i) => i.leadId), ["Q2"]);
});
