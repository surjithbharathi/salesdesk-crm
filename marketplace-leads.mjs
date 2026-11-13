// IndiaMART and TradeIndia enquiries become leads. Each is read on a schedule from the seller's own pull API, with the keys an
// administrator saves in Settings. A buyer already in the CRM (same mobile number) is not made twice: the new enquiry is
// noted on that lead instead. Every enquiry is remembered by its own id, so a re-read never repeats one.
// Neither site is ever written to. Who gets a new lead is left to the workflows ("A new lead comes in", Source is IndiaMART).
//
// IndiaMART Lead Manager pull API (https://help.indiamart.com/knowledge-base/lms-crm-integration-v2):
//   GET https://mapi.indiamart.com/wservce/crm/crmListing/v2/?glusr_crm_key=KEY&start_time=DD-Mon-YYYYHH:MM:SS&end_time=…
//   at most 7 days per read, at most one read every 5 minutes. Answers {CODE, STATUS, MESSAGE, TOTAL_RECORDS, RESPONSE:[…]}
//   with UNIQUE_QUERY_ID, QUERY_TYPE (W direct, B buy-lead, P call, BIZ…), QUERY_TIME (IST), SENDER_NAME, SENDER_MOBILE
//   (+91-98…), SENDER_EMAIL, SENDER_COMPANY, SENDER_CITY, SENDER_STATE, SENDER_COUNTRY_ISO, QUERY_PRODUCT_NAME, QUERY_MESSAGE.
// TradeIndia "My Inquiry API" (My Profile → Inquiries and Contacts → My Inquiry API gives userid, profile_id and key):
//   GET https://www.tradeindia.com/utils/my_inquiry.html?userid=…&profile_id=…&key=…&from_date=YYYY-MM-DD&to_date=…&limit=…&page_no=…
//   Answers a list of enquiries (rfi_id, sender_name, sender_mobile, sender_email, sender_co, sender_city, sender_state,
//   sender_country, subject, message, product_name, generated_date, generated_time, inquiry_type…). Field names are read
//   loosely, since TradeIndia does not publish them.
// IndiaMART Lead Manager push API (https://help.indiamart.com/knowledge-base/integration-of-indiamarts-lead-manager-crm-push-api-with-third-party-crms-real-time-push-of-leads):
//   IndiaMART POSTs each new enquiry, the moment it comes, to the address made here: {CODE:200, STATUS, RESPONSE:{same fields
//   as the pull API}}. It wants HTTP 200 back and tries again later otherwise. IndiaMART signs nothing, so the address itself
//   carries a long random part that only this CRM and the IndiaMART account know; a new one can be made at any time.
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { phoneParts, phoneKeyOf } from "./lead-phone.mjs";
import { cleanState, withRegion } from "./lead-region.mjs";
import { isBlocked } from "./blocked-numbers.mjs";

