import test from "node:test";
import assert from "node:assert/strict";
import { markContacted, isNew } from "./first-contact.mjs";

test("only a New lead with no pipeline step moves, once", () => {
  const rows = new Map(), logs = [];
  const store = { get: (k, id) => rows.get(id), put: (k, v) => rows.set(v.id, v), log: (id, type, text) => logs.push(text) };
  rows.set("a", { id: "a", stage: "New" });
  rows.set("b", { id: "b" }); // no stage yet counts as New
  rows.set("c", { id: "c", stage: "New", deal: "Interested Customer" });
  rows.set("d", { id: "d", stage: "Prospecting" });
  rows.set("e", { id: "e", stage: "New", archived: true });
  assert.equal(markContacted(store, "a", "a WhatsApp message", "2026-11-14T06:00:00.000Z").stage, "Prospecting");
  assert.equal(rows.get("a").firstTouchAt, "2026-11-14T06:00:00.000Z");
  assert.equal(markContacted(store, "a", "again"), null, "already moved");
  assert.equal(markContacted(store, "b", "an answered call").stage, "Prospecting");
  for (const id of ["c", "d", "e", "missing"]) assert.equal(markContacted(store, id, "x"), null, id);
  assert.equal(logs.length, 2);
  assert.equal(isNew({ stage: "New" }), true);
});
