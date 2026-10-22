import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLeadCsv } from "./public/csv.js";

test("CSV import preserves Unicode, quoted separators/newlines, phone strings, and amounts", () => {
  assert.deepEqual(
    parseLeadCsv(
      '\uFEFFLead Name,Company,Mobile,Value\r\n"தமிழ், Name","Line one\nLine ""two""",+919000001234,"₹1,20,000"',
    ),
    [
      {
        name: "தமிழ், Name",
        company: 'Line one\nLine "two"',
        phone: "+919000001234",
        value: 120000,
      },
    ],
  );
});
test("CSV import rejects malformed and ambiguous inputs before posting", () => {
  for (const source of [
    "Phone\n123",
    "Name,Lead Name\nA,B",
    "Name,Value\nA,nope",
    "Name,Phone\nA",
    'Name\n"unclosed',
    'Name\n"a"garbage',
  ])
    assert.throws(() => parseLeadCsv(source));
  assert.throws(() => parseLeadCsv("Name\n" + Array(501).fill("A").join("\n")), /500/);
});
