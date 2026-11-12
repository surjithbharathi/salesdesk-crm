import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { leadScreen } from "./lead-screen.mjs";

function world() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE records(kind TEXT, id TEXT, body TEXT, PRIMARY KEY(kind,id))");
  const put = (kind, o) => db.prepare("INSERT OR REPLACE INTO records VALUES(?,?,?)").run(kind, o.id, JSON.stringify(o));
  const get = (kind, id) => { const r = db.prepare("SELECT body FROM records WHERE kind=? AND id=?").get(kind, id); return r && JSON.parse(r.body); };
  put("leads", { id: "mine", name: "Ravi", phone: "919840012345", owner: "u1", stage: "New", probableState: "Tamil Nadu", telecrm: { x: 1 } });
  put("leads", { id: "free", name: "My Airtel", phone: "919690002999", owner: "", stage: "New" });
  put("leads", { id: "theirs", name: "Other", phone: "919000000000", owner: "u2", stage: "New" });
  put("activities", { id: "a1", leadId: "mine", type: "Note", text: "Asked for price", userId: "u1", occurredAt: "2026-11-01T10:00:00Z" });
  put("activities", { id: "a2", leadId: "mine", type: "Call", direction: "Outgoing", duration: 60, userId: "u1", occurredAt: "2026-11-05T10:00:00Z", importedFrom: "salesmax" });
  put("tasks", { id: "t1", leadId: "mine", title: "Call back", due: "2026-11-12T05:00:00Z", status: "Open" });
  put("tasks", { id: "t2", leadId: "mine", title: "Old", due: "2026-10-01T05:00:00Z", status: "Done" });
  return { db, get, users: () => [{ id: "u1", name: "Surjith" }, { id: "u2", name: "Priya" }] };
}

test("the phone gets one lead with its full history and open follow-ups", () => {
  const r = leadScreen(world(), "mine", { id: "u1", admin: false });
  assert.equal(r.lead.name, "Ravi");
  assert.equal(r.lead.ownerName, "Surjith");
  assert.equal(r.lead.probableState, "Tamil Nadu");
  assert.equal(r.lead.telecrm, undefined);
  assert.deepEqual(r.activities.map((a) => a.id), ["a2", "a1"], "newest first, imported history included");
  assert.equal(r.activities[0].by, "Surjith");
  assert.deepEqual(r.tasks.map((t) => t.id), ["t1"]);
  assert.equal(r.canEdit, true);
  assert.equal(r.canArchive, true, "the owner may archive");
  assert.equal(r.canDelete, false, "only an administrator may delete");
});

test("an administrator may delete or archive any lead; a message keeps its sender", () => {
  const w = world();
  w.db.prepare("INSERT INTO records VALUES(?,?,?)").run("activities", "m1", JSON.stringify({ id: "m1", leadId: "mine", type: "Message", direction: "Outgoing", text: "Hi", sender: "Priya", via: "WhatsApp", createdAt: "2026-11-06T10:00:00Z" }));
  const r = leadScreen(w, "theirs", { id: "u1", admin: true });
  assert.equal(r.canDelete, true);
  assert.equal(r.canArchive, true);
  const m = leadScreen(w, "mine", { id: "u1", admin: false }).activities.find((a) => a.id === "m1");
  assert.equal(m.sender, "Priya");
  assert.equal(m.via, "WhatsApp");
});

test("unassigned leads open for everyone, a colleague's lead only for an administrator", () => {
  const w = world();
  assert.equal(leadScreen(w, "free", { id: "u1", admin: false }).canEdit, false);
  assert.throws(() => leadScreen(w, "theirs", { id: "u1", admin: false }), /colleague/);
  assert.equal(leadScreen(w, "theirs", { id: "u1", admin: true }).lead.ownerName, "Priya");
  assert.throws(() => leadScreen(w, "nope", { id: "u1", admin: true }), /not found/);
});

test("the owner can be changed by the lead's owner, an admin, or anyone for a lead nobody owns; the team comes along", () => {
  const w = world();
  assert.equal(leadScreen(w, "mine", { id: "u1", admin: false }).canAssign, true);
  assert.equal(leadScreen(w, "free", { id: "u2", admin: false }).canAssign, true);
  assert.equal(leadScreen(w, "theirs", { id: "u1", admin: true }).canAssign, true);
  assert.deepEqual(leadScreen(w, "mine", { id: "u1", admin: false }).team, [{ id: "u1", name: "Surjith" }, { id: "u2", name: "Priya" }]);
  const inactive = { ...w, users: () => [{ id: "u1", name: "Surjith" }, { id: "u3", name: "Left", active: false }] };
  assert.deepEqual(leadScreen(inactive, "mine", { id: "u1", admin: false }).team.map((u) => u.id), ["u1"]);
});
