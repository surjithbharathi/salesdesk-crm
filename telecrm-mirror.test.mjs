import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTelecrmMirror, mapStatus } from "./telecrm-mirror.mjs";

const members = [
  { name: "Sathiya", email: "sathiya@deviindustries.com", status: "Working", phone_number: "918282827732", permission_template_name: "Default Manager Permissions" },
  { name: "Balaji", email: "bala@deviindustries.com", status: "Working", phone_number: "919039036583", permission_template_name: "Default Caller Permissions" },
  { name: "Old Hand", email: "old@deviindustries.com", status: "DELETED", permission_template_name: "Default Caller Permissions" },
];
function world(t) {
  const db = new DatabaseSync(":memory:");
  const dir = mkdtempSync(join(tmpdir(), "tc-test-"));
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.exec("CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))");
  db.exec("CREATE UNIQUE INDEX u ON records(json_extract(body,'$.phoneKey')) WHERE kind='leads' AND json_extract(body,'$.phoneKey')<>''");
  const all = (k) => db.prepare("SELECT body FROM records WHERE kind=?").all(k).map((r) => JSON.parse(r.body));
  const get = (k, id) => { const r = db.prepare("SELECT body FROM records WHERE kind=? AND id=?").get(k, id); return r && JSON.parse(r.body); };
  const rawPut = (k, v) => db.prepare("INSERT OR REPLACE INTO records VALUES(?,?,?)").run(k, v.id, JSON.stringify(v));
  const tx = (fn) => { db.exec("BEGIN"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } };
  const tele = { leads: [], actions: {}, calls: [], fail: 0, failFiles: 0 };
  const audio = [];
  const attachRecording = (callId, bytes) => {
    const c = get("mobileCalls", callId), id = "rec-" + audio.length;
    audio.push({ callId, bytes });
    rawPut("mobileCalls", { ...c, recordingId: id });
    const a = get("activities", c.activityId);
    rawPut("activities", { ...a, recordingId: id });
    return { id };
  };
  let clock = 1_800_000_000_000;
  const fetchImpl = async (url, init) => {
    tele.calls.push({ url, method: init.method, auth: init.headers?.Authorization });
    if (tele.fail) return { ok: false, status: tele.fail, json: async () => ({}) };
    if (url.startsWith("https://files.example/") && tele.failFiles > 0) { tele.failFiles--; return { ok: false, status: 500 }; }
    if (url.startsWith("https://files.example/")) return { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]).buffer };
    const u = new URL(url), path = u.pathname.replace(/^.*\/enterprise\/[^/]+/, "");
    const skip = Number(u.searchParams.get("skip") || 0), limit = Number(u.searchParams.get("limit") || 10);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (path === "/team-members") return ok({ data: members.slice(skip, skip + limit), total_count: members.length });
    if (path === "/lead/search") {
      const body = JSON.parse(init.body || "{}");
      const rows = body.actions ? tele.leads.filter((l) => tele.touched?.has(l.id)) : tele.leads;
      return ok({ data: rows.slice(skip, skip + limit), total_count: rows.length });
    }
    if (/\/file\/download-url$/.test(path) && tele.denyFiles) return { ok: false, status: 403, json: async () => ({}) };
    if (/\/file\/download-url$/.test(path)) return ok({ download_url: "https://files.example/" + encodeURIComponent(u.searchParams.get("path")), expires_in: 3600, size: 10, content_type: "audio/mpeg" });
    // writes back to TeleCRM: kept so tests can read what was sent
    if (init.method === "POST" && /^\/lead\/[^/]+(\/action)?$/.test(path) && path !== "/lead/search") {
      (tele.writes ||= []).push({ path, body: JSON.parse(init.body || "{}") });
      return ok(path.endsWith("/action") ? { data: [{ status: "CREATED" }] } : { id: path.split("/")[2], fields: {}, ...(tele.remarks ? { remarks: tele.remarks } : {}) });
    }
    if (path === "/custom-actions") return ok([{ code: "ACTION_1001", displayName: "Salesmax Activity", fieldSchema: [] }, { code: "ACTION_1014", displayName: "Salesdesk Note", fieldSchema: { customFieldDefinitions: [{ type: "TEXT", apiName: "notes", label: "Notes" }] } }]);
    const m = /^\/lead\/([^/]+)$/.exec(path);
    if (m) { const acts = tele.actions[m[1]] || []; return ok({ id: m[1], actions: acts.slice(skip, skip + limit) }); }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const mirror = createTelecrmMirror({ db, all, get, put: rawPut, rawPut, tx, attachRecording, now: () => clock, keyPath: join(dir, "key"), fetchImpl });
  return { mirror, all, get, rawPut, tele, audio, tick: (ms) => { clock += ms; } };
}
const lead = (id, over = {}, f = {}) => ({ id, employeeid: "bala@deviindustries.com", status: "New Lead", rating: 2, score: 10, fields: { name: "Customer " + id, phone: "9198765" + String(id.length * 11111).padStart(5, "0").slice(0, 5), lead_source: "IndiaMart", created_on: 1799000000000, modified_on: 1, last_activity_on: 1, ...f }, ...over });
const connect = (w) => w.mirror.save({ enterpriseId: "6aa78f9ca033a69fb29aaa60", token: "sync-token-1", enabled: true });

