import React, { useEffect, useRef, useState } from "react";
import { TIcon } from "./icons.jsx";

// "Edit filters" in the TeleCRM style: search or pick a condition (an activity or a field), each chosen condition reads
// "Field | test | value" with its own editor, and the list can be sorted. A condition is { key, op, value }.

const DAY = 86400000;
const startOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
export const DATE_PRESETS = [["any", "Any"], ["today", "Today"], ["yesterday", "Yesterday"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["month", "This month"], ["lastmonth", "Last month"], ["older30", "More than 30 days ago"], ["none", "Not set"], ["range", "Between dates"]];
function dateRange(v, now = Date.now()) {
  const today = startOf(now), d = new Date(now);
  switch (v?.preset) {
    case "today": return [today, today + DAY];
    case "yesterday": return [today - DAY, today];
    case "7d": return [today - 6 * DAY, today + DAY];
    case "30d": return [today - 29 * DAY, today + DAY];
    case "month": return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()];
    case "lastmonth": return [new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), new Date(d.getFullYear(), d.getMonth(), 1).getTime()];
    case "older30": return [-Infinity, today - 30 * DAY];
    case "range": return [v.from ? startOf(v.from) : -Infinity, v.to ? startOf(v.to) + DAY : Infinity];
    default: return null;
  }
}

const OPS = {
  select: [["in", "is any of"], ["nin", "is none of"]],
  text: [["contains", "contains"], ["is", "is"], ["not_contains", "does not contain"], ["empty", "is empty"], ["not_empty", "is not empty"]],
  date: [["is", "is"]],
  number: [["more", "is more than"], ["less", "is less than"], ["eq", "is"]],
  count: [["any", "at least one"], ["none", "none"], ["more", "more than"]],
};
const firstValue = (def) => (def.type === "select" ? [] : def.type === "date" ? { preset: "7d" } : def.type === "count" ? 0 : "");
export const newCondition = (def) => ({ key: def.key, op: OPS[def.type][0][0], value: firstValue(def) });

// does lead l pass condition c? x holds what the page knows besides the lead (calls, messages, notes, follow-ups, names)
export function passes(def, c, l, x) {
  if (!def) return true;
  const v = def.get(l, x);
  if (def.type === "select") { const has = (c.value || []).includes(v ?? ""); return !(c.value || []).length || (c.op === "nin" ? !has : has); }
  if (def.type === "text") {
    const a = String(v ?? "").trim().toLowerCase(), b = String(c.value ?? "").trim().toLowerCase();
    if (c.op === "empty") return !a;
    if (c.op === "not_empty") return Boolean(a);
    if (!b) return true;
    return c.op === "is" ? a === b : c.op === "not_contains" ? !a.includes(b) : a.includes(b);
  }
  if (def.type === "date") {
    if (c.value?.preset === "none") return !v;
    const r = dateRange(c.value);
    if (!r) return true;
    const t = Date.parse(v || "");
    return Number.isFinite(t) && t >= r[0] && t < r[1];
  }
  if (def.type === "number") { const n = Number(v) || 0, m = Number(c.value); if (c.value === "" || !Number.isFinite(m)) return true; return c.op === "more" ? n > m : c.op === "less" ? n < m : n === m; }
  if (def.type === "count") { const n = Number(v) || 0; return c.op === "none" ? n === 0 : c.op === "more" ? n > (Number(c.value) || 0) : n > 0; }
  return true;
}

// a short text of a condition, for the chip
export function conditionText(def, c, nameOf) {
  if (!def) return "";
  if (def.type === "select") { const vals = (c.value || []).map((x) => def.options.find(([k]) => k === x)?.[1] || x); return vals.length ? `${c.op === "nin" ? "is none of" : "is"} ${vals.join(", ")}` : "is any"; }
  if (def.type === "date") { const p = c.value?.preset; return p === "range" ? `between ${c.value.from || "…"} and ${c.value.to || "…"}` : `is ${(DATE_PRESETS.find(([k]) => k === p)?.[1] || "Any").toLowerCase()}`; }
  if (def.type === "count") return c.op === "none" ? "none" : c.op === "more" ? `more than ${c.value || 0}` : "at least one";
  const op = OPS[def.type].find(([k]) => k === c.op)?.[1] || "";
  return ["empty", "not_empty"].includes(c.op) ? op : `${op} ${c.value ?? ""}`;
}

function MultiPick({ options, value, onChange, label }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const shown = options.filter(([, t]) => !q || String(t).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="fp-multi">
      <button type="button" className="fp-val" aria-expanded={open} onClick={() => setOpen(!open)}>{value.length ? value.map((k) => options.find(([o]) => o === k)?.[1] || k).join(", ") : <span className="ph">Select {label.toLowerCase()}…</span>}<TIcon name="chevronDown" /></button>
      {open && (
        <div className="fp-opts">
          {options.length > 8 && <input className="fp-opt-search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${label}`} />}
          {shown.map(([k, t]) => <label key={k} className="fp-opt"><input type="checkbox" checked={value.includes(k)} onChange={() => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k])} />{t}</label>)}
          {!shown.length && <p className="fp-none">Nothing matches.</p>}
        </div>
      )}
    </div>
  );
}

