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
