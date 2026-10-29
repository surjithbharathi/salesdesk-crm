import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { migrate } from "./db-migrate.mjs";
import { createStore } from "./store.mjs";
import { createQueries } from "./queries.mjs";

const migrations = fileURLToPath(new URL("./migrations/", import.meta.url));
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  t.after(() => db.close());
  migrate(db, migrations);
  let tick = Date.parse("2026-10-01T00:00:00.000Z");
  const store = createStore(db, { now: () => new Date((tick += 60000)).toISOString() });
  for (const [id, name] of [["u1", "Asha"], ["u2", "Ravi"]])
    db.prepare("INSERT INTO users(id,name,role_id,created_at,updated_at) VALUES(?,?,?,?,?)").run(id, name, "role_caller", "x", "x");
  return { db, store, q: createQueries(db), at: (t0) => (tick = Date.parse(t0)) };
}
let n = 0;
const phone = () => String(9100000000 + ++n);

test("listLeads: filters, text search, stable keyset paging with no gaps or repeats", (t) => {
  const { store, q } = fixture(t);
  const ids = [];
  for (let i = 0; i < 23; i++)
    ids.push(store.createLead({ name: `Lead ${i}`, phone: phone(), source: i % 2 ? "IndiaMart" : "Website", owner: i % 3 ? "u1" : "u2", company: i === 5 ? "Kumar_Oils 100%" : undefined }).id);
  const seen = [];
  let cursor = null, pages = 0;
  do {
    const page = q.listLeads({ limit: 5, cursor });
    assert.ok(page.items.length <= 5);
    seen.push(...page.items.map((l) => l.id));
    assert.equal(page.total, 23);
    cursor = page.nextCursor;
    pages++;
  } while (cursor);
  assert.equal(pages, 5);
  assert.equal(new Set(seen).size, 23); // no repeats
  assert.deepEqual([...seen].sort(), [...ids].sort()); // no gaps
  assert.equal(seen[0], ids[22]); // newest first
  assert.equal(q.listLeads({ ownerId: "u2" }).total, 8);
  assert.equal(q.listLeads({ sourceId: "src_website" }).total, 12);
  assert.equal(q.listLeads({ ownerId: "u2", sourceId: "src_website" }).total, 4);
  assert.equal(q.listLeads({ q: "kumar_oils" }).total, 1); // underscore is literal, not a wildcard
  assert.equal(q.listLeads({ q: "100%" }).total, 1);
  assert.equal(q.listLeads({ q: "Lead 1" }).total, 11); // Lead 1, 10..19
  const target = q.getLead(ids[7]);
  assert.equal(q.listLeads({ q: target.phone_e164.slice(0, 9) }).items.some((l) => l.id === ids[7]), true); // phone prefix
  assert.equal(q.listLeads({ q: "no such" }).items.length, 0);
  assert.throws(() => q.listLeads({ cursor: "garbage!" }), /Invalid cursor/);
  store.setStatus(ids[0], "Won");
  assert.equal(q.listLeads({ group: "WON" }).total, 1);
  store.addTag(ids[3], "Hot");
  assert.equal(q.listLeads({ tagId: "tag_hot" }).total, 1);
});

test("getLead and activities: joined labels, paging through the timeline", (t) => {
  const { store, q } = fixture(t);
  const lead = store.createLead({ name: "Kumar", phone: "9876543210", source: "IndiaMart", owner: "u1" });
  for (let i = 0; i < 12; i++) store.addActivity(lead.id, "note", `Note ${i}`);
  const detail = q.getLead(lead.id);
  assert.equal(detail.status, "New Lead");
  assert.equal(detail.first_source, "IndiaMart");
  assert.equal(detail.owner_name, "Asha");
  assert.equal(q.getLead("missing"), null);
  const first = q.activities(lead.id, { limit: 5 });
  assert.equal(first.items.length, 5);
  assert.equal(first.items[0].text, "Note 11");
  const second = q.activities(lead.id, { limit: 5, cursor: first.nextCursor });
  assert.equal(second.items[0].text, "Note 6");
  const rest = q.activities(lead.id, { limit: 50, cursor: second.nextCursor });
  assert.equal(rest.nextCursor, null);
  assert.equal(first.items.length + second.items.length + rest.items.length, 13); // 12 notes + creation
  assert.equal(q.activities(lead.id, { type: "system" }).items.length, 1);
});

