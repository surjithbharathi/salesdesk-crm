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
  const tele = { leads: [], actions: {}, calls: [], fail: 0 };
  let clock = 1_800_000_000_000;
  const fetchImpl = async (url, init) => {
    tele.calls.push({ url, method: init.method, auth: init.headers.Authorization });
    if (tele.fail) return { ok: false, status: tele.fail, json: async () => ({}) };
    const u = new URL(url), path = u.pathname.replace(/^.*\/enterprise\/[^/]+/, "");
    const skip = Number(u.searchParams.get("skip") || 0), limit = Number(u.searchParams.get("limit") || 10);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (path === "/team-members") return ok({ data: members.slice(skip, skip + limit), total_count: members.length });
    if (path === "/lead/search") {
      const body = JSON.parse(init.body || "{}");
      const rows = body.actions ? tele.leads.filter((l) => tele.touched?.has(l.id)) : tele.leads;
      return ok({ data: rows.slice(skip, skip + limit), total_count: rows.length });
    }
    const m = /^\/lead\/([^/]+)$/.exec(path);
    if (m) { const acts = tele.actions[m[1]] || []; return ok({ id: m[1], actions: acts.slice(skip, skip + limit) }); }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const mirror = createTelecrmMirror({ db, all, get, put: rawPut, rawPut, tx, now: () => clock, keyPath: join(dir, "key"), fetchImpl });
  return { mirror, all, get, rawPut, tele, tick: (ms) => { clock += ms; } };
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
    lead("aaa", { status: "Quotation Shared" }, { next_followup: 1801000000000, expected_revenue: "250000", city: "Erode" }),
    lead("bbbb", { status: "Lost" }, { next_followup: 1801000000000, lost_reason: "Budget Issues" }),
  ];
  w.tele.actions.aaa = [
    { id: "x1", type: "OUTGOING_CALL", created_on: 1799500000000, performed_by: "bala@deviindustries.com", fields: { duration: 95 } },
    { id: "x2", type: "USER_NOTE", created_on: 1799600000000, fields: { note: "Wants 2 hp motor" } },
    { id: "x3", type: "INCOMING_WHATSAPP_MSG", created_on: 1799700000000, fields: { text: "Price?" } },
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
  assert.deepEqual(acts.map((x) => x.type).sort(), ["Call", "Message", "Note"]);
  assert.equal(acts.find((x) => x.type === "Call").duration, 95);
  const task = w.get("tasks", "tct-aaa");
  assert.deepEqual([task.status, task.origin, task.owner], ["Open", "TeleCRM", a.owner]);
  assert.equal(task.due, new Date(1801000000000).toISOString());
  assert.ok(!w.get("tasks", "tct-bbbb"), "a lost lead gets no follow-up task");
  assert.equal(w.all("leads").find((l) => l.telecrm.id === "bbbb").disposition, "Lost");
  assert.ok(w.tele.calls.every((c) => c.auth === "Bearer sync-token-1" && c.url.startsWith("https://next.telecrm.in/autoupdate/v2/enterprise/")));

  w.tick(60000);
  const before = w.tele.calls.length;
  const again = await w.mirror.sync();
  assert.equal(again.mode, "delta");
  assert.equal(again.changed, 0);
  assert.equal(w.all("activities").length, 3);
  assert.ok(w.tele.calls.slice(before).every((c) => !/includeActions/.test(c.url)), "unchanged leads are not fetched again");
});

test("changes in TeleCRM reach the mirror: new status, new owner, a cleared follow-up closes the task, new leads appear", async (t) => {
  const w = world(t);
  connect(w);
  w.tele.leads = [lead("aaa", {}, { next_followup: 1801000000000 })];
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
  assert.equal(w.all("activities").filter((x) => x.leadId === a.id).length, 1);
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
