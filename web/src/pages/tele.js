// Small helpers for the "TeleCRM style" pages.
export const ms = (v) => (typeof v === "number" ? v : Date.parse(v));

// "11m ago", "15h ago", "2d ago", "1M ago": how long ago, in the short form that skin uses.
export function relTime(t) {
  const s = Math.max(0, Math.round((Date.now() - ms(t)) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}M ago`;
}

export function absTime(t) {
  const d = new Date(ms(t));
  return `${d.toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" })} · ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }).toUpperCase()}`;
}

export const talk = (s) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);

export const tagClass = (lead) => (lead.stage === "Closed" ? (lead.disposition === "Won" ? "tag-WON" : "tag-LOST") : lead.stage === "New" ? "tag-FRESH" : "tag-ACTIVE");