test("dashboard: work queues, per-owner scope and today's boundaries", (t) => {
  const { store, q, db } = fixture(t);
  const a = store.createLead({ name: "A", phone: phone(), source: "IndiaMart", owner: "u1" });
  const b = store.createLead({ name: "B", phone: phone(), source: "Website", owner: "u2" });
  const c = store.createLead({ name: "C", phone: phone(), source: "Website" }); // unassigned
  store.captureLead({ name: "A", phone: a.phone_e164, source: "Whatsapp" }); // repeat enquiry
  store.addTask({ leadId: a.id, ownerId: "u1", title: "today", dueAt: "2026-10-29T10:00:00Z" });
  store.addTask({ leadId: b.id, ownerId: "u2", title: "late", dueAt: "2026-10-20T10:00:00Z" });
  const out = store.logCall({ phone: b.phone_e164, direction: "Outgoing", startedAt: "2026-10-28T09:00:00Z", duration: 30, deviceId: "d", localId: "1", userId: "u2" }).call;
  store.logCall({ phone: c.phone_e164, direction: "Missed", startedAt: "2026-10-28T10:00:00Z", duration: 0, deviceId: "d", localId: "2" });
  const day = { now: "2026-10-29T12:00:00.000Z", dayStart: "2026-10-29T00:00:00.000Z", dayEnd: "2026-10-29T23:59:59.999Z" };
  let d = q.dashboard(day);
  assert.equal(d.awaitingFirstTouch, 2); // a and c; b was called
  assert.equal(d.repeatEnquiries, 1);
  assert.equal(d.followupsToday, 1);
  assert.equal(d.overdueFollowups, 1);
  assert.equal(d.unassigned, 1);
  assert.equal(d.missedCallsToReturn, 1);
  assert.equal(d.callsNeedingOutcome, 1);
  assert.equal(q.dashboard({ ...day, ownerId: "u1" }).followupsToday, 1);
  assert.equal(q.dashboard({ ...day, ownerId: "u2" }).followupsToday, 0);
  assert.equal(q.dashboard({ ...day, ownerId: "u2" }).callsNeedingOutcome, 1);
  assert.equal(q.dashboard({ ...day, ownerId: "u1" }).callsNeedingOutcome, 0);
  store.logCall({ phone: c.phone_e164, direction: "Outgoing", startedAt: "2026-10-28T11:00:00Z", duration: 5, deviceId: "d", localId: "3" });
  assert.equal(q.dashboard(day).missedCallsToReturn, 0); // returned the call
  store.setCallOutcome(out.id, "Interested");
  assert.equal(q.dashboard(day).callsNeedingOutcome, 1); // the call to C is still open
  assert.ok(db.prepare("SELECT count(*) c FROM leads").get().c === 3);
  const sum = q.dashboard(day).byStatus.reduce((s, r) => s + r.count, 0);
  assert.equal(sum, 3);
});

test("sourceReport: exact counts, rates, lost reasons, coverage and reconciliation", (t) => {
  const { store, q } = fixture(t);
  const make = (source, i, over = {}) => store.createLead({ name: `${source} ${i}`, phone: phone(), source, owner: "u1", ...over });
  // IndiaMart: 4 leads. 1 won (₹100000), 1 lost no-need, 1 lost wrong number, 1 untouched.
  const im = [0, 1, 2, 3].map((i) => make("IndiaMart", i, { expectedValue: i === 0 ? 100000 : undefined }));
  for (const l of im.slice(0, 3))
    store.logCall({ phone: l.phone_e164, direction: "Outgoing", startedAt: "2026-10-05T10:00:00Z", duration: 45, deviceId: "d", localId: l.id });
  store.setStatus(im[0].id, "Quotation Shared");
  store.setStatus(im[0].id, "Won");
  store.setStatus(im[1].id, "Lost", { lostReason: "No Need" });
  store.setStatus(im[2].id, "Lost", { lostReason: "Wrong number" });
  // Website: 2 leads, none touched, one lost for price after reaching quotation.
  const web = [0, 1].map((i) => make("Website", i));
  store.setStatus(web[0].id, "Quotation Shared");
  store.setStatus(web[0].id, "Lost", { lostReason: "Budget Issues" });
  // unknown source and a lead outside the period
  make("", 9);
  const report = q.sourceReport({ from: "2026-10-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" });
  const get = (id) => report.sources.find((s) => s.source_id === id);
  const indiamart = get("src_indiamart");
  assert.equal(indiamart.leads, 4);
  assert.equal(indiamart.contacted, 3);
  assert.equal(indiamart.connected, 3);
  assert.equal(indiamart.won, 1);
  assert.equal(indiamart.revenue, 100000);
  assert.equal(indiamart.lost, 2);
  assert.equal(indiamart.junk, 1); // only the wrong number
  assert.equal(indiamart.reached_quotation, 1);
  assert.deepEqual(indiamart.rates, { contact: 0.75, connected: 0.75, quotation: 0.25, won: 0.25, junk: 0.25 });
  assert.equal(indiamart.sampleSize, "too_small");
  assert.deepEqual(indiamart.lostReasons.map((r) => [r.reason_id, r.count]).sort(), [["lr_no_need", 1], ["lr_wrong_number", 1]]);
  const website = get("src_website");
  assert.equal(website.leads, 2);
  assert.equal(website.reached_quotation, 1); // ever reached, even though now lost
  assert.equal(website.contacted, 0);
  assert.equal(website.avg_minutes_to_first_touch, null);
  assert.deepEqual(website.lostReasons, [{ reason_id: "lr_price", reason: "Price / budget issue", count: 1 }]);
  assert.equal(get("src_other").leads, 1);
  assert.equal(report.coverage.unknownSource, 1);
  assert.equal(report.coverage.leads, 7);
  assert.equal(report.reconciled, true);
  assert.deepEqual(report.sources.map((s) => s.leads), [4, 2, 1]); // largest first
  // period and owner filters
  const none = q.sourceReport({ from: "2020-01-01T00:00:00Z", to: "2020-02-01T00:00:00Z" });
  assert.deepEqual(none.sources, []);
  assert.equal(none.reconciled, true);
  assert.equal(q.sourceReport({ from: "2026-10-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z", ownerId: "u2" }).sources.length, 0);
  assert.throws(() => q.sourceReport({ from: "2026-10-02", to: "2026-10-01" }), /from and to/);
  assert.throws(() => q.sourceReport({}), /from and to/);
});

test("meta exposes reference data for the screens", (t) => {
  const { q } = fixture(t);
  const m = q.meta();
  assert.equal(m.statuses.length, 17);
  assert.equal(m.lostReasons.length, 11);
  assert.equal(m.sources.length, 25);
  assert.equal(m.users.length, 2);
  assert.ok(m.callOutcomes.some((o) => o.label === "Interested"));
});
