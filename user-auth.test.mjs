import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createUserAuth } from "./user-auth.mjs";

const password = "a sufficiently long password";
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const users = new Map([
    ["u1", { id: "u1", name: "Manager", active: true }],
    ["u2", { id: "u2", name: "Sales", active: true }],
    ["u3", { id: "u3", name: "Other", active: true }],
  ]);
  let time = Date.now();
  const auth = createUserAuth({ db, getUser: (id) => users.get(id), now: () => time });
  return {
    db,
    users,
    auth,
    advance: (ms) => {
      time += ms;
    },
    bootstrap: () =>
      auth.bootstrap({
        userId: "u1",
        username: " Manager@Example.com ",
        password,
        company: " Example Company ",
      }),
  };
}
const status = (expected) => (error) => error.status === expected;

test("shared accounts retain CRM user IDs; salts and hashed sessions contain no plaintext secrets", (t) => {
  const { db, auth, bootstrap } = fixture(t);
  assert.equal(auth.configured(), false);
  const initial = bootstrap();
  assert.equal(auth.configured(), true);
  assert.deepEqual(initial.user, {
    id: "u1",
    name: "Manager",
    username: "manager@example.com",
    role: "admin",
  });
  assert.equal(initial.company, "Example Company");
  assert.equal(auth.authenticate(initial.token).user.id, "u1");
  auth.createAccount(initial.user, { userId: "u2", username: "sales", password });
  const rows = db.prepare("SELECT * FROM auth_accounts").all();
  assert.notEqual(rows[0].salt, rows[1].salt);
  assert.notEqual(rows[0].password_hash, rows[1].password_hash);
  assert.ok(!JSON.stringify(rows).includes(password));
  const deviceId = "12345678-1234-4234-8234-123456789abc";
  const login = auth.login({ username: " SALES ", password, deviceId });
  assert.deepEqual(auth.authenticate(login.token), {
    user: login.user,
    company: "Example Company",
    deviceId,
  });
  assert.equal(login.user.id, "u2");
  assert.ok(!JSON.stringify(db.prepare("SELECT * FROM auth_sessions").all()).includes(login.token));
  assert.ok(!JSON.stringify(auth.listAccounts()).includes("password"));
  assert.equal(auth.listAccounts().length, 2);
});

test("bootstrap, active users, authority, usernames, duplicates and password policies", (t) => {
  const { auth, bootstrap, users } = fixture(t);
  assert.throws(
    () => auth.bootstrap({ userId: "missing", username: "valid", password, company: "Test" }),
    status(400),
  );
  assert.equal(auth.configured(), false);
  const admin = bootstrap();
  assert.throws(bootstrap, status(409));
  assert.throws(
    () =>
      auth.createAccount(
        { id: "u2", role: "admin" },
        { userId: "u3", username: "other", password },
      ),
    status(403),
  );
  for (const bad of ["short", "x".repeat(201), null])
    assert.throws(
      () => auth.createAccount(admin.user, { userId: "u2", username: "sales", password: bad }),
      status(400),
    );
  assert.throws(
    () => auth.createAccount(admin.user, { userId: "u2", username: "invalid space", password }),
    status(400),
  );
  auth.createAccount(admin, { userId: "u2", username: "sales", password });
  assert.throws(
    () => auth.createAccount(admin.user, { userId: "u3", username: "SALES", password }),
    status(409),
  );
  assert.throws(
    () => auth.createAccount(admin.user, { userId: "u2", username: "different", password }),
    status(409),
  );
  const member = auth.login({ username: "sales", password });
  assert.throws(
    () => auth.createAccount(member.user, { userId: "u3", username: "other", password }),
    status(403),
  );
  users.get("u1").active = false;
  assert.throws(
    () => auth.createAccount(admin.user, { userId: "u3", username: "other", password }),
    status(401),
  );
});

test("sessions expire, revoke, reject invalid tokens and stop disabled users", (t) => {
  const { auth, bootstrap, advance, users } = fixture(t);
  const session = bootstrap();
  assert.throws(() => auth.authenticate("garbage"), status(401));
  users.get("u1").active = false;
  assert.throws(() => auth.authenticate(session.token), status(401));
  assert.throws(() => auth.login({ username: "manager@example.com", password }), status(401));
  users.get("u1").active = true;
  const other = auth.login({ username: "manager@example.com", password });
  auth.revoke(other.token);
  assert.throws(() => auth.authenticate(other.token), status(401));
  advance(12 * 60 * 60 * 1000);
  assert.throws(() => auth.authenticate(session.token), status(401));
  assert.throws(
    () => auth.login({ username: "manager@example.com", password, deviceId: "not-uuid" }),
    status(400),
  );
});

test("five failed logins throttle a username for five minutes with consistent errors", (t) => {
  const { auth, bootstrap, advance } = fixture(t);
  bootstrap();
  for (let i = 0; i < 5; i++)
    assert.throws(
      () => auth.login({ username: "manager@example.com", password: "bad" }),
      status(401),
    );
  assert.throws(() => auth.login({ username: "manager@example.com", password }), status(401));
  advance(5 * 60 * 1000);
  assert.equal(auth.login({ username: "manager@example.com", password }).user.id, "u1");
  assert.throws(() => auth.login({ username: "nonexistent", password }), status(401));
});
