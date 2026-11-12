import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createDnt, dntKey } from "./dnt.mjs";

test("dntKey normalizes Indian and international formats", () => {
  assert.equal(dntKey("9894817860"), "919894817860");
  assert.equal(dntKey("+91 98948 17860"), "919894817860");
  assert.equal(dntKey("09894817860"), "919894817860");
  assert.equal(dntKey("0091-9894817860"), "919894817860");
  assert.equal(dntKey("+44 20 7946 0958"), "442079460958");
  assert.equal(dntKey("12345"), "");
  assert.equal(dntKey(""), "");
  assert.equal(dntKey(null), "");
});

test("add/has/remove/list are idempotent and format-insensitive", () => {
  const dnt = createDnt({ db: new DatabaseSync(":memory:") });
  const r = dnt.add(["+919894817860", "9894817860", "+914471074705", "abc", ""], {
    source: "Salesmax",
    addedBy: "t",
  });
  assert.deepEqual([r.added, r.existing, r.invalid.length], [2, 1, 2]);
  assert.ok(dnt.has("98948 17860"));
  assert.ok(dnt.has("+91-4471-074705"));
  assert.ok(!dnt.has("+919999999999"));
  assert.equal(dnt.count(), 2);
  const l = dnt.list({ q: "4471" });
  assert.equal(l.total, 1);
  assert.equal(l.rows[0].phone, "+914471074705");
  assert.equal(l.rows[0].source, "Salesmax");
  assert.deepEqual(dnt.remove(["9894817860", "0000"]), { removed: 1 });
  assert.ok(!dnt.has("+919894817860"));
  assert.throws(() => dnt.add([]), /Provide/);
});
