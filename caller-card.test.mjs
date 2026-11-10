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
  put("leads", { id: "l1", name: "Ravi Traders", phone: "+919840012345", phoneKey: "919840012345", owner: "u1", deal: "Quotation Shared", stage: "Quotation given", company: "Ravi Oil Mill", city: "Salem", state: "Tamil Nadu", language: "Tamil", source: "IndiaMART", value: 250000 });
  put("activities", { id: "a1", leadId: "l1", type: "Call", direction: "Outgoing", duration: 125, outcome: "Interested", userId: "u1", occurredAt: "2026-11-08T05:00:00Z" });
  put("activities", { id: "a2", leadId: "l1", type: "System", text: "Lead stage changed", occurredAt: "2026-11-09T05:00:00Z" });
  put("activities", { id: "a3", leadId: "l1", type: "Call", direction: "Incoming", duration: 0, userId: "u1", occurredAt: "2026-11-01T05:00:00Z" });
  put("tasks", { id: "t1", leadId: "l1", title: "Send revised quote", due: "2026-11-11T05:00:00Z", status: "Open" });
  put("tasks", { id: "t2", leadId: "l1", title: "old", due: "2026-10-01T05:00:00Z", status: "Done" });
  return { db, get, users };
}

test("an own lead comes with its details, last work and next follow-up", () => {
  const card = callerCard(setup(), "9840012345", { id: "u1" });
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
  const other = callerCard(s, "919840012345", { id: "u2" });
  assert.deepEqual(other, { found: true, id: "l1", name: "Ravi Traders", number: "+919840012345", stage: "Quotation Shared", owner: "Bala", own: false });
  assert.equal(callerCard(s, "9840012345", { id: "u2", admin: true }).own, true);
});

test("an unknown number gets its probable state; a blocked number says so", () => {
  const s = setup();
  assert.deepEqual(callerCard(s, "9786000001", { id: "u1" }), { found: false, number: "+919786000001", probableState: "Tamil Nadu" });
  assert.equal(callerCard({ ...s, isBlocked: (k) => k === "919786000001" }, "9786000001", { id: "u1" }).blocked, true);
  assert.equal(callerCard(s, "12", { id: "u1" }).found, false);
});
