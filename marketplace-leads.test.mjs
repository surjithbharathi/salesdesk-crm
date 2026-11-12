import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMarketplaceLeads, readIndiamart, readTradeindia, imParam, readTime, plain, enquiryDetails } from "./marketplace-leads.mjs";
import { phoneParts } from "./lead-phone.mjs";

function fixture(t, now = { value: Date.UTC(2026, 10, 12, 6, 0, 0) }) {
  const db = new DatabaseSync(":memory:"), dir = mkdtempSync(join(tmpdir(), "salesdesk-market-"));
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.exec("CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))");
  const withPhone = (kind, v) => { if (kind === "leads") try { return { ...v, ...phoneParts(v.phone) }; } catch {} return v; };
  const all = (kind) => db.prepare("SELECT body FROM records WHERE kind=?").all(kind).map((r) => withPhone(kind, JSON.parse(r.body)));
  const get = (kind, id) => { const r = db.prepare("SELECT body FROM records WHERE kind=? AND id=?").get(kind, id); return r && withPhone(kind, JSON.parse(r.body)); };
  const put = (kind, v) => db.prepare("INSERT OR REPLACE INTO records VALUES(?,?,?)").run(kind, v.id, JSON.stringify(withPhone(kind, v)));
  const stamp = (v) => ({ ...v, id: randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const tx = (fn) => { db.exec("BEGIN"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } };
  const log = (leadId, type, text, extra = {}) => { const a = stamp({ leadId, type, text, ...extra }); put("activities", a); return a; };
  const replies = [], asked = [];
  const fetchImpl = async (url) => { asked.push(String(url)); const r = replies.shift() ?? { status: 200, body: [] }; return { status: r.status, text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)) }; };
  const m = createMarketplaceLeads({ db, all, get, put, stamp, tx, log, keyPath: join(dir, "key"), now: () => now.value, fetchImpl, timers: false });
  return { db, all, get, put, m, replies, asked, now };
}
const im = (v) => ({ UNIQUE_QUERY_ID: "Q" + Math.random().toString(36).slice(2), QUERY_TYPE: "B", QUERY_TIME: "2026-11-12 10:15:00", SENDER_NAME: "Malvika", SENDER_MOBILE: "+91-8328485570",
  SENDER_EMAIL: "m@example.com", SENDER_CITY: "Hyderabad", SENDER_STATE: "Telangana", SENDER_COUNTRY_ISO: "IN", QUERY_PRODUCT_NAME: "Cold Press Oil Machine",
  QUERY_MESSAGE: "Requirement for Cold Press Oil Machine<br>Production Capacity: 100 kg/hr", ...v });
const ti = (v) => ({ rfi_id: "R" + Math.random().toString(36).slice(2), sender_name: "Narayan lal kumawat", sender_mobile: "+919057567249", sender_co: "Narayan", sender_city: "Begun",
  sender_state: "Rajasthan", sender_country: "IN", subject: "Looking for suppliers of Ss Press Oil Machine", product_name: "Ss Press Oil Machine", quantity: "1 Piece",
  message: 'Buyer: Mobile - <a href="tel:+919057567249">+919057567249</a> Company Name - Narayan', generated_date: "2026-11-12", generated_time: "11:20:05", inquiry_type: "Direct Inquiry", ...v });

test("helpers read both sites' times, numbers and text", () => {
  assert.equal(imParam(Date.UTC(2026, 10, 10, 13, 27, 0)), "10-Nov-202618:57:00");
  assert.equal(readTime("2026-11-10 18:57:00"), Date.UTC(2026, 10, 10, 13, 27, 0));
  assert.equal(readTime("10-Nov-2026 18:57:00"), Date.UTC(2026, 10, 10, 13, 27, 0));
  assert.equal(readTime("2026-11-10", "18:57:00"), Date.UTC(2026, 10, 10, 13, 27, 0));
  assert.equal(plain('Hi<br>call <a href="x">+91 98</a> &amp; go'), "Hi\ncall +91 98 & go");
  const a = readIndiamart(im({ QUERY_TYPE: "W" }));
  assert.equal(a.phone, "+918328485570");
  assert.equal(a.type, "Direct enquiry");
  assert.equal(a.message, "Requirement for Cold Press Oil Machine\nProduction Capacity: 100 kg/hr");
  const b = readTradeindia(ti({ sender_mobile: "9057567249" }));
  assert.equal(b.phone, "+919057567249");
  assert.equal(b.at, Date.UTC(2026, 10, 12, 5, 50, 5));
  assert.equal(readTradeindia({ RFI_ID: "1", SENDER_MOBILE: "919057567249" }).phone, "+919057567249", "field names in any case");
});