test("settings keep the token secret and cannot be enabled half set up", (t) => {
  const w = world(t);
  assert.throws(() => w.mirror.save({ enabled: true }), (e) => e.status === 400);
  assert.throws(() => w.mirror.save({ enterpriseId: "no spaces allowed" }), (e) => e.status === 400);
  const s = connect(w);
  assert.equal(s.hasToken, true);
  assert.ok(!JSON.stringify(s).includes("sync-token-1"));
  assert.equal(w.mirror.save({ token: "" }).hasToken, true);
});

test("status labels land on the pipeline steps of this CRM, with spelling variations", () => {
  assert.deepEqual(mapStatus("Intrested Customer"), { deal: "Interested Customer", stage: "Opportunity", disposition: "" });
  assert.equal(mapStatus("Machine Delivered - Need To Start").deal, "Machine Delivered - Need to Start");
  assert.equal(mapStatus("Lost").disposition, "Lost");
  assert.deepEqual(mapStatus("New Lead"), { deal: "", stage: "New", disposition: "" });
  assert.equal(mapStatus("Something new").stage, "Prospecting");
});

test("a full run mirrors people, leads, their timeline and the follow-up as a task; a second run changes nothing", async (t) => {
  const w = world(t);
  connect(w);
  w.tele.leads = [
    lead("aaa", { status: "Quotation Shared" }, { "next_follow-up_on": 1801000000000, expected_revenue: "250000", city: "Erode" }),
    lead("bbbb", { status: "Lost" }, { "next_follow-up_on": 1801000000000, lost_reason: "Budget Issues" }),
  ];
  const bala = "bala@deviindustries.com";
  w.tele.actions.aaa = [
    { id: "x1", type: "OUTGOING_CALL", creationTimestamp: 1799500000000, employeeid: bala, duration: 95, feedback: "CONNECTED", callRecording: { name: "call.m4a", filePath: "ent/uid/call.mp3" } },
    { id: "x1b", type: "MISSED_CALL", creationTimestamp: 1799550000000, employeeid: "", duration: 0, feedback: "NA", callRecording: null },
    { id: "x2", type: "USER_NOTE", creationTimestamp: 1799600000000, employeeid: bala, text: "Wants 2 hp motor" },
    { id: "x3", type: "ACTION_1013", creationTimestamp: 1799700000000, employeeid: bala, fields: { notes: "Customer | Sales 82828 27732\nPrice please?" } },
    { id: "x4", type: "ACTION_1013", creationTimestamp: 1799800000000, employeeid: bala, fields: { notes: "Sent from gateway | Sales 82828 27732\nRs 2.5 lakh with GST" } },
    { id: "x5", type: "ACTION_1013", creationTimestamp: 1799900000000, employeeid: bala, fields: { notes: "Sent from WhatsApp | Sales 82828 27732\nOk sir, will call you" } },
  ];
  const r = await w.mirror.sync();
  assert.equal(r.ok, true, r.message);
  assert.equal(r.mode, "full");
  const users = w.all("users");
  assert.equal(users.length, 3);
  assert.equal(users.find((u) => u.email === "sathiya@deviindustries.com").role, "Manager");
  assert.equal(users.find((u) => u.email === "bala@deviindustries.com").role, "Sales representative");
  assert.equal(users.find((u) => u.email === "old@deviindustries.com").active, false);
  const a = w.all("leads").find((l) => l.telecrm.id === "aaa");
  assert.deepEqual([a.deal, a.stage, a.city, a.value, a.source], ["Quotation Shared", "Quotation given", "Erode", 250000, "IndiaMart"]);
  assert.equal(a.owner, users.find((u) => u.email === "bala@deviindustries.com").id);
  assert.match(a.phone, /^\+91/);
  const acts = w.all("activities").filter((x) => x.leadId === a.id);
  assert.deepEqual(acts.map((x) => x.type).sort(), ["Call", "Call", "Message", "Message", "Message", "Note"]);
  assert.equal(acts.find((x) => x.type === "Call" && x.duration === 95).outcome, "Connected");
  assert.equal(acts.find((x) => x.type === "Call" && x.duration === 0).outcome, "No answer");
  // calls are native phone-call records, recordings are real audio attached to them
  const calls = w.all("mobileCalls").filter((c) => c.leadId === a.id).sort((p, q) => p.startedAt - q.startedAt);
  assert.deepEqual(calls.map((c) => [c.direction, c.duration, c.deviceId]), [["Outgoing", 95, "telecrm"], ["Missed", 0, "telecrm"]]);
  assert.equal(calls[0].owner, a.owner);
  assert.equal(calls[0].phone, a.phoneKey);
  assert.equal(w.audio.length, 1);
  assert.deepEqual(w.audio[0].bytes.subarray(0, 3).toString(), "ID3");
  assert.equal(calls[0].recordingId, "rec-0");
  assert.equal(w.get("activities", "tca-aaa-x1").recordingId, "rec-0");
  assert.equal(r.recordings, 1);
  // WhatsApp: a conversation with both directions, who wrote, and which number
  const msgs = w.all("messages").filter((m) => m.leadId === a.id).sort((p, q) => p.occurredAt.localeCompare(q.occurredAt));
  assert.deepEqual(msgs.map((m) => [m.direction, m.text, m.numberLabel, m.sender, m.via || ""]), [["Incoming", "Price please?", "Sales 82828 27732", a.name, ""], ["Outgoing", "Rs 2.5 lakh with GST", "Sales 82828 27732", "Balaji", "Gateway"], ["Outgoing", "Ok sir, will call you", "Sales 82828 27732", "Balaji", "WhatsApp"]]);
  assert.equal(msgs[1].senderId, a.owner);
  assert.ok(!acts.some((x) => x.type === "Note" && /^ACTION_1013/.test(x.text)), "no WhatsApp line is left as a note");
  assert.equal(acts.filter((x) => x.type === "Message").length, 3);
  assert.equal(w.all("conversations").filter((c) => c.leadId === a.id && c.channel === "WhatsApp").length, 1);
  const task = w.get("tasks", "tct-aaa");
  assert.deepEqual([task.status, task.origin, task.owner], ["Open", "TeleCRM", a.owner]);
  assert.equal(task.due, new Date(1801000000000).toISOString());
  assert.ok(!w.get("tasks", "tct-bbbb"), "a lost lead gets no follow-up task");
  assert.equal(w.all("leads").find((l) => l.telecrm.id === "bbbb").disposition, "Lost");
  assert.ok(w.tele.calls.filter((c) => c.url.startsWith("https://next.telecrm.in")).every((c) => c.auth === "Bearer sync-token-1" && c.url.startsWith("https://next.telecrm.in/autoupdate/v2/enterprise/")));

  w.tick(60000);
  const before = w.tele.calls.length;
  const again = await w.mirror.sync();
  assert.equal(again.mode, "delta");
  assert.equal(again.changed, 0);
  assert.equal(w.all("activities").length, 6);
  assert.equal(w.audio.length, 1, "a recording already kept is not fetched again");
  assert.ok(w.tele.calls.slice(before).every((c) => !/includeActions/.test(c.url)), "unchanged leads are not fetched again");
});

