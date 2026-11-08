// The deal pipeline Devi Industries works in, from first interest to a machine delivered. Each step also says which of the five basic
// stages (New, Prospecting, Opportunity, Quotation given, Closed) it belongs to, so the scorecards, the phone app and the old screens keep
// working from the basic stage while people see and pick the pipeline step.
// web/src/pipeline.js holds the same list for the screens; pipeline.test.mjs checks that the two match.
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
