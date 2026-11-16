// WhatsApp chats as people see them: one chat per lead. A customer can reach us through several of our numbers and
// through several systems (the Devi gateway, TeleCRM's copy, the old WhatsApp link), and each of those keeps its own
// conversation record; all of them are one customer, so their messages are joined into one thread, oldest first.
// A conversation not linked to a lead stays a chat of its own. `stampOf` gives a message's time as a sortable value.
export function waThreads(conversations, messages, stampOf) {
  const byConversation = new Map();
  for (const m of messages || []) byConversation.set(m.conversationId, [...(byConversation.get(m.conversationId) || []), m]);
  const byKey = new Map();
  for (const c of conversations || []) {
    if (c.channel !== "WhatsApp") continue;
    const key = c.leadId ? `lead:${c.leadId}` : c.id;
    const own = byConversation.get(c.id) || [];
    const t = byKey.get(key);
    if (!t) byKey.set(key, { ...c, id: key, conversationIds: [c.id], messages: [...own] });
    else { t.conversationIds.push(c.id); t.messages.push(...own); }
  }
  const order = (a, b) => { const x = stampOf(a), y = stampOf(b); return x < y ? -1 : x > y ? 1 : 0; };
  return [...byKey.values()].map((t) => {
    // the same message can come from two systems (TeleCRM's copy and the gateway): keep it once
    const seen = new Set();
    const list = t.messages.sort(order).filter((m) => {
      const k = `${m.direction}|${String(m.text || "").trim()}|${Math.floor(new Date(stampOf(m)).getTime() / 60000)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { ...t, messages: list };
  });
}
