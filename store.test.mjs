import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { migrate } from "./db-migrate.mjs";
import { createStore, StoreError } from "./store.mjs";

const migrations = fileURLToPath(new URL("./migrations/", import.meta.url));
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  t.after(() => db.close());
  migrate(db, migrations);
  let tick = Date.parse("2026-10-29T09:00:00.000Z");
  const store = createStore(db, { now: () => new Date((tick += 1000)).toISOString() });
  for (const [id, name, role] of [["u1", "Asha", "role_caller"], ["u2", "Ravi", "role_caller"]])
    db.prepare("INSERT INTO users(id,name,role_id,created_at,updated_at) VALUES(?,?,?,?,?)").run(id, name, role, "x", "x");
  const lead = (over = {}) => store.createLead({ name: "Kumar", phone: "98765 43210", source: "IndiaMart", owner: "u1", ...over });
  const status = (id) => db.prepare("SELECT status_id s FROM leads WHERE id=?").get(id).s;
  const events = (type) => db.prepare("SELECT * FROM events WHERE type=?").all(type);
  const activities = (id, type) => db.prepare("SELECT * FROM activities WHERE lead_id=? AND type=? ORDER BY occurred_at").all(id, type);
  return { db, store, lead, status, events, activities };
}
const code = (status) => (error) => error instanceof StoreError && error.status === status;
const call = (over = {}) => ({
  phone: "+91 98765 43210", direction: "Outgoing", startedAt: Date.parse("2026-10-29T08:00:00.000Z"), duration: 60,
  deviceId: "d1", localId: "c1", userId: "u1", ...over,
});

test("createLead: canonical phone, required, unique across numbers, source captured once", (t) => {
  const { store, lead, events, activities } = fixture(t);
  const a = lead();
  assert.equal(a.phone_e164, "919876543210");
  assert.equal(a.status_id, "st_new_lead");
  assert.equal(a.first_source_id, "src_indiamart");
  assert.equal(a.latest_source_id, "src_indiamart");
  assert.equal(a.owner_id, "u1");
  assert.ok(a.assigned_at);
  assert.equal(events("lead.created").length, 1);
  assert.equal(activities(a.id, "system").length, 1);
  for (const phone of ["9876543210", "09876543210", "+91 98765-43210"])
    assert.throws(() => lead({ phone }), code(409));
  assert.throws(() => store.createLead({ name: "No phone" }), /Phone number is required/);
  assert.throws(() => store.createLead({ name: "Bad", phone: "123" }), code(400));
  assert.throws(() => store.createLead({ name: "", phone: "9111111111" }), /name required/);
  assert.throws(() => lead({ phone: "9111111111", owner: "ghost" }), /active user/);
  store.addAlternatePhone(a.id, "9000000001");
  assert.throws(() => lead({ phone: "9000000001" }), code(409)); // alternate numbers are protected too
  assert.equal(store.sourceOf("Brand New Directory").id, "src_brand_new_directory");
  assert.equal(store.sourceOf("").id, "src_other");
});

test("captureLead: new enquiry creates a lead, repeat enquiry adds an event not a clone", (t) => {
  const { store, activities, events } = fixture(t);
  const first = store.captureLead({ name: "Kumar", phone: "9876543210", source: "IndiaMart" });
  assert.equal(first.created, true);
  const again = store.captureLead({ name: "Kumar K", phone: "+919876543210", source: "Whatsapp", message: "Price?" });
  assert.equal(again.created, false);
  assert.equal(again.lead.id, first.lead.id);
  assert.equal(again.lead.is_repeat, 1);
  assert.equal(again.lead.repeat_count, 1);
  assert.equal(again.lead.capture_count, 2);
  assert.equal(again.lead.first_source_id, "src_indiamart"); // unchanged
  assert.equal(again.lead.latest_source_id, "src_whatsapp");
  assert.equal(activities(first.lead.id, "repeat_enquiry").length, 1);
  assert.equal(events("lead.repeat_enquiry").length, 1);
  assert.equal(store.tx(() => store.captureLead({ name: "X", phone: "9876543210", source: "Website" })).lead.repeat_count, 2);
});

test("updateLead: whitelist, phone clash, custom field merge, audit trail", (t) => {
  const { store, lead, activities } = fixture(t);
  const a = lead(), b = lead({ name: "Other", phone: "9111111111" });
  assert.throws(() => store.updateLead(a.id, { phone: "9111111111" }), code(409));
  assert.throws(() => store.updateLead(a.id, { status_id: "st_won" }), /cannot be edited here/);
  assert.throws(() => store.updateLead(a.id, { owner_id: "u2" }), /cannot be edited here/);
  assert.throws(() => store.updateLead(a.id, { rating: 9 }), /CHECK/);
  const updated = store.updateLead(a.id, { city: "Coimbatore", custom: { gst: "33ABC" }, phone: "98765 43211" }, { userId: "u1" });
  assert.equal(updated.city, "Coimbatore");
  assert.equal(updated.phone_e164, "919876543211");
  assert.deepEqual(updated.custom, { gst: "33ABC" });
  assert.deepEqual(store.updateLead(a.id, { custom: { size: "20kg" } }).custom, { gst: "33ABC", size: "20kg" });
  assert.equal(activities(a.id, "field_change").length, 2);
  const same = store.updateLead(a.id, { city: "Coimbatore" });
  assert.equal(activities(a.id, "field_change").length, 2); // no-op writes nothing
  assert.equal(same.city, "Coimbatore");
  assert.equal(store.getLead(b.id).phone_e164, "919111111111");
});

