// Reads quotations and sales invoices from ERPNext and links them to CRM leads by phone number.
// This module only ever issues GET requests to the ERP. Pushing quotation drafts is a separate, later step.
import { canonicalPhone } from "./phone.mjs";

// ERPNext reports times in the site's local time (India).
const erpTime = (text) => new Date(String(text).replace(" ", "T").slice(0, 19) + "+05:30").toISOString();
const rupees = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
// Where a document moves a lead to. A lead only ever moves forward, and only while it is still open.
const STAGE_ORDER = ["st_new_lead", "st_contact_attempted", "st_interested", "st_requirement", "st_quotation", "st_negotiation",
  "st_later_purchase", "st_loan_docs", "st_loan_process", "st_advance_pending", "st_advance_received", "st_payment_received"];

export const FIELDS = {
  Quotation: ["name", "docstatus", "status", "party_name", "contact_mobile", "transaction_date", "grand_total", "custom_sales_person", "modified"],
  "Sales Invoice": ["name", "docstatus", "status", "customer", "contact_mobile", "posting_date", "grand_total", "outstanding_amount", "custom_sales_person", "modified"],
};

export function normalize(doctype, row) {
  const quote = doctype === "Quotation";
  return {
    doctype,
    name: row.name,
    docstatus: Number(row.docstatus) || 0,
    status: row.status ?? null,
    party_name: (quote ? row.party_name : row.customer) ?? null,
    mobile_raw: (row.contact_mobile || "").trim() || null,
    doc_date: (quote ? row.transaction_date : row.posting_date) ?? null,
    grand_total: Number(row.grand_total) || 0,
    outstanding: quote ? null : Number(row.outstanding_amount ?? row.grand_total) || 0,
    sales_person: row.custom_sales_person ?? null,
    erp_modified: row.modified,
  };
}

// The stage a document justifies, or null when it changes nothing. Drafts are not shared with the customer, so they move nothing.
export function stageFor(doc) {
  if (doc.docstatus !== 1) return null;
  if (doc.doctype === "Quotation") return ["Open", "Replied", "Partially Ordered"].includes(doc.status) || doc.status === "Ordered" ? "st_quotation" : null;
  if (doc.status === "Cancelled" || doc.status === "Return" || doc.status === "Credit Note Issued") return null;
  if (doc.outstanding <= 0) return "st_payment_received";
  return doc.outstanding < doc.grand_total ? "st_advance_received" : "st_advance_pending";
}

export function describe(doc) {
  if (doc.doctype === "Quotation") {
    const state = doc.docstatus === 0 ? "drafted" : doc.docstatus === 2 ? "cancelled" : (doc.status || "submitted").toLowerCase();
    return `ERP quotation ${doc.name} ${state}, ${rupees(doc.grand_total)}`;
  }
  const state = doc.docstatus === 2 ? "cancelled" : doc.outstanding <= 0 ? "paid" : doc.outstanding < doc.grand_total ? `part paid, ${rupees(doc.outstanding)} due` : `unpaid, ${rupees(doc.outstanding)} due`;
  return `ERP invoice ${doc.name} ${state}, ${rupees(doc.grand_total)}`;
}

