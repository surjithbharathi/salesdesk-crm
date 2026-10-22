export function summarizeReport(state, definition, now = Date.now()) {
  const entity = definition.entity || "leads";
  const leads = new Map(state.leads.map((l) => [l.id, l]));
  const deals = new Map(state.deals.map((d) => [d.id, d]));
  const users = new Map(state.users.map((u) => [u.id, u.name]));
  const input =
    entity === "calls" ? state.activities.filter((a) => a.type === "Call") : state[entity] || [];
  const totals = new Map();
  for (const item of input) {
    const deal = entity === "payments" ? deals.get(item.dealId) : null;
    const lead = entity === "leads" ? item : leads.get(item.leadId || deal?.leadId);
    if (definition.days && Date.parse(item.createdAt) < now - definition.days * 86400000) continue;
    if (definition.days && !Number.isFinite(Date.parse(item.createdAt))) continue;
    if (definition.active && ["Won", "Lost"].includes(item.stage)) continue;
    if (definition.stage && lead?.stage !== definition.stage) continue;
    let key;
    if (definition.groupBy === "owner")
      key = users.get(item.owner || deal?.owner || lead?.owner) || "Unassigned";
    else if (definition.groupBy === "source") key = lead?.source || "Unknown";
    else if (definition.groupBy === "stage")
      key = entity === "deals" ? item.stage : entity === "payments" ? deal?.stage : lead?.stage;
    else key = item[definition.groupBy];
    const value =
      definition.measure === "value"
        ? Number(entity === "payments" ? item.amount || 0 : item.value || 0)
        : 1;
    totals.set(key || "Unknown", (totals.get(key || "Unknown") || 0) + value);
  }
  return [...totals].sort((a, b) => b[1] - a[1]);
}
