// What the phone app keeps: the person's working leads and recent work, with only the fields it shows. The full copy grew
// past what a phone can download and store once TeleCRM and Salesmax history came in; older and closed things stay on the
// server (the caller popup and the web CRM still find them).
const PHONE_DAYS = 21, PHONE_LEADS = 4000, PHONE_ACTIVITIES = 6000;
const LEAD_FIELDS = ["id", "name", "phone", "countryCode", "mobileNumber", "phoneKey", "company", "email", "city", "state", "language", "stage", "deal", "disposition", "owner", "value", "source", "createdAt", "updatedAt", "firstTouchAt", "repeat", "needsName", "createdBy"];
export function phoneWorkspace(st, now = Date.now()) {
  const since = now - PHONE_DAYS * 86400000, recent = (iso) => Date.parse(iso || 0) >= since;
  const openTask = new Set((st.tasks || []).filter((t) => t.status !== "Done" && t.leadId).map((t) => t.leadId));
  const leads = (st.leads || []).filter((l) => !l.archived && !l.mergedInto && (l.stage !== "Closed" || openTask.has(l.id) || Date.parse(l.updatedAt || 0) >= now - 60 * 86400000))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))).slice(0, PHONE_LEADS)
    .map((l) => Object.fromEntries(LEAD_FIELDS.filter((k) => l[k] !== undefined && l[k] !== "").map((k) => [k, l[k]])));
  const kept = new Set(leads.map((l) => l.id));
  const activities = (st.activities || []).filter((a) => kept.has(a.leadId) && recent(a.occurredAt || a.createdAt))
    .sort((a, b) => String(b.occurredAt || b.createdAt).localeCompare(String(a.occurredAt || a.createdAt))).slice(0, PHONE_ACTIVITIES)
    .map((a) => ({ ...a, text: typeof a.text === "string" && a.text.length > 240 ? a.text.slice(0, 239) + "…" : a.text }));
  return {
    ...st, leads, activities,
    tasks: (st.tasks || []).filter((t) => t.status !== "Done" || recent(t.updatedAt || t.due)),
    mobileCalls: (st.mobileCalls || []).filter((c) => recent(c.createdAt || (c.startedAt ? new Date(c.startedAt).toISOString() : ""))),
    messages: (st.messages || []).filter((m) => kept.has(m.leadId) && recent(m.occurredAt || m.createdAt)),
    documents: [],
  };
}
