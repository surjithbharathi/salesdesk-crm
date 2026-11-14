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

// Why a lead was lost: one of these is asked for every time a lead is closed as Lost (the phone app has the same list).
export const LOST_REASONS = ["No Need", "Price / Budget Issue", "Lost to competitor", "Product Not Suitable", "Finance Not Approved", "Purchase Postponed", "No Response After Multiple Attempts", "Duplicate Lead"];

// The older screens ask with a plain prompt; returns the reason, or "" when the person cancels.
export function askLostReason(name) {
  const answer = window.prompt(`Why was ${name || "this lead"} lost?\n\n${LOST_REASONS.join("\n")}\n\nType one of these, or your own reason:`, "");
  return (answer || "").trim().slice(0, 200);
}
