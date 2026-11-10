import test from "node:test";
import assert from "node:assert/strict";
import { mobileOf, circleOf, learnSeries, probableStates } from "./probable-state.mjs";

test("a mobile number is read from any form and its circle found", () => {
  assert.equal(mobileOf({ phoneKey: "919840012345" }), "9840012345");
  assert.equal(mobileOf({ phone: "+91 98400 12345" }), "9840012345");
  assert.equal(mobileOf({ phone: "+14155550100" }), "", "not an Indian mobile");
  assert.equal(circleOf("9840012345"), "TN");
});

test("the CRM's own leads win over the series list; a lead with a state gets no probable state", () => {
  const leads = [
    ...[1, 2, 3].map((i) => ({ id: "k" + i, phoneKey: `91984001234${i}`, state: "Karnataka" })),
    { id: "x", phoneKey: "919840099999", state: "" },
    { id: "y", phoneKey: "919786000001" },
    { id: "z", phoneKey: "919840055555", state: "Kerala", probableState: "Tamil Nadu", probableStateFrom: "number series" },
    { id: "w", phoneKey: "911100000000" },
  ];
  const guess = learnSeries(leads);
  assert.deepEqual(guess("9840099999"), { state: "Karnataka", from: "your leads" }, "three of our leads with 98400 are in Karnataka");
  assert.deepEqual(guess("9786000001"), { state: "Tamil Nadu", from: "number series" });
  const changed = new Map(probableStates(leads).map((l) => [l.id, l]));
  assert.equal(changed.get("x").probableState, "Karnataka");
  assert.equal(changed.get("x").state, "", "the state itself is never filled");
  assert.equal(changed.get("y").probableStateFrom, "number series");
  assert.equal(changed.get("z").probableState, undefined, "cleared once a real state is there");
  assert.ok(!changed.has("w") && !changed.has("k1"));
  assert.equal(probableStates([...changed.values()].concat(leads.filter((l) => !changed.has(l.id)))).length, 0, "a second pass changes nothing");
});
