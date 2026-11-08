import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createWorkspaceAccess } from "./workspace-access.mjs";

function world() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id));
    CREATE TABLE auth_accounts(user_id TEXT PRIMARY KEY, username TEXT, role TEXT);
    CREATE TABLE auth_sessions(token_hash TEXT PRIMARY KEY, user_id TEXT);
    CREATE TABLE auth_resets(token_hash TEXT PRIMARY KEY, user_id TEXT);`);
  const get = (k, id) => { const r = db.prepare("SELECT body FROM records WHERE kind=? AND id=?").get(k, id); return r && JSON.parse(r.body); };
  const put = (k, v) => db.prepare("INSERT OR REPLACE INTO records VALUES(?,?,?)").run(k, v.id, JSON.stringify(v));
  const access = createWorkspaceAccess({ db, get, put, userAuth: { listAccounts: () => [] }, crmOwnerId: "boss" });
  const person = (id, role, login = true) => {
    put("users", { id, name: id, active: true, role });
    if (login) { db.prepare("INSERT INTO auth_accounts VALUES(?,?,?)").run(id, id, role === "member" ? "member" : "admin"); db.prepare("INSERT INTO auth_sessions VALUES(?,?)").run("s-" + id, id); }
    db.prepare("INSERT OR REPLACE INTO workspace_roles VALUES(?,?,?)").run(id, role, "{}");
  };
  person("boss", "owner"); person("admin1", "admin"); person("bala", "member"); person("ghost", "member", false);
  put("leads", { id: "L1", name: "Lead 1", owner: "bala" }); put("leads", { id: "L2", name: "Lead 2", owner: "admin1" });
  put("tasks", { id: "T1", title: "Call", owner: "bala" });
  return { db, get, access, as: (id) => ({ user: { id } }) };
}
const status = (n) => (e) => e.status === n;

test("removing a person deletes their login and role, unassigns what they owned and keeps the leads", () => {
  const w = world();
  const out = w.access.remove(w.as("boss"), "bala");
  assert.deepEqual(out.unassigned, { leads: 1, tasks: 1, deals: 0 });
  assert.ok(!w.get("users", "bala"));
  assert.equal(w.db.prepare("SELECT COUNT(*) n FROM auth_accounts WHERE user_id='bala'").get().n, 0);
  assert.equal(w.db.prepare("SELECT COUNT(*) n FROM auth_sessions WHERE user_id='bala'").get().n, 0);
  assert.equal(w.db.prepare("SELECT COUNT(*) n FROM workspace_roles WHERE user_id='bala'").get().n, 0);
  assert.equal(w.get("leads", "L1").owner, "");
  assert.equal(w.get("leads", "L1").name, "Lead 1");
  assert.equal(w.get("leads", "L2").owner, "admin1", "other people's leads are untouched");
  assert.equal(w.get("tasks", "T1").owner, "");
});

test("a person without a login can be removed too", () => {
  const w = world();
  assert.equal(w.access.remove(w.as("boss"), "ghost").removed, true);
  assert.ok(!w.get("users", "ghost"));
});

test("you cannot remove yourself, the CRM owner, someone above you, or a stranger; a caller cannot remove anyone", () => {
  const w = world();
  assert.throws(() => w.access.remove(w.as("admin1"), "admin1"), status(409));
  assert.throws(() => w.access.remove(w.as("admin1"), "boss"), status(403));
  assert.throws(() => w.access.remove(w.as("boss"), "nobody"), status(404));
  assert.throws(() => w.access.remove(w.as("bala"), "ghost"), status(403));
  w.db.prepare("UPDATE workspace_roles SET role='owner' WHERE user_id='admin1'").run();
  assert.throws(() => w.access.remove(w.as("bala"), "admin1"), status(403));
});

test("the last active workspace owner cannot be removed", () => {
  const w = world();
  w.db.prepare("UPDATE workspace_roles SET role='owner' WHERE user_id='admin1'").run();
  w.db.prepare("DELETE FROM workspace_roles WHERE user_id='boss'").run();
  w.db.prepare("INSERT INTO workspace_roles VALUES('boss','admin','{}')").run();
  assert.throws(() => w.access.remove(w.as("boss"), "admin1"), (e) => e.status === 400 || e.status === 403);
});