test("IndiaMART enquiries become leads once; a known buyer gets a note instead", async (t) => {
  const f = fixture(t), { m, replies, asked, all } = f;
  f.put("users", { id: "u1", name: "Sathiya", active: true });
  f.put("leads", { id: "old", name: "+919486583682", phone: "+919486583682", stage: "New", owner: "u1" });
  m.save({ owner: "u1", indiamart: { key: "abcdefghijklmnop1234", enabled: true, backfillDays: 2 } });
  const first = im(), repeat = im({ UNIQUE_QUERY_ID: "Q2", QUERY_TYPE: "W", SENDER_NAME: "Akhil Services", SENDER_MOBILE: "+91-9486583682", SENDER_STATE: "TAMILNADU" });
  replies.push({ status: 200, body: { CODE: 200, STATUS: "SUCCESS", RESPONSE: [first, repeat, im({ UNIQUE_QUERY_ID: "Q3", SENDER_MOBILE: "", SENDER_EMAIL: "" })] } });
  const out = await m.sync();
  assert.match(asked[0], /glusr_crm_key=abcdefghijklmnop1234&start_time=10-Nov-2026/);
  assert.deepEqual([out.results.indiamart.ok, out.results.indiamart.newLeads, out.results.indiamart.repeats, out.results.indiamart.skipped], [true, 1, 1, 1]);
  const made = all("leads").find((l) => l.phoneKey === "918328485570");
  assert.equal(made.source, "IndiaMART");
  assert.equal(made.owner, "u1");
  assert.equal(made.state, "Telangana");
  assert.equal(made.language, "Telugu");
  assert.equal(made.product, "Cold Press Oil Machine");
  const old = f.get("leads", "old");
  assert.equal(old.name, "Akhil Services", "a lead named only by its number takes the buyer's name");
  assert.equal(old.state, "Tamil Nadu");
  assert.ok(all("activities").some((a) => a.leadId === "old" && /^Repeat enquiry: IndiaMART direct enquiry about Cold Press Oil Machine/.test(a.text)));
  // the next read overlaps; the same enquiries are not taken twice
  replies.push({ status: 200, body: { CODE: 200, RESPONSE: [first, repeat] } });
  const again = await m.sync();
  assert.equal(again.results.indiamart.newLeads + again.results.indiamart.repeats, 0);
  assert.equal(all("leads").length, 2);
  assert.equal(m.settings().indiamart.enquiries, 3);
  assert.equal(m.settings().indiamart.hasKey, true);
  assert.equal(JSON.stringify(m.settings()).includes("abcdefghijklmnop1234"), false, "the key is never shown again");
});

test("IndiaMART's wait-5-minutes answer keeps the place for the next read", async (t) => {
  const { m, replies } = fixture(t);
  m.save({ indiamart: { key: "abcdefghijklmnop1234", enabled: true } });
  replies.push({ status: 200, body: { CODE: 429, STATUS: "FAILURE", MESSAGE: "It is advised to hit this API once in every 5 minutes" } });
  const out = await m.sync();
  assert.equal(out.results.indiamart.ok, false);
  assert.match(out.results.indiamart.message, /5 minutes/);
  assert.equal(out.indiamart.readUpTo, null);
});

