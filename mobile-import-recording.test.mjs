import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMobileSync } from "./mobile-sync.mjs";

test("an imported recording is kept encrypted, attached to its call and plays back unchanged", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "mob-import-"));
  const db = new DatabaseSync(":memory:");
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.exec("CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))");
  const get = (k, id) => { const r = db.prepare("SELECT body FROM records WHERE kind=? AND id=?").get(k, id); return r && JSON.parse(r.body); };
  const put = (k, v) => db.prepare("INSERT OR REPLACE INTO records VALUES(?,?,?)").run(k, v.id, JSON.stringify(v));
  const tx = (fn) => { db.exec("BEGIN"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } };
  const m = createMobileSync({ db, all: () => [], get, put, stamp: (v) => ({ id: randomUUID(), ...v }), tx, log: () => {}, keyPath: join(dir, "audio-key") });
  put("mobileCalls", { id: "tcc-1", deviceId: "telecrm", leadId: "L", activityId: "A1" });
  put("activities", { id: "A1", leadId: "L", type: "Call" });
  const bytes = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 7)]);
  const out = m.importRecording("tcc-1", bytes);
  assert.equal(out.duplicate, false);
  assert.equal(get("mobileCalls", "tcc-1").recordingId, out.id);
  assert.equal(get("activities", "A1").recordingId, out.id);
  const stored = db.prepare("SELECT bytes FROM mobile_audio WHERE id=?").get(out.id).bytes;
  assert.ok(!Buffer.from(stored).includes(Buffer.alloc(50, 7)), "stored encrypted");
  const back = m.playback(out.id);
  assert.equal(back.mime, "audio/mpeg");
  assert.ok(back.bytes.equals(bytes));
  assert.equal(m.importRecording("tcc-1", bytes).duplicate, true);
  put("mobileCalls", { id: "tcc-2", deviceId: "telecrm", leadId: "L", activityId: "A2" });
  assert.throws(() => m.importRecording("tcc-2", Buffer.from("not audio at all")), (e) => e.status === 400);
  assert.throws(() => m.importRecording("missing", bytes), (e) => e.status === 404);
});

test("a TeleCRM call takes the phone app's recording of the same call", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "mob-twin-"));
  const db = new DatabaseSync(":memory:");
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.exec("CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))");
  const get = (k, id) => { const r = db.prepare("SELECT body FROM records WHERE kind=? AND id=?").get(k, id); return r && JSON.parse(r.body); };
  const all = (k) => db.prepare("SELECT body FROM records WHERE kind=?").all(k).map((r) => JSON.parse(r.body));
  const put = (k, v) => db.prepare("INSERT OR REPLACE INTO records VALUES(?,?,?)").run(k, v.id, JSON.stringify(v));
  const tx = (fn) => { db.exec("BEGIN"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } };
  const m = createMobileSync({ db, all, get, put, stamp: (v) => ({ id: randomUUID(), ...v }), tx, log: () => {}, keyPath: join(dir, "audio-key") });
  const at = Date.UTC(2026, 10, 9, 11, 22);
  // phone call with a recording; TeleCRM logged the same call 50 s later (at its end) with the number in another form
  put("mobileCalls", { id: "P1", deviceId: "dev-1", phone: "919741200042", startedAt: at, duration: 48, activityId: "PA1", recordingId: "rec-1" });
  put("mobileCalls", { id: "tcc-1", deviceId: "telecrm", phone: "9741200042", startedAt: at + 50000, duration: 47, activityId: "TA1", recordingPath: "x/rec.mp3" });
  put("activities", { id: "TA1", type: "Call" });
  // another call to the same number an hour later, and a different number at the same time: neither takes it
  put("mobileCalls", { id: "tcc-2", deviceId: "telecrm", phone: "919741200042", startedAt: at + 3600000, duration: 48, activityId: "TA2" });
  put("mobileCalls", { id: "tcc-3", deviceId: "telecrm", phone: "917353300043", startedAt: at, duration: 48, activityId: "TA3" });
  assert.equal(m.shareTwins(), 1);
  assert.equal(get("mobileCalls", "tcc-1").recordingId, "rec-1");
  assert.equal(get("mobileCalls", "tcc-1").twinCallId, "P1");
  assert.equal(get("activities", "TA1").recordingId, "rec-1");
  assert.equal(get("mobileCalls", "tcc-2").recordingId, undefined);
  assert.equal(get("mobileCalls", "tcc-3").recordingId, undefined);
  assert.equal(m.shareTwins(), 0, "nothing left to fill");
});