const DAY = 86400000, IST = 19800000, MIN = 60000;
const IM_BASE = "https://mapi.indiamart.com/wservce/crm/crmListing/v2/";
const TI_BASE = "https://www.tradeindia.com/utils/my_inquiry.html";
const IM_WINDOW = 7 * DAY, OVERLAP = 10 * MIN, TI_DAYS = 7, TI_PAGE = 50, TI_PAGES = 20;
const SOURCES = { indiamart: "IndiaMART", tradeindia: "TradeIndia", website: "Website" };
const IM_TYPES = { W: "Direct enquiry", B: "Buy-lead", P: "Call", BIZ: "Catalogue enquiry", V: "Catalogue view", WA: "WhatsApp enquiry" };
const DEFAULTS = {
  intervalMinutes: 15, owner: "",
  indiamart: { enabled: false, key: "", backfillDays: 7, cursor: 0, lastRun: null, push: false, pushToken: "" },
  tradeindia: { enabled: false, userid: "", profileId: "", key: "", backfillDays: 7, cursor: 0, lastRun: null },
};
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// plain text from what the sites send: tags out (TradeIndia sends links, IndiaMART line breaks), entities read, spaces tidied
export function plain(v, max = 200) {
  let s = typeof v === "string" ? v : v == null ? "" : typeof v === "object" ? "" : String(v);
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  s = s.replace(/[^\S\n]+/g, " ").replace(/\p{Cc}/gu, (c) => (c === "\n" ? "\n" : " ")).replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return s.slice(0, max);
}
const line = (v, max) => plain(v, max).replace(/\n/g, " ");
// the first non-empty value among several possible field names (any case)
function pick(row, ...names) {
  const lower = new Map(Object.keys(row || {}).map((k) => [k.toLowerCase(), k]));
  for (const n of names) { const k = lower.get(n.toLowerCase()); if (k !== undefined && row[k] != null && String(row[k]).trim()) return row[k]; }
  return "";
}
// IndiaMART takes and gives India time
export function imParam(ms) {
  const d = new Date(ms + IST), p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
export const istDate = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
// "2026-11-10 18:57:00", "2026-11-10T18:57", "10-Nov-2026 18:57:00", "10-11-2026 18:57" (India time) or a Unix time
export function readTime(v, clock = "") {
  const s = `${String(v ?? "").trim()} ${String(clock ?? "").trim()}`.trim();
  if (/^\d{10}$/.test(s)) return Number(s) * 1000;
  if (/^\d{13}$/.test(s)) return Number(s);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) - IST;
  m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3}|\d{1,2})[-/ ](\d{4}) ?(?:(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) { const mon = /\d/.test(m[2]) ? +m[2] - 1 : MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase()); if (mon >= 0) return Date.UTC(+m[3], mon, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) - IST; }
  return 0;
}
// a mobile number the CRM can store, or "" (IndiaMART writes +91-98…, TradeIndia sometimes 91…, sometimes 98…)
function mobileOf(raw, country) {
  const s = String(raw ?? "").replace(/^\+?(\d{1,3})-/, "+$1").replace(/[^\d+]/g, "");
  if (!s) return "";
  const india = !country || /^(in|ind|india)$/i.test(String(country).trim());
  try { return phoneParts(s, s.startsWith("+") ? "" : india ? "91" : "").phone; } catch { return ""; }
}

// What one enquiry says, the same way for both sites.
export function readIndiamart(r) {
  const type = String(r.QUERY_TYPE || "").toUpperCase();
  const country = pick(r, "SENDER_COUNTRY_ISO");
  return {
    id: line(r.UNIQUE_QUERY_ID, 100), at: readTime(r.QUERY_TIME), type: IM_TYPES[type] || (type ? `Enquiry (${type})` : "Enquiry"),
    name: line(r.SENDER_NAME, 100), company: line(r.SENDER_COMPANY, 200), email: line(r.SENDER_EMAIL, 200), email2: line(r.SENDER_EMAIL_ALT, 200),
    phone: mobileOf(r.SENDER_MOBILE, country) || mobileOf(r.SENDER_MOBILE_ALT, country) || mobileOf(r.SENDER_PHONE, country),
    city: line(r.SENDER_CITY, 100), state: line(r.SENDER_STATE, 80), pincode: line(r.SENDER_PINCODE, 12), address: line(r.SENDER_ADDRESS, 300),
    country: line(country, 40), product: line(r.QUERY_PRODUCT_NAME || r.QUERY_MCAT_NAME, 200), subject: line(r.SUBJECT, 300),
    message: plain(r.QUERY_MESSAGE, 2000), duration: Number.parseInt(r.CALL_DURATION, 10) || 0,
    code: type, category: line(r.QUERY_MCAT_NAME, 200), phone2: mobileOf(r.SENDER_MOBILE_ALT, country), landline: line(r.SENDER_PHONE || r.SENDER_PHONE_ALT, 40),
    receiver: line(r.RECEIVER_MOBILE, 40),
  };
}
// What an enquiry's message says, taken apart for the lead screen. IndiaMART writes it as lines: "Requirement for X",
// "Buyer Searched for X", "Production Capacity : 20 kg/hr", "Probable Requirement Type : Business Use",
// "Buyer Filled Details : …", "Suppliers from Jaipur will be preferred". Each "Key : Value" becomes a spec; the
// requirement type, the search words and the buyer's own words get their own places; other lines are kept as notes.
const sentence = (v) => String(v || "").replace(/\b([A-Z])([a-z]+)\b/g, (w, a, b, i) => (i ? a.toLowerCase() + b : w));
// Some enquiries come as one long line ("Buyer Searched for X Machine Type: Semi-Automatic Motor Power: 1 HP …"). Each
// "Key:" then starts its own line. The key is the longest name IndiaMART is known to use that ends right at the colon,
// else the one or two capitalised words before it, so "Business Use Production Capacity:" splits at "Production Capacity".
const KNOWN_KEYS = ["Probable Requirement Type", "Probable Order Value", "Finance/Loan Requirement", "Buyer Filled Details", "Production Capacity",
  "Usage/Application", "Model Name/Number", "Crushing Capacity", "Capacity (kg/hr)", "Motor Power (HP)", "Automation Grade", "Number of Plates",
  "Number of Bolts", "Operation Type", "Pressing Method", "Pressing Type", "No. of Screws", "Machine Type", "Motor Power", "Power Phase", "Buyer Info",
  "I Deal In", "Technology", "Capacity", "Quantity", "Phase", "Power", "Brand", "Size"].sort((a, b) => b.length - a.length);