function Condition({ def, c, onChange, onRemove }) {
  const set = (patch) => onChange({ ...c, ...patch });
  return (
    <div className="fp-cond">
      <div className="fp-cond-head"><TIcon name={def.icon} /><b>{def.label}</b><button type="button" className="fp-x" aria-label={`Remove ${def.label}`} onClick={onRemove}><TIcon name="x" /></button></div>
      <div className="fp-cond-body">
        {OPS[def.type].length > 1 && <select className="fp-op" value={c.op} onChange={(e) => set({ op: e.target.value })} aria-label={`${def.label} test`}>{OPS[def.type].map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>}
        {def.type === "select" && <MultiPick options={def.options} value={c.value || []} label={def.label} onChange={(value) => set({ value })} />}
        {def.type === "text" && !["empty", "not_empty"].includes(c.op) && <input className="fp-val" value={c.value || ""} maxLength={120} placeholder="Type a value" aria-label={`${def.label} value`} onChange={(e) => set({ value: e.target.value })} />}
        {def.type === "number" && <input className="fp-val" type="number" inputMode="decimal" value={c.value ?? ""} aria-label={`${def.label} value`} onChange={(e) => set({ value: e.target.value })} />}
        {def.type === "count" && c.op === "more" && <input className="fp-val" type="number" min={0} value={c.value ?? 0} aria-label={`${def.label} count`} onChange={(e) => set({ value: e.target.value })} />}
        {def.type === "date" && <>
          <select className="fp-val" value={c.value?.preset || "any"} onChange={(e) => set({ value: { ...c.value, preset: e.target.value } })} aria-label={`${def.label} period`}>{DATE_PRESETS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
          {c.value?.preset === "range" && <div className="fp-range">
            <input type="date" value={c.value.from || ""} aria-label="From" onChange={(e) => set({ value: { ...c.value, from: e.target.value } })} />
            <span>to</span>
            <input type="date" value={c.value.to || ""} aria-label="To" onChange={(e) => set({ value: { ...c.value, to: e.target.value } })} />
          </div>}
        </>}
      </div>
    </div>
  );
}

export default function FilterPanel({ defs, sorts, conds, setConds, sort, setSort, onClose, onSave, onClear }) {
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState(!conds.length);
  const [name, setName] = useState("");
  const search = useRef(null);
  useEffect(() => { if (picking) search.current?.focus(); }, [picking]);
  useEffect(() => { const k = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const want = q.trim().toLowerCase();
  const match = (d) => !want || d.label.toLowerCase().includes(want);
  const groups = [["activity", null], ["field", "Fields"], ["telecrm", "TeleCRM fields"]].map(([g, title]) => [g, title, defs.filter((d) => d.group === g && match(d))]).filter(([, , list]) => list.length);
  const add = (d) => { setConds([...conds, newCondition(d)]); setPicking(false); setQ(""); };
  const byKey = new Map(defs.map((d) => [d.key, d]));
  return (
    <>
      <div className="fp-scrim" onClick={onClose} />
      <aside className="fp" role="dialog" aria-label="Edit filters">
        <div className="fp-head"><h2>Edit filters</h2><button type="button" className="fp-x" aria-label="Close filters" onClick={onClose}><TIcon name="x" /></button></div>
        <div className="fp-body">
          <div className={`fp-add ${picking ? "open" : ""}`}>
            <div className="fp-search">
              {picking && conds.length > 0 && <button type="button" className="fp-back" aria-label="Back to the conditions" onClick={() => { setPicking(false); setQ(""); }}><TIcon name="chevronLeft" /></button>}
              <input ref={search} placeholder="Add a new condition" value={q} aria-label="Add a new condition" onFocus={() => setPicking(true)} onChange={(e) => { setQ(e.target.value); setPicking(true); }} />
              <span className="fp-go" aria-hidden="true"><TIcon name="search" /></span>
            </div>
            {picking && (
              <div className="fp-pick">
                {groups.map(([g, title, list]) => g === "activity" ? (
                  <div key={g} className="fp-chips">{list.map((d) => <button key={d.key} type="button" className="fp-chip" title={d.label} onClick={() => add(d)}><TIcon name={d.icon} /><span>{d.label}</span></button>)}</div>
                ) : (
                  <div key={g} className="fp-fields">
                    <div className="fp-group"><TIcon name={g === "field" ? "gear" : "tag"} />{title}</div>
                    {list.map((d) => <button key={d.key} type="button" className="fp-field" onClick={() => add(d)}><TIcon name={d.icon} />{d.label}</button>)}
                  </div>
                ))}
                {!groups.length && <p className="fp-none">No condition matches “{q}”.</p>}
              </div>
            )}
          </div>
          {conds.map((c, i) => byKey.get(c.key) && <Condition key={i} def={byKey.get(c.key)} c={c} onChange={(n) => setConds(conds.map((x, j) => (j === i ? n : x)))} onRemove={() => setConds(conds.filter((_, j) => j !== i))} />)}
          <div className="fp-sort">
            <span><TIcon name="filter" />Sort by:</span>
            <select value={sort.key} onChange={(e) => setSort({ ...sort, key: e.target.value })} aria-label="Sort by">{sorts.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
            <select value={sort.dir} onChange={(e) => setSort({ ...sort, dir: e.target.value })} aria-label="Order"><option value="desc">{sort.key === "name" ? "Z to A" : "Newest first"}</option><option value="asc">{sort.key === "name" ? "A to Z" : "Oldest first"}</option></select>
          </div>
        </div>
        <div className="fp-foot">
          {conds.length > 0 && <button type="button" className="fp-clear" onClick={onClear}>Clear all</button>}
          {conds.length > 0 && <form className="fp-save" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onSave(name.trim()); setName(""); } }}>
            <input value={name} maxLength={40} placeholder="Save as a smart view" aria-label="Smart view name" onChange={(e) => setName(e.target.value)} />
            <button type="submit" disabled={!name.trim()}>Save</button>
          </form>}
        </div>
      </aside>
    </>
  );
}
