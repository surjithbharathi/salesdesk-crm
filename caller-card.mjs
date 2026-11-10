// What the phone app shows over the call screen when a call comes in (like Truecaller, but from this CRM).
// The person's own leads (or any lead, for an administrator) come with their details; a colleague's lead only says whose it
// is and where it stands, so nobody works the same customer twice; an unknown number gets its probable state.
import { phoneParts } from "./lead-phone.mjs";
import { mobileOf, circleOf, CIRCLE_STATE } from "./probable-state.mjs";

const short = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

export function callerCard({ db, get, users, isBlocked = () => false }, digits, viewer) {
  let parts;
  try { parts = phoneParts(digits.length > 10 ? "+" + digits : digits, digits.length > 10 ? "" : "91"); } catch { return { found: false, number: digits }; }
  const key = parts.phoneKey;
  if (isBlocked(key)) return { found: false, blocked: true, number: parts.phone };
  const row = db.prepare("SELECT body FROM records WHERE kind='leads' AND json_extract(body,'$.phoneKey')=? AND json_extract(body,'$.phoneKey')<>''").get(key);
  let lead = row && JSON.parse(row.body);
  if (lead?.mergedInto) lead = get("leads", lead.mergedInto) || lead;
  const name = (id) => users().find((u) => u.id === id)?.name || "";
  if (!lead || lead.archived) {
    const mobile = mobileOf({ phoneKey: key }), circle = mobile && circleOf(mobile);
    return { found: false, number: parts.phone, probableState: circle ? CIRCLE_STATE[circle] : "" };
  }
  const stage = lead.deal || lead.stage || "New";
  const base = { found: true, id: lead.id, name: lead.name || parts.phone, number: parts.phone, stage, owner: name(lead.owner) || "No owner" };
  const own = viewer.admin || lead.owner === viewer.id;
  if (!own) return { ...base, own: false };

  const acts = db.prepare("SELECT body FROM records WHERE kind='activities' AND json_extract(body,'$.leadId')=?").all(lead.id).map((r) => JSON.parse(r.body))
    .sort((a, b) => String(b.occurredAt || b.createdAt).localeCompare(String(a.occurredAt || a.createdAt)));
  const calls = acts.filter((a) => a.type === "Call"), worked = acts.find((a) => a.type !== "System");
  const tasks = db.prepare("SELECT body FROM records WHERE kind='tasks' AND json_extract(body,'$.leadId')=? AND COALESCE(json_extract(body,'$.status'),'Open')<>'Done'").all(lead.id).map((r) => JSON.parse(r.body))
    .sort((a, b) => String(a.due).localeCompare(String(b.due)));
  return {
    ...base, own: true, company: lead.company || "", city: lead.city || "",
    state: lead.state || "", probableState: lead.state ? "" : lead.probableState || "", language: lead.language || "", source: lead.source || "", value: Number(lead.value) || 0,
    calls: calls.length, answered: calls.filter((c) => Number(c.duration) > 0).length,
    last: worked ? { type: worked.type, direction: worked.direction || "", at: worked.occurredAt || worked.createdAt, by: name(worked.userId), text: short(worked.type === "Call" ? `${worked.direction || ""} call${Number(worked.duration) > 0 ? ` · ${Math.round(worked.duration / 60) || 1} min` : " · not answered"}${worked.outcome ? " · " + worked.outcome : ""}` : worked.text, 140) } : null,
    next: tasks[0] ? { title: short(tasks[0].title, 80), due: tasks[0].due } : null,
    createdAt: lead.createdAt || "",
  };
}
