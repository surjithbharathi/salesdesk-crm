import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { leadScreen } from "./lead-screen.mjs";

function world() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE records(kind TEXT, id TEXT, body TEXT, PRIMARY KEY(kind,id))");
  const put = (kind, o) => db.prepare("INSERT OR REPLACE INTO records VALUES(?,?,?)").run(kind, o.id, JSON.stringify(o));
  const get = (kind, id) => { const r = db.prepare("SELECT body FROM records WHERE kind=? AND id=?").get(kind, id); return r && JSON.parse(r.body); };
  put("leads", { id: "mine", name: "Ravi", phone: "919840000011", owner: "u1", stage: "New", probableState: "Tamil Nadu", telecrm: { x: 1 } });
  put("leads", { id: "free", name: "My Airtel", phone: "919690000027", owner: "", stage: "New" });
  put("leads", { id: "theirs", name: "Other", phone: "919000000022", owner: "u2", stage: "New" });
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

test("a lead the TeleCRM copy owns is its real owner's: they can edit it, and the copy is not in the team list", () => {
  const w = world();
  w.db.prepare("INSERT OR REPLACE INTO records VALUES(?,?,?)").run("leads", "mirrored", JSON.stringify({ id: "mirrored", name: "From TeleCRM", phone: "919840000026", owner: "tc-user-1", stage: "New" }));
  w.db.prepare("INSERT OR REPLACE INTO records VALUES(?,?,?)").run("activities", "m1", JSON.stringify({ id: "m1", leadId: "mirrored", type: "Note", text: "Said yes", userId: "tc-user-1", occurredAt: "2026-11-02T10:00:00Z" }));
  const users = () => [{ id: "u1", name: "Surjith" }, { id: "u2", name: "Priya" }, { id: "tc-user-1", name: "Surjith" }];
  const links = new Map([["tc-user-1", "u1"]]);
  const r = leadScreen({ ...w, users, links }, "mirrored", { id: "u1", admin: false });
  assert.equal(r.canEdit, true, "the owner can change the stage from the phone");
  assert.equal(r.canArchive, true);
  assert.equal(r.canAssign, true);
  assert.equal(r.lead.owner, "u1");
  assert.equal(r.lead.ownerName, "Surjith");
  assert.equal(r.activities[0].by, "Surjith");
  assert.deepEqual(r.team.map((u) => u.id), ["u1", "u2"], "the copy is not offered as a person to give the lead to");
  // a colleague still cannot open it
  assert.throws(() => leadScreen({ ...w, users, links }, "mirrored", { id: "u2", admin: false }), /colleague/);
});
