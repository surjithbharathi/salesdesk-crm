import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMobileSync, audioType, MAX_AUDIO } from "./mobile-sync.mjs";

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  const dir = mkdtempSync(join(tmpdir(), "salesdesk-mobile-test-"));
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
  const keyPath = join(dir, "recordings.key");
  const api = createMobileSync({ db, all, get, put, stamp, tx, log, keyPath });
  put("users", { id: "owner", active: true });
  put("users", { id: "other", active: true });
  put("leads", { id: "lead", owner: "owner", phone: "+91 98765 43210" });
  put("leads", { id: "other-lead", owner: "other", phone: "919999999999" });
  put("leads", { id: "archived", owner: "owner", phone: "918888888888", archived: true });
  const device = api.issue({ name: "Test phone", owner: "owner" });
  const payload = (overrides) => ({
    localId: "call-1",
    phone: "919876543210",
    startedAt: Date.now() - 60000,
    duration: 30,
    direction: "Outgoing",
    ...overrides,
  });
  const audio = Buffer.from("OggS test recording content");
  const meta = (c) => ({
    mode: "auto",
    duration: c.duration,
    modified: c.startedAt + c.duration * 1000,
  });
  return { api, db, all, get, put, keyPath, device, payload, audio, meta };
}
const status = (expected) => (error) => error.status === expected;

test("device credentials are hashed, redacted, owner scoped, and revocable", (t) => {
  const f = fixture(t),
    { api, device, db } = f;
  assert.equal(api.authenticate(`Bearer ${device.token}`).id, device.id);
  assert.equal(api.devices()[0].token, undefined);
  const row = db.prepare("SELECT * FROM mobile_devices").get();
  assert.equal(row.token_hash, createHash("sha256").update(device.token).digest("hex"));
  assert.ok(!row.body.includes(device.token));
  assert.deepEqual(api.targets(device), [{ id: "lead", phone: "919876543210" }]);
  for (const header of [undefined, "", `Basic ${device.token}`, "Bearer invalid"])
    assert.throws(() => api.authenticate(header), status(401));
  assert.throws(() => api.issue({ name: "Phone", owner: "absent" }), status(400));
  f.put("users", { id: "owner", active: false });
  assert.throws(() => api.authenticate(`Bearer ${device.token}`), status(401));
  f.put("users", { id: "owner", active: true });
  api.revoke(device.id);
  assert.equal(api.devices()[0].revoked, true);
  assert.equal(db.prepare("SELECT token_hash FROM mobile_devices").get().token_hash, null);
  assert.throws(() => api.authenticate(`Bearer ${device.token}`), status(401));
});

test("call sync permits exactly one assigned active business lead and is idempotent", (t) => {
  const f = fixture(t),
    p = f.payload();
  const c = f.api.call(f.device, p);
  assert.equal(f.api.call(f.device, p).id, c.id);
  assert.equal(f.all("mobileCalls").length, 1);
  assert.equal(f.all("activities").length, 1);
  assert.throws(() => f.api.call(f.device, { ...p, duration: 31 }), status(409));
  for (const phone of ["919999999999", "918888888888", "917777777777"])
    assert.throws(() => f.api.call(f.device, { ...p, phone }), status(403));
  f.put("leads", { id: "duplicate", owner: "owner", phone: p.phone });
  assert.throws(() => f.api.call(f.device, f.payload({ localId: "duplicate-match" })), status(403));
});

test("invalid call metadata is rejected without creating activities", (t) => {
  const f = fixture(t);
  for (const change of [
    { localId: "../bad" },
    { duration: -1 },
    { duration: 1.5 },
    { direction: "Unknown" },
    { startedAt: Date.now() + 600000 },
    { startedAt: 0 },
    { phone: "+919876543210" },
  ])
    assert.throws(() => f.api.call(f.device, f.payload(change)), status(400));
  assert.equal(f.all("activities").length, 0);
});