test("TradeIndia enquiries are read page by page and day by day", async (t) => {
  const f = fixture(t), { m, replies, asked, all } = f;
  f.db.exec("CREATE TABLE blocked_numbers(phone TEXT PRIMARY KEY, name TEXT, by TEXT, at TEXT)");
  f.db.prepare("INSERT INTO blocked_numbers VALUES('9000000001','x','u','now')").run();
  assert.throws(() => m.save({ tradeindia: { enabled: true } }), /user id, profile id and key/);
  m.save({ tradeindia: { userid: "12345", profileId: "67890", key: "a1b2c3d4e5f6", enabled: true, backfillDays: 3 } });
  const page1 = Array.from({ length: 50 }, (_, i) => ti({ rfi_id: "P" + i, sender_mobile: "+9198765" + String(10000 + i) }));
  replies.push({ status: 200, body: page1 }, { status: 200, body: [ti({ rfi_id: "LAST" }), ti({ rfi_id: "BLK", sender_mobile: "9000000001" })] });
  const out = await m.sync();
  assert.match(asked[0], /my_inquiry\.html\?userid=12345&profile_id=67890&key=a1b2c3d4e5f6&from_date=2026-11-10&to_date=2026-11-12&limit=50&page_no=1/);
  assert.match(asked[1], /page_no=2/);
  assert.deepEqual([out.results.tradeindia.newLeads, out.results.tradeindia.skipped], [51, 1]);
  const lead = all("leads").find((l) => l.phoneKey === "919057567249");
  assert.equal(lead.source, "TradeIndia");
  assert.equal(lead.company, "Narayan");
  assert.ok(all("activities").some((a) => a.leadId === lead.id && /^TradeIndia direct inquiry about Ss Press Oil Machine \(1 Piece\)\nLooking for suppliers/.test(a.text)));
  assert.equal(all("leads").some((l) => l.phoneKey === "919000000001"), false, "a blocked number is never made a lead");
  // the next read starts again from the last day read
  replies.push({ status: 200, body: { error: "No Record Found" } });
  const next = await m.sync();
  assert.equal(next.results.tradeindia.ok, true);
  assert.match(asked[2], /from_date=2026-11-11&to_date=2026-11-12/);
});

test("TradeIndia refusing the key is said plainly", async (t) => {
  const { m, replies } = fixture(t);
  m.save({ tradeindia: { userid: "1", profileId: "2", key: "wrongkey99", enabled: true } });
  replies.push({ status: 200, body: { error: "Invalid key" } });
  const out = await m.sync();
  assert.equal(out.results.tradeindia.ok, false);
  assert.equal(out.results.tradeindia.message, "TradeIndia: Invalid key");
});

test("IndiaMART's push makes the lead at once, only at its own address, and never twice", async (t) => {
  const f = fixture(t), { m, replies, all } = f;
  assert.throws(() => m.receivePush("0".repeat(32), { RESPONSE: im() }), /Not found/, "push is off until it is switched on");
  const on = m.save({ indiamart: { push: true } });
  assert.match(on.indiamart.pushPath, /^\/hooks\/indiamart\/[a-f0-9]{32}$/);
  const token = on.indiamart.pushPath.split("/").pop();
  assert.throws(() => m.receivePush("f".repeat(32), { RESPONSE: im() }), /Not found/, "a wrong address is refused");
  const lead = im({ UNIQUE_QUERY_ID: "PUSH1", SENDER_MOBILE: "+91-9876500011", SENDER_NAME: "Ravi" });
  assert.deepEqual(m.receivePush(token, { CODE: 200, STATUS: "SUCCESS", RESPONSE: lead }), { CODE: 200, STATUS: "SUCCESS" });
  assert.equal(all("leads").filter((l) => l.phoneKey === "919876500011").length, 1);
  assert.equal(all("leads").find((l) => l.phoneKey === "919876500011").source, "IndiaMART");
  // IndiaMART sends it again, and the pull read later lists it too: still one lead
  m.receivePush(token, { RESPONSE: lead });
  m.save({ indiamart: { key: "abcdefghijklmnop1234", enabled: true } });
  replies.push({ status: 200, body: { CODE: 200, RESPONSE: [lead] } });
  await m.sync();
  assert.equal(all("leads").filter((l) => l.phoneKey === "919876500011").length, 1);
  // IndiaMART's test buyer is answered but not made a lead
  assert.equal(m.receivePush(token, { RESPONSE: im({ UNIQUE_QUERY_ID: "TEST1", SENDER_MOBILE: "+91-9999999999" }) }).CODE, 200);
  assert.equal(all("leads").some((l) => l.phoneKey === "919999999999"), false);
  assert.equal(m.settings().indiamart.lastPush.tests, 1);
  // a new address shuts the old one
  const fresh = m.save({ indiamart: { newPushAddress: true } }).indiamart.pushPath.split("/").pop();
  assert.notEqual(fresh, token);
  assert.throws(() => m.receivePush(token, { RESPONSE: im() }), /Not found/);
  m.save({ indiamart: { push: false } });
  assert.throws(() => m.receivePush(fresh, { RESPONSE: im() }), /Not found/);
});

