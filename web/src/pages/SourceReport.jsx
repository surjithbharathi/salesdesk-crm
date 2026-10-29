import React, { useMemo, useState } from "react";
import { v2 } from "../api.js";
import { useLoad } from "../hooks.js";
import { hashFor, pct, rupees, minutes, plural } from "../format.js";

const RANGES = [[7, "7 days"], [30, "30 days"], [90, "90 days"], [365, "Year"]];
// [key, heading, how to read the value, higher is better?]
const COLUMNS = [
  ["leads", "Leads", (s) => s.leads, true],
  ["contact", "Called", (s) => s.rates.contact, true],
  ["connected", "Answered", (s) => s.rates.connected, true],
  ["quotation", "Quotation", (s) => s.rates.quotation, true],
  ["won", "Orders", (s) => s.rates.won, true],
  ["junk", "Junk", (s) => s.rates.junk, false],
  ["revenue", "Order value", (s) => s.revenue, true],
  ["touch", "First call", (s) => s.avg_minutes_to_first_touch, false],
];
const RATE_COLUMNS = ["contact", "connected", "quotation", "won", "junk"];

// Marks the best and worst source per column, only among sources with enough leads to judge.
function marks(sources) {
  const result = {};
  const judged = sources.filter((s) => s.sampleSize === "ok");
  if (judged.length < 2) return result;
  for (const [key, , read, higher] of COLUMNS) {
    if (key === "leads") continue;
    const values = judged.map((s) => [s.source_id, read(s)]).filter(([, v]) => v != null);
    if (values.length < 2) continue;
    const sorted = [...values].sort((a, b) => (higher ? b[1] - a[1] : a[1] - b[1]));
    if (sorted[0][1] === sorted[sorted.length - 1][1]) continue;
    result[`${sorted[0][0]}:${key}`] = "best";
    result[`${sorted[sorted.length - 1][0]}:${key}`] = "worst";
  }
  return result;
}

// Plain facts taken from the numbers, never guesses. Each one names its source.
function findings(data) {
  const judged = data.sources.filter((s) => s.sampleSize === "ok");
  const out = [];
  if (judged.length >= 2) {
    const byWin = [...judged].sort((a, b) => b.rates.won - a.rates.won);
    const best = byWin[0];
    if (best.won > 0)
      out.push({ tone: "good", text: <><b>{best.source}</b> turns the most enquiries into orders: {plural(best.won, "order")} from {plural(best.leads, "lead")} ({pct(best.rates.won)}).</> });
    const weakest = [...judged].sort((a, b) => (a.rates.connected ?? 0) - (b.rates.connected ?? 0))[0];
    if (weakest.source_id !== best.source_id && (weakest.rates.connected ?? 0) < (best.rates.connected ?? 0)) {
      const top = weakest.lostReasons[0];
      out.push({ tone: "bad", text: <><b>{weakest.source}</b> is hardest to reach: only {pct(weakest.rates.connected)} of its {plural(weakest.leads, "lead")} were ever answered and {pct(weakest.rates.junk)} were junk (wrong number or duplicate).{top ? <> The most common reason for losing them is “{top.reason}” ({top.count}).</> : null}</> });
    }
    const slow = [...judged].filter((s) => s.avg_minutes_to_first_touch != null).sort((a, b) => b.avg_minutes_to_first_touch - a.avg_minutes_to_first_touch)[0];
    if (slow && slow.avg_minutes_to_first_touch >= 240)
      out.push({ tone: "", text: <><b>{slow.source}</b> waits the longest for a first call: {minutes(slow.avg_minutes_to_first_touch)} on average.</> });
  } else if (data.sources.length) {
    out.push({ tone: "", text: "Not enough leads per source yet to compare them fairly. Sources with fewer than 20 leads are shown but not judged." });
  }
  return out;
}

function Meter({ value, tone }) {
  return (
    <span className={`meter ${tone ? `meter-${tone}` : ""}`}>
      <span className="num">{pct(value)}</span>
      <progress max="1" value={value ?? 0} aria-hidden="true" />
    </span>
  );
}

