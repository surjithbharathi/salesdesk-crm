import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMobileSync } from "./mobile-sync.mjs";
import { createIndiamartCalls, istParam, queryTime, isRelay } from "./indiamart-calls.mjs";
import { phoneParts } from "./lead-phone.mjs";

const IST = 19800000;
const ist = (ms) => new Date(ms + IST).toISOString().replace("T", " ").slice(0, 19);

function fixture(t, now) {
  const db = new DatabaseSync(":memory:"), dir = mkdtempSync(join(tmpdir(), "salesdesk-indiamart-"));
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.exec("CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))");
  const withPhone = (kind, v) => { if (kind === "leads") try { return { ...v, ...phoneParts(v.phone) }; } catch {} return v; };
  const all = (kind) => db.prepare("SELECT body FROM records WHERE kind=?").all(kind).map((r) => withPhone(kind, JSON.parse(r.body)));
  const get = (kind, id) => { const r = db.prepare("SELECT body FROM records WHERE kind=? AND id=?").get(kind, id); return r && withPhone(kind, JSON.parse(r.body)); };
  const put = (kind, v) => db.prepare("INSERT OR REPLACE INTO records VALUES(?,?,?)").run(kind, v.id, JSON.stringify(withPhone(kind, v)));
  const stamp = (v) => ({ id: randomUUID(), createdAt: new Date().toISOString(), ...v });
  const tx = (fn) => { db.exec("BEGIN"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } };
  const log = (leadId, type, text, extra = {}) => { const a = stamp({ leadId, type, text, ...extra }); put("activities", a); return a; };
  const mobile = createMobileSync({ db, all, get, put, stamp, tx, log, keyPath: join(dir, "mobile-key") });
  const replies = [], asked = [];
  const fetchImpl = async (url) => { asked.push(url); return { ok: true, status: 200, json: async () => replies.shift() }; };
  const im = createIndiamartCalls({ db, all, get, put, stamp, tx, log, keyPath: join(dir, "im-key"), now: () => now.value, fetchImpl });
  return { db, all, get, put, mobile, im, replies, asked };
}
const enquiry = (v) => ({ UNIQUE_QUERY_ID: "Q" + Math.random().toString(36).slice(2), QUERY_TYPE: "P", SENDER_NAME: "Murugan", SENDER_MOBILE: "+91-9443012345", SENDER_COUNTRY_ISO: "IN", SENDER_CITY: "Salem", SENDER_STATE: "Tamil Nadu", QUERY_PRODUCT_NAME: "Wooden Cold Press Oil Machine", RECEIVER_MOBILE: "9876500000", ...v });

test("helpers read IndiaMART time and recognise relay numbers", () => {
  assert.equal(istParam(Date.UTC(2026, 10, 10, 13, 27, 0)), "10-Nov-202618:57:00");
  assert.equal(queryTime("2026-11-10 18:57:00"), Date.UTC(2026, 10, 10, 13, 27, 0));
  assert.equal(queryTime("10-Nov-2026 18:57:00"), Date.UTC(2026, 10, 10, 13, 27, 0));
  assert.ok(isRelay("918048250260"));
  assert.ok(!isRelay("919786250600"));
  assert.ok(isRelay("919786250600", ["919786250600"]));
});

