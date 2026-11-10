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
  assert.deepEqual(w.leads.map((l) => l.id).sort(), ["closedTask", "open", "recentClosed"]);
  assert.equal(w.leads.find((l) => l.id === "open").telecrm, undefined, "TeleCRM and Salesmax extras stay on the server");
  assert.deepEqual(w.activities.map((a) => a.id), ["a1"], "recent work of kept leads only");
  assert.equal(w.activities[0].text.length, 240);
  assert.deepEqual(w.tasks.map((t) => t.id), ["t1"]);
  assert.deepEqual(w.mobileCalls.map((c) => c.id), ["c1"]);
  assert.deepEqual(w.documents, []);
});
