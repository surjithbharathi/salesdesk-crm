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
  put("leads", { id: "lead", name: "Saved lead", owner: "owner", phone: "+91 98765 43210" });
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
  // every active lead's number, so the office phone still picks up calls with leads assigned to colleagues
  assert.deepEqual(api.targets(device), [{ id: "lead", phone: "919876543210" }, { phone: "919999999999" }], "own leads with their id, others by number only");
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

test("call sync lands on the lead with the number, whoever owns it, and is idempotent", (t) => {
  const f = fixture(t),
    p = f.payload();
  const c = f.api.call(f.device, p);
  assert.equal(f.api.call(f.device, p).id, c.id);
  assert.equal(f.all("mobileCalls").length, 1);
  assert.equal(f.all("activities").length, 1);
  assert.throws(() => f.api.call(f.device, { ...p, duration: 31 }), status(409));
  // the same call written twice in the phone's call log lands once
  assert.equal(f.api.call(f.device, { ...p, localId: "call-1-twin", startedAt: p.startedAt + 1000 }).id, c.id);
  assert.equal(f.all("mobileCalls").length, 1);
  // an archived lead or a number that is no lead is not synced
  for (const phone of ["918888888888", "917777777777"])
    assert.throws(() => f.api.call(f.device, { ...p, phone }), status(403));
  // a colleague's lead: the office phone's call still lands on it
  assert.equal(f.api.call(f.device, f.payload({ localId: "colleague", phone: "919999999999" })).leadId, "other-lead");
  // two leads with one number: the phone owner's own lead wins
  f.put("leads", { id: "duplicate", owner: "other", phone: p.phone, updatedAt: "2099-01-01T00:00:00Z" });
  assert.equal(f.api.call(f.device, f.payload({ localId: "duplicate-match" })).leadId, "lead");
});

test("the phone's contact name fills a lead that has only its number, and never replaces a real name", (t) => {
  const f = fixture(t);
  f.put("leads", { id: "bare", name: "919812345678", owner: "owner", phone: "919812345678" });
  f.put("leads", { id: "bare-2", name: "+91 98123 45679", owner: "owner", phone: "919812345679" });
  const flagged = f.api.targets(f.device);
  assert.equal(flagged.find((l) => l.id === "bare").needsName, true);
  assert.equal(flagged.find((l) => l.id === "lead").needsName, undefined);
  // through a synced call
  f.api.call(f.device, f.payload({ localId: "named", phone: "919812345678", name: "  ரவி\n Kumar  " }));
  assert.equal(f.get("leads", "bare").name, "ரவி Kumar");
  assert.equal(f.get("leads", "bare").nameSource, "phone");
  assert.equal(f.api.targets(f.device).find((l) => l.id === "bare").needsName, undefined);
  // a typed name stays
  f.api.call(f.device, f.payload({ localId: "typed", name: "Other name" }));
  assert.equal(f.get("leads", "lead").name, "Saved lead");
  // leads whose calls synced earlier are named directly; a number or empty text is not a name
  assert.equal(f.api.nameLead(f.device, "bare-2", "98123 45679").named, false);
  assert.equal(f.api.nameLead(f.device, "bare-2", "").named, false);
  assert.equal(f.api.nameLead(f.device, "bare-2", "Anbu Traders").named, true);
  assert.equal(f.get("leads", "bare-2").name, "Anbu Traders");
  assert.equal(f.api.nameLead(f.device, "bare-2", "Later name").named, false);
  assert.equal(f.get("leads", "bare-2").name, "Anbu Traders");
  // only this phone's own leads
  assert.throws(() => f.api.nameLead(f.device, "other-lead", "Someone"), status(403));
  assert.throws(() => f.api.nameLead(f.device, "archived", "Someone"), status(403));
  // a new lead made from a call in all-calls mode takes the name straight away
  const account = "a".repeat(64);
  f.api.preferences(f.device, { sims: { [account]: "all" }, assignment: "self", consent: true });
  const fresh = f.api.call(f.device, f.payload({ localId: "fresh", phone: "917012345678", accountId: account, name: "Fresh Contact" }));
  assert.equal(f.get("leads", fresh.leadId).name, "Fresh Contact");
  const unnamed = f.api.call(f.device, f.payload({ localId: "unnamed", phone: "917012345679", accountId: account }));
  assert.equal(f.get("leads", unnamed.leadId).name, "917012345679");
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
  assert.throws(() => f.api.recording(second, a.id, f.audio, f.meta(a)), status(409));
  f.api.recording(f.device, a.id, f.audio, f.meta(a));
  const b = f.api.call(f.device, f.payload({ localId: "call-2", startedAt: a.startedAt - 600000 }));
  assert.throws(() => f.api.recording(f.device, b.id, f.audio, f.meta(b)), status(409));
  const other = f.api.call(second, { ...f.payload(), startedAt: a.startedAt });
  assert.notEqual(other.id, a.id);
  assert.equal(f.api.recording(second, other.id, f.audio, f.meta(other)).duplicate, false);
  // a lead moved to a colleague still takes the recording; an archived one does not
  f.put("leads", { ...f.get("leads", "lead"), archived: true });
  assert.throws(
    () => f.api.recording(f.device, b.id, Buffer.from("OggS new"), f.meta(b)),
    status(409),
  );
});

test("ambiguous automatic time matches require explicit manual review", (t) => {
  const f = fixture(t),
    a = f.api.call(f.device, f.payload());
  f.api.call(f.device, f.payload({ localId: "nearby-call", startedAt: a.startedAt + 1000, duration: 31 }));
  assert.throws(() => f.api.recording(f.device, a.id, f.audio, f.meta(a)), status(409));
  assert.equal(
    f.api.recording(f.device, a.id, f.audio, { ...f.meta(a), mode: "manual" }).duplicate,
    false,
  );
});

test("a refused recording is 409, so the phone skips that file and keeps syncing instead of signing out", (t) => {
  const f = fixture(t),
    a = f.api.call(f.device, f.payload());
  f.put("leads", { id: "lead", name: "Saved lead", owner: "other", phone: "+91 98765 43210", archived: true });
  assert.throws(() => f.api.recording(f.device, a.id, f.audio, f.meta(a)), status(409));
  assert.throws(() => f.api.recording(f.device, "no-such-call", f.audio, {}), status(409));
});

test("the phone's number list stays under the 1 MB the app accepts, own leads always included", (t) => {
  const f = fixture(t),
    { api, device } = f;
  const stamp = (i) => new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString();
  for (let i = 0; i < 12000; i++) f.put("leads", { id: "own-lead-id-" + String(i).padStart(14, "0"), name: "Own", phone: "+91" + (9100000000 + i), owner: device.owner, updatedAt: stamp(i) });
  for (let i = 0; i < 30000; i++) f.put("leads", { id: "other-" + i, name: "x", phone: "+91" + (8100000000 + i), owner: "someone-else", updatedAt: stamp(i) });
  const list = api.targets(device);
  assert.ok(Buffer.byteLength(JSON.stringify(list)) < 1048576, "fits the app's limit");
  assert.equal(list.filter((x) => x.id?.startsWith("own-lead-id-")).length, 12000, "every own lead is there");
  const others = list.filter((x) => !x.id);
  assert.ok(others.length > 0);
  assert.equal(others[0].phone, "918100029999", "the most recently active other number comes first");
});