test("a call through the IndiaMART number moves with its recording to the buyer's lead", async (t) => {
  const now = { value: Date.now() }, f = fixture(t, now), { mobile, im, put, get, all } = f;
  put("users", { id: "u1", name: "Surjith", phone: "+919876500000", active: true });
  put("users", { id: "u2", name: "Bala", phone: "+919876511111", active: true });
  put("leads", { id: "relay", name: "IndiaMART Buyer", phone: "+918048250260", owner: "u1", stage: "New" });
  const device = mobile.issue({ name: "Phone", owner: "u1" });
  const at = now.value - 20 * 60000;
  const call = mobile.call(device, { localId: "c1", phone: "918048250260", direction: "Incoming", startedAt: at, duration: 244 });
  assert.equal(call.leadId, "relay");
  const audio = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64, 1)]);
  const rec = mobile.recording(device, call.id, audio, { mode: "auto", duration: 244, modified: at + 244000 });

  // a different, unrelated call a minute later from a real mobile stays where it is
  put("leads", { id: "other", name: "Other", phone: "+919786250600", owner: "u1" });
  const other = mobile.call(device, { localId: "c2", phone: "919786250600", direction: "Incoming", startedAt: at + 60000, duration: 240 });

  im.save({ key: "abcdefghijklmnopqrstuvwxyz012345", enabled: true, backfillDays: 7 });
  f.replies.push({ CODE: 200, STATUS: "SUCCESS", RESPONSE: [enquiry({ QUERY_TIME: ist(at + 5000), CALL_DURATION: "245" }), { UNIQUE_QUERY_ID: "W1", QUERY_TYPE: "W", SENDER_MOBILE: "+91-9000000000" }] });
  const out = await im.sync();
  assert.match(f.asked[0], /crmListing\/v2\/\?glusr_crm_key=abcdefghijklmnopqrstuvwxyz012345&start_time=\d{2}-[A-Z][a-z]{2}-\d{4}\d{2}:\d{2}:\d{2}&end_time=/);
  assert.equal(out.lastRun.ok, true);
  assert.equal(out.lastRun.linked, 1);
  assert.deepEqual(out.relays, ["+918048250260"]);

  const buyer = all("leads").find((l) => l.phoneKey === "919443012345");
  assert.equal(buyer.name, "Murugan");
  assert.equal(buyer.source, "IndiaMART");
  assert.equal(buyer.owner, "u1");
  const moved = get("mobileCalls", call.id);
  assert.equal(moved.leadId, buyer.id);
  assert.equal(moved.relayLeadId, "relay");
  assert.equal(moved.recordingId, rec.id);
  const activity = get("activities", moved.activityId);
  assert.equal(activity.leadId, buyer.id);
  assert.equal(activity.recordingId, rec.id);
  assert.equal(get("leads", "relay").indiamartRelay, true);
  assert.equal(get("mobileCalls", other.id).leadId, "other");
  assert.equal(mobile.playback(rec.id).bytes.length, audio.length);

  // the same enquiry read again (overlapping windows) changes nothing
  now.value += 16 * 60000;
  f.replies.push({ CODE: 200, STATUS: "SUCCESS", RESPONSE: [] });
  assert.equal((await im.sync()).lastRun.linked, 0);
});

test("an enquiry waits for the phone's call, and a late recording still reaches the buyer's lead owned by someone else", async (t) => {
  const now = { value: Date.now() }, f = fixture(t, now), { mobile, im, put, get } = f;
  put("users", { id: "u1", name: "Surjith", phone: "+919876500000", active: true });
  put("users", { id: "u2", name: "Bala", active: true });
  put("leads", { id: "buyer", name: "Murugan Oils", phone: "+919443012345", owner: "u2", source: "IndiaMART" });
  put("leads", { id: "relay", name: "IndiaMART Buyer", phone: "+918048250260", owner: "u1" });
  const device = mobile.issue({ name: "Phone", owner: "u1" });
  const at = now.value - 10 * 60000;
  im.save({ key: "abcdefghijklmnopqrstuvwxyz012345", enabled: true });
  f.replies.push({ CODE: 200, STATUS: "SUCCESS", RESPONSE: [enquiry({ QUERY_TIME: ist(at), CALL_DURATION: "90" })] });
  assert.equal((await im.sync()).lastRun.waiting, 1);

  // the phone sends its call log later; the server links it straight away
  const call = mobile.call(device, { localId: "c1", phone: "918048250260", direction: "Incoming", startedAt: at - 30000, duration: 92 });
  assert.equal(im.relink().linked, 1);
  const moved = get("mobileCalls", call.id);
  assert.equal(moved.leadId, "buyer");
  assert.equal(get("leads", "buyer").owner, "u2", "the buyer's owner is kept");
  const audio = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64, 2)]);
  const rec = mobile.recording(device, call.id, audio, { mode: "auto", duration: 92, modified: at - 30000 + 92000 });
  assert.equal(get("activities", moved.activityId).recordingId, rec.id);
  assert.equal(get("activities", moved.activityId).leadId, "buyer");
});

