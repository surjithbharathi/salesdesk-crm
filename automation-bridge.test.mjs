import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createAutomationBridge } from "./automation-bridge.mjs";

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(
    "CREATE TABLE auth_accounts(user_id TEXT PRIMARY KEY,role TEXT); CREATE TABLE auth_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,expires_at INTEGER)",
  );
  const users = new Map(
    ["admin", "selected", "other"].map((id) => [id, { id, name: id, active: true }]),
  );
  for (const id of users.keys()) {
    db.prepare("INSERT INTO auth_accounts VALUES(?,?)").run(
      id,
      id === "admin" ? "admin" : "member",
    );
    db.prepare("INSERT INTO auth_sessions VALUES(?,?,?)").run(
      createHash("sha256").update(id).digest("hex"),
      id,
      Date.now() + 60000,
    );
  }
  const bridge = createAutomationBridge({
    db,
    getUser: (id) => users.get(id),
    config: { enabled: true, target: "http://127.0.0.1:5681" },
  });
  const issue = (id) =>
    bridge.issue({ user: users.get(id) }, id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  return { db, users, bridge, issue };
}
const forbidden = (e) => e.status === 403;

test("Automation defaults to denied for every account, including administrators", (t) => {
  const { bridge, issue } = fixture(t);
  for (const id of ["admin", "selected", "other"]) {
    assert.equal(bridge.status(id).canAccess, false);
    assert.throws(() => issue(id), forbidden);
  }
  assert.equal(bridge.status("admin").canManageAccess, true);
  assert.equal(bridge.status("other").canManageAccess, false);
});
test("Only an active database administrator can grant access to selected accounts", (t) => {
  const { bridge, users, issue } = fixture(t);
  assert.throws(() => bridge.setAccess("other", { userId: "other", enabled: true }), forbidden);
  assert.throws(() => bridge.accessList("other"), forbidden);
  bridge.setAccess("admin", { userId: "selected", enabled: true });
  assert.equal(bridge.status("selected").canAccess, true);
  assert.throws(() => issue("other"), forbidden);
  assert.equal(bridge.consume(issue("selected").ticket).userId, "selected");
  users.get("admin").active = false;
  assert.throws(() => bridge.setAccess("admin", { userId: "other", enabled: true }), forbidden);
});
test("Revocation removes pending handoffs and blocks new sessions and direct URLs", (t) => {
  const { bridge, issue, users } = fixture(t);
  bridge.setAccess("admin", { userId: "selected", enabled: true });
  const { ticket } = issue("selected");
  bridge.setAccess("admin", { userId: "selected", enabled: false });
  assert.throws(
    () => bridge.consume(ticket),
    (e) => e.status === 401,
  );
  assert.throws(() => issue("selected"), forbidden);
  assert.throws(
    () => bridge.proxy({ url: "/automation/", headers: {} }, {}, { user: users.get("selected") }),
    forbidden,
  );
});
test("Handoffs are one use and disabling a selected user prevents consumption", (t) => {
  const { bridge, issue, users } = fixture(t);
  bridge.setAccess("admin", { userId: "selected", enabled: true });
  const first = issue("selected");
  bridge.consume(first.ticket);
  assert.throws(
    () => bridge.consume(first.ticket),
    (e) => e.status === 401,
  );
  const next = issue("selected");
  users.get("selected").active = false;
  assert.throws(
    () => bridge.consume(next.ticket),
    (e) => e.status === 401,
  );
});