test("recordings are encrypted at rest, replayable, and duplicate safe", (t) => {
  const f = fixture(t),
    c = f.api.call(f.device, f.payload());
  const attached = f.api.recording(f.device, c.id, f.audio, f.meta(c));
  assert.equal(attached.duplicate, false);
  const row = f.db.prepare("SELECT bytes FROM mobile_audio").get();
  assert.ok(!Buffer.from(row.bytes).includes(f.audio));
  assert.equal(readFileSync(f.keyPath).length, 32);
  assert.deepEqual(f.api.playback(attached.id), { bytes: f.audio, mime: "audio/ogg" });
  assert.equal(f.get("mobileCalls", c.id).recordingId, attached.id);
  assert.equal(f.get("activities", c.activityId).recordingId, attached.id);
  assert.deepEqual(f.api.recording(f.device, c.id, f.audio, f.meta(c)), {
    id: attached.id,
    duplicate: true,
  });
  assert.throws(
    () => f.api.recording(f.device, c.id, Buffer.from("OggS different"), f.meta(c)),
    status(409),
  );
  assert.throws(() => f.api.playback("missing"), status(404));
  const damaged = Buffer.from(row.bytes);
  damaged[damaged.length - 1] ^= 1;
  f.db.prepare("UPDATE mobile_audio SET bytes=?").run(damaged);
  assert.throws(() => f.api.playback(attached.id));
});

test("recording formats, size guards, and manual review are enforced", (t) => {
  const f = fixture(t),
    c = f.api.call(f.device, f.payload());
  assert.throws(() => f.api.recording(f.device, c.id, Buffer.alloc(0), f.meta(c)), status(413));
  assert.throws(
    () => f.api.recording(f.device, c.id, Buffer.alloc(MAX_AUDIO + 1), f.meta(c)),
    status(413),
  );
  assert.throws(
    () => f.api.recording(f.device, c.id, Buffer.from("not audio"), f.meta(c)),
    status(400),
  );
  assert.throws(
    () => f.api.recording(f.device, c.id, f.audio, { ...f.meta(c), duration: 300 }),
    status(409),
  );
  assert.throws(
    () => f.api.recording(f.device, c.id, f.audio, { ...f.meta(c), modified: 0 }),
    status(409),
  );
  assert.throws(
    () => f.api.recording(f.device, c.id, f.audio, { ...f.meta(c), mode: "unknown" }),
    status(400),
  );
  assert.equal(
    f.api.recording(f.device, c.id, f.audio, { mode: "manual", duration: 300, modified: 0 })
      .duplicate,
    false,
  );
  for (const [value, mime] of [
    ["OggS", "audio/ogg"],
    ["#!AMR\n", "audio/amr"],
    ["0000ftyp", "audio/mp4"],
    ["RIFF0000WAVE", "audio/wav"],
    ["ID3", "audio/mpeg"],
  ])
    assert.equal(audioType(Buffer.from(value)), mime);
});

test("devices cannot attach other devices' calls or reuse recording hashes within a device", (t) => {
  const f = fixture(t),
    a = f.api.call(f.device, f.payload());
  const second = f.api.issue({ name: "Second phone", owner: "owner" });
  assert.throws(() => f.api.recording(second, a.id, f.audio, f.meta(a)), status(403));
  f.api.recording(f.device, a.id, f.audio, f.meta(a));
  const b = f.api.call(f.device, f.payload({ localId: "call-2", startedAt: a.startedAt - 600000 }));
  assert.throws(() => f.api.recording(f.device, b.id, f.audio, f.meta(b)), status(409));
  const other = f.api.call(second, { ...f.payload(), startedAt: a.startedAt });
  assert.notEqual(other.id, a.id);
  assert.equal(f.api.recording(second, other.id, f.audio, f.meta(other)).duplicate, false);
  f.put("leads", { ...f.get("leads", "lead"), owner: "other" });
  assert.throws(
    () => f.api.recording(f.device, b.id, Buffer.from("OggS new"), f.meta(b)),
    status(403),
  );
});

test("ambiguous automatic time matches require explicit manual review", (t) => {
  const f = fixture(t),
    a = f.api.call(f.device, f.payload());
  f.api.call(f.device, f.payload({ localId: "nearby-call", startedAt: a.startedAt + 1000 }));
  assert.throws(() => f.api.recording(f.device, a.id, f.audio, f.meta(a)), status(409));
  assert.equal(
    f.api.recording(f.device, a.id, f.audio, { ...f.meta(a), mode: "manual" }).duplicate,
    false,
  );
});
