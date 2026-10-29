import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalPhone } from "./phone.mjs";
import { createUserAuth } from "./user-auth.mjs";
import { createMobileSync } from "./mobile-sync.mjs";

const status = (expected) => (error) => error.status === expected;

test("canonical phone numbers compare equal however they were typed", () => {
  const same = [
    "+91 98765 43210",
    "98765 43210",
    "098765 43210",
    "0091 98765 43210",
    "919876543210",
    "(+91) 98765-43210",
  ];
  for (const value of same) assert.equal(canonicalPhone(value), "919876543210", value);
  assert.equal(canonicalPhone("+1 202 555 0100"), "12025550100");
  assert.equal(canonicalPhone("0422 2345678"), "914222345678"); // STD landline
  assert.equal(canonicalPhone("98765 43210", "971"), "9719876543210"); // configurable country
  for (const empty of ["", "   ", null, undefined, "abc"]) assert.equal(canonicalPhone(empty), "");
});

function authFixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const users = new Map([
    ["u1", { id: "u1", name: "Manager", active: true }],
    ["u2", { id: "u2", name: "Sales", active: true }],
  ]);
  let time = Date.now();
  const auth = createUserAuth({ db, getUser: (id) => users.get(id), now: () => time });
  const password = "a sufficiently long password";
  const admin = auth.bootstrap({ userId: "u1", username: "manager", password, company: "Co" });
  auth.createAccount(admin.user, { userId: "u2", username: "sales", password });
  return { auth, password, advance: (ms) => (time += ms) };
}

test("failed logins from one address cannot lock real users out from another", (t) => {
  const { auth, password } = authFixture(t);
  for (let i = 0; i < 5; i++)
    assert.throws(
      () => auth.login({ username: "sales", password: "wrong" }, { ip: "203.0.113.9" }),
      status(401),
    );
  // The attacker's address is throttled for that username, even with the right password...
  assert.throws(() => auth.login({ username: "sales", password }, { ip: "203.0.113.9" }), status(401));
  // ...but the real user from another address, and other users from the same address, still work.
  assert.equal(auth.login({ username: "sales", password }, { ip: "198.51.100.7" }).user.id, "u2");
  assert.equal(auth.login({ username: "manager", password }, { ip: "203.0.113.9" }).user.id, "u1");
});

test("many failures across usernames from one address throttle only that address", (t) => {
  const { auth, password } = authFixture(t);
  for (let i = 0; i < 100; i++)
    assert.throws(
      () => auth.login({ username: "ghost" + i, password: "wrong" }, { ip: "203.0.113.50" }),
      status(401),
    );
  assert.throws(() => auth.login({ username: "sales", password }, { ip: "203.0.113.50" }), status(401));
  assert.equal(auth.login({ username: "sales", password }, { ip: "198.51.100.8" }).user.id, "u2");
});

test("phone sessions last 30 days; browser sessions still expire after 12 hours", (t) => {
  const { auth, password, advance } = authFixture(t);
  const phone = auth.login({
    username: "sales",
    password,
    deviceId: "12345678-1234-4234-8234-123456789abc",
  });
  const browser = auth.login({ username: "manager", password });
  advance(13 * 60 * 60 * 1000);
  assert.throws(() => auth.authenticate(browser.token), status(401));
  assert.equal(auth.authenticate(phone.token).user.id, "u2");
  auth.revoke(phone.token);
  assert.throws(() => auth.authenticate(phone.token), status(401));
  const another = auth.login({
    username: "sales",
    password,
    deviceId: "12345678-1234-4234-8234-123456789abd",
  });
  advance(30 * 24 * 60 * 60 * 1000);
  assert.throws(() => auth.authenticate(another.token), status(401));
});

function mobileFixture(t, lead = {}) {
  const db = new DatabaseSync(":memory:");
  const dir = mkdtempSync(join(tmpdir(), "salesdesk-phase0-"));
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  db.exec("CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))");
  const all = (kind) =>
    db
      .prepare("SELECT body FROM records WHERE kind=?")
      .all(kind)
      .map((r) => JSON.parse(r.body));
  const get = (kind, id) => {
    const r = db.prepare("SELECT body FROM records WHERE kind=? AND id=?").get(kind, id);
    return r && JSON.parse(r.body);
  };
  const put = (kind, value) =>
    db
      .prepare("INSERT OR REPLACE INTO records VALUES(?,?,?)")
      .run(kind, value.id, JSON.stringify(value));
  const stamp = (value) => ({ id: randomUUID(), ...value });
  const tx = (fn) => {
    db.exec("BEGIN");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const log = (leadId, type, description, extra = {}) => {
    const a = stamp({ leadId, type, description, ...extra });
    put("activities", a);
    return a;
  };
  const api = createMobileSync({ db, all, get, put, stamp, tx, log, keyPath: join(dir, "key") });
  put("users", { id: "owner", active: true });
  put("leads", {
    id: "lead",
    owner: "owner",
    phone: "98765 43210", // stored without a country code
    stage: "New",
    firstTouchAt: null,
    ...lead,
  });
  const device = api.issue({ name: "Phone", owner: "owner" });
  const call = (overrides) => ({
    localId: "call-1",
    phone: "919876543210",
    startedAt: Date.now() - 120000,
    duration: 45,
    direction: "Outgoing",
    ...overrides,
  });
  return { api, device, get, call };
}

test("a lead stored without a country code still matches the phone's calls", (t) => {
  const f = mobileFixture(t);
  assert.deepEqual(f.api.targets(f.device), [{ id: "lead", phone: "919876543210" }]);
  assert.ok(f.api.call(f.device, f.call()).id);
});

test("a synced connected call counts as first touch, updates metrics and starts prospecting", (t) => {
  const f = mobileFixture(t);
  const payload = f.call();
  f.api.call(f.device, payload);
  const lead = f.get("leads", "lead");
  assert.equal(lead.firstTouchAt, new Date(payload.startedAt).toISOString());
  assert.equal(lead.stage, "Prospecting");
  assert.equal(lead.callCount, 1);
  assert.equal(lead.connectedCalls, 1);
  assert.equal(lead.totalCallSeconds, 45);
  assert.equal(lead.lastCallAt, new Date(payload.startedAt).toISOString());
  f.api.call(f.device, payload); // idempotent replay does not count twice
  assert.equal(f.get("leads", "lead").callCount, 1);
  f.api.call(f.device, f.call({ localId: "call-2", startedAt: payload.startedAt + 60000 }));
  const after = f.get("leads", "lead");
  assert.equal(after.callCount, 2);
  assert.equal(after.totalCallSeconds, 90);
  assert.equal(after.firstTouchAt, new Date(payload.startedAt).toISOString()); // earliest kept
});

test("an unanswered outgoing call is an attempt (first touch) but does not advance the stage", (t) => {
  const f = mobileFixture(t);
  f.api.call(f.device, f.call({ duration: 0 }));
  const lead = f.get("leads", "lead");
  assert.ok(lead.firstTouchAt);
  assert.equal(lead.stage, "New");
  assert.equal(lead.connectedCalls, 0);
  assert.equal(lead.callCount, 1);
});

test("a missed incoming call is not first touch and never changes the stage", (t) => {
  const f = mobileFixture(t);
  f.api.call(f.device, f.call({ direction: "Missed", duration: 0 }));
  const lead = f.get("leads", "lead");
  assert.equal(lead.firstTouchAt, null);
  assert.equal(lead.stage, "New");
  assert.equal(lead.callCount, 1);
});
