// ERPNext (Devi ERP) quotations and sales invoices on CRM leads.
// - Every 10 minutes the Quotations and Sales Invoices changed in ERPNext since the last read are copied into erp_docs,
//   keyed by the customer's mobile number (last 10 digits), so a lead shows its quotes, invoices, totals and what is
//   still owed.
// - A quotation submitted, an invoice partly paid or paid in full moves the lead forward in the pipeline (never back),
//   each move written on the lead with its reason. The very first read only takes stock: no notes, no moves, so years
//   of history do not flood the CRM.
// - From a lead, a draft quotation can be made in ERPNext (the customer is found by the lead's number, else created).
// The API key and secret are stored encrypted, like the WhatsApp gateway settings, and never sent back to a browser.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PIPELINE } from "./pipeline.mjs";
import { publicHttps } from "./wa-gateway.mjs";

const DEFAULTS = { enabled: false, baseUrl: "", apiKey: "", apiSecret: "", autoStage: true, cursor: { Quotation: "", "Sales Invoice": "" }, lastRun: null };
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const tail10 = (phone) => { const d = String(phone || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };
// how far a lead is along the pipeline; Lost and Later Purchase count as not started, so a new quotation reopens them
export const STEP_RANK = { "Requirement Discussion": 1, "Interested Customer": 2, "Quotation Shared": 3, "Loan Document Collected": 4, "Loan in Process": 5, "Advance Received": 6, "Machine Dispatched": 7, "Machine Delivered - Need to Start": 8, Won: 9 };
const KINDS = {
  Quotation: { label: "Quotation", fields: ["name", "party_name", "customer_name", "contact_mobile", "transaction_date", "valid_till", "grand_total", "status", "docstatus", "modified", "quotation_to"], date: "transaction_date", party: "party_name" },
  "Sales Invoice": { label: "Invoice", fields: ["name", "customer", "customer_name", "contact_mobile", "posting_date", "due_date", "grand_total", "outstanding_amount", "status", "docstatus", "modified"], date: "posting_date", party: "customer" },
};
const PAGE = 500, MAX_PAGES = 20, EVERY = 10 * 60 * 1000;
const money = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");

// the pipeline step an ERPNext document asks for, or "" for none
export function stepFor(kind, doc) {
  if (Number(doc.docstatus) !== 1) return "";
  if (kind === "Quotation") return "Quotation Shared";
  const total = Number(doc.grand_total) || 0, owed = Number(doc.outstanding_amount);
  if (/^paid$/i.test(doc.status) || (total > 0 && owed <= 0)) return "Won";
  if (total > 0 && owed < total) return "Advance Received";
  return "";
}

export function createErpnext({ db, all, get, put, log, keyPath, checkUrl = publicHttps, fetchImpl = (...a) => globalThis.fetch(...a), now = () => Date.now(), report = () => {} }) {
  db.exec(`CREATE TABLE IF NOT EXISTS erp_settings(id INTEGER PRIMARY KEY CHECK(id=1), body BLOB);
    CREATE TABLE IF NOT EXISTS erp_docs(kind TEXT NOT NULL, name TEXT NOT NULL, phone TEXT, modified TEXT, body TEXT NOT NULL, PRIMARY KEY(kind, name));
    CREATE INDEX IF NOT EXISTS erp_docs_phone ON erp_docs(phone);`);
  let key;
  function secretKey() {
    if (key) return key;
    mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
    try { writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 }); } catch (e) { if (e.code !== "EEXIST") throw e; }
    try { chmodSync(keyPath, 0o600); } catch { /* not on every file system */ }
    key = readFileSync(keyPath);
    if (key.length !== 32) fail("The settings key is unavailable", 503);
    return key;
  }
  function raw() {
    const row = db.prepare("SELECT body FROM erp_settings WHERE id=1").get();
    if (!row) return structuredClone(DEFAULTS);
    const b = Buffer.from(row.body), d = createDecipheriv("aes-256-gcm", secretKey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return { ...structuredClone(DEFAULTS), ...JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8")) };
  }
  function store(s) {
    const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", secretKey(), iv);
    const bytes = Buffer.concat([c.update(JSON.stringify(s)), c.final()]);
    db.prepare("INSERT INTO erp_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(Buffer.concat([iv, c.getAuthTag(), bytes]));
  }
  const ready = (s) => Boolean(s.enabled && s.baseUrl && s.apiKey && s.apiSecret);
  function settings() {
    const s = raw(), counts = Object.fromEntries(db.prepare("SELECT kind, COUNT(*) n FROM erp_docs GROUP BY kind").all().map((r) => [r.kind, r.n]));
    return { enabled: s.enabled, baseUrl: s.baseUrl, hasKey: Boolean(s.apiKey && s.apiSecret), autoStage: s.autoStage, lastRun: s.lastRun, quotations: counts.Quotation || 0, invoices: counts["Sales Invoice"] || 0 };
  }
  async function save(input = {}) {
    const s = raw();
    if ("baseUrl" in input) s.baseUrl = input.baseUrl ? await checkUrl(String(input.baseUrl).trim().replace(/\/+$/, "")) : "";
    for (const k of ["apiKey", "apiSecret"]) if (typeof input[k] === "string" && input[k].trim()) {
      const v = input[k].trim();
      if (v.length > 200 || /\s/.test(v)) fail("That key does not look right");
      s[k] = v;
    }
    if ("autoStage" in input) s.autoStage = Boolean(input.autoStage);
    if ("enabled" in input) {
      if (input.enabled === true && !(s.baseUrl && s.apiKey && s.apiSecret)) fail("Add the ERPNext address, API key and API secret first");
      s.enabled = input.enabled === true;
    }
    store(s);
    return settings();
  }

  async function api(path, init = {}, s = raw()) {
    if (!s.baseUrl || !s.apiKey || !s.apiSecret) fail("ERPNext is not connected", 409);
    const base = await checkUrl(s.baseUrl);
    let res;
    try {
      res = await fetchImpl(base + path, { ...init, redirect: "manual", signal: AbortSignal.timeout(30000),
        headers: { Authorization: `token ${s.apiKey}:${s.apiSecret}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) } });
    } catch (e) { fail("ERPNext could not be reached" + (e.name === "TimeoutError" ? " (no answer in 30 seconds)" : ""), 502); }
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) {
      let why = data?.exception || data?.message || "";
      try { const m = JSON.parse(data?._server_messages || "[]"); if (m[0]) why = JSON.parse(m[0]).message || why; } catch { /* plain */ }
      fail(`ERPNext answered ${res.status}${why ? ": " + String(why).replace(/<[^>]*>/g, "").slice(0, 200) : ""}`, res.status === 401 || res.status === 403 ? 409 : 502);
    }
    return data;
  }
  async function test() {
    const me = await api("/api/method/frappe.auth.get_logged_user");
    return { ok: true, user: me?.message || "" };
  }

  // ---------------------------------------------------------------- reading
  const q = (o) => encodeURIComponent(JSON.stringify(o));
  async function pullKind(kind, s, firstRun) {
    const def = KINDS[kind], since = s.cursor?.[kind] || "";
    const changed = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const filters = since ? [["modified", ">", since]] : [];
      const rows = (await api(`/api/resource/${encodeURIComponent(kind)}?fields=${q(def.fields)}&filters=${q(filters)}&order_by=${encodeURIComponent("modified asc")}&limit_start=${page * PAGE}&limit_page_length=${PAGE}`, {}, s))?.data || [];
      changed.push(...rows);
      if (rows.length < PAGE) break;
    }
    // a document without a mobile number takes its customer's
    const noPhone = [...new Set(changed.filter((d) => !tail10(d.contact_mobile)).map((d) => d[def.party]).filter(Boolean))];
    const partyPhone = new Map();
    for (let i = 0; i < noPhone.length; i += 100) {
      const rows = (await api(`/api/resource/Customer?fields=${q(["name", "mobile_no"])}&filters=${q([["name", "in", noPhone.slice(i, i + 100)]])}&limit_page_length=100`, {}, s))?.data || [];
      for (const r of rows) if (tail10(r.mobile_no)) partyPhone.set(r.name, tail10(r.mobile_no));
    }
    const upsert = db.prepare("INSERT INTO erp_docs VALUES(?,?,?,?,?) ON CONFLICT(kind,name) DO UPDATE SET phone=excluded.phone, modified=excluded.modified, body=excluded.body");
    let moved = 0, noted = 0;
    for (const d of changed) {
      const phone = tail10(d.contact_mobile) || partyPhone.get(d[def.party]) || "";
      const before = db.prepare("SELECT body FROM erp_docs WHERE kind=? AND name=?").get(kind, d.name);
      upsert.run(kind, d.name, phone, d.modified || "", JSON.stringify({ ...d, kind }));
      if (!firstRun && phone) { const r = react(kind, d, before ? JSON.parse(before.body) : null, phone, s); moved += r.moved; noted += r.noted; }
    }
    const last = changed.reduce((m, d) => (String(d.modified || "") > m ? String(d.modified) : m), since);
    return { read: changed.length, moved, noted, cursor: last };
  }

  let leadByPhone = null;
  function leadFor(phone) {
    if (!leadByPhone) {
      leadByPhone = new Map();
      for (const l of all("leads")) { if (l.archived || l.mergedInto) continue; const t = tail10(l.phone); if (t && !leadByPhone.has(t)) leadByPhone.set(t, l.id); }
    }
    const id = leadByPhone.get(phone);
    return id ? get("leads", id) : null;
  }
  // a new or changed document: a note on the lead, and a forward move in the pipeline when it calls for one
  function react(kind, doc, before, phone, s) {
    const lead = leadFor(phone);
    if (!lead) return { moved: 0, noted: 0 };
    let moved = 0, noted = 0;
    const def = KINDS[kind];
    if (!before || before.status !== doc.status || Number(before.docstatus) !== Number(doc.docstatus)) {
      const what = Number(doc.docstatus) === 2 ? "Cancelled" : Number(doc.docstatus) === 0 ? "Draft" : doc.status || "Submitted";
      log(lead.id, "System", `ERPNext ${def.label} ${doc.name} · ${money(doc.grand_total)} · ${what}${kind === "Sales Invoice" && Number(doc.outstanding_amount) > 0 && Number(doc.docstatus) === 1 ? ` · ${money(doc.outstanding_amount)} due` : ""}`, { erp: { kind, name: doc.name } });
      noted++;
    }
    const step = s.autoStage ? stepFor(kind, doc) : "";
    if (step && (STEP_RANK[step] || 0) > (STEP_RANK[lead.deal] || 0)) {
      const p = PIPELINE.find((x) => x.name === step);
      const fresh = get("leads", lead.id);
      put("leads", { ...fresh, deal: step, stage: p.stage, disposition: p.disposition, updatedAt: new Date(now()).toISOString() });
      log(lead.id, "System", `Pipeline step changed: ${fresh.deal || "none"} → ${step} · reason: ERPNext ${def.label.toLowerCase()} ${doc.name}`);
      moved++;
    }
    return { moved, noted };
  }

  let running = false;
  async function sync() {
    const s = raw();
    if (!ready(s)) return { skipped: "ERPNext is not connected" };
    if (running) return { skipped: "A read is already running" };
    running = true; leadByPhone = null;
    const at = now();
    try {
      const firstRun = !s.cursor?.Quotation && !s.cursor?.["Sales Invoice"];
      const out = {};
      for (const kind of Object.keys(KINDS)) {
        const r = await pullKind(kind, s, firstRun);
        s.cursor = { ...(s.cursor || {}), [kind]: r.cursor };
        out[kind] = r;
      }
      const fresh = raw(); // settings may have been saved meanwhile: keep them, move only the read state
      fresh.cursor = s.cursor;
      fresh.lastRun = { at, ok: true, firstRun, quotations: out.Quotation.read, invoices: out["Sales Invoice"].read, moved: out.Quotation.moved + out["Sales Invoice"].moved, noted: out.Quotation.noted + out["Sales Invoice"].noted };
      store(fresh);
      return fresh.lastRun;
    } catch (e) {
      const fresh = raw();
      fresh.lastRun = { at, ok: false, message: e.status ? e.message : "ERPNext read failed" };
      store(fresh);
      report("ERPNext read failed: " + e.message);
      return fresh.lastRun;
    } finally { running = false; leadByPhone = null; }
  }

  // what a lead's screen shows
  function forLead(leadId) {
    const lead = get("leads", leadId);
    if (!lead) fail("Lead not found", 404);
    const s = raw(), phone = tail10(lead.phone);
    const rows = phone ? db.prepare("SELECT kind, body FROM erp_docs WHERE phone=? ORDER BY modified DESC LIMIT 200").all(phone).map((r) => JSON.parse(r.body)) : [];
    const pick = (kind) => rows.filter((d) => d.kind === kind && Number(d.docstatus) !== 2);
    const quotations = pick("Quotation").map((d) => ({ name: d.name, date: d.transaction_date, validTill: d.valid_till || "", total: Number(d.grand_total) || 0, status: Number(d.docstatus) === 0 ? "Draft" : d.status, party: d.customer_name || d.party_name }));
    const invoices = pick("Sales Invoice").map((d) => ({ name: d.name, date: d.posting_date, due: d.due_date || "", total: Number(d.grand_total) || 0, outstanding: Number(d.outstanding_amount) || 0, status: Number(d.docstatus) === 0 ? "Draft" : d.status, party: d.customer_name || d.customer }));
    const submitted = (list) => list.filter((d) => d.status !== "Draft");
    return {
      connected: ready(s), base: s.baseUrl,
      quotations, invoices,
      totals: { quoted: submitted(quotations).reduce((a, d) => a + d.total, 0), invoiced: submitted(invoices).reduce((a, d) => a + d.total, 0), outstanding: submitted(invoices).reduce((a, d) => a + d.outstanding, 0) },
    };
  }

  // ---------------------------------------------------------------- making a quotation
  async function items(text) {
    const s = raw(); if (!ready(s)) fail("ERPNext is not connected", 409);
    const like = `%${String(text || "").trim().slice(0, 60)}%`;
    const rows = (await api(`/api/resource/Item?fields=${q(["item_code", "item_name", "standard_rate", "stock_uom"])}&filters=${q([["disabled", "=", 0], ["is_sales_item", "=", 1]])}&or_filters=${q([["item_name", "like", like], ["item_code", "like", like]])}&limit_page_length=20`, {}, s))?.data || [];
    return rows.map((r) => ({ code: r.item_code, name: r.item_name, rate: Number(r.standard_rate) || 0, uom: r.stock_uom || "" }));
  }
  async function createQuotation(leadId, input = {}, actorName = "") {
    const s = raw(); if (!ready(s)) fail("ERPNext is not connected", 409);
    const lead = get("leads", leadId); if (!lead) fail("Lead not found", 404);
    const phone = tail10(lead.phone); if (!phone) fail("This lead has no mobile number to find the customer by");
    const lines = (Array.isArray(input.items) ? input.items : []).slice(0, 30).map((x) => ({ item_code: String(x.code || "").slice(0, 140), qty: Number(x.qty) || 0, rate: Number(x.rate) || 0 }));
    if (!lines.length || lines.some((l) => !l.item_code || l.qty <= 0 || l.rate < 0)) fail("Choose at least one item with a quantity");
    // the customer: one with this mobile number, else a new one named after the lead
    let customer = ((await api(`/api/resource/Customer?fields=${q(["name"])}&filters=${q([["mobile_no", "like", `%${phone}`]])}&limit_page_length=1`, {}, s))?.data || [])[0]?.name;
    if (!customer) {
      const name = String(lead.company || lead.name || "").trim();
      const made = await api("/api/resource/Customer", { method: "POST", body: JSON.stringify({ customer_name: !name || /^\+?\d[\d\s]+$/.test(name) ? "+91" + phone : name.slice(0, 140), customer_type: "Individual", mobile_no: phone }) }, s);
      customer = made?.data?.name;
      if (!customer) fail("ERPNext did not create the customer", 502);
    }
    const today = new Date(now()).toISOString().slice(0, 10);
    const made = await api("/api/resource/Quotation", { method: "POST", body: JSON.stringify({ quotation_to: "Customer", party_name: customer, transaction_date: today, contact_mobile: phone, items: lines }) }, s);
    const doc = made?.data;
    if (!doc?.name) fail("ERPNext did not create the quotation", 502);
    db.prepare("INSERT INTO erp_docs VALUES(?,?,?,?,?) ON CONFLICT(kind,name) DO UPDATE SET phone=excluded.phone, modified=excluded.modified, body=excluded.body")
      .run("Quotation", doc.name, phone, doc.modified || "", JSON.stringify({ name: doc.name, party_name: customer, customer_name: doc.customer_name || customer, contact_mobile: phone, transaction_date: doc.transaction_date || today, grand_total: doc.grand_total || 0, status: doc.status || "Draft", docstatus: doc.docstatus ?? 0, modified: doc.modified || "", kind: "Quotation" }));
    log(lead.id, "System", `ERPNext Quotation ${doc.name} drafted from the CRM${actorName ? " by " + actorName : ""} · ${money(doc.grand_total)} · finish and submit it in ERPNext`, { erp: { kind: "Quotation", name: doc.name } });
    return { name: doc.name, url: `${s.baseUrl}/app/quotation/${encodeURIComponent(doc.name)}`, total: Number(doc.grand_total) || 0 };
  }

  const timer = setInterval(() => { void sync(); }, EVERY);
  timer.unref?.();
  return { settings, save, test, sync, forLead, items, createQuotation, close: () => clearInterval(timer) };
}