test("changes in TeleCRM reach the mirror: new status, new owner, a cleared follow-up closes the task, new leads appear", async (t) => {
  const w = world(t);
  connect(w);
  w.tele.leads = [lead("aaa", {}, { "next_follow-up_on": 1801000000000 })];
  await w.mirror.sync();
  w.tick(120000);
  w.tele.leads = [{ ...lead("aaa", { status: "Advance Received", employeeid: "sathiya@deviindustries.com" }, { modified_on: 2, last_activity_on: 2 }) }, lead("cccc", {}, {})];
  w.tele.touched = new Set(["aaa"]);
  w.tele.actions.aaa = [{ id: "n1", type: "STATUS_CHANGE", created_on: 1800000001000, fields: { status: "Advance Received" } }];
  const r = await w.mirror.sync();
  assert.equal(r.mode, "delta");
  assert.equal(r.changed, 2);
  const a = w.all("leads").find((l) => l.telecrm.id === "aaa");
  assert.equal(a.deal, "Advance Received");
  assert.equal(w.all("users").find((u) => u.id === a.owner).email, "sathiya@deviindustries.com");
  assert.equal(w.get("tasks", "tct-aaa").status, "Done");
  assert.ok(w.all("leads").some((l) => l.telecrm.id === "cccc"));
  const said = w.all("activities").filter((x) => x.leadId === a.id).map((x) => x.text || x.description || "");
  assert.equal(said.length, 2);
  assert.ok(said.some((x) => /^Owner changed: .+ → .+ · reason: changed in TeleCRM$/.test(x)), said.join(" | "));
});

