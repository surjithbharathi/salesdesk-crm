import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLeadView } from "./public/lead-views.js";
const leads = [
  {
    id: "a",
    name: "Alice",
    company: "Factory",
    phone: "123",
    stage: "New",
    source: "Web",
    owner: "u",
    value: 10,
  },
  { id: "b", name: "Bob", stage: "Opportunity", source: "Web", owner: "u", value: 20 },
  { id: "c", name: "Cara", stage: "New", source: "Referral", owner: "v", value: 30 },
  { id: "d", name: "Archived", archived: true, stage: "New", value: 100 },
];
test("saved views compose filters and sort without changing stored records", () => {
  assert.deepEqual(
    applyLeadView(leads, { source: "Web", owner: "u", sortKey: "value", sortDir: "desc" }).map(
      (l) => l.id,
    ),
    ["b", "a"],
  );
  assert.deepEqual(
    applyLeadView(leads, { query: "factory", stage: "New" }).map((l) => l.id),
    ["a"],
  );
  assert.deepEqual(
    applyLeadView(leads, { archived: true }).map((l) => l.id),
    ["d"],
  );
  assert.deepEqual(
    leads.map((l) => l.id),
    ["a", "b", "c", "d"],
  );
});
