import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWaGateway, publicHttps } from "./wa-gateway.mjs";

const SECRET = "whsec_test_secret_value";
function fixture(t, { fetchImpl } = {}) {
  const db = new DatabaseSync(":memory:");
  const dir = mkdtempSync(join(tmpdir(), "wagw-test-"));
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.exec("CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))");
  const all = (kind) => db.prepare("SELECT body FROM records WHERE kind=?").all(kind).map((r) => JSON.parse(r.body));
  const get = (kind, id) => { const r = db.prepare("SELECT body FROM records WHERE kind=? AND id=?").get(kind, id); return r && JSON.parse(r.body); };
  const put = (kind, v) => db.prepare("INSERT OR REPLACE INTO records VALUES(?,?,?)").run(kind, v.id, JSON.stringify(v));
  const stamp = (v) => ({ id: randomUUID(), ...v });
  const tx = (fn) => { db.exec("BEGIN"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } };
  const log = (leadId, type, text, extra = {}) => { const a = stamp({ leadId, type, text, ...extra }); put("activities", a); return a; };
  put("users", { id: "owner", active: true });
  put("users", { id: "sales", active: true });
  const calls = [];
  const gw = createWaGateway({ db, all, get, put, stamp, tx, log, keyPath: join(dir, "key"), systemUser: "owner", checkUrl: async (u) => u,
    fetchImpl: fetchImpl || (async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ message_id: "wamid.OUT1", ok: true }) }; }) });
  return { gw, all, get, put, calls };
}
const sign = (body, secret = SECRET) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
const event = (over = {}, name = "message.received") => Buffer.from(JSON.stringify({ event: name, delivery_id: "d1", sent_at: 1, data: { wa_id: "919876500001", name: "Ravi Kumar", phone_id: "111", number_label: "Sales 1", kind: "text", text: "Price please", has_file: false, message_id: "wamid.A1", is_new_customer: true, at: 1794000000, ...over } }));
async function ready(f) {
  await f.gw.save({ baseUrl: "https://wa.example.com", apiKey: "key-1", webhookSecret: SECRET, enabled: true, numberOwners: { 111: "sales" } });
}
const status = (n) => (e) => e.status === n;

test("settings never give the key or the secret back, and cannot be enabled half set up", async (t) => {
  const f = fixture(t);
  await assert.rejects(f.gw.save({ enabled: true }), status(400));
  const saved = await f.gw.save({ baseUrl: "https://wa.example.com/", apiKey: "key-1", webhookSecret: SECRET });
  assert.equal(saved.baseUrl, "https://wa.example.com");
  assert.equal(saved.hasKey, true);
  assert.equal(saved.hasSecret, true);
  assert.ok(!JSON.stringify(saved).includes("key-1") && !JSON.stringify(saved).includes(SECRET));
  assert.equal((await f.gw.save({ enabled: true })).enabled, true);
  await assert.rejects(f.gw.save({ defaultOwner: "ghost" }), status(400));
  await assert.rejects(f.gw.save({ numberOwners: { "abc": "sales" } }), status(400));
  assert.equal((await f.gw.save({ apiKey: "" })).hasKey, true); // an empty box keeps the key
});

test("the gateway address must be a public https site", async () => {
  const resolve = async (host) => (host === "inside.example" ? [{ address: "10.0.0.5" }] : [{ address: "93.184.216.34" }]);
  assert.equal(await publicHttps("https://wa.example.com", resolve), "https://wa.example.com");
  for (const bad of ["http://wa.example.com", "https://user:pw@wa.example.com", "https://inside.example", "https://127.0.0.1", "https://[::1]", "https://wa.example.com/?x=1", "not a url"])
    await assert.rejects(publicHttps(bad, resolve), status(400), bad);
});

test("a signed customer message makes a lead under the number's owner, with the message and an activity; a repeat is ignored", async (t) => {
  const f = fixture(t);
  await ready(f);
  const body = event();
  const first = f.gw.receive(body, sign(body));
  assert.equal(first.created, true);
  const lead = f.get("leads", first.leadId);
  assert.deepEqual([lead.name, lead.phone, lead.source, lead.stage, lead.owner], ["Ravi Kumar", "919876500001", "WhatsApp", "New", "sales"]);
  const [message] = f.all("messages");
  assert.deepEqual([message.provider, message.direction, message.text, message.phoneId, message.leadId], ["gateway", "Incoming", "Price please", "111", lead.id]);
  assert.ok(f.all("activities").some((a) => a.type === "Message" && a.leadId === lead.id));
  assert.equal(f.gw.settings().seenNumbers["111"], "Sales 1");
  assert.equal(f.gw.receive(body, sign(body)).duplicate, true);
  assert.equal(f.all("messages").length, 1);
  // the same event also arrives as customer.new: still one message
  const again = event({}, "customer.new");
  assert.equal(f.gw.receive(again, sign(again)).duplicate, true);
  // a later message from the same number joins the same lead
  const next = event({ message_id: "wamid.A2", text: "Still waiting", is_new_customer: false });
  const second = f.gw.receive(next, sign(next));
  assert.equal(second.created, false);
  assert.equal(second.leadId, lead.id);
  assert.equal(f.all("leads").length, 1);
  assert.equal(f.all("conversations").length, 1);
});