test("a lead first linked to TeleCRM keeps the owner given here and TeleCRM is told; TeleCRM's old assignee never undoes it", async (t) => {
  const w = world(t);
  connect(w);
  await w.mirror.sync();
  const sathiya = w.all("users").find((u) => u.email === "sathiya@deviindustries.com");
  w.rawPut("leads", { id: "mine", name: "From WhatsApp", phone: "+919876511111", phoneKey: "919876511111", countryCode: "91", mobileNumber: "9876511111", owner: sathiya.id, stage: "New", deal: "", disposition: "" });
  w.tick(120000);
  w.tele.leads = [lead("aaa", {}, { phone: "919876511111", modified_on: 2 })];
  w.tele.touched = new Set(["aaa"]);
  await w.mirror.sync();
  assert.equal(w.get("leads", "mine").owner, sathiya.id, "the workflow's owner stays");
  assert.equal(w.mirror.settings().outbox.waiting, 1);
  await w.mirror.push();
  assert.deepEqual(w.tele.writes.at(-1).body.fields, { assignee: "sathiya@deviindustries.com" });
  w.tick(120000);
  w.tele.leads = [lead("aaa", {}, { phone: "919876511111", modified_on: 3 })];
  w.tele.touched = new Set(["aaa"]);
  await w.mirror.sync();
  assert.equal(w.get("leads", "mine").owner, sathiya.id, "TeleCRM still showing the old assignee does not move it back");
  assert.ok(!w.all("activities").some((x) => x.leadId === "mine" && /Owner changed/.test(x.text || "")));
});

test("TeleCRM's next_follow-up_on field becomes the lead's follow-up task", async (t) => {
  const w = world(t);
  connect(w);
  w.tele.leads = [lead("aaa", {}, { "next_follow-up_on": 1801000000000 })];
  await w.mirror.sync();
  const task = w.get("tasks", "tct-aaa");
  assert.equal(task.status, "Open");
  assert.equal(task.due, new Date(1801000000000).toISOString());
  assert.equal(w.all("leads")[0].telecrm.nextFollowup, 1801000000000);
});

