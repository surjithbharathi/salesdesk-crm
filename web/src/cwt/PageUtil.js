import { pipelineStep } from "../pipeline.js";

// Small helpers shared by My Calls, Follow Ups and Reports (PageCalls.jsx, PageFollowups.jsx, PageReports.jsx).

export const statusOf = (l) => (l.stage === "New" ? "New" : pipelineStep(l) || "New");

// The colour of a lead's status tag: blue for new, amber while talking, sky once a quotation is out, green won, red lost.
const TONES = {
  "Interested Customer": "green",
  "Requirement Discussion": "amber",
  "Later Purchase": "amber",
  Won: "green",
  Lost: "red",
};
export const stageTone = (l) => {
  const s = statusOf(l);
  if (s === "New") return "blue";
  return TONES[s] || "sky";
};

export const DAY = 86400000;
export const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
export const mondayOf = (t) => { const s = dayStart(t); return addDays(s, -((new Date(s).getDay() + 6) % 7)); };
export const monthStart = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };

export const timeText = (t) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
export const dayText = (t) => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
export const talkText = (s) => {
  s = Math.round(Number(s) || 0);
  const h = Math.floor(s / 3600);
  return h ? `${h}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m` : `${Math.floor(s / 60)}m ${s % 60}s`;
};
export const ago = (t) => {
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`;
};

// "919741218951" -> "+91 97412 18951"
export const prettyPhone = (p) => {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length === 10) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  if (d.length === 12 && d.startsWith("91")) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  return d ? `+${d}` : "";
};
export const telOf = (p) => { const d = String(p || "").replace(/[^\d+]/g, ""); return d ? `tel:${d}` : ""; };

export function csvOf(rows) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}
export function saveCsv(name, csv) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
