import test from "node:test";
import assert from "node:assert/strict";
import { phoneWorkspace } from "./phone-workspace.mjs";

test("the phone gets working leads and recent work, with only the fields it shows", () => {
  const now = Date.parse("2026-11-10T10:00:00Z"), day = 86400000, iso = (d) => new Date(now - d * day).toISOString();
  const st = {
    leads: [
      { id: "open", name: "Open", stage: "New", updatedAt: iso(200), telecrm: { fields: { a: 1 } }, salesmax: { x: 1 } },
      { id: "oldClosed", name: "Old closed", stage: "Closed", updatedAt: iso(200) },
      { id: "closedTask", name: "Closed with task", stage: "Closed", updatedAt: iso(200) },
      { id: "recentClosed", name: "Recent closed", stage: "Closed", updatedAt: iso(5) },
      { id: "gone", name: "Archived", stage: "New", archived: true, updatedAt: iso(1) },
    ],
    activities: [
      { id: "a1", leadId: "open", type: "Note", text: "x".repeat(500), occurredAt: iso(2) },
      { id: "a2", leadId: "open", type: "Call", occurredAt: iso(40) },
      { id: "a3", leadId: "oldClosed", type: "Call", occurredAt: iso(1) },
    ],
    tasks: [{ id: "t1", leadId: "closedTask", status: "Open", due: iso(-1) }, { id: "t2", leadId: "open", status: "Done", updatedAt: iso(60) }],
    mobileCalls: [{ id: "c1", createdAt: iso(3) }, { id: "c2", createdAt: iso(90) }],
    messages: [], conversations: [], tickets: [], documents: [{ id: "d" }],
  };
  const w = phoneWorkspace(st, now);
  assert.deepEqual(w.leads.map((l) => l.id).sort(), ["closedTask", "oldClosed", "open", "recentClosed"], "a closed lead worked in the last weeks stays too");
  assert.equal(w.leads.find((l) => l.id === "open").telecrm, undefined, "TeleCRM and Salesmax extras stay on the server");
  assert.deepEqual(w.activities.map((a) => a.id), ["a3", "a1"], "recent work of kept leads only");
  assert.equal(w.activities.find((a) => a.id === "a1").text.length, 240);
  assert.deepEqual(w.tasks.map((t) => t.id), ["t1"]);
  assert.deepEqual(w.mobileCalls.map((c) => c.id), ["c1"]);
  assert.deepEqual(w.documents, []);
});

test("a lead with a recent call reaches the phone even past the lead limit", () => {
  const now = Date.parse("2026-11-10T10:00:00Z"), iso = (d) => new Date(now - d * 86400000).toISOString();
  const leads = Array.from({ length: 4001 }, (_, i) => ({ id: "L" + i, name: "N" + i, stage: "New", updatedAt: iso(1) }));
  leads.push({ id: "called", name: "Called", stage: "Closed", updatedAt: iso(300) });
  const w = phoneWorkspace({ leads, activities: [], tasks: [], messages: [], mobileCalls: [{ id: "c", leadId: "called", startedAt: now - 3600000 }] }, now);
  assert.equal(w.leads.length, 4000);
  assert.ok(w.leads.some((l) => l.id === "called"));
});

test("the phone copy leaves out deals and keeps only recent chats of its leads", () => {
  const now = Date.parse("2026-11-10T10:00:00Z"), iso = (d) => new Date(now - d * 86400000).toISOString();
  const w = phoneWorkspace({
    leads: [{ id: "l1", name: "A", stage: "New", updatedAt: iso(1) }],
    deals: [{ id: "d1", leadId: "l1" }],
    conversations: [{ id: "c1", leadId: "l1", updatedAt: iso(2) }, { id: "c2", leadId: "l1", updatedAt: iso(90) }, { id: "c3", leadId: "other", updatedAt: iso(1) }],
  }, now);
  assert.deepEqual(w.deals, []);
  assert.deepEqual(w.conversations.map((c) => c.id), ["c1"]);
});

test("a copy too big for the phone is shrunk until it fits", async () => {
  const { fitPhoneWorkspace } = await import("./phone-workspace.mjs");
  const now = Date.parse("2026-11-10T10:00:00Z"), iso = (d) => new Date(now - d * 86400000).toISOString();
  const leads = Array.from({ length: 4000 }, (_, i) => ({ id: "l" + i, name: "Lead " + i + " ".repeat(300), stage: "New", updatedAt: iso(i % 30) }));
  const small = fitPhoneWorkspace({ leads: leads.slice(0, 10) }, { user: { id: "u" } }, now);
  assert.equal(small.step, 0);
  assert.equal(JSON.parse(small.text).user.id, "u");
  const big = fitPhoneWorkspace({ leads }, {}, now, 800000);
  assert.ok(big.step > 0 && big.bytes <= 800000, `shrunk to ${big.bytes} at step ${big.step}`);
});