test("the old Excel next_followup column is not a follow-up; a late task it left is closed as of its own date", async (t) => {
  const w = world(t);
  connect(w);
  const past = 1_799_000_000_000;
  w.tele.leads = [lead("aaa", {}, { "next_follow-up_on": past })];
  await w.mirror.sync();
  assert.equal(w.get("tasks", "tct-aaa").status, "Open");
  w.tick(120000);
  w.tele.leads = [lead("aaa", {}, { next_followup: past }), lead("bbbb", {}, { next_followup: 1801000000000 })];
  await w.mirror.sync();
  const closed = w.get("tasks", "tct-aaa");
  assert.equal(closed.status, "Done");
  assert.equal(closed.completedAt, new Date(past).toISOString(), "not counted as done today");
  assert.equal(w.get("tasks", "tct-bbbb"), undefined);
});

test("a lead already in this CRM with the same mobile number is adopted, not duplicated", async (t) => {
  const w = world(t);
  connect(w);
  w.rawPut("leads", { id: "mine", name: "Hand typed", phone: "+919876511111", phoneKey: "919876511111", countryCode: "91", mobileNumber: "9876511111", owner: "", stage: "New", deal: "", disposition: "" });
  w.tele.leads = [lead("aaa", {}, { phone: "919876511111" })];
  await w.mirror.sync();
  const leads = w.all("leads");
  assert.equal(leads.length, 1);
  assert.deepEqual([leads[0].id, leads[0].telecrm.id], ["mine", "aaa"]);
});

test("a refused token is reported plainly, stops the run and is remembered", async (t) => {
  const w = world(t);
  connect(w);
  w.tele.fail = 401;
  const r = await w.mirror.sync();
  assert.equal(r.ok, false);
  assert.match(r.message, /refused the token/);
  assert.equal(w.mirror.settings().lastRun.ok, false);
  assert.equal(w.mirror.settings().running, false);
  w.tele.fail = 0;
  assert.equal((await w.mirror.sync()).ok, true);
});

test("leads without a usable phone are kept, and two runs at once share one", async (t) => {
  const w = world(t);
  connect(w);
  w.tele.leads = [{ id: "nophone", employeeid: "", status: "New Lead", fields: { phone: "", name: "WhatsApp user", modified_on: 1 } }];
  const [one, two] = await Promise.all([w.mirror.sync(), w.mirror.sync()]);
  assert.equal(one, two);
  const l = w.all("leads")[0];
  assert.deepEqual([l.name, l.phoneKey], ["WhatsApp user", ""]);
});

test("the phone app's id is learned from Call IQ, so its calls belong to the right person", async (t) => {
  const w = world(t);
  connect(w);
  w.tele.leads = [lead("aaa", { employeeid: "sathiya@deviindustries.com" })];
  w.tele.actions.aaa = [
    { id: "c1", type: "OUTGOING_CALL", creationTimestamp: 1799500000000, employeeid: "Lf7vwxnDDANa976FtCg30NiQmVL2", duration: 60, feedback: "CONNECTED", callRecording: null },
    { id: "iq1", type: "ACTION_1002", creationTimestamp: 1799500100000, employeeid: "", automationInfo: { triggerActionid: "c1" }, fields: { telecrm_lead_caller: "bala@deviindustries.com", summary: "Customer wants a 2 hp press", "next_action_and_follow-up": "Send quotation" } },
  ];
  const first = await w.mirror.sync();
  assert.equal(first.ok, true, first.message);
  const bala = w.all("users").find((u) => u.email === "bala@deviindustries.com");
  assert.equal(w.all("mobileCalls")[0].owner, bala.id, "the app id maps to Balaji through the Call IQ note");
  assert.match(w.all("activities").find((x) => x.telecrmType === "ACTION_1002").text, /^Call IQ: Customer wants a 2 hp press\nNext: Send quotation/);
});