test("setStatus: lost needs a reason (default applied), leaving lost clears it, history kept", (t) => {
  const { store, lead, activities, status } = fixture(t);
  const a = lead();
  store.setStatus(a.id, "Intrested Customer"); // old spelling resolves
  assert.equal(status(a.id), "st_interested");
  const lost = store.setStatus(a.id, "Lost");
  assert.equal(lost.lost_reason_id, "lr_unknown");
  const reasoned = store.setStatus(a.id, "st_won");
  assert.equal(reasoned.lost_reason_id, null);
  assert.throws(() => store.setStatus(a.id, "st_lost", { lostReason: "Nonsense" }), code(400));
  assert.equal(store.getLead(a.id).status_id, "st_won"); // the failed change left no trace
  store.setStatus(a.id, "st_lost", { lostReason: "Budget Issues" });
  assert.equal(store.getLead(a.id).lost_reason_id, "lr_price");
  assert.equal(activities(a.id, "status_change").length, 4);
  assert.throws(() => store.setStatus(a.id, "Nonsense"), code(400));
  assert.equal(store.setStatus(a.id, "st_lost").status_id, "st_lost"); // same status: no new history
  assert.equal(activities(a.id, "status_change").length, 4);
});

test("assign: tracked, previous owner kept, protected leads refuse automatic reassignment", (t) => {
  const { store, lead, activities } = fixture(t);
  const a = lead();
  const moved = store.assign(a.id, "u2", { by: "u1" });
  assert.equal(moved.owner_id, "u2");
  assert.equal(moved.previous_owner_id, "u1");
  assert.equal(moved.assigned_by, "u1");
  assert.equal(activities(a.id, "assignment").length, 1);
  store.assign(a.id, "u2", { by: "u1" }); // no change, nothing logged
  assert.equal(activities(a.id, "assignment").length, 1);
  store.updateLead(a.id, { lead_protection: "Protected" });
  assert.throws(() => store.assign(a.id, "u1", { automatic: true }), code(409));
  assert.equal(store.assign(a.id, "u1", { by: "u1" }).owner_id, "u1"); // manual is allowed
  assert.throws(() => store.assign(a.id, "ghost"), /active user/);
  assert.equal(store.assign(a.id, null).owner_id, null);
});

test("logCall: matches any number of the lead, updates metrics, first touch and status once", (t) => {
  const { store, lead, status, activities, events } = fixture(t);
  const a = lead();
  store.addAlternatePhone(a.id, "9000000002");
  const missed = store.logCall(call({ direction: "Missed", duration: 0, localId: "m1", startedAt: Date.parse("2026-10-29T07:00:00Z") }));
  assert.equal(missed.call.connected, 0);
  let l = store.getLead(a.id);
  assert.equal(l.first_touch_at, null); // a missed incoming call is not rep work
  assert.equal(status(a.id), "st_new_lead");
  assert.equal(l.call_count, 1);
  const first = store.logCall(call());
  assert.equal(first.duplicate, false);
  assert.equal(first.call.connected, 1);
  l = store.getLead(a.id);
  assert.equal(l.first_touch_at, "2026-10-29T08:00:00.000Z");
  assert.equal(l.attempts, 1);
  assert.equal(l.connected_count, 1);
  assert.equal(l.total_call_seconds, 60);
  assert.equal(l.last_call_at, "2026-10-29T08:00:00.000Z");
  assert.equal(status(a.id), "st_contact_attempted");
  const replay = store.logCall(call());
  assert.equal(replay.duplicate, true);
  assert.equal(store.getLead(a.id).call_count, 2);
  assert.throws(() => store.logCall(call({ duration: 61 })), code(409));
  store.logCall(call({ phone: "9000000002", localId: "c2", startedAt: Date.parse("2026-10-29T08:30:00Z"), duration: 30 }));
  assert.equal(store.getLead(a.id).total_call_seconds, 90);
  assert.equal(activities(a.id, "call").length, 3);
  assert.equal(events("call.logged").length, 3);
  assert.throws(() => store.logCall(call({ phone: "9555555555", localId: "x" })), code(404));
  assert.throws(() => store.logCall(call({ direction: "Sideways", localId: "y" })), /direction/);
  assert.throws(() => store.logCall(call({ duration: -1, localId: "z" })), /duration/);
});

