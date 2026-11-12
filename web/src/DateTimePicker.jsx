import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

// A date and time picker with Cancel and OK, used in place of the browser's own date-time box (Chrome's has no OK button:
// the time changes as you scroll, and it closes only when you click away). The value is the same text a
// datetime-local box uses ("2026-11-13T15:48"), so the forms around it keep working as before.
// Styles: styles.css (dtp-*). Placed with the page's CSSOM, not inline style attributes (the CSP allows no inline styles).

const pad = (n) => String(n).padStart(2, "0");
export const toLocalValue = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parse = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
};
const shown = (d) => d.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const QUICK = [[10, "10 AM"], [12, "12 PM"], [15, "3 PM"], [17, "5 PM"]];
const WEEK = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export default function DateTimePicker({ value, onChange, className = "", ariaLabel = "Date and time", required = false, placeholder = "Pick date and time" }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [month, setMonth] = useState(null);
  const box = useRef(null), button = useRef(null), pop = useRef(null);
  const current = parse(value);

  function start() {
    const base = current || (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d; })();
    setDraft(new Date(base));
    setMonth(new Date(base.getFullYear(), base.getMonth(), 1));
    setOpen(true);
  }
  const close = () => { setOpen(false); button.current?.focus(); };
  const ok = () => { onChange(toLocalValue(draft)); close(); };

  // a click outside, or Escape, closes it without changing anything
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key, true); };
  }, [open]);
  // fixed on screen, under the box (or above it when there is no room), so a scrolling panel never cuts it off
  useLayoutEffect(() => {
    if (!open || !pop.current || !button.current) return;
    const r = button.current.getBoundingClientRect(), p = pop.current.getBoundingClientRect(), gap = 6;
    const below = r.bottom + gap + p.height <= window.innerHeight || r.top - gap - p.height < 0;
    pop.current.style.top = `${Math.max(8, below ? r.bottom + gap : r.top - gap - p.height)}px`;
    pop.current.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - p.width - 8))}px`;
  }, [open, month]);

  const setPart = (fn) => setDraft((d) => { const n = new Date(d); fn(n); return n; });
  let body = null;
  if (open && draft && month) {
    const first = month.getDay(), days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(), today = new Date();
    const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
    const h = draft.getHours(), h12 = h % 12 || 12, pm = h >= 12;
    const setHour = (v12, isPm) => setPart((d) => d.setHours((v12 % 12) + (isPm ? 12 : 0)));
    body = (
      <div className="dtp-pop" ref={pop} role="dialog" aria-label={ariaLabel}>
        <div className="dtp-head">
          <button type="button" className="dtp-nav" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
          <b>{month.toLocaleString("en-IN", { month: "long", year: "numeric" })}</b>
          <button type="button" className="dtp-nav" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
        </div>
        <div className="dtp-grid" role="grid">
          {WEEK.map((w) => <span key={w} className="dtp-wd" aria-hidden="true">{w}</span>)}
          {cells.map((d, i) => d
            ? <button key={i} type="button" className={`dtp-day${sameDay(d, draft) ? " on" : ""}${sameDay(d, today) ? " today" : ""}`} aria-pressed={sameDay(d, draft)} aria-label={d.toDateString()}
                onClick={() => setPart((n) => n.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()))}>{d.getDate()}</button>
            : <span key={i} />)}
        </div>
        <p className="dtp-label">Time</p>
        <div className="dtp-quick">
          {QUICK.map(([hour, text]) => <button key={hour} type="button" className={`dtp-chip${h === hour && draft.getMinutes() === 0 ? " on" : ""}`} onClick={() => setPart((d) => d.setHours(hour, 0))}>{text}</button>)}
        </div>
        <div className="dtp-exact">
          <span>Or exact</span>
          <select aria-label="Hour" value={h12} onChange={(e) => setHour(Number(e.target.value), pm)}>{Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}</select>
          <span>:</span>
          <select aria-label="Minute" value={draft.getMinutes()} onChange={(e) => setPart((d) => d.setMinutes(Number(e.target.value)))}>{Array.from({ length: 60 }, (_, i) => i).map((n) => <option key={n} value={n}>{pad(n)}</option>)}</select>
          <select aria-label="AM or PM" value={pm ? "PM" : "AM"} onChange={(e) => setHour(h12, e.target.value === "PM")}><option>AM</option><option>PM</option></select>
        </div>
        <div className="dtp-foot">
          <span className="dtp-sum">{shown(draft)}</span>
          <span className="dtp-acts">
            <button type="button" className="dtp-cancel" onClick={close}>Cancel</button>
            <button type="button" className="dtp-ok" onClick={ok}>OK</button>
          </span>
        </div>
      </div>
    );
  }
  return (
    <span className={`dtp ${className}`} ref={box}>
      <button type="button" ref={button} className="dtp-field" aria-haspopup="dialog" aria-expanded={open} aria-label={`${ariaLabel}: ${current ? shown(current) : "not set"}`} onClick={() => (open ? setOpen(false) : start())}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
        <span>{current ? shown(current) : placeholder}</span>
      </button>
      {/* keeps the form's "required" check: an empty value stops the form like the old box did */}
      {required && <input className="dtp-req" tabIndex={-1} aria-hidden="true" value={value || ""} required onChange={() => {}} />}
      {body}
    </span>
  );
}