test("a bad signature, a turned-off link or a customer without a number is refused or ignored", async (t) => {
  const f = fixture(t);
  const body = event();
  assert.throws(() => f.gw.receive(body, sign(body)), status(404));
  await ready(f);
  assert.throws(() => f.gw.receive(body, sign(body, "other")), status(401));
  assert.throws(() => f.gw.receive(body, ""), status(401));
  assert.throws(() => f.gw.receive(Buffer.from(body.toString() + " "), sign(body)), status(401));
  const hidden = event({ wa_id: "IN.1349120865" });
  assert.match(f.gw.receive(hidden, sign(hidden)).ignored, /phone/);
  const other = Buffer.from(JSON.stringify({ event: "something.else", data: {} }));
  assert.match(f.gw.receive(other, sign(other)).ignored, /event/);
  assert.equal(f.all("leads").length, 0);
  await f.gw.save({ createLeads: false });
  const unknown = event({ message_id: "wamid.Z" });
  assert.match(f.gw.receive(unknown, sign(unknown)).ignored, /no lead/);
});

test("a message from a number that is already a lead is attached to it, files get a placeholder text", async (t) => {
  const f = fixture(t);
  await ready(f);
  f.put("leads", { id: "known", name: "Known Customer", phone: "+91 98765 00001", owner: "owner", stage: "Prospecting" });
  const body = event({ text: "", kind: "image", has_file: true, message_id: "wamid.IMG" });
  const r = f.gw.receive(body, sign(body));
  assert.deepEqual([r.leadId, r.created], ["known", false]);
  assert.match(f.all("messages")[0].text, /image/);
  assert.equal(f.get("leads", "known").name, "Known Customer");
});

test("sending goes out through the gateway from the number the customer wrote to, and is kept on the lead", async (t) => {
  const f = fixture(t);
  await ready(f);
  const body = event();
  const { leadId } = f.gw.receive(body, sign(body));
  const out = await f.gw.send(leadId, { text: "  Vanakkam, price list attached soon  " }, "sales");
  assert.equal(out.messageId, "wamid.OUT1");
  const call = f.calls.at(-1);
  assert.equal(call.url, "https://wa.example.com/api/send");
  assert.equal(call.init.headers["X-Api-Key"], "key-1");
  const sent = JSON.parse(call.init.body);
  assert.deepEqual([sent.to, sent.text, sent.from_phone_id], ["919876500001", "Vanakkam, price list attached soon", "111"]);
  assert.match(sent.idempotency_key, /^salesdesk:/);
  const stored = f.all("messages").find((m) => m.direction === "Outgoing");
  assert.deepEqual([stored.status, stored.userId, stored.text], ["Sent", "sales", "Vanakkam, price list attached soon"]);
  await f.gw.send(leadId, { template: "devi_welcome_v2", params: ["Ravi"] }, "sales");
  const tpl = JSON.parse(f.calls.at(-1).init.body);
  assert.deepEqual([tpl.template, tpl.params, tpl.language, tpl.text], ["devi_welcome_v2", ["Ravi"], "en", undefined]);
  await assert.rejects(f.gw.send(leadId, {}, "sales"), status(400));
  await assert.rejects(f.gw.send(leadId, { template: "Bad Name!" }, "sales"), status(400));
  await assert.rejects(f.gw.send("missing", { text: "x" }, "sales"), status(404));
});

test("a refusal or silence from the gateway becomes a clear error and nothing is saved", async (t) => {
  const f = fixture(t, { fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ detail: "template not approved" }) }) });
  await ready(f);
  f.put("leads", { id: "l", name: "L", phone: "919876500009", owner: "owner" });
  await assert.rejects(f.gw.send("l", { text: "hi" }, "owner"), (e) => e.status === 502 && /template not approved/.test(e.message));
  assert.equal(f.all("messages").length, 0);
  const down = fixture(t, { fetchImpl: async () => { throw new Error("offline"); } });
  await ready(down);
  down.put("leads", { id: "l", name: "L", phone: "919876500009", owner: "owner" });
  await assert.rejects(down.gw.send("l", { text: "hi" }, "owner"), status(502));
});

