// IndiaMART call link. A buyer who rings the seller's IndiaMART number (PNS) reaches the phone from an IndiaMART relay
// number, so the phone app records the call, and its recording, against that relay number ("IndiaMART Buyer").
// IndiaMART's Lead Manager Pull API lists each such call as a "P" enquiry with the buyer's own number, the time, the length
// and the seller number that answered. This reads those enquiries and moves each matching phone call, with its timeline
// entry and recording, to the buyer's own lead (made if missing). IndiaMART is only read, never written to.
// API: https://help.indiamart.com/knowledge-base/lms-crm-integration-v2 (at most a 7-day window, at most one call per 5 minutes).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { phoneParts, phoneKeyOf } from "./lead-phone.mjs";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

const BASE = "https://mapi.indiamart.com/wservce/crm/crmListing/v2/";
const DAY = 86400000, IST = 19800000, WINDOW = 7 * DAY, OVERLAP = 10 * 60000;
const NEAR = 5 * 60000; // how far the phone's call time may be from IndiaMART's call time
const RETRY_FOR = 3 * DAY; // an enquiry whose phone call has not been synced yet is tried again this long
const DEFAULTS = { enabled: false, key: "", intervalMinutes: 15, backfillDays: 30, cursor: 0, lastRun: null, relays: [] };
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
const digits = (v) => String(v ?? "").replace(/\D/g, "");
const tail = (v) => digits(v).slice(-10);
const text = (v, max = 200) => (typeof v === "string" ? v : v == null ? "" : String(v)).replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// IndiaMART takes and gives India time.
export function istParam(ms) {
  const d = new Date(ms + IST), p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
export function queryTime(v) {
  const s = String(v || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - IST;
  m = s.match(/^(\d{2})-([A-Za-z]{3}|\d{2})-(\d{4}) ?(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) { const mon = /\d/.test(m[2]) ? +m[2] - 1 : MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase()); if (mon >= 0) return Date.UTC(+m[3], mon, +m[1], +m[4], +m[5], +(m[6] || 0)) - IST; }
  return 0;
}
// IndiaMART relay numbers are Indian landlines (for example +91 80 4825 0260); a buyer's mobile never is.
// Numbers already seen relaying an IndiaMART call are trusted too.
export const isRelay = (phone, learned = []) => {
  const d = digits(phone);
  if (learned.includes(d)) return true;
  if (!/^91\d{10}$/.test(d)) return false;
  try { return parsePhoneNumberFromString("+" + d)?.getType() === "FIXED_LINE"; } catch { return false; }
};

export function createIndiamartCalls({ db, all, get, put, stamp, tx, log, keyPath, now = () => Date.now(), fetchImpl = (...a) => globalThis.fetch(...a), report = () => {} }) {
  db.exec("CREATE TABLE IF NOT EXISTS indiamart_settings(id INTEGER PRIMARY KEY CHECK(id=1), body BLOB); CREATE TABLE IF NOT EXISTS indiamart_calls(id TEXT PRIMARY KEY, at INTEGER, body TEXT)");
  let key, running = null;
  function secretKey() {
    if (key) return key;
    mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
    try { writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 }); } catch (e) { if (e.code !== "EEXIST") throw e; }
    chmodSync(keyPath, 0o600);
    key = readFileSync(keyPath);
    if (key.length !== 32) fail("The settings key is unavailable", 503);
    return key;
  }
  function raw() {
    const row = db.prepare("SELECT body FROM indiamart_settings WHERE id=1").get();
    if (!row) return { ...DEFAULTS };
    const b = Buffer.from(row.body), d = createDecipheriv("aes-256-gcm", secretKey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return { ...DEFAULTS, ...JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8")) };
  }
  function store(s) {
    const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", secretKey(), iv), bytes = Buffer.concat([c.update(JSON.stringify(s)), c.final()]);
    db.prepare("INSERT INTO indiamart_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(Buffer.concat([iv, c.getAuthTag(), bytes]));
  }
  const enquiries = (limit = 20) => db.prepare("SELECT body FROM indiamart_calls ORDER BY at DESC LIMIT ?").all(limit).map((r) => JSON.parse(r.body));
  function settings() {
    const s = raw();
    return { enabled: s.enabled, hasKey: Boolean(s.key), intervalMinutes: s.intervalMinutes, backfillDays: s.backfillDays, readUpTo: s.cursor || null, running: Boolean(running), lastRun: s.lastRun, relays: s.relays.map((r) => "+" + r),
      recent: enquiries().map((q) => ({ id: q.id, at: q.at, buyer: q.name, phone: q.phone, duration: q.duration, status: q.status, leadId: q.leadId || null })) };
  }
  function save(input) {
    const s = raw();
    if (typeof input.key === "string" && input.key.trim()) { const k = input.key.trim(); if (!/^[A-Za-z0-9+/=_-]{16,200}$/.test(k)) fail("That CRM key does not look right"); s.key = k; }
    if ("intervalMinutes" in input) { const n = Number(input.intervalMinutes); if (!Number.isInteger(n) || n < 10 || n > 1440) fail("Choose between 10 and 1440 minutes (IndiaMART allows one read every 5 minutes)"); s.intervalMinutes = n; }
    if ("backfillDays" in input) { const n = Number(input.backfillDays); if (!Number.isInteger(n) || n < 1 || n > 365) fail("Choose between 1 and 365 days"); if (n !== s.backfillDays) { s.backfillDays = n; s.cursor = 0; } } // a new look-back reads from that day again
    if ("enabled" in input) { if (input.enabled === true && !s.key) fail("Add the IndiaMART CRM key first"); s.enabled = input.enabled === true; }
    store(s);
    return settings();
  }

  async function read(s, from, to) {
    const url = `${BASE}?glusr_crm_key=${encodeURIComponent(s.key)}&start_time=${istParam(from)}&end_time=${istParam(to)}`;
    let res;
    try { res = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30000) }); } catch (e) { fail("IndiaMART did not answer: " + (e.message || "network error"), 502); }
    let body = {};
    try { body = await res.json(); } catch { if (!res.ok) fail(`IndiaMART answered ${res.status}`, 502); }
    const code = Number(body.CODE ?? res.status);
    if (code === 204) return [];
    if (code === 401) fail("IndiaMART refused the CRM key. Make a new key in Lead Manager → Import/Export Leads → Pull API.", 502);
    if (code === 429) fail("IndiaMART asks to wait 5 minutes between reads; the next scheduled read will continue.", 429);
    if (code !== 200 || !Array.isArray(body.RESPONSE)) fail(text(body.MESSAGE, 300) || `IndiaMART answered ${code}`, 502);
    return body.RESPONSE;
  }

  // An IndiaMART "P" enquiry is one call through the IndiaMART number.
  function remember(r) {
    const id = text(r.UNIQUE_QUERY_ID, 100);
    if (!id || String(r.QUERY_TYPE || "").toUpperCase() !== "P") return null;
    const prior = db.prepare("SELECT body FROM indiamart_calls WHERE id=?").get(id);
    if (prior) return JSON.parse(prior.body);
    let phone = "";
    try { phone = phoneParts(text(r.SENDER_MOBILE, 40).replace(/^\+?91-/, "+91"), r.SENDER_COUNTRY_ISO && r.SENDER_COUNTRY_ISO !== "IN" ? "" : "91").phoneKey; } catch {}
    const q = { id, at: queryTime(r.QUERY_TIME), phone, name: text(r.SENDER_NAME, 100), company: text(r.SENDER_COMPANY), email: text(r.SENDER_EMAIL), city: text(r.SENDER_CITY, 100), state: text(r.SENDER_STATE, 100),
      product: text(r.QUERY_PRODUCT_NAME), message: text(r.QUERY_MESSAGE, 2000), duration: Number.parseInt(r.CALL_DURATION, 10) || 0, receiver: tail(r.RECEIVER_MOBILE), status: "waiting" };
    if (!q.at) q.status = "no time";
    else if (!q.phone) q.status = "no buyer number";
    db.prepare("INSERT INTO indiamart_calls VALUES(?,?,?)").run(q.id, q.at, JSON.stringify(q));
    return q;
  }
  const keep = (q) => db.prepare("UPDATE indiamart_calls SET body=? WHERE id=?").run(JSON.stringify(q), q.id);
  const gap = (c, at) => Math.min(Math.abs(c.startedAt - at), Math.abs(c.startedAt + (c.duration || 0) * 1000 - at));

  // Finds the phone call this enquiry was. One clear match only: two calls equally close are left alone.
  function callFor(q, learned) {
    const answerers = new Set(q.receiver.length === 10 ? all("users").filter((u) => tail(u.phone) === q.receiver).map((u) => u.id) : []);
    const near = all("mobileCalls").filter((c) => c.deviceId !== "telecrm" && !c.indiamartQueryId && ["Incoming", "Missed", "Rejected"].includes(c.direction) &&
      Number.isFinite(c.startedAt) && isRelay(c.phone, learned) && digits(c.phone) !== q.phone && gap(c, q.at) <= NEAR &&
      (!q.duration || !c.duration || Math.abs(c.duration - q.duration) <= Math.max(15, q.duration * 0.25)) && (!answerers.size || answerers.has(c.owner)))
      .sort((a, b) => gap(a, q.at) - gap(b, q.at));
    if (near.length > 1 && gap(near[1], q.at) - gap(near[0], q.at) < 60000) return { ambiguous: true };
    return { call: near[0] || null };
  }
  function link(q, c, s) {
    return tx(() => {
      let buyer = all("leads").find((l) => !l.mergedInto && phoneKeyOf(l) === q.phone), made = false;
      if (!buyer) {
        buyer = stamp({ name: q.name || "+" + q.phone, phone: "+" + q.phone, company: q.company, email: q.email, city: q.city, state: q.state, ...(q.product ? { product: q.product } : {}),
          source: "IndiaMART", stage: "New", owner: c.owner || "", createdBy: c.owner || "" });
        put("leads", buyer);
        made = true;
      } else if (q.name && !/\p{L}/u.test(String(buyer.name || ""))) put("leads", (buyer = { ...buyer, name: q.name, updatedAt: new Date(now()).toISOString() }));
      const relayLead = get("leads", c.leadId), activity = c.activityId && get("activities", c.activityId);
      put("mobileCalls", { ...c, leadId: buyer.id, relayLeadId: c.leadId, relayNumber: c.phone, indiamartQueryId: q.id });
      if (activity) put("activities", { ...activity, leadId: buyer.id, text: `${activity.text} · through IndiaMART`, indiamartQueryId: q.id });
      const about = [q.product && `about ${q.product}`, q.message && `“${q.message}”`].filter(Boolean).join(" ");
      log(buyer.id, "System", `${made ? "Lead made from an" : "Linked an"} IndiaMART call: ${q.name || "the buyer"} rang through IndiaMART number +${digits(c.phone)}${about ? " " + about : ""}`, { indiamartQueryId: q.id });
      if (relayLead) {
        put("leads", { ...relayLead, indiamartRelay: true });
        log(relayLead.id, "System", `This is an IndiaMART relay number. The call of ${new Date(c.startedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} was moved to ${buyer.name} (+${q.phone})`);
      }
      const relay = digits(c.phone);
      if (!s.relays.includes(relay)) s.relays.push(relay);
      Object.assign(q, { status: "linked", leadId: buyer.id, callId: c.id, leadMade: made });
      keep(q);
      return q;
    });
  }
  // Tries every enquiry still waiting for its phone call. Phone calls can arrive later than IndiaMART lists them.
  function match(s) {
    let linked = 0, waiting = 0;
    const open = db.prepare("SELECT body FROM indiamart_calls WHERE at>? AND json_extract(body,'$.status') IN ('waiting','unclear')").all(now() - RETRY_FOR - DAY).map((r) => JSON.parse(r.body));
    for (const q of open.sort((a, b) => a.at - b.at)) {
      const found = callFor(q, s.relays);
      if (found.call) { link(q, found.call, s); linked++; continue; }
      const status = found.ambiguous ? "unclear" : now() - q.at > RETRY_FOR ? "no phone call" : "waiting";
      if (status !== q.status) keep({ ...q, status });
      if (status === "waiting" || status === "unclear") waiting++;
    }
    return { linked, waiting };
  }

  async function sync() {
    if (running) return running;
    running = (async () => {
      const s = raw(), at = now();
      if (!s.key) fail("Add the IndiaMART CRM key first");
      const from = s.cursor ? s.cursor - OVERLAP : at - s.backfillDays * DAY, to = Math.min(at, from + WINDOW);
      try {
        const rows = await read(s, from, to);
        const calls = rows.map(remember).filter(Boolean).length;
        s.cursor = to;
        const { linked, waiting } = match(s);
        s.lastRun = { at, ok: true, from, to, enquiries: rows.length, calls, linked, waiting, message: to < at - OVERLAP ? "Catching up on older calls" : "Up to date" };
      } catch (e) {
        s.lastRun = { at, ok: false, message: e.message };
        report("IndiaMART call link: " + e.message);
        if (e.status !== 429) { store(s); throw e; }
      }
      store(s);
      return settings();
    })().finally(() => { running = null; });
    return running;
  }
  // Re-checks waiting enquiries without asking IndiaMART again, for when the phone sends its call log late.
  function relink() { const s = raw(); const out = match(s); store(s); return out; }
  // IndiaMART records read by the IndiaMART & TradeIndia enquiry import (pull or push): the calls among them are kept and
  // matched to the phone calls synced so far; the rest wait for the phone (relink, when a relay call is synced)
  function take(rows) {
    const calls = (Array.isArray(rows) ? rows : []).map(remember).filter(Boolean).length;
    if (!calls) return { calls: 0, linked: 0, waiting: 0 };
    return { calls, ...relink() };
  }
  return { settings, save, sync, relink, take, isRunning: () => Boolean(running) };
}