test("a recording that cannot be fetched is tried again on the next run, and gives up after a few tries", async (t) => {
  const w = world(t);
  connect(w);
  w.tele.leads = [lead("aaa")];
  w.tele.actions.aaa = [{ id: "c1", type: "INCOMING_CALL", creationTimestamp: 1799500000000, employeeid: "bala@deviindustries.com", duration: 40, feedback: "CONNECTED", callRecording: { name: "r.m4a", filePath: "x/y.mp3" } }];
  w.tele.failFiles = 1;
  const one = await w.mirror.sync();
  assert.equal(one.ok, true);
  assert.equal(w.audio.length, 0);
  assert.equal(w.get("mobileCalls", "tcc-c1").recordingTries, 1);
  assert.equal(one.errors, 1);
  w.tick(60000);
  const two = await w.mirror.sync();
  assert.equal(two.recordings, 1);
  assert.equal(w.audio.length, 1);
  assert.equal(w.get("mobileCalls", "tcc-c1").recordingId, "rec-0");
  // too many failures: it stops asking
  w.tele.actions.aaa = [{ id: "c2", type: "INCOMING_CALL", creationTimestamp: 1799600000000, employeeid: "bala@deviindustries.com", duration: 40, feedback: "CONNECTED", callRecording: { name: "r2.m4a", filePath: "x/z.mp3" } }];
  w.tele.leads = [lead("aaa", {}, { modified_on: 5, last_activity_on: 5 })];
  w.tele.touched = new Set(["aaa"]);
  w.tele.failFiles = 99;
  for (let i = 0; i < 6; i++) { w.tick(60000); await w.mirror.sync(); }
  assert.equal(w.get("mobileCalls", "tcc-c2").recordingTries, 4);
  assert.equal(w.audio.length, 1);
});

test("the newest recordings are copied first, and the waiting count is the whole backlog", async (t) => {
  const w = world(t);
  connect(w);
  w.tele.leads = [lead("aaa")];
  w.tele.actions.aaa = Array.from({ length: 160 }, (_, i) => ({ id: "c" + i, type: "INCOMING_CALL", creationTimestamp: 1799500000000 + i * 1000, employeeid: "bala@deviindustries.com", duration: 40, feedback: "CONNECTED", callRecording: { name: `r${i}.m4a`, filePath: `x/${i}.mp3` } }));
  const one = await w.mirror.sync();
  assert.equal(one.recordings, 150);
  assert.equal(one.recordingsWaiting, 10);
  assert.ok(w.get("mobileCalls", "tcc-c159").recordingId, "the newest call has its recording");
  assert.ok(!w.get("mobileCalls", "tcc-c0").recordingId, "the oldest waits for the next run");
});

test("a recording TeleCRM will not share (403) is given up at once and does not fail the sync", async (t) => {
  const w = world(t);
  connect(w);
  w.tele.leads = [lead("aaa")];
  w.tele.actions.aaa = [{ id: "c1", type: "INCOMING_CALL", creationTimestamp: 1799500000000, employeeid: "bala@deviindustries.com", duration: 40, feedback: "CONNECTED", callRecording: { name: "r.m4a", filePath: "x/y.mp3" } }];
  w.tele.denyFiles = true;
  const r = await w.mirror.sync();
  assert.equal(r.ok, true, r.message);
  const c = w.get("mobileCalls", "tcc-c1");
  assert.equal(c.recordingTries, 9);
  assert.match(c.recordingNote, /does not share/);
  assert.equal((await w.mirror.copyRecordings()).recordingsWaiting, 0);
});

test("recordings can be copied on their own, without reading the leads again", async (t) => {
  const w = world(t);
  connect(w);
  w.tele.leads = [lead("aaa")];
  w.tele.actions.aaa = [{ id: "c1", type: "INCOMING_CALL", creationTimestamp: 1799500000000, employeeid: "bala@deviindustries.com", duration: 40, feedback: "CONNECTED", callRecording: { name: "r.m4a", filePath: "x/y.mp3" } }];
  w.tele.failFiles = 1;
  await w.mirror.sync();
  assert.equal(w.audio.length, 0);
  const r = await w.mirror.copyRecordings();
  assert.deepEqual([r.recordings, r.recordingsWaiting], [1, 0]);
  assert.equal(w.get("mobileCalls", "tcc-c1").recordingId, "rec-0");
});