test("an IndiaMART message is taken apart: specs, requirement type, search words and the buyer's own words", () => {
  const q = readIndiamart(im({ QUERY_TYPE: "B", QUERY_PRODUCT_NAME: "Coconut Oil Extraction Machine", QUERY_MCAT_NAME: "Oil Extraction Machine", SENDER_MOBILE_ALT: "+91-9447055555", RECEIVER_MOBILE: "9790012345",
    QUERY_MESSAGE: "Requirement for Coconut Oil Extraction Machine<br>Buyer Searched for coconut oil machine<br>Production Capacity : 20 kg/hr<br>Motor Power : 5 HP<br>Buyer Filled Details : Buyer is located in Kerala and prefers to discuss the motor power.<br>Probable Requirement Type : Business Use<br>Suppliers from Jaipur will be preferred" }));
  const d = enquiryDetails(q);
  assert.equal(d.kind, "Buy-lead");
  assert.equal(d.product, "Coconut Oil Extraction Machine");
  assert.equal(d.category, "Oil Extraction Machine");
  assert.equal(d.searched, "coconut oil machine");
  assert.equal(d.requirement, "Business use");
  assert.deepEqual(d.specs, [["Production Capacity", "20 kg/hr"], ["Motor Power", "5 HP"]]);
  assert.match(d.buyerNote, /located in Kerala/);
  assert.deepEqual(d.notes, ["Suppliers from Jaipur will be preferred"]);
  assert.equal(d.mobile2, "+919447055555");
  assert.equal(d.receivedOn, "9790012345");
  assert.equal(d.intro, "", "the 'Requirement for' line repeats the product");
  assert.equal(enquiryDetails(readIndiamart(im({ QUERY_TYPE: "BIZ", QUERY_MESSAGE: "I viewed your product, 'Oil Press Machine'" }))).intro, "Viewed your product Oil Press Machine");
});

test("each enquiry note carries the enquiry taken apart, and older notes get it at the next start", async (t) => {
  const f = fixture(t), { m, replies, all } = f;
  m.save({ indiamart: { key: "abcdefghijklmnop1234", enabled: true } });
  replies.push({ status: 200, body: { CODE: 200, RESPONSE: [im({ UNIQUE_QUERY_ID: "N1", SENDER_MOBILE: "+91-9876511111", QUERY_MESSAGE: "Capacity : 5 ton/day<br>Probable Requirement Type : Business Use" })] } });
  await m.sync();
  const note = all("activities").find((a) => a.marketplaceId === "N1");
  assert.equal(note.buyLead.requirement, "Business use");
  assert.deepEqual(note.buyLead.specs, [["Capacity", "5 ton/day"]]);
  // a note from before: no buyLead yet; a fresh start fills it from the kept enquiry
  const { buyLead, ...old } = note; f.put("activities", old);
  createMarketplaceLeads({ db: f.db, all, get: f.get, put: f.put, stamp: (v) => v, tx: (fn) => fn(), log: () => {}, keyPath: join(mkdtempSync(join(tmpdir(), "k-")), "key"), timers: false });
  assert.equal(all("activities").find((a) => a.marketplaceId === "N1").buyLead.specs[0][1], "5 ton/day");
});

test("a one-line IndiaMART message is split at each known key", () => {
  const d = enquiryDetails(readIndiamart(im({ QUERY_MESSAGE: "Buyer Searched for small oil extraction machine and small rice mill Machine Type: Semi-Automatic Motor Power: 1 HP Probable Requirement Type: Business Use Production Capacity: 10 kg/hr Usage/Application: Oil Production" })));
  assert.equal(d.searched, "small oil extraction machine and small rice mill");
  assert.equal(d.requirement, "Business use");
  assert.deepEqual(d.specs, [["Machine Type", "Semi-Automatic"], ["Motor Power", "1 HP"], ["Production Capacity", "10 kg/hr"], ["Usage/Application", "Oil Production"]]);
  const i = enquiryDetails(readIndiamart(im({ QUERY_MESSAGE: "I am interested in Automatic Copra Cutter & Oil Cake Shredder, Capacity: 1-5 ton/day<br>Number of Bolts : 4" })));
  assert.equal(i.intro, "I am interested in Automatic Copra Cutter & Oil Cake Shredder");
  assert.deepEqual(i.specs, [["Capacity", "1-5 ton/day"], ["Number of Bolts", "4"]]);
  assert.equal(d.v, 2);
});