test("call outcomes apply their effect: interested opens, not interested closes with reason, call later keeps", (t) => {
  const { store, lead, status } = fixture(t);
  const interested = lead();
  const c1 = store.logCall(call()).call;
  store.setCallOutcome(c1.id, "Interested", { note: "wants 20 kg press" });
  assert.equal(status(interested.id), "st_interested");
  assert.equal(store.getLead(interested.id).lost_reason_id, null);

  const declined = lead({ name: "B", phone: "9222222222" });
  const c2 = store.logCall(call({ phone: "9222222222", localId: "c2" })).call;
  store.setCallOutcome(c2.id, "co_not_interested");
  assert.equal(status(declined.id), "st_lost");
  assert.equal(store.getLead(declined.id).lost_reason_id, "lr_no_need");

  const later = lead({ name: "C", phone: "9333333333" });
  const c3 = store.logCall(call({ phone: "9333333333", localId: "c3", duration: 0, direction: "Incoming" })).call;
  store.setCallOutcome(c3.id, "Call later");
  assert.equal(status(later.id), "st_contact_attempted");

  const won = lead({ name: "D", phone: "9444444444" });
  store.setStatus(won.id, "Won");
  const c4 = store.logCall(call({ phone: "9444444444", localId: "c4" })).call;
  store.setCallOutcome(c4.id, "Not interested"); // never closes an already-won lead
  assert.equal(status(won.id), "st_won");
  assert.throws(() => store.setCallOutcome(c4.id, "Whatever"), code(400));
  assert.throws(() => store.setCallOutcome("missing", "Interested"), code(404));
});

test("tasks keep next_followup_at correct and log to the timeline", (t) => {
  const { store, lead, activities } = fixture(t);
  const a = lead();
  const soon = store.addTask({ leadId: a.id, ownerId: "u1", title: "Send quotation", dueAt: "2026-11-01T10:00:00Z" });
  store.addTask({ leadId: a.id, ownerId: "u1", title: "Check payment", dueAt: "2026-11-05T10:00:00Z" });
  assert.equal(store.getLead(a.id).next_followup_at, "2026-11-01T10:00:00.000Z");
  store.completeTask(soon.id, { userId: "u1" });
  assert.equal(store.getLead(a.id).next_followup_at, "2026-11-05T10:00:00.000Z");
  const second = store.cancelTask(store.addTask({ leadId: a.id, title: "x", dueAt: "2026-11-02T00:00:00Z" }).id);
  assert.equal(second.status, "Cancelled");
  assert.equal(store.getLead(a.id).next_followup_at, "2026-11-05T10:00:00.000Z");
  assert.equal(store.completeTask(soon.id).status, "Done"); // idempotent
  assert.throws(() => store.addTask({ leadId: a.id, title: "", dueAt: "2026-11-01" }), /title/);
  assert.throws(() => store.addTask({ leadId: a.id, title: "x", dueAt: "nope" }), /due date/);
  assert.throws(() => store.addTask({ leadId: "ghost", title: "x", dueAt: "2026-11-01" }), code(404));
  assert.ok(activities(a.id, "task").length >= 4);
});

test("operations are atomic: a failure inside rolls back every change, including events", (t) => {
  const { store, lead, db } = fixture(t);
  const a = lead();
  const eventsBefore = db.prepare("SELECT count(*) c FROM events").get().c;
  assert.throws(() =>
    store.tx(() => {
      store.setStatus(a.id, "st_interested");
      store.addTag(a.id, "Hot");
      store.updateLead(a.id, { city: "Salem" });
      throw new Error("boom");
    }),
  );
  const after = store.getLead(a.id);
  assert.equal(after.status_id, "st_new_lead");
  assert.equal(after.city, null);
  assert.deepEqual(after.tags, []);
  assert.equal(db.prepare("SELECT count(*) c FROM events").get().c, eventsBefore);
  // nested failures roll back only the inner part
  store.tx(() => {
    store.setStatus(a.id, "st_requirement");
    assert.throws(() => store.tx(() => { store.setStatus(a.id, "st_won"); throw new Error("inner"); }));
  });
  assert.equal(store.getLead(a.id).status_id, "st_requirement");
});

test("recomputeMetrics rebuilds counters from the rows and tags work", (t) => {
  const { store, lead, db } = fixture(t);
  const a = lead();
  store.logCall(call());
  store.logCall(call({ localId: "c2", startedAt: Date.parse("2026-10-29T08:10:00Z"), duration: 40 }));
  store.addTask({ leadId: a.id, title: "T", dueAt: "2026-12-01T00:00:00Z" });
  db.prepare("UPDATE leads SET call_count=99, connected_count=99, total_call_seconds=99, attempts=99, next_followup_at=NULL WHERE id=?").run(a.id);
  const fixed = store.recomputeMetrics(a.id);
  assert.equal(fixed.call_count, 2);
  assert.equal(fixed.connected_count, 2);
  assert.equal(fixed.total_call_seconds, 100);
  assert.equal(fixed.attempts, 2);
  assert.equal(fixed.next_followup_at, "2026-12-01T00:00:00.000Z");
  const tagged = store.addTag(a.id, "hot");
  assert.deepEqual(tagged.tags.map((x) => x.label), ["Hot"]);
  assert.deepEqual(store.addTag(a.id, "Cold").tags.map((x) => x.label), ["Cold", "Hot"]);
  assert.deepEqual(store.removeTag(a.id, "Hot").tags.map((x) => x.label), ["Cold"]);
});
