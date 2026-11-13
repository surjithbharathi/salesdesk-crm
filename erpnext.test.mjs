import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createErpnext, stepFor } from "./erpnext.mjs";

function world(t) {
  const dir = mkdtempSync(join(tmpdir(), "erp-test-"));
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))");
  const all = (k) => db.prepare("SELECT body FROM records WHERE kind=?").all(k).map((r) => JSON.parse(r.body));
  const get = (k, id) => { const r = db.prepare("SELECT body FROM records WHERE kind=? AND id=?").get(k, id); return r && JSON.parse(r.body); };
  const put = (k, v) => db.prepare("INSERT OR REPLACE INTO records VALUES(?,?,?)").run(k, v.id, JSON.stringify(v));
  const notes = [];
  const log = (leadId, type, text) => notes.push({ leadId, text });
  put("leads", { id: "L1", name: "Durga Oils", phone: "+91 86399 67636", deal: "Interested Customer", stage: "Opportunity" });
  put("leads", { id: "L2", name: "Raj Tools", phone: "8866579555", deal: "Won", stage: "Closed" });
  const erp = { Quotation: [], "Sales Invoice": [], Customer: [{ name: "Raj Machinery", customer_name: "Raj Machinery", mobile_no: "8866579555", gstin: "33AAAAA0000A1Z5", customer_primary_address: "Raj Machinery-Billing" }], Address: [{ name: "Raj Machinery-Billing", address_type: "Billing", address_line1: "12 Mill Road", address_line2: "Peelamedu", city: "Coimbatore", state: "Tamil Nadu", pincode: "641004", country: "India" }], made: [] };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url), path = decodeURIComponent(u.pathname);
    const ok = (data) => ({ ok: true, status: 200, json: async () => data });
    assert.equal(init.headers.Authorization, "token k1:s1");
    if (path === "/api/method/frappe.auth.get_logged_user") return ok({ message: "crm@devi" });
    const [kind, one] = path.replace("/api/resource/", "").split("/");
    if (one && init.method !== "POST") return ok({ data: (erp[kind] || []).find((r) => r.name === one) });
    if (init.method === "POST") {
      const body = JSON.parse(init.body);
      erp.made.push({ kind, body });
      if (kind === "Customer") { erp.Customer.push({ name: body.customer_name, mobile_no: body.mobile_no }); return ok({ data: { name: body.customer_name } }); }
      return ok({ data: { name: "SAL-QTN-NEW", grand_total: body.items.reduce((a, i) => a + i.qty * i.rate, 0), docstatus: 0, status: "Draft" } });
    }
    const filters = JSON.parse(u.searchParams.get("filters") || "[]");
    let rows = erp[kind] || [];
    for (const [f, op, v] of filters) {
      if (op === ">") rows = rows.filter((r) => String(r[f]) > v);
      if (op === "in") rows = rows.filter((r) => v.includes(r[f]));
      if (op === "like") rows = rows.filter((r) => String(r[f] || "").endsWith(v.replace(/%/g, "")));
    }
    const start = Number(u.searchParams.get("limit_start") || 0);
    return ok({ data: rows.slice(start, start + Number(u.searchParams.get("limit_page_length") || 20)) });
  };
  const api = createErpnext({ db, all, get, put, log, keyPath: join(dir, "erp-key"), checkUrl: async (v) => v, fetchImpl });
  t.after(() => { api.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { api, erp, notes, get };
}

test("settings keep the key secret and need address, key and secret before turning on", async (t) => {
  const { api } = world(t);
  await assert.rejects(api.save({ enabled: true }), /Add the ERPNext address/);
  const s = await api.save({ baseUrl: "https://erp.example/", apiKey: "k1", apiSecret: "s1", enabled: true });
  assert.equal(s.baseUrl, "https://erp.example");
  assert.equal(s.hasKey, true);
  assert.equal(JSON.stringify(s).includes("s1"), false);
  assert.equal((await api.test()).user, "crm@devi");
});

test("the first read only takes stock; later quotations and invoices note the lead and move it forward, never back", async (t) => {
  const { api, erp, notes, get } = world(t);
  await api.save({ baseUrl: "https://erp.example", apiKey: "k1", apiSecret: "s1", enabled: true });
  erp.Quotation.push({ name: "Q-OLD", party_name: "Durga", contact_mobile: "8639967636", grand_total: 100, status: "Open", docstatus: 1, modified: "2026-10-01 10:00:00" });
  const first = await api.sync();
  assert.equal(first.firstRun, true);
  assert.equal(notes.length, 0);
  assert.equal(get("leads", "L1").deal, "Interested Customer", "history does not move anyone");
  erp.Quotation.push({ name: "Q-1", party_name: "Durga", contact_mobile: "8639967636", grand_total: 224200, status: "Open", docstatus: 1, modified: "2026-11-12 10:00:00" });
  erp["Sales Invoice"].push({ name: "I-1", customer: "Raj Machinery", contact_mobile: "", grand_total: 1000, outstanding_amount: 1000, status: "Unpaid", docstatus: 1, modified: "2026-11-12 10:00:00" });
  await api.sync();
  assert.equal(get("leads", "L1").deal, "Quotation Shared");
  assert.ok(notes.some((n) => n.leadId === "L1" && /reason: ERPNext quotation Q-1/.test(n.text)));
  assert.equal(get("leads", "L2").deal, "Won", "a won lead is not moved back by an unpaid invoice");
  assert.deepEqual(api.forLead("L2").invoices.map((i) => i.name), ["I-1"], "invoice found through the customer's mobile");
  assert.equal(notes.some((n) => /I-1|Invoice/.test(n.text)), false, "invoices are not written on the shared timeline");
  erp["Sales Invoice"].push({ name: "I-2", customer: "Durga", contact_mobile: "8639967636", grand_total: 224200, outstanding_amount: 100000, status: "Partly Paid", docstatus: 1, modified: "2026-11-12 11:00:00" });
  await api.sync();
  assert.equal(get("leads", "L1").deal, "Advance Received");
  assert.ok(notes.some((n) => n.leadId === "L1" && /→ Advance Received · reason: payment recorded in ERPNext$/.test(n.text)), "a move by payment names no invoice or amount");
  const view = api.forLead("L1");
  assert.deepEqual(view.quotations.map((q) => q.name).sort(), ["Q-1", "Q-OLD"]);
  assert.equal(view.totals.outstanding, 100000);
  assert.equal(view.totals.quoted, 224300);
  const caller = api.forLead("L1", { seeInvoices: false });
  assert.equal(caller.invoices, null, "callers see no invoices");
  assert.equal(caller.totals.outstanding, undefined, "nor what is owed");
  assert.equal(caller.quotations.length, 2, "but they see the quotations");
});

test("pipeline steps from documents", () => {
  assert.equal(stepFor("Quotation", { docstatus: 0 }), "");
  assert.equal(stepFor("Quotation", { docstatus: 1 }), "Quotation Shared");
  assert.equal(stepFor("Sales Invoice", { docstatus: 1, grand_total: 10, outstanding_amount: 10, status: "Unpaid" }), "");
  assert.equal(stepFor("Sales Invoice", { docstatus: 1, grand_total: 10, outstanding_amount: 4, status: "Partly Paid" }), "Advance Received");
  assert.equal(stepFor("Sales Invoice", { docstatus: 1, grand_total: 10, outstanding_amount: 0, status: "Paid" }), "Won");
});

test("a draft quotation is made from a lead, for an existing customer or a new one", async (t) => {
  const { api, erp, notes } = world(t);
  await api.save({ baseUrl: "https://erp.example", apiKey: "k1", apiSecret: "s1", enabled: true });
  const made = await api.createQuotation("L2", { items: [{ code: "OIL-EXP-7.5", qty: 1, rate: 135700 }] }, "Surjith");
  assert.equal(made.name, "SAL-QTN-NEW");
  assert.equal(made.url, "https://erp.example/app/quotation/SAL-QTN-NEW");
  assert.equal(erp.made.length, 1, "the customer with this number is used");
  assert.equal(erp.made[0].body.party_name, "Raj Machinery");
  await api.createQuotation("L1", { items: [{ code: "X", qty: 2, rate: 10 }] }, "Surjith");
  assert.deepEqual(erp.made.map((m) => m.kind), ["Quotation", "Customer", "Quotation"], "a new customer for a number ERPNext does not know");
  assert.ok(notes.some((n) => /drafted from the CRM by Surjith/.test(n.text)));
  assert.equal(api.forLead("L1").quotations[0].status, "Draft");
  await assert.rejects(api.createQuotation("L1", { items: [] }), /Choose at least one item/);
});

test("a lead shows its ERPNext customer with address, and a new quotation opens in ERPNext", async (t) => {
  const { api, erp, notes } = world(t);
  assert.equal(await api.customerFor("L2"), null, "nothing while ERPNext is off");
  await api.save({ baseUrl: "https://erp.example", apiKey: "k1", apiSecret: "s1", enabled: true });
  const c = await api.customerFor("L2");
  assert.equal(c.customerName, "Raj Machinery");
  assert.equal(c.gstin, "33AAAAA0000A1Z5");
  assert.deepEqual(c.address.lines, ["12 Mill Road", "Peelamedu"]);
  assert.equal(c.address.pincode, "641004");
  const open = await api.createQuotation("L2", { open: true }, "Surjith");
  assert.equal(open.url, "https://erp.example/app/quotation/new?quotation_to=Customer&party_name=Raj%20Machinery");
  assert.equal(erp.made.length, 0, "nothing is made in ERPNext for a known customer");
  const fresh = await api.createQuotation("L1", { open: true }, "Surjith");
  assert.deepEqual(erp.made.map((m) => m.kind), ["Customer"], "only the customer, never a quotation");
  assert.match(fresh.url, /party_name=Durga%20Oils$/);
  assert.ok(notes.some((n) => /customer Durga Oils created from the CRM by Surjith/.test(n.text)));
});