export function createErpSync(db, store, { now = () => new Date().toISOString() } = {}) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);

  function leadForPhone(phone) {
    if (!phone) return null;
    return one("SELECT id FROM leads WHERE phone_e164=? AND archived_at IS NULL", phone)?.id
      || one("SELECT lp.lead_id id FROM lead_phones lp JOIN leads l ON l.id=lp.lead_id WHERE lp.phone_e164=? AND l.archived_at IS NULL", phone)?.id || null;
  }

  // Stores documents and applies their effects on the matching leads. Safe to run again with the same documents.
  function apply(docs, { phoneFor = () => null, dryRun = false } = {}) {
    const result = { inserted: 0, updated: 0, unchanged: 0, matched: 0, unmatched: 0, moved: 0, needsReview: [] };
    db.exec("SAVEPOINT erp_apply");
    try {
      for (const doc of docs) {
        const phone = canonicalPhone(doc.mobile_raw || "") || canonicalPhone(phoneFor(doc) || "") || null;
        const before = one("SELECT * FROM erp_documents WHERE doctype=? AND name=?", doc.doctype, doc.name);
        const leadId = leadForPhone(phone);
        const changed = !before || before.erp_modified !== doc.erp_modified || before.lead_id !== leadId;
        if (!changed) { result.unchanged++; leadId ? result.matched++ : result.unmatched++; continue; }
        run(
          `INSERT INTO erp_documents(doctype,name,docstatus,status,party_name,mobile_raw,phone_e164,doc_date,grand_total,outstanding,sales_person,erp_modified,lead_id,first_seen_at,synced_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(doctype,name) DO UPDATE SET docstatus=excluded.docstatus,status=excluded.status,party_name=excluded.party_name,mobile_raw=excluded.mobile_raw,
             phone_e164=excluded.phone_e164,doc_date=excluded.doc_date,grand_total=excluded.grand_total,outstanding=excluded.outstanding,sales_person=excluded.sales_person,
             erp_modified=excluded.erp_modified,lead_id=excluded.lead_id,synced_at=excluded.synced_at`,
          doc.doctype, doc.name, doc.docstatus, doc.status, doc.party_name, doc.mobile_raw, phone, doc.doc_date, doc.grand_total, doc.outstanding,
          doc.sales_person, doc.erp_modified, leadId, before?.first_seen_at ?? now(), now(),
        );
        before ? result.updated++ : result.inserted++;
        if (!leadId) { result.unmatched++; continue; }
        result.matched++;
        const lead = one("SELECT l.id,l.owner_id,l.status_id,st.stage_group FROM leads l JOIN statuses st ON st.id=l.status_id WHERE l.id=?", leadId);
        const factsChanged = !before || before.docstatus !== doc.docstatus || before.status !== doc.status || before.outstanding !== doc.outstanding || before.grand_total !== doc.grand_total;
        if (factsChanged)
          store.addActivity(leadId, "erp", describe(doc), { source: "erp", userId: lead.owner_id, occurredAt: erpTime(doc.erp_modified), data: { doctype: doc.doctype, name: doc.name, status: doc.status, grandTotal: doc.grand_total, outstanding: doc.outstanding } });
        const target = stageFor(doc);
        if (!target) continue;
        if (!["FRESH", "ACTIVE"].includes(lead.stage_group)) {
          if (factsChanged) result.needsReview.push({ lead: leadId, doc: `${doc.doctype} ${doc.name}`, reason: "Lead is closed in the CRM but the ERP shows new activity" });
          continue;
        }
        if (STAGE_ORDER.indexOf(target) > STAGE_ORDER.indexOf(lead.status_id)) {
          store.setStatus(leadId, target, { source: "erp", userId: lead.owner_id, note: `${doc.doctype} ${doc.name}` });
          result.moved++;
        }
      }
      if (dryRun) db.exec("ROLLBACK TO erp_apply");
      db.exec("RELEASE erp_apply");
    } catch (error) {
      db.exec("ROLLBACK TO erp_apply");
      db.exec("RELEASE erp_apply");
      throw error;
    }
    return result;
  }

  const documentsForLead = (leadId) =>
    db.prepare("SELECT doctype,name,docstatus,status,party_name,doc_date,grand_total,outstanding,sales_person FROM erp_documents WHERE lead_id=? ORDER BY doc_date DESC, name DESC").all(leadId);
  const unmatched = (limit = 100) =>
    db.prepare("SELECT doctype,name,status,party_name,mobile_raw,doc_date,grand_total FROM erp_documents WHERE lead_id IS NULL ORDER BY doc_date DESC LIMIT ?").all(limit);

  return { apply, documentsForLead, unmatched, leadForPhone };
}

// Minimal read-only ERPNext client. Credentials come from the caller (environment), never from the repository.
export function createErpClient({ baseUrl, apiKey, apiSecret, fetchImpl = fetch }) {
  if (!baseUrl || !apiKey || !apiSecret) throw new Error("ERP_URL, ERP_API_KEY and ERP_API_SECRET are required");
  const root = baseUrl.replace(/\/+$/, "");
  async function get(path, params) {
    const url = new URL(root + path);
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
    const response = await fetchImpl(url, { method: "GET", headers: { Authorization: `token ${apiKey}:${apiSecret}`, Accept: "application/json" } });
    if (!response.ok) throw new Error(`ERP answered ${response.status} for ${path}`);
    return (await response.json()).data;
  }
  async function* modifiedSince(doctype, since, pageSize = 200) {
    for (let start = 0; ; start += pageSize) {
      const rows = await get(`/api/resource/${encodeURIComponent(doctype)}`, {
        fields: FIELDS[doctype], filters: since ? [["modified", ">", since]] : [], order_by: "modified asc", limit_start: start, limit_page_length: pageSize,
      });
      yield* rows;
      if (rows.length < pageSize) return;
    }
  }
  // Phone numbers kept on the customer record, for documents that have no mobile number of their own.
  async function customerPhones(names) {
    const map = new Map();
    for (let i = 0; i < names.length; i += 100) {
      const rows = await get("/api/resource/Customer", { fields: ["name", "mobile_no"], filters: [["name", "in", names.slice(i, i + 100)]], limit_page_length: 100 });
      for (const r of rows) if (r.mobile_no) map.set(r.name, r.mobile_no);
    }
    return map;
  }
  return { modifiedSince, customerPhones };
}

// One full pass: read what changed since the last pass, store it, move the watermark. Reads only.
export async function syncFromErp(db, store, client, { dryRun = false, now = () => new Date().toISOString() } = {}) {
  const engine = createErpSync(db, store, { now });
  const summary = {};
  for (const doctype of Object.keys(FIELDS)) {
    const state = db.prepare("SELECT last_modified FROM erp_sync_state WHERE doctype=?").get(doctype);
    const docs = [];
    for await (const row of client.modifiedSince(doctype, state?.last_modified)) docs.push(normalize(doctype, row));
    const lacking = [...new Set(docs.filter((d) => !canonicalPhone(d.mobile_raw || "") && d.party_name).map((d) => d.party_name))];
    const phones = lacking.length ? await client.customerPhones(lacking) : new Map();
    summary[doctype] = engine.apply(docs, { phoneFor: (d) => phones.get(d.party_name), dryRun });
    if (!dryRun && docs.length)
      db.prepare("INSERT INTO erp_sync_state(doctype,last_modified,last_run_at,last_error) VALUES(?,?,?,NULL) ON CONFLICT(doctype) DO UPDATE SET last_modified=excluded.last_modified,last_run_at=excluded.last_run_at,last_error=NULL")
        .run(doctype, docs[docs.length - 1].erp_modified, now());
  }
  return summary;
}
