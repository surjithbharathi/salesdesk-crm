export const pct = (value) => (value == null ? "—" : `${Math.round(value * 1000) / 10}%`);
export const rupees = (n) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);
export const when = (iso) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
export const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—");
export const timeOnly = (iso) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
export const minutes = (m) => (m == null ? "—" : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 6) / 10} h` : `${Math.round(m / 144) / 10} d`);
export const phoneText = (lead) => lead.phone_display || (lead.phone_e164 ? `+${lead.phone_e164}` : "No phone");
export const initials = (name) =>
  String(name || "?").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
export const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// A stable colour class per person, so the same lead keeps the same avatar everywhere.
export function avatarClass(text) {
  let hash = 0;
  for (const ch of String(text)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `av-${hash % 6}`;
}

// "3 days late", "today", "in 2 days": what a caller needs to know about a follow-up date.
export function dueText(iso, nowMs = Date.now()) {
  if (!iso) return null;
  const start = new Date(nowMs);
  start.setHours(0, 0, 0, 0);
  const days = Math.floor((new Date(iso).getTime() - start.getTime()) / 86400000);
  if (days < 0) return { text: `${plural(-days, "day")} late`, tone: "late" };
  if (days === 0) return { text: "today", tone: "soon" };
  if (days === 1) return { text: "tomorrow", tone: "" };
  return { text: `in ${days} days`, tone: "" };
}
export function ago(iso, nowMs = Date.now()) {
  const days = Math.floor((nowMs - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return day(iso);
}
export function dayLabel(iso, nowMs = Date.now()) {
  const start = new Date(nowMs);
  start.setHours(0, 0, 0, 0);
  const days = Math.floor((start.getTime() - new Date(iso).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(iso).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
}

// Hash routing: #/leads?queue=untouched&lead=<id>
export function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/dashboard";
  const [path, query = ""] = raw.split("?");
  return { path, params: Object.fromEntries(new URLSearchParams(query)) };
}
export function hashFor(path, params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return `#${path}${query ? "?" + query : ""}`;
}
