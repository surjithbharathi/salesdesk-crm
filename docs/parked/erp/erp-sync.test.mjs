import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { migrate } from "./db-migrate.mjs";
import { createStore } from "./store.mjs";
import { createErpSync, createErpClient, normalize, stageFor, syncFromErp } from "./erp-sync.mjs";

const migrations = fileURLToPath(new URL("./migrations/", import.meta.url));
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  t.after(() => db.close());
  migrate(db, migrations);
  let tick = Date.parse("2026-10-01T00:00:00.000Z");
  const store = createStore(db, { now: () => new Date((tick += 60000)).toISOString() });
  db.prepare("INSERT INTO users(id,name,role_id,created_at,updated_at) VALUES('u1','Asha','role_caller','x','x')").run();
  return { db, store, erp: createErpSync(db, store, { now: () => "2026-10-29T12:00:00.000Z" }) };
}
const quote = (o = {}) => normalize("Quotation", { name: "SAL-QTN-1", docstatus: 0, status: "Draft", party_name: "Pathi Ganesh", contact_mobile: "96401 02054", transaction_date: "2026-10-28", grand_total: 277300, modified: "2026-10-28 17:56:35.796805", ...o });
const invoice = (o = {}) => normalize("Sales Invoice", { name: "DEVI-1", docstatus: 1, status: "Unpaid", customer: "Pathi Ganesh", contact_mobile: "+919640102054", posting_date: "2026-10-29", grand_total: 277300, outstanding_amount: 277300, modified: "2026-10-29 10:00:00.000000", ...o });

test("documents match a lead by phone however the number is written, drafts do not move the stage", (t) => {
  const { db, store, erp } = fixture(t);
  const lead = store.createLead({ name: "Pathi", phone: "9640102054", source: "IndiaMart", owner: "u1" });
  const out = erp.apply([quote()]);
  assert.deepEqual([out.inserted, out.matched, out.unmatched, out.moved], [1, 1, 0, 0]);
  assert.equal(store.getLead(lead.id).status_id, "st_new_lead"); // a draft is not shared with the customer
  const doc = erp.documentsForLead(lead.id);
  assert.equal(doc.length, 1);
  assert.match(db.prepare("SELECT text FROM activities WHERE type='erp'").get().text, /SAL-QTN-1 drafted, ₹2,77,300/);
});

test("submitted quotation and invoice move the lead forward only, and a repeat run changes nothing", (t) => {
  const { db, store, erp } = fixture(t);
  const lead = store.createLead({ name: "Pathi", phone: "9640102054", source: "IndiaMart", owner: "u1" });
  const submitted = quote({ docstatus: 1, status: "Open", modified: "2026-10-28 18:00:00" });
  assert.equal(erp.apply([submitted]).moved, 1);
  assert.equal(store.getLead(lead.id).status_id, "st_quotation");
  const unpaid = invoice();
  assert.equal(erp.apply([unpaid]).moved, 1);
  assert.equal(store.getLead(lead.id).status_id, "st_advance_pending");
  const activities = db.prepare("SELECT count(*) c FROM activities").get().c;
  const again = erp.apply([submitted, unpaid]);
  assert.deepEqual([again.unchanged, again.moved], [2, 0]);
  assert.equal(db.prepare("SELECT count(*) c FROM activities").get().c, activities);
  // an older quotation arriving late must not pull the lead back
  assert.equal(erp.apply([quote({ name: "SAL-QTN-0", docstatus: 1, status: "Open", modified: "2026-10-20 10:00:00" })]).moved, 0);
  assert.equal(store.getLead(lead.id).status_id, "st_advance_pending");
  // part payment then full payment
  erp.apply([invoice({ outstanding_amount: 100000, modified: "2026-10-30 10:00:00" })]);
  assert.equal(store.getLead(lead.id).status_id, "st_advance_received");
  erp.apply([invoice({ outstanding_amount: 0, status: "Paid", modified: "2026-10-31 10:00:00" })]);
  assert.equal(store.getLead(lead.id).status_id, "st_payment_received");
});

test("unmatched documents are kept, and match when the lead appears later; closed leads are flagged, not reopened", (t) => {
  const { store, erp } = fixture(t);
  const first = erp.apply([invoice({ name: "DEVI-9", contact_mobile: "9988776655" })]);
  assert.deepEqual([first.unmatched, erp.unmatched().length], [1, 1]);
  const lead = store.createLead({ name: "Late", phone: "9988776655", source: "IndiaMart", owner: "u1" });
  store.setStatus(lead.id, "Lost", { lostReason: "No Need" });
  const second = erp.apply([invoice({ name: "DEVI-9", contact_mobile: "9988776655", modified: "2026-10-29 11:00:00" })]);
  assert.equal(second.matched, 1);
  assert.equal(second.moved, 0);
  assert.equal(second.needsReview.length, 1);
  assert.equal(store.getLead(lead.id).status_id, "st_lost");
  assert.equal(erp.unmatched().length, 0);
});

test("dry run changes nothing; stage rules for cancelled and returned invoices", (t) => {
  const { db, store, erp } = fixture(t);
  store.createLead({ name: "Pathi", phone: "9640102054", source: "IndiaMart", owner: "u1" });
  erp.apply([invoice()], { dryRun: true });
  assert.equal(db.prepare("SELECT count(*) c FROM erp_documents").get().c, 0);
  assert.equal(stageFor(invoice({ docstatus: 2, status: "Cancelled" })), null);
  assert.equal(stageFor(invoice({ status: "Return" })), null);
  assert.equal(stageFor(quote()), null);
});

test("sync reads through a GET-only client, falls back to the customer phone, and moves the watermark", async (t) => {
  const { db, store } = fixture(t);
  const lead = store.createLead({ name: "Pathi", phone: "9640102054", source: "IndiaMart", owner: "u1" });
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ method: init.method, auth: init.headers.Authorization, path: url.pathname });
    const doctype = decodeURIComponent(url.pathname.split("/").pop());
    if (doctype === "Customer") return { ok: true, json: async () => ({ data: [{ name: "Pathi Ganesh", mobile_no: "9640102054" }] }) };
    const data = doctype === "Quotation"
      ? [{ name: "SAL-QTN-7", docstatus: 1, status: "Open", party_name: "Pathi Ganesh", contact_mobile: "", transaction_date: "2026-10-29", grand_total: 1000, modified: "2026-10-29 09:00:00" }]
      : [];
    return { ok: true, json: async () => ({ data }) };
  };
  const client = createErpClient({ baseUrl: "https://erp.example/", apiKey: "k", apiSecret: "s", fetchImpl });
  const summary = await syncFromErp(db, store, client);
  assert.equal(summary.Quotation.matched, 1);
  assert.equal(store.getLead(lead.id).status_id, "st_quotation");
  assert.ok(calls.every((c) => c.method === "GET" && c.auth === "token k:s"));
  assert.equal(db.prepare("SELECT last_modified m FROM erp_sync_state WHERE doctype='Quotation'").get().m, "2026-10-29 09:00:00");
  assert.throws(() => createErpClient({ baseUrl: "x" }), /required/);
});
