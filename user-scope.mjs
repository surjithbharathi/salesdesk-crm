// An open lead nobody owns is shown to everyone, so whoever picks it up can assign it to themselves.
export const openUnassigned = (l) => Boolean(l) && !l.owner && !l.archived && !l.mergedInto && l.stage !== "Closed";

export function scopedState(all, userId) {
  const leads = all("leads").filter((l) => l.owner === userId || openUnassigned(l));
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
    // colleagues by name and number only, so a chat can say which of them a message went to or came from
    team: all("users").filter((u) => u.active !== false).map((u) => ({ id: u.id, name: u.name || "", numbers: u.numbers || [], active: true })),
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
  const own = (leadId) => { const l = leadId && leadOf(leadId); return Boolean(l) && (l.owner === userId || openUnassigned(l)); };
  switch (kind) {
    case "leads": return v.owner === userId || openUnassigned(v);
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

// A staff member searching a number or a name also learns when it is a colleague's lead: who has it and at what stage,
// nothing more (no history, no calls, no editing). Only leads that person cannot already see; at most 10.
// A number needs 6 digits or more, a name 3 letters or more.
export function othersLeads(all, userId, query, nameOf) {
  const q = String(query || "").trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  const byPhone = digits.length >= 6 && digits.length >= q.replace(/[\s+()-]/g, "").length - 1;
  if (!byPhone && q.length < 3) return [];
  const out = [];
  for (const l of all("leads")) {
    if (l.mergedInto || l.owner === userId || openUnassigned(l)) continue;
    const hit = byPhone ? String(l.phone || "").replace(/\D/g, "").includes(digits) : String(l.name || "").toLowerCase().includes(q);
    if (!hit) continue;
    out.push({ id: l.id, name: l.name || "", phone: l.phone || "", owner: l.owner ? nameOf(l.owner) || "Someone else" : "Nobody", stage: l.deal || l.stage || "", archived: Boolean(l.archived), updatedAt: l.updatedAt || "" });
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 10).map(({ updatedAt, ...rest }) => rest);
}
