import React from "react";
import { sourceLabel, sourceKeys } from "../ChatEntry.jsx";

// Small pieces the leads list and the lead panel share: the source tag, follow-up wording and the quick time choices.

// Where the lead came from, as a small coloured tag (IndiaMART red, TradeIndia orange, Meta blue, website green, others grey).
export function SourceTag({ source, className = "" }) {
  if (!String(source || "").trim()) return null;
  const key = sourceKeys(source)[0];
  return <span className={`lb-src lb-src-${key} ${className}`}>{sourceLabel(source)}</span>;
}

const timeText = (d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

// "Late · 11:00 AM", "Today · 4:00 PM", "Mon · 11:00 AM": what a caller needs to know about a follow-up time.
export function dueLabel(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return { tone: "none", text: "Not planned" };
  const d = new Date(t), start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const days = Math.floor((t - start.getTime()) / 86400000);
  if (t < now) return { tone: "late", text: days === 0 ? `Late · ${timeText(d)}` : days === -1 ? "Late · yesterday" : `Late · ${-days}d` };
  if (days === 0) return { tone: "today", text: `Today · ${timeText(d)}` };
  if (days === 1) return { tone: "soon", text: `Tomorrow · ${timeText(d)}` };
  if (days < 7) return { tone: "soon", text: `${d.toLocaleDateString("en-US", { weekday: "short" })} · ${timeText(d)}` };
  return { tone: "soon", text: `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${timeText(d)}` };
}

// The quick times offered for a follow-up: in an hour, this evening (while it is still ahead), tomorrow morning, two days on.
export function quickTimes(now = new Date()) {
  const at = (days, h) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d; };
  const soon = new Date(Math.ceil((now.getTime() + 3600000) / 300000) * 300000);
  const list = [["In 1 hour", soon]];
  if (now.getHours() < 17) list.push(["Today 6 PM", at(0, 18)]);
  list.push(["Tomorrow 10 AM", at(1, 10)]);
  const later = at(2, 11);
  list.push([`${later.toLocaleDateString("en-US", { weekday: "long" })} 11 AM`, later]);
  return list;
}

export const localInput = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