test("two calls that fit equally are left alone; a refused key is reported", async (t) => {
  const now = { value: Date.now() }, f = fixture(t, now), { mobile, im, put, get } = f;
  put("users", { id: "u1", name: "Surjith", active: true });
  put("leads", { id: "relay", name: "IndiaMART Buyer", phone: "+918048250260", owner: "u1" });
  put("leads", { id: "relay2", name: "IndiaMART", phone: "+918048251111", owner: "u1" });
  const device = mobile.issue({ name: "Phone", owner: "u1" });
  const at = now.value - 10 * 60000;
  const a = mobile.call(device, { localId: "a", phone: "918048250260", direction: "Incoming", startedAt: at, duration: 60 });
  const b = mobile.call(device, { localId: "b", phone: "918048251111", direction: "Incoming", startedAt: at + 10000, duration: 60 });
  im.save({ key: "abcdefghijklmnopqrstuvwxyz012345" });
  f.replies.push({ CODE: 200, STATUS: "SUCCESS", RESPONSE: [enquiry({ QUERY_TIME: ist(at + 5000), CALL_DURATION: "60", RECEIVER_MOBILE: "" })] });
  const out = await im.sync();
  assert.equal(out.lastRun.linked, 0);
  assert.equal(out.recent[0].status, "unclear");
  assert.equal(get("mobileCalls", a.id).leadId, "relay");
  assert.equal(get("mobileCalls", b.id).leadId, "relay2");
  now.value += 16 * 60000;
  f.replies.push({ CODE: 401, STATUS: "FAILURE", MESSAGE: "Invalid key" });
  await assert.rejects(im.sync(), /refused the CRM key/);
  assert.equal(im.settings().lastRun.ok, false);
  assert.throws(() => im.save({ enabled: true, key: "bad key" }), /does not look right/);
});

test("records handed over by the enquiry import link the call without a read or key of its own", async (t) => {
  const now = { value: Date.now() }, f = fixture(t, now), { mobile, im, put, get, all, asked } = f;
  put("users", { id: "u1", name: "Office Phone", active: true });
  put("leads", { id: "relay", name: "IndiaMART Buyer", phone: "+918048250260", owner: "u1", stage: "New" });
  const device = mobile.issue({ name: "Office", owner: "u1" });
  const at = now.value - 10 * 60000;
  const call = mobile.call(device, { localId: "p1", phone: "918048250260", direction: "Incoming", startedAt: at, duration: 120 });
  const out = im.take([enquiry({ QUERY_TIME: ist(at + 3000), CALL_DURATION: "121", SENDER_MOBILE: "+91-9505429074", SENDER_NAME: "Raju" }), { UNIQUE_QUERY_ID: "B9", QUERY_TYPE: "B", SENDER_MOBILE: "+91-9000000000" }]);
  assert.deepEqual([out.calls, out.linked], [1, 1]);
  assert.equal(asked.length, 0, "IndiaMART is not asked again");
  const moved = get("mobileCalls", call.id);
  const buyer = all("leads").find((l) => l.phoneKey === "919505429074");
  assert.equal(moved.leadId, buyer.id);
  assert.equal(moved.indiamartQueryId !== undefined, true);
  assert.equal(im.take([]).calls, 0);
});

test("a call synced after IndiaMART listed it is linked when the phone sends it", async (t) => {
  const now = { value: Date.now() }, f = fixture(t, now), { mobile, im, put, get, all } = f;
  put("users", { id: "u1", name: "Office Phone", active: true });
  put("leads", { id: "relay", name: "IndiaMART Buyer", phone: "+918048250260", owner: "u1", stage: "New" });
  const device = mobile.issue({ name: "Office", owner: "u1" });
  const at = now.value - 10 * 60000;
  assert.deepEqual(im.take([enquiry({ QUERY_TIME: ist(at), CALL_DURATION: "60", SENDER_MOBILE: "+91-9440012345" })]), { calls: 1, linked: 0, waiting: 1 });
  const call = mobile.call(device, { localId: "p2", phone: "918048250260", direction: "Incoming", startedAt: at - 2000, duration: 60 });
  assert.equal(im.relink().linked, 1);
  assert.equal(get("mobileCalls", call.id).leadId, all("leads").find((l) => l.phoneKey === "919440012345").id);
});
