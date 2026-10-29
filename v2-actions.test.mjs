import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { migrate } from "./db-migrate.mjs";
import { createStore } from "./store.mjs";
import { createQueries } from "./queries.mjs";
import { createActions } from "./v2-actions.mjs";

const migrations = fileURLToPath(new URL("./migrations/", import.meta.url));
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  t.after(() => db.close());
  migrate(db, migrations);
  let tick = Date.parse("2026-10-01T00:00:00.000Z");
  const store = createStore(db, { now: () => new Date((tick += 60000)).toISOString() });
  for (const [id, name] of [["u1", "Asha"], ["u2", "Ravi"]])
    db.prepare("INSERT INTO users(id,name,role_id,created_at,updated_at) VALUES(?,?,?,?,?)").run(id, name, "role_caller", "x", "x");
  const act = createActions(db, store);
  const admin = { id: null, role: "admin" }, asha = { id: "u1", role: "member" }, ravi = { id: "u2", role: "member" };
  return { db, store, q: createQueries(db), act, admin, asha, ravi };
}
const status = (lead) => lead.status_id;

test("a caller's new lead is always their own, the owner can assign anyone", (t) => {
  const { act, asha, admin } = fixture(t);
  const mine = act.perform("POST", "/leads", asha, { name: "Sri Oils", phone: "9840011111", source: "Website", owner: "u2" }).lead;
  assert.equal(mine.owner_id, "u1"); // cannot hand the lead to someone else
  const theirs = act.perform("POST", "/leads", admin, { name: "Kumar", phone: "9840022222", source: "Website", owner: "u2" }).lead;
  assert.equal(theirs.owner_id, "u2");
  assert.throws(() => act.perform("POST", "/leads", asha, { name: "Dup", phone: "+91 98400 11111", source: "Website" }), /already|exists|duplicate/i);
});

test("callers cannot touch another caller's lead; unknown ids look like not found", (t) => {
  const { act, asha, ravi, admin } = fixture(t);
  const lead = act.perform("POST", "/leads", asha, { name: "Sri Oils", phone: "9840011111", source: "Website" }).lead;
  for (const [method, path, body] of [
    ["POST", `/leads/${lead.id}/status`, { status: "Interested Customer" }],
    ["POST", `/leads/${lead.id}/notes`, { text: "hello" }],
    ["POST", `/leads/${lead.id}/tasks`, { title: "Call", dueAt: "2026-11-01T10:00:00Z" }],
    ["PATCH", `/leads/${lead.id}`, { city: "Salem" }],
  ]) assert.throws(() => act.perform(method, path, ravi, body), (e) => e.status === 404);
  assert.throws(() => act.perform("POST", `/leads/${lead.id}/assign`, asha, { owner: "u2" }), (e) => e.status === 403);
  assert.equal(act.perform("POST", `/leads/${lead.id}/assign`, admin, { owner: "u2" }).lead.owner_id, "u2");
  assert.throws(() => act.perform("DELETE", "/leads/x", admin, {}), (e) => e.status === 404);
});

test("status needs a lost reason to close, a note and a task show on the lead, tasks close", (t) => {
  const { act, q, asha } = fixture(t);
  const lead = act.perform("POST", "/leads", asha, { name: "Sri Oils", phone: "9840011111", source: "Website" }).lead;
  assert.equal(status(act.perform("POST", `/leads/${lead.id}/status`, asha, { status: "Quotation Shared" }).lead), "st_quotation");
  assert.throws(() => act.perform("POST", `/leads/${lead.id}/status`, asha, { status: "Lost" }), /reason/i);
  act.perform("POST", `/leads/${lead.id}/notes`, asha, { text: "Wants 20 kg wooden press" });
  assert.throws(() => act.perform("POST", `/leads/${lead.id}/notes`, asha, { text: "  " }), /required/);
  const { task } = act.perform("POST", `/leads/${lead.id}/tasks`, asha, { title: "Send quotation", dueAt: "2026-11-02T05:00:00Z" });
  assert.equal(q.leadWork(lead.id).tasks.length, 1);
  assert.equal(q.getLead(lead.id).next_followup_at, "2026-11-02T05:00:00.000Z");
  act.perform("POST", `/tasks/${task.id}/close`, asha, {});
  assert.equal(q.leadWork(lead.id).tasks.length, 0);
  const texts = q.activities(lead.id).items.map((a) => a.text);
  assert.ok(texts.includes("Wants 20 kg wooden press"));
  act.perform("POST", `/leads/${lead.id}/status`, asha, { status: "Lost", lostReason: "Price / budget issue" });
  assert.equal(q.getLead(lead.id).lost_reason, "Price / budget issue");
});

test("a call outcome applies its effect and only the lead's owner (or the owner) can record it", (t) => {
  const { act, store, q, asha, ravi } = fixture(t);
  const lead = act.perform("POST", "/leads", asha, { name: "Sri Oils", phone: "9840011111", source: "Website" }).lead;
  const { call } = store.logCall({ phone: lead.phone_e164, direction: "Outgoing", startedAt: "2026-10-02T05:00:00.000Z", duration: 90, deviceId: "d", localId: "1", userId: "u1" });
  assert.throws(() => act.perform("POST", `/calls/${call.id}/outcome`, ravi, { outcome: "Interested" }), (e) => e.status === 404);
  const after = act.perform("POST", `/calls/${call.id}/outcome`, asha, { outcome: "Interested", note: "Needs 3-phase" }).lead;
  assert.equal(status(after), "st_interested");
  assert.equal(q.leadWork(lead.id).calls[0].outcome, "Interested");
  assert.throws(() => act.perform("POST", `/calls/${call.id}/outcome`, asha, { outcome: "Nonsense" }), (e) => e.status === 400);
});
