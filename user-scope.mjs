export function scopedState(all, userId) {
  const leads = all("leads").filter((l) => l.owner === userId);
  const leadIds = new Set(leads.map((l) => l.id));
  const deals = all("deals").filter((d) => d.owner === userId && leadIds.has(d.leadId));
  const conversations = all("conversations").filter((c) => leadIds.has(c.leadId));
  const conversationIds = new Set(conversations.map((c) => c.id));
  const dealIds = new Set(deals.map((d) => d.id));
  return {
    leads,
    deals,
    conversations,
    users: all("users").filter((u) => u.id === userId),
    activities: all("activities").filter((a) => leadIds.has(a.leadId)),
    tasks: all("tasks").filter((t) => t.owner === userId && (!t.leadId || leadIds.has(t.leadId))),
    payments: all("payments").filter((p) => dealIds.has(p.dealId)),
    products: all("products"),
    messages: all("messages").filter((m) => conversationIds.has(m.conversationId)),
    tickets: all("tickets").filter(
      (t) => t.owner === userId && (!t.leadId || leadIds.has(t.leadId)),
    ),
    documents: all("documents").filter((d) => leadIds.has(d.leadId)),
    // calls of the person's leads, and of unassigned leads they created (read once: checking every lead for every call
    // took minutes once the TeleCRM copy brought tens of thousands of calls)
    mobileCalls: (() => { const mine = new Set(all("leads").filter((l) => l.owner === "" && l.createdBy === userId).map((l) => l.id)); return all("mobileCalls").filter((c) => leadIds.has(c.leadId) || (c.owner === userId && mine.has(c.leadId))); })(),
    lists: [],
    campaigns: [],
    automationRules: [],
    attendance: [],
    savedReports: [],
    autoReplies: [],
    teamChannels: [],
    teamMessages: [],
    leadViews: [],
  };
}

// The same rules for one record at a time, for the screen's "only what changed" updates: whether this person's screen
// holds this record. `leadOf`, `dealOf` and `conversationOf` read the linked record (people already joined).
export function visibleTo(kind, v, userId, { leadOf, dealOf, conversationOf }) {
  const own = (leadId) => Boolean(leadId) && leadOf(leadId)?.owner === userId;
  switch (kind) {
    case "leads": return v.owner === userId;
    case "users": return v.id === userId;
    case "products": return true;
    case "deals": return v.owner === userId && own(v.leadId);
    case "conversations": case "activities": case "documents": return own(v.leadId);
    case "tasks": case "tickets": return v.owner === userId && (!v.leadId || own(v.leadId));
    case "payments": { const d = v.dealId && dealOf(v.dealId); return Boolean(d) && d.owner === userId && own(d.leadId); }
    case "messages": { const c = v.conversationId && conversationOf(v.conversationId); return Boolean(c) && own(c.leadId); }
    case "mobileCalls": { if (own(v.leadId)) return true; const l = v.leadId && leadOf(v.leadId); return Boolean(l) && v.owner === userId && l.owner === "" && l.createdBy === userId; }
    default: return false;
  }
}