test("history adds the missing messages of both directions once", async (t) => {
  const rows = [
    { id: 1, direction: "in", kind: "text", body: "Hello", meta_msg_id: "wamid.H1", created_at: 1794000000, phone_id: "111", status: "received" },
    { id: 2, direction: "out", source: "web:priya", kind: "text", body: "Hi, how can I help?", meta_msg_id: "wamid.H2", created_at: 1794000060, phone_id: "111", status: "read" },
    { id: 3, direction: "echo", kind: "text", body: "From the phone app", meta_msg_id: null, created_at: 1794000120, phone_id: "111", status: "sent" },
  ];
  const f = fixture(t, { fetchImpl: async (url) => ({ ok: true, status: 200, json: async () => (url.includes("/api/messages") ? rows : {}) }) });
  await ready(f);
  f.put("leads", { id: "l", name: "L", phone: "919876500001", owner: "owner" });
  assert.deepEqual(await f.gw.history("l"), { added: 3, total: 3 });
  assert.deepEqual(await f.gw.history("l"), { added: 0, total: 3 });
  assert.deepEqual(f.all("messages").map((m) => m.direction).sort(), ["Incoming", "Outgoing", "Outgoing"]);
});

test("the connection test reports reachability, the key and the numbers", async (t) => {
  const f = fixture(t, { fetchImpl: async (url, init) => (url.endsWith("/health") ? { ok: true, status: 200, json: async () => ({ ok: true, connected_numbers: 5, agent_mode: "all", pending_owner_alerts: 0 }) } : { ok: init.headers?.["X-Api-Key"] === "key-1", status: 200, json: async () => [] }) });
  await ready(f);
  assert.deepEqual(await f.gw.test(), { reachable: true, keyOk: true, numbers: 5, aiMode: "all", pendingAlerts: 0 });
});

test("one-click connect: Connect makes a one-time token; the gateway hands over key and secret with it, once, before it expires", async (t) => {
  let clock = 1_800_000_000_000;
  const db = new DatabaseSync(":memory:");
  const dir = mkdtempSync(join(tmpdir(), "wagw-pair-"));
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.exec("CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))");
  const nothing = () => [];
  const gw = createWaGateway({ db, all: nothing, get: () => null, put: () => {}, stamp: (v) => v, tx: (fn) => fn(), log: () => {}, keyPath: join(dir, "key"),
    checkUrl: async (u) => (u.startsWith("https://") ? new URL(u).origin : (() => { throw Object.assign(Error("bad"), { status: 400 }); })()), now: () => clock });
  await assert.rejects(gw.startPairing("https://wa.example.com", ""), status(409));
  await assert.rejects(gw.startPairing("https://wa.example.com", "http://crm.example.com"), status(409));
  await assert.rejects(gw.startPairing("http://wa.example.com", "https://crm.example.com"), status(400));
  const { url } = await gw.startPairing("https://wa.example.com/", "https://crm.example.com/");
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://wa.example.com/app/connect");
  assert.equal(u.searchParams.get("app"), "salesdesk");
  assert.equal(u.searchParams.get("crm"), "https://crm.example.com");
  assert.equal(u.searchParams.get("back"), "/next/#/settings?tab=gateway");
  const token = u.searchParams.get("token");
  assert.ok(token.length >= 40);
  assert.ok(!JSON.stringify(gw.settings()).includes(token), "the token is not kept or shown");
  const handover = { token, base_url: "https://wa.example.com", api_key: "k".repeat(43), webhook_secret: "s".repeat(43), default_from_phone_id: "538388877117181",
    numbers: [{ phone_id: "538388877117181", label: "Main 94431 74449" }, { phone_id: "bad", label: "x" }] };
  assert.throws(() => gw.pair({ ...handover, token: "wrong".repeat(9) }), status(404));
  assert.throws(() => gw.pair({ ...handover, token: "" }), status(404));
  assert.throws(() => gw.pair({ ...handover, api_key: "short" }), status(400));
  assert.throws(() => gw.pair({ ...handover, webhook_secret: "has space ".repeat(4) }), status(400));
  assert.throws(() => gw.pair({ ...handover, base_url: "https://other.example.com" }), status(400), "the address the admin chose");
  assert.equal(gw.settings().enabled, false, "nothing changes until a good handover");
  assert.deepEqual(gw.pair(handover), { ok: true });
  const s = gw.settings();
  assert.equal(s.enabled, true);
  assert.equal(s.baseUrl, "https://wa.example.com");
  assert.ok(s.hasKey && s.hasSecret);
  assert.equal(s.defaultFromPhoneId, "538388877117181");
  assert.deepEqual(s.seenNumbers, { 538388877117181: "Main 94431 74449" });
  assert.ok(!JSON.stringify(s).includes("k".repeat(43)) && !JSON.stringify(s).includes("s".repeat(43)));
  assert.throws(() => gw.pair(handover), status(404), "a token works once");
  // the handed-over secret signs incoming messages
  const body = Buffer.from(JSON.stringify({ event: "test", data: {} }));
  assert.deepEqual(gw.receive(body, "sha256=" + createHmac("sha256", "s".repeat(43)).update(body).digest("hex")), { ignored: "event not used here" });
  // an old request runs out
  const again = new URL((await gw.startPairing("https://wa.example.com", "https://crm.example.com")).url).searchParams.get("token");
  clock += 11 * 60000;
  assert.throws(() => gw.pair({ ...handover, token: again }), status(404));
});