export const PARSE_VERSION = 2;
function messageLines(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const cuts = [0], re = /\s?:\s/g;
    let m;
    while ((m = re.exec(line))) {
      const before = line.slice(0, m.index), low = before.toLowerCase();
      let key = KNOWN_KEYS.find((k) => low.endsWith(k.toLowerCase()) && (before.length === k.length || /\s/.test(before[before.length - k.length - 1])));
      if (!key) key = (/((?:[A-Z(][\w/&().-]*)(?: [A-Z(][\w/&().-]*)?)$/.exec(before) || [])[1];
      const at = key ? before.length - key.length : 0;
      if (at > cuts[cuts.length - 1]) cuts.push(at);
    }
    for (let i = 0; i < cuts.length; i++) out.push(line.slice(cuts[i], cuts[i + 1]).trim().replace(/,$/, ""));
  }
  return out;
}
export function enquiryDetails(q, source = "indiamart") {
  const specs = [], notes = [], seen = new Set();
  let searched = "", requirement = "", intro = "", buyerNote = "";
  for (const raw of messageLines(q.message)) {
    const l = raw.trim();
    if (!l) continue;
    let m;
    if (/^requirement for /i.test(l)) { if (!q.product) intro ||= l; continue; }
    if ((m = /^buyer searched for (.+)$/i.exec(l))) { searched = m[1].trim(); continue; }
    if ((m = /^i viewed your product,?\s*'?(.+?)'?$/i.exec(l))) { intro ||= `Viewed your product ${m[1]}`; continue; }
    if ((m = /^([^:]{2,40}?)\s*:\s*(.+)$/.exec(l))) {
      const k = m[1].trim(), v = m[2].trim();
      if (/^probable requirement type$/i.test(k)) requirement = sentence(v);
      else if (/^(buyer filled details|buyer info|additional (info|details))$/i.test(k)) buyerNote = v;
      else if (!seen.has(k.toLowerCase()) && specs.length < 12) { seen.add(k.toLowerCase()); specs.push([k, v]); }
      continue;
    }
    if (/^i am interested in /i.test(l)) { intro ||= l; continue; }
    if (notes.length < 3) notes.push(l);
  }
  return {
    v: PARSE_VERSION, source: SOURCES[source] || "IndiaMART", kind: q.type || "Enquiry", code: q.code || "", id: q.id || "", at: q.at ? new Date(q.at).toISOString() : "",
    product: q.product || "", category: q.category && q.category !== q.product ? q.category : "",
    subject: q.subject && q.subject !== q.product && !/^requirement for /i.test(q.subject) ? q.subject : "",
    searched, requirement, intro, specs, buyerNote, notes, quantity: q.quantity || "",
    name: q.name || "", company: q.company || "", mobile: q.phone || "", mobile2: q.phone2 && q.phone2 !== q.phone ? q.phone2 : "",
    landline: q.landline || "", email: q.email || "", email2: q.email2 || "", address: q.address || "",
    city: q.city || "", state: q.state || "", pincode: q.pincode || "", receivedOn: q.receiver || "", callSeconds: q.duration || 0,
  };
}
export function readTradeindia(r) {
  const country = pick(r, "sender_country", "country");
  return {
    id: line(pick(r, "rfi_id", "inquiry_id", "enquiry_id", "id"), 100),
    at: readTime(pick(r, "generated_date", "inquiry_date", "date", "generated"), pick(r, "generated_time", "inquiry_time", "time")),
    type: line(pick(r, "inquiry_type", "enquiry_type", "source"), 60) || "Enquiry",
    name: line(pick(r, "sender_name", "name", "buyer_name"), 100), company: line(pick(r, "sender_co", "sender_company", "company", "company_name"), 200),
    email: line(pick(r, "sender_email", "email"), 200), email2: "",
    phone: mobileOf(pick(r, "sender_mobile", "mobile", "sender_phone", "mobile_number"), country) || mobileOf(pick(r, "landline_number", "sender_other_mobiles"), country),
    city: line(pick(r, "sender_city", "city"), 100), state: line(pick(r, "sender_state", "state"), 80), pincode: line(pick(r, "pincode", "sender_pincode"), 12),
    address: line(pick(r, "address", "sender_address"), 300), country: line(country, 40),
    product: line(pick(r, "product_name", "product", "subject"), 200), subject: line(pick(r, "subject"), 300),
    message: plain(pick(r, "message", "inquiry_message", "description"), 2000), quantity: line(pick(r, "quantity"), 60), duration: 0,
  };
}

export function createMarketplaceLeads({ db, all, get, put, stamp, tx, log, keyPath, now = () => Date.now(), fetchImpl = (...a) => globalThis.fetch(...a), report = () => {}, timers = true, onIndiamart = () => {}, websiteToken = "" }) {
  db.exec(`CREATE TABLE IF NOT EXISTS marketplace_settings(id INTEGER PRIMARY KEY CHECK(id=1), body BLOB);
    CREATE TABLE IF NOT EXISTS marketplace_push(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT);
    CREATE TABLE IF NOT EXISTS marketplace_enquiries(source TEXT NOT NULL, id TEXT NOT NULL, at INTEGER, status TEXT, lead_id TEXT, body TEXT, PRIMARY KEY(source,id))`);
  let secret, running = null, timer = null, retry = null;
  // Enquiries noted before the enquiry was taken apart get it now, from the copy kept of each one. Runs at start and
  // touches only notes still without it, or taken apart by an older reading of the message.
  function fillOldNotes() {
    const kept = new Map(db.prepare("SELECT source,id,body FROM marketplace_enquiries WHERE lead_id IS NOT NULL").all().map((r) => [r.source + ":" + r.id, r]));
    if (!kept.size) return 0;
    let n = 0;
    for (const a of all("activities")) {
      if (!a.marketplaceId || !a.integrationSource || a.buyLead?.v === PARSE_VERSION) continue;
      const r = kept.get(a.integrationSource + ":" + a.marketplaceId);
      if (!r) continue;
      try { put("activities", { ...a, buyLead: { ...enquiryDetails(JSON.parse(r.body), r.source), ...(/^Repeat enquiry/.test(a.text || "") ? { repeat: true } : {}) } }); n++; }
      catch (e) { report(`Enquiry note ${a.id}: ${e.message}`); }
    }
    return n;
  }
  try { const n = fillOldNotes(); if (n) report(`Marketplace enquiries: ${n} older notes taken apart`); } catch (e) { report("Marketplace enquiries: " + e.message); }
  function secretKey() {
    if (secret) return secret;
    mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
    try { writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 }); } catch (e) { if (e.code !== "EEXIST") throw e; }
    try { chmodSync(keyPath, 0o600); } catch {}
    secret = readFileSync(keyPath);
    if (secret.length !== 32) fail("The settings key is unavailable", 503);
    return secret;
  }
  function raw() {
    const row = db.prepare("SELECT body FROM marketplace_settings WHERE id=1").get();
    if (!row) return structuredClone(DEFAULTS);
    const b = Buffer.from(row.body), d = createDecipheriv("aes-256-gcm", secretKey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    const s = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"));
    return { ...DEFAULTS, ...s, indiamart: { ...DEFAULTS.indiamart, ...s.indiamart }, tradeindia: { ...DEFAULTS.tradeindia, ...s.tradeindia } };
  }
  function store(s) {
    const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", secretKey(), iv), bytes = Buffer.concat([c.update(JSON.stringify(s)), c.final()]);
    db.prepare("INSERT INTO marketplace_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(Buffer.concat([iv, c.getAuthTag(), bytes]));
  }
  const recent = (source, limit = 15) => db.prepare("SELECT at,status,lead_id,body FROM marketplace_enquiries WHERE source=? ORDER BY at DESC LIMIT ?").all(source, limit)
    .map((r) => { const q = JSON.parse(r.body); return { id: q.id, at: r.at, buyer: q.name || q.company, phone: q.phone, product: q.product, type: q.type, status: r.status, leadId: r.lead_id || null }; });
  const counts = (source) => db.prepare("SELECT count(*) AS n, sum(status='new lead') AS made FROM marketplace_enquiries WHERE source=?").get(source);
  function settings() {
    const s = raw(), side = (k, extra) => { const c = counts(k); return { enabled: s[k].enabled, backfillDays: s[k].backfillDays, readUpTo: s[k].cursor || null, lastRun: s[k].lastRun, enquiries: c.n || 0, leadsMade: c.made || 0, recent: recent(k), ...extra }; };
    return {
      intervalMinutes: s.intervalMinutes, owner: s.owner, running: Boolean(running),
      indiamart: side("indiamart", { hasKey: Boolean(s.indiamart.key), push: s.indiamart.push, pushPath: s.indiamart.push && s.indiamart.pushToken ? `/hooks/indiamart/${s.indiamart.pushToken}` : null, lastPush: lastPush() }),
      tradeindia: side("tradeindia", { hasKey: Boolean(s.tradeindia.key), userid: s.tradeindia.userid, profileId: s.tradeindia.profileId }),
    };
  }
  const lastPush = () => { const r = db.prepare("SELECT body FROM marketplace_push WHERE id=1").get(); return r ? JSON.parse(r.body) : null; };
  const days = (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 90) fail("Choose between 1 and 90 days"); return n; };
  function save(input = {}) {
    const s = raw();
    if ("intervalMinutes" in input) { const n = Number(input.intervalMinutes); if (!Number.isInteger(n) || n < 10 || n > 1440) fail("Choose between 10 and 1440 minutes (IndiaMART allows one read every 5 minutes)"); s.intervalMinutes = n; }
    if ("owner" in input) { const o = String(input.owner || ""); if (o && !get("users", o)?.active) fail("Choose an active team member, or nobody"); s.owner = o; }
    const im = input.indiamart || {}, ti = input.tradeindia || {};
    if (typeof im.key === "string" && im.key.trim()) { const k = im.key.trim(); if (!/^[A-Za-z0-9+/=_-]{16,200}$/.test(k)) fail("That IndiaMART CRM key does not look right"); s.indiamart.key = k; }
    if ("backfillDays" in im) { const n = days(im.backfillDays); if (n !== s.indiamart.backfillDays) { s.indiamart.backfillDays = n; s.indiamart.cursor = 0; } }
    if ("push" in im) { s.indiamart.push = im.push === true; if (s.indiamart.push && !s.indiamart.pushToken) s.indiamart.pushToken = randomBytes(16).toString("hex"); }
    if (im.newPushAddress === true) s.indiamart.pushToken = randomBytes(16).toString("hex");
    if ("enabled" in im) { if (im.enabled === true && !s.indiamart.key) fail("Add the IndiaMART CRM key first"); s.indiamart.enabled = im.enabled === true; }
    for (const [k, f] of [["userid", "userid"], ["profileId", "profile id"]])
      if (typeof ti[k] === "string" && ti[k].trim() !== s.tradeindia[k]) { const v = ti[k].trim(); if (v && !/^[A-Za-z0-9_-]{1,40}$/.test(v)) fail(`That TradeIndia ${f} does not look right`); s.tradeindia[k] = v; }
    if (typeof ti.key === "string" && ti.key.trim()) { const k = ti.key.trim(); if (!/^[A-Za-z0-9+/=_.-]{8,200}$/.test(k)) fail("That TradeIndia key does not look right"); s.tradeindia.key = k; }
    if ("backfillDays" in ti) { const n = days(ti.backfillDays); if (n !== s.tradeindia.backfillDays) { s.tradeindia.backfillDays = n; s.tradeindia.cursor = 0; } }
    if ("enabled" in ti) { if (ti.enabled === true && !(s.tradeindia.key && s.tradeindia.userid && s.tradeindia.profileId)) fail("Add the TradeIndia user id, profile id and key first"); s.tradeindia.enabled = ti.enabled === true; }
    store(s);
    schedule();
    return settings();
  }

  // One enquiry into the CRM: a new lead, or a note on the buyer's lead. Returns the status kept for it.
  function take(source, q, owner) {
    if (!q.id) return null;
    if (db.prepare("SELECT 1 FROM marketplace_enquiries WHERE source=? AND id=?").get(source, q.id)) return null;
    const label = SOURCES[source];
    return tx(() => {
      let status, leadId = null;
      const key = q.phone ? q.phone.slice(1) : "";
      const email = (q.email || "").toLowerCase();
      if (key && isBlocked(db, key)) status = "blocked";
      else if (!key && !email) status = "no contact";
      else {
        const lead = all("leads").find((l) => !l.mergedInto && ((key && phoneKeyOf(l) === key) || (!key && email && String(l.email || "").toLowerCase() === email)));
        const about = [q.product && `about ${q.product}`, q.quantity && `(${q.quantity})`].filter(Boolean).join(" ");
        const said = [q.subject && q.subject !== q.product && q.subject, q.message].filter(Boolean).join("\n");
        const head = `${label} ${q.type.toLowerCase()}${about ? " " + about : ""}`;
        const at = new Date(q.at || now()).toISOString();
        if (lead) {
          const fill = {};
          for (const k of ["email", "company", "city"]) if (!lead[k] && q[k]) fill[k] = q[k];
          if (!lead.state && q.state) Object.assign(fill, withRegion({ ...lead, ...fill }, { state: q.state }) || { state: cleanState(q.state) });
          if (q.name && !/\p{L}/u.test(String(lead.name || ""))) fill.name = q.name;
          // a customer who already bought and asks again starts over as a new lead with the same owner: marked as a
          // repeat customer, not yet called, with a call for the owner right away
          const won = lead.disposition === "Won" || lead.deal === "Won";
          const reopen = won ? { stage: "New", deal: "", disposition: "", repeat: true, firstTouchAt: null } : {};
          put("leads", { ...lead, ...fill, ...reopen, lastEnquiryAt: at, updatedAt: new Date(now()).toISOString() });
          log(lead.id, "Note", `Repeat enquiry: ${head}${said ? "\n" + said : ""}`, { integrationSource: source, marketplaceId: q.id, buyLead: { ...enquiryDetails(q, source), repeat: true } });
          if (won) {
            log(lead.id, "System", `Pipeline step changed: Won → New · reason: new ${label} enquiry from a customer who already bought`);
            put("tasks", stamp({ title: `Call ${lead.name || "the customer"}: repeat enquiry${q.product ? " for " + q.product : ""}`, leadId: lead.id, owner: lead.owner || "", status: "Open", due: new Date(now()).toISOString(), origin: "Repeat enquiry" }));
          }
          status = "repeat"; leadId = lead.id;
        } else {
          let made = stamp({ name: q.name || q.company || q.phone || q.email, phone: q.phone, email: q.email, company: q.company, city: q.city, state: q.state ? cleanState(q.state) : "",
            source: label, stage: "New", owner, createdBy: owner, ...(q.product ? { product: q.product } : {}), ...(q.language ? { language: q.language } : {}), lastEnquiryAt: at,
            marketplace: { source, id: q.id, type: q.type, ...(q.pincode ? { pincode: q.pincode } : {}), ...(q.address ? { address: q.address } : {}) } });
          made = withRegion(made) || made;
          put("leads", made);
          log(made.id, "Note", `${head}${said ? "\n" + said : ""}`, { integrationSource: source, marketplaceId: q.id, buyLead: enquiryDetails(q, source) });
          status = "new lead"; leadId = made.id;
        }
      }
      db.prepare("INSERT INTO marketplace_enquiries VALUES(?,?,?,?,?,?)").run(source, q.id, q.at || now(), status, leadId, JSON.stringify(q));
      return status;
    });
  }
  function takeAll(source, rows, read, owner) {
    const out = { enquiries: rows.length, newLeads: 0, repeats: 0, skipped: 0 };
    // IndiaMART's records also list the calls through its number (type P): the call link reads them from here
    if (source === "indiamart") try { onIndiamart(rows); } catch (e) { report("IndiaMART call link: " + e.message); }
    for (const r of rows) {
      let status;
      try { status = take(source, read(r), owner); } catch (e) { report(`${SOURCES[source]} enquiry: ${e.message}`); status = "failed"; }
      if (status === "new lead") out.newLeads++;
      else if (status === "repeat") out.repeats++;
      else if (status) out.skipped++;
    }
    return out;
  }
  async function getJson(url, who) {
    let res;
    try { res = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30000) }); } catch (e) { fail(`${who} did not answer: ${e.message || "network error"}`, 502); }
    const body = await res.text().catch(() => "");
    try { return { status: res.status, body: JSON.parse(body) }; } catch { return { status: res.status, body: null, text: body }; }
  }

  async function readIndiamartWindow(s, from, to) {
    const { status, body } = await getJson(`${IM_BASE}?glusr_crm_key=${encodeURIComponent(s.indiamart.key)}&start_time=${imParam(from)}&end_time=${imParam(to)}`, "IndiaMART");
    const code = Number(body?.CODE ?? status);
    if (code === 204) return [];
    if (code === 401) fail("IndiaMART refused the CRM key. Make a new key in Lead Manager → Import/Export Leads → Pull API.", 502);
    if (code === 429) fail("IndiaMART asks to wait 5 minutes between reads; it is read again shortly.", 429);
    if (code !== 200 || !Array.isArray(body?.RESPONSE)) fail(line(body?.MESSAGE, 300) || `IndiaMART answered ${code}`, 502);
    return body.RESPONSE;
  }
  async function readTradeindiaDays(s, from, to) {
    const rows = [];
    for (let page = 1; page <= TI_PAGES; page++) {
      const q = new URLSearchParams({ userid: s.tradeindia.userid, profile_id: s.tradeindia.profileId, key: s.tradeindia.key, from_date: from, to_date: to, limit: String(TI_PAGE), page_no: String(page) });
      const { status, body, text } = await getJson(`${TI_BASE}?${q}`, "TradeIndia");
      if (status === 401 || status === 403) fail("TradeIndia refused the user id, profile id or key. Copy them again from My Profile → My Inquiry API.", 502);
      if (status >= 400) fail(`TradeIndia answered ${status}`, 502);
      const list = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.inquiries) ? body.inquiries : Array.isArray(body?.RESPONSE) ? body.RESPONSE : null;
      if (!list) {
        const said = line(body?.error || body?.message || body?.msg || text, 300);
        if (body && !said) break; // an empty answer object: nothing on that day
        if (/no (record|data|inquir|enquir)/i.test(said)) break;
        fail(said ? `TradeIndia: ${said}` : "TradeIndia's answer could not be read", 502);
      }
      rows.push(...list.filter((r) => r && typeof r === "object"));
      if (list.length < TI_PAGE) break;
    }
    return rows;
  }

  async function syncIndiamart(s) {
    const at = now(), side = s.indiamart;
    const from = side.cursor ? side.cursor - OVERLAP : at - side.backfillDays * DAY, to = Math.min(at, from + IM_WINDOW);
    const rows = await readIndiamartWindow(s, from, to);
    const out = takeAll("indiamart", rows, readIndiamart, s.owner);
    side.cursor = to;
    return { ...out, from, to, message: to < at - OVERLAP ? "Catching up on older enquiries" : "Up to date" };
  }
  async function syncTradeindia(s) {
    const at = now(), side = s.tradeindia;
    // TradeIndia reads whole days; the last day read is read again, so enquiries later that day are not missed
    const start = side.cursor ? Math.min(side.cursor, at) - DAY : at - (side.backfillDays - 1) * DAY;
    const end = Math.min(at, start + (TI_DAYS - 1) * DAY);
    const rows = await readTradeindiaDays(s, istDate(start), istDate(end));
    const out = takeAll("tradeindia", rows, readTradeindia, s.owner);
    side.cursor = end;
    return { ...out, from: start, to: end, message: istDate(end) < istDate(at) ? "Catching up on older enquiries" : "Up to date" };
  }
  // Reads both sites (those switched on, or the one asked for). One read at a time.
  // IndiaMART's push: one enquiry (or a list) at a time, the moment it comes. The pull reads stay as a back-up; an enquiry
  // already taken by either is never taken twice. IndiaMART's own test sends a made-up buyer (a number like 99999 99999),
  // which is answered but not made into a lead.
  // The website's enquiry form (oilmachineindia.com, Contact Form 7) posts each enquiry here at its secret address.
  // The same enquiry posted twice (a retry) is taken once.
  const LANGS = ["English", "Tamil", "Telugu", "Hindi", "Kannada", "Malayalam"];
  function receiveWebsite(token, p = {}) {
    const t = String(websiteToken || "");
    if (t.length < 20 || typeof token !== "string" || token.length !== t.length || !timingSafeEqual(Buffer.from(token), Buffer.from(t))) fail("Not found", 404);
    const phone = mobileOf(p.phone, "IN"), email = line(p.email, 200);
    const [city, ...rest] = line(p.location, 150).split(",").map((x) => x.trim());
    const machine = line(p.machine, 250);
    const at = Number(p.at) > 1e9 ? Number(p.at) * (Number(p.at) < 1e12 ? 1000 : 1) : now();
    const id = line(p.id, 100) || `web-${(phone || email).replace(/\D/g, "")}-${Math.floor(at / 60000)}`;
    const q = { id, at, type: "enquiry", name: line(p.name, 100), phone, email, city: city || "", state: rest.join(", "),
      product: /^machine model or help me choose$/i.test(machine) ? "" : machine,
      message: [plain(p.message, 3000), p.form ? `Form: ${line(p.form, 100)}` : "", p.page ? `Page: ${line(p.page, 300)}` : ""].filter(Boolean).join("\n"),
      language: LANGS.includes(line(p.language, 20)) ? line(p.language, 20) : "" };
    const status = take("website", q, raw().owner || "");
    return { ok: true, status: status || "already taken" };
  }
  function receivePush(token, payload) {
    const s = raw(), t = s.indiamart.pushToken;
    if (!s.indiamart.push || !t || typeof token !== "string" || token.length !== t.length || !timingSafeEqual(Buffer.from(token), Buffer.from(t))) fail("Not found", 404);
    const body = payload?.RESPONSE ?? payload;
    const rows = (Array.isArray(body) ? body : [body]).filter((r) => r && typeof r === "object" && pick(r, "UNIQUE_QUERY_ID"));
    const real = rows.filter((r) => !/^(?:0{10}|1{10}|2{10}|3{10}|4{10}|5{10}|6{10}|7{10}|8{10}|9{10})$/.test(String(readIndiamart(r).phone || "").slice(-10)));
    const out = takeAll("indiamart", real, readIndiamart, s.owner || "");
    const note = { at: now(), ...out, enquiries: rows.length, tests: rows.length - real.length };
    db.prepare("INSERT INTO marketplace_push VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(JSON.stringify(note));
    return { CODE: 200, STATUS: "SUCCESS" };
  }
  async function sync(only = "") {
    if (running) return running;
    running = (async () => {
      const s = raw(), results = {};
      let wait = false;
      for (const [k, fn] of [["indiamart", syncIndiamart], ["tradeindia", syncTradeindia]]) {
        if (only ? only !== k : !s[k].enabled) continue;
        const at = now();
        try {
          if (k === "indiamart" && !s.indiamart.key) fail("Add the IndiaMART CRM key first");
          if (k === "tradeindia" && !(s.tradeindia.key && s.tradeindia.userid && s.tradeindia.profileId)) fail("Add the TradeIndia user id, profile id and key first");
          s[k].lastRun = { at, ok: true, ...(await fn(s)) };
        } catch (e) {
          s[k].lastRun = { at, ok: false, message: e.message };
          if (e.status === 429) wait = true;
          report(`${SOURCES[k]} leads: ${e.message}`);
        }
        results[k] = s[k].lastRun;
        store(s); // keep each site's progress even if the other fails
      }
      if (wait && timers) { clearTimeout(retry); retry = setTimeout(() => sync().catch(() => {}), 6 * MIN); retry.unref?.(); }
      return { ...settings(), results };
    })().finally(() => { running = null; });
    return running;
  }
  // Reads on the schedule. The first read waits 7 minutes after a start, so it does not fall on the same minute as the
  // IndiaMART call link, which uses the same key and IndiaMART's one-read-every-5-minutes allowance.
  function schedule() {
    if (!timers) return;
    clearTimeout(timer); clearInterval(timer);
    const s = raw();
    if (!s.indiamart.enabled && !s.tradeindia.enabled) return;
    timer = setTimeout(() => { sync().catch(() => {}); timer = setInterval(() => sync().catch(() => {}), s.intervalMinutes * MIN); timer.unref?.(); }, 7 * MIN);
    timer.unref?.();
  }
  return { settings, save, sync, schedule, receivePush, receiveWebsite, isRunning: () => Boolean(running) };
}
