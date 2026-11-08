import test from "node:test";
import assert from "node:assert/strict";
import { PIPELINE } from "./pipeline.mjs";
import { PIPELINE as SCREENS, pipelineStep } from "./web/src/pipeline.js";

const STAGES = ["Prospecting", "Opportunity", "Quotation given", "Closed"];

test("the server and the screens share one pipeline", () => {
  assert.deepEqual(SCREENS, PIPELINE);
});

test("every step belongs to a basic stage, names are unique, and only Won and Lost close a lead", () => {
  assert.equal(new Set(PIPELINE.map((d) => d.name)).size, PIPELINE.length);
  for (const d of PIPELINE) {
    assert.ok(STAGES.includes(d.stage), d.name);
    assert.equal(d.stage === "Closed", d.disposition !== "", d.name);
  }
  assert.deepEqual(PIPELINE.filter((d) => d.stage === "Closed").map((d) => d.name), ["Won", "Lost"]);
});

test("leads moved before the pipeline existed show the step that matches their basic stage", () => {
  assert.equal(pipelineStep({ stage: "Opportunity" }), "Interested Customer");
  assert.equal(pipelineStep({ stage: "Prospecting" }), "Requirement Discussion");
  assert.equal(pipelineStep({ stage: "Closed", disposition: "Won" }), "Won");
  assert.equal(pipelineStep({ stage: "Closed", disposition: "" }), "");
  assert.equal(pipelineStep({ stage: "Quotation given", deal: "Advance Received" }), "Advance Received");
  assert.equal(pipelineStep({ stage: "Quotation given", deal: "Not a step" }), "Quotation Shared");
});
