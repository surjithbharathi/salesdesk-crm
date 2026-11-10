import React from "react";

// Shared pieces of the owner overview (Dashboard.jsx) and the staff "My day" (pages/MyDay.jsx). Styles: cwt/r-dash.css.

export const DAY = 86400000;
export const MIN_TALK = 10; // seconds: a shorter answered call is an accidental pick-up (the same rule as the KPI counts on the server)
export const ms = (v) => (typeof v === "number" ? v : Date.parse(v));
export const PERIODS = [["today", "Today"], ["week", "This week"], ["month", "This month"]];

// The chosen period, and the same stretch of time one period earlier (cut at the same point, so a half-day is compared with a half-day).
export function periodRange(period, now = Date.now()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === "week") {
    const from = start.getTime() - ((start.getDay() + 6) % 7) * DAY;
    return { from, to: from + 7 * DAY, prevFrom: from - 7 * DAY, prevTo: now - 7 * DAY, cmp: "vs last week", days: Math.floor((start.getTime() - from) / DAY) + 1 };
  }
  if (period === "month") {
    const from = new Date(start.getFullYear(), start.getMonth(), 1).getTime();
    const prev = new Date(start.getFullYear(), start.getMonth() - 1, 1).getTime();
    return { from, to: new Date(start.getFullYear(), start.getMonth() + 1, 1).getTime(), prevFrom: prev, prevTo: Math.min(from, prev + (now - from)), cmp: "vs last month", days: start.getDate() };
  }
  return { from: start.getTime(), to: start.getTime() + DAY, prevFrom: start.getTime() - DAY, prevTo: now - DAY, cmp: "vs yesterday", days: 1 };
}
// Working days so far in a period (Sundays off), for goals that are set per day.
export function workDays(range, now = Date.now()) {
  let n = 0;
  for (let t = range.from; t < Math.min(range.to, now); t += DAY) if (new Date(t).getDay() !== 0) n++;
  return Math.max(1, n);
}

export const dateLine = (now = new Date()) => now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
export const hourLabel = (h) => String(h % 12 || 12);
export const hourName = (h) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
export const clock = (t) => new Date(t).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).toUpperCase();
export function talk(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
export function shortTalk(seconds) {
  const s = Math.round(seconds);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}
export function since(t, now = Date.now()) {
  const m = Math.max(0, Math.floor((now - t) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
}
// Rupees the way the team says them: 18.4 L, 1.2 Cr.
export function money(n) {
  const v = Number(n) || 0;
  if (v >= 1e7) return `₹ ${(v / 1e7).toFixed(1).replace(/\.0$/, "")} Cr`;
  if (v >= 1e5) return `₹ ${(v / 1e5).toFixed(1).replace(/\.0$/, "")} L`;
  return `₹ ${new Intl.NumberFormat("en-IN").format(Math.round(v))}`;
}
export const share = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
export const width = (part, whole) => ({ width: `${whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0}%` });

export function Seg({ value, onChange, label = "Period" }) {
  return (
    <div className="rd-seg" role="group" aria-label={label}>
      {PERIODS.map(([key, text]) => <button key={key} type="button" className={value === key ? "on" : ""} aria-pressed={value === key} onClick={() => onChange(key)}>{text}</button>)}
    </div>
  );
}

// A number card: label, big value, then a change line or a short note.
export function Kpi({ label, value, of, note, tone = "", noteTone = "", bar, barTone = "", accent = false }) {
  return (
    <div className={`r-card rd-kpi ${accent ? "rd-kpi-accent" : ""}`}>
      <p className="rd-kl">{label}</p>
      <p className={`rd-kv ${tone}`}>{value}{of != null && <span className="rd-of"> / {of}</span>}</p>
      {bar != null && <div className="rd-track"><i className={barTone} style={width(bar, 1)} /></div>}
      {note && <p className={`rd-ks ${noteTone}`}>{note}</p>}
    </div>
  );
}
// "▲ 18% vs yesterday" style change line
export function change(now, before, { unit = "%", cmp = "" } = {}) {
  if (unit === "pts") {
    const d = Math.round(now - before);
    return d === 0 ? { text: `same as before`, tone: "" } : { text: `${d > 0 ? "▲" : "▼"} ${Math.abs(d)} pts`, tone: d > 0 ? "up" : "down" };
  }
  if (unit === "n") {
    const d = now - before;
    return d === 0 ? { text: `same ${cmp}`.trim(), tone: "" } : { text: `${d > 0 ? "▲" : "▼"} ${Math.abs(d)} ${cmp}`.trim(), tone: d > 0 ? "up" : "down" };
  }
  if (!before) return now ? { text: `up from 0 ${cmp}`.trim(), tone: "up" } : { text: `none ${cmp}`.trim(), tone: "" };
  const p = Math.round(((now - before) / before) * 100);
  return p === 0 ? { text: `same ${cmp}`.trim(), tone: "" } : { text: `${p > 0 ? "▲" : "▼"} ${Math.abs(p)}% ${cmp}`.trim(), tone: p > 0 ? "up" : "down" };
}

// A coloured work-queue tile: small caps label, a big count, and where it leads.
export function Tile({ tone, label, count, note, href, onClick }) {
  const body = <><p className="rd-tl">{label}</p><p className="rd-tv">{count}</p><p className="rd-tn">{note} <span aria-hidden="true">→</span></p></>;
  return href ? <a className={`rd-tile ${tone}`} href={href}>{body}</a> : <button type="button" className={`rd-tile ${tone}`} onClick={onClick}>{body}</button>;
}

// Calls per hour of the day; the busiest hour is drawn in full blue, hours after now are greyed out.
export function HourChart({ counts, tall = false, today = false }) {
  const hours = Object.keys(counts).map(Number);
  const first = Math.min(9, ...hours), last = Math.max(today ? 17 : 18, ...hours);
  const top = Math.max(1, ...Object.values(counts));
  const peak = hours.length ? hours.reduce((a, b) => (counts[b] > counts[a] ? b : a), hours[0]) : null;
  const nowHour = new Date().getHours();
  const max = tall ? 112 : 108;
  const cols = [];
  for (let h = first; h <= last; h++) {
    const n = counts[h] || 0;
    const future = today && h > nowHour;
    cols.push(
      <div key={h} className="rd-hr" title={`${hourName(h)}: ${n} ${n === 1 ? "call" : "calls"}`}>
        <i className={future ? "later" : h === peak && n > 0 ? "peak" : ""} style={{ height: `${Math.max(8, Math.round((n / top) * max))}px` }} />
        {hourLabel(h)}
      </div>,
    );
  }
  return <div className={`rd-hours ${tall ? "tall" : ""}`}>{cols}</div>;
}
export function peakHour(counts) {
  const hours = Object.keys(counts).map(Number).filter((h) => counts[h] > 0);
  return hours.length ? hours.reduce((a, b) => (counts[b] > counts[a] ? b : a), hours[0]) : null;
}
