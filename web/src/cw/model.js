// Turns this CRM's records into the simple shape the Salesmax-style screens work with: leads that carry their own activities,
// people by name, and stages Won and Lost. Everything is read from the CRM; nothing here is stored.

export const DAY = 86400000;
export const HOUR = 3600000;
export const startOfDay = (t) => new Date(t).setHours(0, 0, 0, 0);
const ms = (v) => (typeof v === "number" ? v : Date.parse(v));
export const money = (v) => {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2).replace(/\.?0+$/, "")}Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1).replace(/\.0$/, "")}L`;
  return "₹" + Math.round(v || 0).toLocaleString("en-IN");
};
export const hms = (s, padded = false) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return padded ? [h, m, sec].map((x) => String(x).padStart(2, "0")).join(":") : `${h}h:${m}m:${sec}s`;
};
export const initials = (name) => String(name || "?").split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
export function ago(t, now = Date.now()) {
  const m = Math.floor((now - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? "about 1 hour" : `about ${h} hours`;
  const d = Math.floor(h / 24);
  if (d < 30) return d === 1 ? "1 day" : `${d} days`;
  const mo = Math.floor(d / 30);
  return mo === 1 ? "about 1 month" : `about ${mo} months`;
}

// The five stages the screens use; the pipeline step is kept alongside for display.
export const STAGES = ["New", "Prospecting", "Opportunity", "Won", "Lost"];
export const STAGE_LABEL = { New: "New Lead", Prospecting: "Need Discussion", Opportunity: "Interested", Won: "Won", Lost: "Lost" };
export function cwStage(lead) {
  if (lead.stage === "Closed") return lead.disposition === "Won" ? "Won" : "Lost";
  if (lead.stage === "Quotation given") return "Opportunity";
  return lead.stage;
}

const CALL_IN = new Set(["Incoming", "Missed", "Rejected"]);

// `crm` is what useCrm() returns once the records are loaded.
export function buildModel(crm) {
  const name = (id) => crm.users.get(id)?.name || "";
  const leads = crm.leads.filter((l) => !l.archived).map((l) => ({
    id: l.id, raw: l, name: l.name, phone: l.phone || "", company: l.company || "", source: l.source || "Other", value: Number(l.value) || 0,
    stage: cwStage(l), owner: name(l.owner), ownerId: l.owner || "", createdAt: ms(l.createdAt),
    nextFollowUp: crm.nextDue.get(l.id) ? ms(crm.nextDue.get(l.id)) : null, repeat: Boolean(l.repeat), activities: [],
  }));
  const byId = new Map(leads.map((l) => [l.id, l]));
  const add = (leadId, a) => { const lead = byId.get(leadId); if (lead) lead.activities.push({ ...a, lead }); };
  for (const a of crm.activities || []) {
    const at = ms(a.occurredAt || a.createdAt);
    const by = name(a.userId) || byId.get(a.leadId)?.owner || "";
    if (a.type === "Call") {
      const secs = Number(a.duration) || 0;
      add(a.leadId, { id: a.id, kind: "call", text: a.text || "", at, by, dir: CALL_IN.has(a.direction) ? "in" : "out", connected: secs > 0, secs });
    } else if (a.type === "Note") add(a.leadId, { id: a.id, kind: "note", text: a.text || "", at, by });
    else if (a.type === "Visit") add(a.leadId, { id: a.id, kind: "visit", text: a.text || "Visit logged", at, by });
    else if (a.type === "WhatsApp" || a.type === "Message") add(a.leadId, { id: a.id, kind: "whatsapp", text: a.text || "", at, by, out: a.direction === "Outgoing", sender: a.sender || "", via: a.via || "", label: a.numberLabel || "" });
    else if (a.type === "System") {
      const move = /^Lead stage changed: (.*) → (.+)$/.exec(a.text || "");
      if (move) add(a.leadId, { id: a.id, kind: "stage", text: `Stage changed ${move[1]} → ${move[2]}`, at, by });
    }
  }
  // chat messages the team sent also count as WhatsApp activity
  const conv = new Map((crm.state.conversations || []).map((c) => [c.id, c]));
  for (const m of crm.state.messages || []) {
    const c = conv.get(m.conversationId);
    if (c && m.direction === "Outgoing") add(c.leadId, { id: m.id, kind: "whatsapp", text: m.text || "", at: ms(m.occurredAt || m.createdAt), by: byId.get(c.leadId)?.owner || "" });
  }
  for (const l of leads) l.activities.sort((a, b) => b.at - a.at);
  const team = [...crm.users.values()].filter((u) => u.active !== false).map((u) => u.name);
  const allActivities = leads.flatMap((l) => l.activities).sort((a, b) => b.at - a.at);
  return { leads, byId, team, allActivities, me: name(crm.me.id) };
}

export function smoothPath(pts) {
  if (!pts.length) return "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