export default function SourceReport() {
  const [days, setDays] = useState(30);
  const [open, setOpen] = useState(null);
  const [sort, setSort] = useState({ key: "leads", dir: "desc" });
  const { data, error, loading } = useLoad(() => {
    const to = new Date();
    to.setDate(to.getDate() + 1);
    to.setHours(0, 0, 0, 0);
    const from = new Date(to);
    from.setDate(from.getDate() - days - 1);
    return v2("/reports/sources", { from: from.toISOString(), to: to.toISOString() });
  }, [days]);

  const rows = useMemo(() => {
    if (!data) return [];
    const column = COLUMNS.find(([key]) => key === sort.key);
    const read = column ? column[2] : (s) => s.leads;
    return [...data.sources].sort((a, b) => {
      const x = read(a), y = read(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return sort.dir === "desc" ? y - x : x - y;
    });
  }, [data, sort]);
  const marked = useMemo(() => (data ? marks(data.sources) : {}), [data]);
  const notes = useMemo(() => (data ? findings(data) : []), [data]);
  const toggle = (id) => setOpen(open === id ? null : id);
  const sortBy = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  const markFor = (id, key) => marked[`${id}:${key}`];

  return (
    <>
      <div className="work-head">
        <h1 className="work-title">Where leads come from</h1>
        <div className="pills" role="group" aria-label="Period">
          {RANGES.map(([d, label]) => (
            <button key={d} className="pill" aria-pressed={days === d} onClick={() => setDays(d)}>{label}</button>
          ))}
        </div>
      </div>
      {loading && !data && <p className="muted">Loading the report…</p>}
      {error && <p className="error">{error.message}</p>}
      {data && (
        <>
          <p className="muted report-meta">
            {plural(data.coverage.leads, "lead")} in the last {days} days.{" "}
            {data.reconciled ? <span className="note note-good">Source totals match the lead count</span> : <span className="note note-bad">Source totals do not match the lead count</span>}{" "}
            {data.coverage.unknownSource > 0 && <span className="note note-warn">{plural(data.coverage.unknownSource, "lead")} with no source recorded</span>}{" "}
            {data.coverage.withoutPhone > 0 && <span className="note note-warn">{plural(data.coverage.withoutPhone, "lead")} without a phone number</span>}
          </p>
          {notes.length > 0 && (
            <div className="findings" aria-label="What the numbers show">
              {notes.map((n, i) => <p key={i} className={`finding ${n.tone ? `finding-${n.tone}` : ""}`}>{n.text}</p>)}
            </div>
          )}
          <div className="table-frame">
            <table className="grid">
              <thead>
                <tr>
                  <th>Source</th>
                  {COLUMNS.map(([key, label]) => (
                    <th key={key} className={key === "leads" || key === "revenue" || key === "touch" ? "right" : ""} aria-sort={sort.key === key ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}>
                      <button className="sort" data-dir={sort.key === key ? sort.dir : undefined} onClick={() => sortBy(key)}>
                        {label}{sort.key === key ? (sort.dir === "desc" ? " ▾" : " ▴") : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <React.Fragment key={s.source_id}>
                    <tr className="src-row" tabIndex={0} aria-expanded={open === s.source_id} onClick={() => toggle(s.source_id)}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle(s.source_id))}>
                      <td>
                        <b>{s.source}</b>
                        {s.sampleSize === "too_small" && <span className="note note-warn small-note" title="Fewer than 20 leads, too few to judge">few leads</span>}
                      </td>
                      <td className="right num">{s.leads}</td>
                      {RATE_COLUMNS.map((key) => {
                        const mark = markFor(s.source_id, key);
                        const column = COLUMNS.find(([k]) => k === key);
                        const good = (mark === "best");
                        return (
                          <td key={key}>
                            <Meter value={column[2](s)} tone={mark ? (good ? "good" : "bad") : ""} />
                            {mark && <span className={`mark mark-${mark}`}>{mark === "best" ? "Best" : "Weakest"}</span>}
                          </td>
                        );
                      })}
                      <td className="right num">
                        {rupees(s.revenue)}
                        {markFor(s.source_id, "revenue") === "best" && <span className="mark mark-best">Best</span>}
                      </td>
                      <td className="right num">
                        {minutes(s.avg_minutes_to_first_touch)}
                        {markFor(s.source_id, "touch") && <span className={`mark mark-${markFor(s.source_id, "touch")}`}>{markFor(s.source_id, "touch") === "best" ? "Fastest" : "Slowest"}</span>}
                      </td>
                    </tr>
                    {open === s.source_id && (
                      <tr className="reasons">
                        <td colSpan={COLUMNS.length + 1}>
                          <b>Why these leads were lost</b>
                          {s.lostReasons.length ? (
                            <ul className="reason-list">
                              {s.lostReasons.map((r) => (
                                <li key={r.reason_id}><span>{r.reason}</span><progress max={s.lostReasons[0].count} value={r.count} /><span className="num">{r.count}</span></li>
                              ))}
                            </ul>
                          ) : <p className="muted reason-none">No lead from this source was lost in this period.</p>}
                          <a className="btn" href={hashFor("/leads", { source: s.source_id })}>Open {s.source} leads</a>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            {!data.sources.length && <div className="empty"><b>No leads in this period</b>Choose a longer period to see more history.</div>}
          </div>
          <details className="defs">
            <summary>How these numbers are worked out</summary>
            <dl>
              {Object.entries(data.definitions).map(([k, v]) => (<React.Fragment key={k}><dt>{k.replace(/_/g, " ")}</dt><dd>{v}</dd></React.Fragment>))}
            </dl>
            <p className="muted">Every figure comes from the database. Sources with fewer than 20 leads are shown but never marked best or weakest.</p>
          </details>
        </>
      )}
    </>
  );
}