test("a copy made by an older version is read again once, so old notes become messages", async (t) => {
  const w = world(t);
  // what the first version left behind: the lead looks up to date, and the WhatsApp line sits in the history as a note
  w.rawPut("leads", { id: "tc-aaa", name: "Customer aaa", phone: "", phoneKey: "", stage: "New", deal: "", disposition: "", telecrm: { id: "aaa", status: "New Lead", assignee: "bala@deviindustries.com", nextFollowup: null, modifiedOn: 1, lastActivityOn: 1, fields: {} } });
  w.rawPut("activities", { id: "tca-aaa-m1", leadId: "tc-aaa", type: "Note", text: "ACTION_1013: {\"notes\":\"Customer | Sales 82828 27732\\nHello\"}" });
  connect(w);
  w.tele.leads = [lead("aaa", {}, { modified_on: 1, last_activity_on: 1 })];
  w.tele.actions.aaa = [{ id: "m1", type: "ACTION_1013", creationTimestamp: 1799700000000, employeeid: "bala@deviindustries.com", fields: { notes: "Customer | Sales 82828 27732\nHello" } }];
  const first = await w.mirror.sync();
  assert.equal(first.mode, "full");
  assert.equal(w.get("activities", "tca-aaa-m1").type, "Message");
  assert.equal(w.all("messages").length, 1);
  w.tick(60000);
  const second = await w.mirror.sync();
  assert.equal(second.changed, 0, "after that, unchanged leads are skipped again");
});

test("a real source found here is not overwritten by TeleCRM's \"Excel\"; a real TeleCRM source still wins", async (t) => {
  const w = world(t);
  connect(w);
  w.rawPut("leads", { id: "smx", name: "From Salesmax", phone: "+919876511111", phoneKey: "919876511111", countryCode: "91", mobileNumber: "9876511111", owner: "", stage: "New", deal: "", disposition: "", source: "IndiaMART", createdAt: "2025-08-01T05:00:00.000Z" });
  w.rawPut("leads", { id: "two", name: "Other", phone: "+919876522222", phoneKey: "919876522222", countryCode: "91", mobileNumber: "9876522222", owner: "", stage: "New", deal: "", disposition: "", source: "IndiaMART" });
  w.tele.leads = [lead("aaa", {}, { phone: "919876511111", lead_source: "Excel" }), lead("bbbb", {}, { phone: "919876522222", lead_source: "TradeIndia" })];
  await w.mirror.sync();
  assert.equal(w.get("leads", "smx").source, "IndiaMART");
  assert.equal(w.get("leads", "smx").createdAt, "2025-08-01T05:00:00.000Z", "the earlier real date stays");
  assert.equal(w.get("leads", "two").source, "TradeIndia");
});

test("a TeleCRM follow-up moved or done in the CRM stays so, until TeleCRM sets another date", async (t) => {
  const w = world(t);
  connect(w);
  w.tele.leads = [lead("aaa", {}, { "next_follow-up_on": 1801000000000 })];
  await w.mirror.sync();
  const tcDue = new Date(1801000000000).toISOString(), moved = new Date(1801500000000).toISOString();
  // what the CRM's task save keeps when someone changes it: the new date, and the date TeleCRM had
  w.rawPut("tasks", { ...w.get("tasks", "tct-aaa"), due: moved, tcDue });
  w.tick(120000);
  await w.mirror.sync();
  assert.equal(w.get("tasks", "tct-aaa").due, moved, "the CRM's new date stays");
  w.rawPut("tasks", { ...w.get("tasks", "tct-aaa"), status: "Done" });
  w.tick(120000);
  await w.mirror.sync();
  assert.equal(w.get("tasks", "tct-aaa").status, "Done", "done stays done");
  // TeleCRM gets a new follow-up date: that one is the follow-up now
  w.tele.leads = [lead("aaa", {}, { "next_follow-up_on": 1802000000000, modified_on: 3 })];
  w.tele.touched = new Set(["aaa"]);
  w.tick(120000);
  await w.mirror.sync();
  const task = w.get("tasks", "tct-aaa");
  assert.equal(task.due, new Date(1802000000000).toISOString());
  assert.equal(task.status, "Open");
  assert.equal(task.tcDue, undefined);
});

