import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { callerCard } from "./caller-card.mjs";

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))");
  const put = (k, v) => db.prepare("INSERT INTO records VALUES(?,?,?)").run(k, v.id, JSON.stringify(v));
  const get = (k, id) => { const r = db.prepare("SELECT body FROM records WHERE kind=? AND id=?").get(k, id); return r && JSON.parse(r.body); };
  const users = () => [{ id: "u1", name: "Bala" }, { id: "u2", name: "Priya" }];
  put("leads", { id: "l1", name: "Ravi Traders", phone: "+919840000011", phoneKey: "919840000011", owner: "u1", deal: "Quotation Shared", stage: "Quotation given", company: "Ravi Oil Mill", city: "Salem", state: "Tamil Nadu", language: "Tamil", source: "IndiaMART", value: 250000 });
  put("activities", { id: "a1", leadId: "l1", type: "Call", direction: "Outgoing", duration: 125, outcome: "Interested", userId: "u1", occurredAt: "2026-11-08T05:00:00Z" });
  put("activities", { id: "a2", leadId: "l1", type: "System", text: "Lead stage changed", occurredAt: "2026-11-09T05:00:00Z" });
  put("activities", { id: "a3", leadId: "l1", type: "Call", direction: "Incoming", duration: 0, userId: "u1", occurredAt: "2026-11-01T05:00:00Z" });
  put("tasks", { id: "t1", leadId: "l1", title: "Send revised quote", due: "2026-11-11T05:00:00Z", status: "Open" });
  put("tasks", { id: "t2", leadId: "l1", title: "old", due: "2026-10-01T05:00:00Z", status: "Done" });
  return { db, get, users };
}

test("an own lead comes with its details, last work and next follow-up", () => {
  const card = callerCard(setup(), "9840000011", { id: "u1" });
  assert.equal(card.found, true);
  assert.equal(card.own, true);
  assert.equal(card.name, "Ravi Traders");
  assert.equal(card.stage, "Quotation Shared");
  assert.equal(card.owner, "Bala");
  assert.deepEqual([card.calls, card.answered], [2, 1]);
  assert.match(card.last.text, /Outgoing call · 2 min · Interested/);
  assert.equal(card.next.title, "Send revised quote");
  assert.equal(card.state, "Tamil Nadu");
});

test("a colleague's lead only says whose it is; an admin sees all; the number can come in any form", () => {
  const s = setup();
  const other = callerCard(s, "919840000011", { id: "u2" });
  assert.deepEqual(other, { found: true, id: "l1", name: "Ravi Traders", number: "+919840000011", stage: "Quotation Shared", owner: "Bala", own: false });
  assert.equal(callerCard(s, "9840000011", { id: "u2", admin: true }).own, true);
});

test("an unknown number gets its probable state; a blocked number says so", () => {
  const s = setup();
  assert.deepEqual(callerCard(s, "9786000012", { id: "u1" }), { found: false, number: "+919786000012", probableState: "Tamil Nadu" });
  assert.equal(callerCard({ ...s, isBlocked: (k) => k === "919786000012" }, "9786000012", { id: "u1" }).blocked, true);
  assert.equal(callerCard(s, "12", { id: "u1" }).found, false);
});

test("the last call says what was spoken: Call AI first, else the Call IQ note near it", () => {
  const s = setup();
  s.db.prepare("INSERT INTO records VALUES('activities','a4',?)").run(JSON.stringify({ id: "a4", leadId: "l1", type: "Note", text: "Call IQ: Wants 2 machines, loan needed.\nNext: send quote", occurredAt: "2026-11-08T05:10:00Z" }));
  const card = callerCard(s, "9840000011", { id: "u1" });
  assert.deepEqual([card.lastCall.direction, card.lastCall.seconds, card.lastCall.by, card.lastCall.spokenFrom], ["Outgoing", 125, "Bala", "Call IQ"]);
  assert.match(card.lastCall.spoken, /^Wants 2 machines/);
  s.db.prepare("UPDATE records SET body=json_set(body,'$.recordingId','rec1') WHERE id='a1'").run();
  const ai = callerCard({ ...s, spokenOf: (id) => (id === "rec1" ? { summary: "Asked for price of 10kg model.\nCustomer language: Tamil", transcript: "..." } : null) }, "9840000011", { id: "u1" });
  assert.equal(ai.lastCall.spoken, "Asked for price of 10kg model.");
  assert.equal(ai.lastCall.spokenFrom, "Call AI");
  assert.equal(callerCard(s, "9840000011", { id: "u2" }).lastCall, undefined, "nothing about the call for a colleague's lead");
});
