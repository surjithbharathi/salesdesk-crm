// What the phone app keeps: the person's working leads and recent work, with only the fields it shows. The full copy grew
// past what a phone can download and store once TeleCRM and Salesmax history came in; older and closed things stay on the
// server (the caller popup and the web CRM still find them).
const PHONE_DAYS = 21, PHONE_LEADS = 4000, PHONE_ACTIVITIES = 6000, PHONE_MESSAGES = 1500;
const LEAD_FIELDS = ["id", "name", "phone", "countryCode", "mobileNumber", "phoneKey", "company", "email", "city", "state", "language", "stage", "deal", "disposition", "owner", "value", "source", "createdAt", "updatedAt", "firstTouchAt", "repeat", "needsName", "createdBy"];
export function phoneWorkspace(st, now = Date.now()) {
  const since = now - PHONE_DAYS * 86400000, recent = (iso) => Date.parse(iso || 0) >= since;
  const openTask = new Set((st.tasks || []).filter((t) => t.status !== "Done" && t.leadId).map((t) => t.leadId));
  const callAt = (c) => c.createdAt || (c.startedAt ? new Date(c.startedAt).toISOString() : "");
  // leads the person is working now come first, so a recent call or a follow-up always shows its lead's name on the phone
  const working = new Set([...openTask,
    ...(st.mobileCalls || []).filter((c) => c.leadId && recent(callAt(c))).map((c) => c.leadId),
    ...(st.activities || []).filter((a) => a.leadId && recent(a.occurredAt || a.createdAt)).map((a) => a.leadId)]);
  const leads = (st.leads || []).filter((l) => !l.archived && !l.mergedInto && (working.has(l.id) || l.stage !== "Closed" || Date.parse(l.updatedAt || 0) >= now - 60 * 86400000))
    .sort((a, b) => (working.has(b.id) - working.has(a.id)) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))).slice(0, PHONE_LEADS)
    .map((l) => Object.fromEntries(LEAD_FIELDS.filter((k) => l[k] !== undefined && l[k] !== "").map((k) => [k, l[k]])));
  const kept = new Set(leads.map((l) => l.id));
  const activities = (st.activities || []).filter((a) => kept.has(a.leadId) && recent(a.occurredAt || a.createdAt))
    .sort((a, b) => String(b.occurredAt || b.createdAt).localeCompare(String(a.occurredAt || a.createdAt))).slice(0, PHONE_ACTIVITIES)
    .map((a) => ({ ...a, text: typeof a.text === "string" && a.text.length > 240 ? a.text.slice(0, 239) + "…" : a.text }));
  return {
    ...st, leads, activities,
    tasks: (st.tasks || []).filter((t) => t.status !== "Done" || recent(t.updatedAt || t.due)),
    // recording bookkeeping and TeleCRM ids stay on the server: the app does not read them
    mobileCalls: (st.mobileCalls || []).filter((c) => recent(callAt(c)))
      .map(({ recordingPath, recordingName, recordingTries, recordingNote, telecrmLeadId, activityId, ...c }) => c),
    messages: (st.messages || []).filter((m) => kept.has(m.leadId) && recent(m.occurredAt || m.createdAt))
      .sort((a, b) => String(b.occurredAt || b.createdAt).localeCompare(String(a.occurredAt || a.createdAt))).slice(0, PHONE_MESSAGES),
    // the app does not show deals, and a busy caller's deals alone pushed the copy past the 6 MB the app accepts
    deals: [],
    conversations: (st.conversations || []).filter((c) => kept.has(c.leadId) && recent(c.updatedAt || c.createdAt)),
    documents: [],
  };
}
