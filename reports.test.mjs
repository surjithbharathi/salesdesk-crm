import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeReport } from "./public/reports.js";
const now = Date.parse("2026-10-22T12:00:00Z");
const state = {
  users: [{ id: "u", name: "Rep" }],
  leads: [
    { id: "l", source: "Web", owner: "u", stage: "Opportunity", createdAt: "2026-10-21T12:00:00Z" },
    { id: "old", source: "Web", createdAt: "2026-01-01T12:00:00Z" },
  ],
  deals: [
    { id: "d", leadId: "l", owner: "u", stage: "Proposal", value: 10000 },
    { id: "closed", leadId: "l", stage: "Won", value: 5000 },
  ],
  payments: [{ dealId: "d", amount: 3000, createdAt: "2026-10-21T12:00:00Z" }],
  activities: [
    { type: "Call", leadId: "l", outcome: "Interested", createdAt: "2026-10-21T12:00:00Z" },
    { type: "Note", leadId: "l", createdAt: "2026-10-21T12:00:00Z" },
  ],
};
test("reports join payment owners and linked lead filters accurately", () => {
  assert.deepEqual(
    summarizeReport(
      state,
      { entity: "payments", groupBy: "owner", measure: "value", days: 30, stage: "Opportunity" },
      now,
    ),
    [["Rep", 3000]],
  );
  assert.deepEqual(
    summarizeReport(state, { entity: "payments", groupBy: "stage", measure: "count" }, now),
    [["Proposal", 1]],
  );
});
test("reports use date windows, active deals and call-only records", () => {
  assert.deepEqual(summarizeReport(state, { entity: "leads", groupBy: "source", days: 7 }, now), [
    ["Web", 1],
  ]);
  assert.deepEqual(
    summarizeReport(
      state,
      { entity: "deals", groupBy: "stage", measure: "value", active: true },
      now,
    ),
    [["Proposal", 10000]],
  );
  assert.deepEqual(summarizeReport(state, { entity: "calls", groupBy: "outcome", days: 7 }, now), [
    ["Interested", 1],
  ]);
});
