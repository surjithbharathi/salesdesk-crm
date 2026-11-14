// A New lead moves to Prospecting the first time somebody actually reaches the customer: a call that was answered
// (synced from the phone), or a WhatsApp message a person sent (from the CRM, the gateway number's WhatsApp app, or the
// linked personal WhatsApp). A lead already past New, or with a pipeline step chosen, is never touched.
export const CONTACTED_STAGE = "Prospecting";

export function isNew(lead) {
  return !!lead && !lead.archived && !lead.mergedInto && (lead.stage || "New") === "New" && !lead.deal;
}

/**
 * Moves the lead on when it is still New. `how` says what happened, for the lead's history ("an answered call",
 * "a WhatsApp message"). Returns the updated lead, or null when nothing changed.
 */
export function markContacted({ get, put, log }, leadId, how, at = new Date().toISOString()) {
  const lead = get("leads", leadId);
  if (!isNew(lead)) return null;
  const moved = { ...lead, stage: CONTACTED_STAGE, firstTouchAt: lead.firstTouchAt || at, updatedAt: new Date().toISOString() };
  put("leads", moved);
  log(leadId, "System", `Stage moved from New to ${CONTACTED_STAGE} after ${how}`);
  return moved;
}
