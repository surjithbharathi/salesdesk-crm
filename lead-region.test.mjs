import test from "node:test";
import assert from "node:assert/strict";
import { cleanState, cleanLanguage, languageOfState, withRegion, regionHints } from "./lead-region.mjs";

test("states and languages are written one way", () => {
  assert.equal(cleanState("TAMILNADU"), "Tamil Nadu");
  assert.equal(cleanState(" tamil nadu "), "Tamil Nadu");
  assert.equal(cleanState("TN"), "Tamil Nadu");
  assert.equal(cleanState("Orissa"), "Odisha");
  assert.equal(cleanState("Dubai"), "Dubai", "an unknown place is kept as written");
  assert.equal(cleanLanguage("telugu"), "Telugu");
  assert.equal(languageOfState("Karnataka"), "Kannada");
  assert.equal(languageOfState("uttar pradesh"), "Hindi");
});

test("empty state and language are filled; a person's choice is kept; a guessed language is marked", () => {
  assert.deepEqual(withRegion({ id: 1 }, { state: "TELANGANA" }), { id: 1, state: "Telangana", language: "Telugu", languageGuess: true });
  assert.equal(withRegion({ id: 1, state: "Kerala", language: "Hindi" }, { state: "Tamil Nadu" }), null, "nothing to change");
  assert.deepEqual(withRegion({ id: 1 }, { state: "Tamil Nadu", language: "English" }), { id: 1, state: "Tamil Nadu", language: "English" });
  assert.equal(withRegion({ id: 1 }, {}), null);
  assert.deepEqual(regionHints({ telecrm: { fields: { state: "Kerala", preferred_language: "Malayalam" } } }), { state: "Kerala", language: "Malayalam" });
  assert.deepEqual(regionHints({ salesmax: { state: "Goa" } }), { state: "Goa", language: "" });
});