test("changes made here go back to TeleCRM: fields, status, assignee, follow-up and notes; the read waits for them", async (t) => {
  const w = world(t);
  connect(w);
  w.tele.leads = [lead("aaa", {}, { "next_follow-up_on": 1801000000000 })];
  await w.mirror.sync();
  const before = w.get("leads", "tc-aaa"), sathiya = w.all("users").find((u) => u.email === "sathiya@deviindustries.com");
  // a person moves the lead on, gives it to Sathiya and fixes the city
  const after = { ...before, owner: sathiya.id, deal: "Quotation Shared", stage: "Quotation given", city: "Salem" };
  w.rawPut("leads", after);
  w.mirror.queueChange("leads", before, after);
  // the follow-up is done, and a note is written
  const task = w.get("tasks", "tct-aaa");
  w.rawPut("tasks", { ...task, status: "Done" });
  w.mirror.queueChange("tasks", task, { ...task, status: "Done" });
  w.mirror.queueChange("activities", null, { id: "n1", type: "Note", text: "Wants 2 machines", leadId: "tc-aaa", userId: sathiya.id, createdAt: "2027-01-15T04:30:00.000Z" });
  // an import or a workflow note is not sent
  w.mirror.queueChange("activities", null, { id: "n2", type: "Note", text: "Repeat enquiry", leadId: "tc-aaa", integrationSource: "indiamart" });
  assert.equal(w.mirror.settings().outbox.waiting, 2, "the field changes for one lead (lead and follow-up) are merged into one update");
  // TeleCRM still says New Lead: a read now leaves the CRM's newer values alone
  w.tick(120000);
  w.tele.touched = new Set(["aaa"]);
  w.tele.leads = [lead("aaa", {}, { "next_follow-up_on": 1801000000000, modified_on: 2 })];
  await w.mirror.sync();
  assert.equal(w.get("leads", "tc-aaa").deal, "Quotation Shared");
  w.tele.remarks = [{ field: "fields.city", status: "UPDATED" }];
  const out = await w.mirror.push();
  assert.equal(out.sent, 2);
  const [fields, note] = w.tele.writes;
  assert.equal(fields.path, "/lead/aaa");
  assert.deepEqual(fields.body.fields, { city: "Salem", assignee: "sathiya@deviindustries.com", status: "Quotation Shared", "next_follow-up_on": "" });
  assert.equal(note.path, "/lead/aaa/action");
  assert.equal(note.body.actions[0].type, "1014");
  assert.equal(note.body.actions[0].employeeid, "sathiya@deviindustries.com");
  assert.equal(note.body.actions[0].fields.notes, "Wants 2 machines\n— Sathiya, Salesdesk");
  assert.equal(note.body.actions[0].created_on, "15/01/2027 10:00:00");
  assert.equal(w.mirror.settings().outbox.waiting, 0);
  // the note coming back from TeleCRM is not added a second time
  w.tele.actions.aaa = [{ id: "x1", type: "ACTION_1014", creationTimestamp: 1800000300000, fields: { note: "Wants 2 machines\n— Sathiya, Salesdesk" } }];
  w.tele.leads = [lead("aaa", { status: "Quotation Shared", employeeid: "sathiya@deviindustries.com" }, { modified_on: 3 })];
  w.tick(120000);
  await w.mirror.sync();
  assert.equal(w.all("activities").filter((a) => a.leadId === "tc-aaa" && /Wants 2 machines/.test(a.text || "")).length, 0);
  assert.equal(w.get("leads", "tc-aaa").deal, "Quotation Shared");
});

test("a field TeleCRM turns down is kept as the outbox entry's error", async (t) => {
  const w = world(t);
  connect(w);
  w.tele.leads = [lead("aaa")];
  await w.mirror.sync();
  const before = w.get("leads", "tc-aaa");
  w.mirror.queueChange("leads", before, { ...before, state: "Atlantis" });
  w.tele.remarks = [{ field: "fields.state", status: "IGNORED", remark: "Not an option" }];
  await w.mirror.push();
  assert.match(w.mirror.settings().outbox.recent[0].error, /state: Not an option/);
});
