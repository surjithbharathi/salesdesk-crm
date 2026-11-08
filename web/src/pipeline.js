// The deal pipeline, from first interest to a machine delivered. Each step belongs to one of the five basic stages.
// The server keeps the same list in pipeline.mjs (pipeline.test.mjs checks that they match).
export const PIPELINE = [
  { name: "Interested Customer", stage: "Opportunity", disposition: "" },
  { name: "Requirement Discussion", stage: "Prospecting", disposition: "" },
  { name: "Quotation Shared", stage: "Quotation given", disposition: "" },
  { name: "Loan Document Collected", stage: "Quotation given", disposition: "" },
  { name: "Loan in Process", stage: "Quotation given", disposition: "" },
  { name: "Advance Received", stage: "Quotation given", disposition: "" },
  { name: "Machine Dispatched", stage: "Quotation given", disposition: "" },
  { name: "Machine Delivered - Need to Start", stage: "Quotation given", disposition: "" },
  { name: "Won", stage: "Closed", disposition: "Won" },
  { name: "Later Purchase", stage: "Prospecting", disposition: "" },
  { name: "Lost", stage: "Closed", disposition: "Lost" },
];

// The step a lead is at. Leads that were moved before the pipeline existed show the step that matches their basic stage.
const FALLBACK = { Prospecting: "Requirement Discussion", Opportunity: "Interested Customer", "Quotation given": "Quotation Shared" };
export function pipelineStep(lead) {
  if (lead.deal && PIPELINE.some((d) => d.name === lead.deal)) return lead.deal;
  if (lead.stage === "Closed") return lead.disposition === "Won" ? "Won" : lead.disposition === "Lost" ? "Lost" : "";
  return FALLBACK[lead.stage] || "";
}
