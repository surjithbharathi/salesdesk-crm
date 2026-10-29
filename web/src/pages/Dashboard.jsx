import React, { useState } from "react";
import { v2, localDay, localMonths } from "../api.js";
import { useLoad } from "../hooks.js";
import { hashFor, pct, plural, rupees } from "../format.js";

const WORK = [
  ["overdueFollowups", "overdue", "Late follow-ups", "Calls promised to a customer that are past due", true],
  ["followupsToday", "today", "Follow-ups due today", "Calls and messages scheduled for today"],
  ["awaitingFirstTouch", "untouched", "Leads nobody has called yet", "No call or message recorded so far", true],
  ["newLeads", "new", "New enquiries", "Still waiting at New Lead"],
  ["repeatEnquiries", "repeat", "Customers who came back", "Enquired again after the first time"],
];
const DECISIONS = [
  ["unassigned", "Leads with no owner"],
  ["missedCallsToReturn", "Missed calls not yet returned"],
  ["callsNeedingOutcome", "Answered calls with no outcome"],
  ["won", "Orders won"],
];
const RANGES = [[7, "7 days"], [30, "30 days"], [90, "90 days"]];

// The press line: every enquiry of the period flows left to right and narrows as leads drop out.
const STAGES = [
  ["leads", "Enquiries", "enquiries came in", null],
  ["contacted", "Called", "were ever called", "were never called"],
  ["connected", "Answered", "were ever answered", "never picked up"],
  ["quotation", "Quotation", "reached a quotation", "never got a quotation"],
  ["won", "Orders", "became orders", "did not order"],
];
const W = 960, CY = 150, MAX_H = 120, COL_X = [60, 270, 480, 690, 900];

function band(x1, h1, x2, h2) {
  const mid = (x1 + x2) / 2;
  const a = CY - h1 / 2, b = CY + h1 / 2, c = CY - h2 / 2, d = CY + h2 / 2;
  return `M${x1} ${a} C${mid} ${a} ${mid} ${c} ${x2} ${c} L${x2} ${d} C${mid} ${d} ${mid} ${b} ${x1} ${b} Z`;
}

function PressLine({ totals, days, setDays }) {
  const [active, setActive] = useState(null);
  const values = STAGES.map(([key]) => totals[key]);
  const intake = values[0];
  const heights = values.map((v) => (intake ? Math.max(5, (v / intake) * MAX_H) : 5));
  const drops = values.map((v, i) => (i ? values[i - 1] - v : 0));
  let worst = 0;
  for (let i = 1; i < drops.length; i++) if (drops[i] > drops[worst]) worst = i;

  const sentence = intake
    ? <>Of <b className="num">{intake}</b> enquiries in the last {days} days, <b className="num">{values[4]}</b> became {values[4] === 1 ? "an order" : "orders"}.</>
    : <>No enquiries were received in the last {days} days.</>;

  let caption;
  if (active !== null && active > 0) {
    const prev = values[active - 1];
    caption = `${values[active]} of ${prev} ${STAGES[active - 1][1].toLowerCase() === "enquiries" ? "enquiries" : STAGES[active - 1][1].toLowerCase()} ${STAGES[active][2]} (${pct(prev ? values[active] / prev : null)}). ${Math.max(0, drops[active])} ${STAGES[active][3]}.`;
  } else if (active === 0) {
    caption = `${intake} enquiries came in during the last ${days} days. Point at a stage to see what happens next.`;
  } else if (intake && drops[worst] > 0) {
    caption = `The biggest loss is between ${STAGES[worst - 1][1].toLowerCase()} and ${STAGES[worst][1].toLowerCase()}: ${plural(drops[worst], "lead")} (${pct(drops[worst] / intake)} of all enquiries).`;
  } else caption = "Point at a stage to see how many leads reach it.";

  return (
    <section className="press" aria-label="From enquiry to order">
      <div className="press-head">
        <p className="press-sentence">{sentence}</p>
        <div className="pills" role="group" aria-label="Period">
          {RANGES.map(([d, label]) => (
            <button key={d} className="pill" aria-pressed={days === d} onClick={() => setDays(d)}>{label}</button>
          ))}
        </div>
      </div>
      <svg className="press-svg" viewBox={`0 0 ${W} 250`} role="img" aria-label={`Enquiries ${values[0]}, called ${values[1]}, answered ${values[2]}, quotation ${values[3]}, orders ${values[4]}`}>
        <defs>
          <clipPath id="pour"><rect className="press-reveal" x="0" y="0" width={W} height="250" /></clipPath>
        </defs>
        <path className="press-ghost" d={`M${COL_X[0]} ${CY - heights[0] / 2} H${COL_X[4]} V${CY + heights[0] / 2} H${COL_X[0]} Z`} />
        <g clipPath="url(#pour)">
          {COL_X.slice(0, -1).map((x, i) => <path key={i} className="press-stream" d={band(x, heights[i], COL_X[i + 1], heights[i + 1])} />)}
        </g>
        {COL_X.slice(0, -1).map((x, i) => drops[i + 1] > 0 && (
          <text key={`l${i}`} className="press-loss" x={(x + COL_X[i + 1]) / 2} y={CY + heights[0] / 2 + 24} textAnchor="middle">
            −{drops[i + 1]} {STAGES[i + 1][3]}
          </text>
        ))}
        {STAGES.map(([key, label], i) => (
          <g key={key} className="press-col" tabIndex={0} role="button" aria-label={`${label}: ${values[i]}`} data-on={active === i}
             onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}>
            <rect className="press-hit" x={COL_X[i] - 60} y="0" width="120" height="250" />
            <rect className="press-valve" x={COL_X[i] - 6} y={CY - MAX_H / 2 - 12} width="12" height={MAX_H + 24} rx="3" />
            <text className="press-label" x={COL_X[i]} y="24" textAnchor="middle">{label}</text>
            <text className="press-value" x={COL_X[i]} y="56" textAnchor="middle">{values[i]}</text>
            {i > 0 && <text className="press-pct" x={COL_X[i]} y="76" textAnchor="middle">{pct(intake ? values[i] / intake : null)} of enquiries</text>}
          </g>
        ))}
      </svg>
      <p className="press-caption" aria-live="polite">
        {caption} <a href={hashFor("/reports/sources")}>Compare sources</a>
      </p>
    </section>
  );
}

function change(now, before) {
  if (!before) return now ? "Nothing to compare with last month" : "No orders in either month";
  const diff = now - before;
  return diff === 0 ? "Same as last month" : `${diff > 0 ? "Up" : "Down"} ${Math.abs(diff)} from last month`;
}

function Month({ data }) {
  const month = new Date().toLocaleDateString("en-IN", { month: "long" });
  const { thisMonth: now, lastMonth: before } = data;
  return (
    <section aria-label="This month" className="month">
      <h2 className="section-title">{month} so far</h2>
      <div className="month-tiles">
        <div className="month-tile"><b className="num">{now.n}</b><span>{now.n === 1 ? "order" : "orders"}</span><small>{change(now.n, before.n)}</small></div>
        <div className="month-tile"><b className="num">{rupees(now.value)}</b><span>order value</span><small>{before.value ? `Last month ${rupees(before.value)}` : "No orders last month"}</small></div>
      </div>
      <div className="table-frame">
        <table className="grid">
          <thead><tr><th>Person</th><th className="right">Calls</th><th className="right">Quotations</th><th className="right">Orders</th><th className="right">Order value</th></tr></thead>
          <tbody>
            {data.people.map((p) => (
              <tr key={p.id}><td><b>{p.name}</b></td><td className="right num">{p.calls}</td><td className="right num">{p.quotations}</td><td className="right num">{p.orders}</td><td className="right num">{rupees(p.value)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted gauge-note">An order is counted in the month its lead moved to a Won stage. Value is the lead's expected value.</p>
    </section>
  );
}

function Pipeline({ rows }) {
  const total = rows.reduce((s, r) => s + r.count, 0) || 1;
  let x = 0;
  return (
    <>
      <svg className="stack" viewBox="0 0 1000 22" preserveAspectRatio="none" role="img" aria-label="Leads by status">
        {rows.filter((r) => r.count).map((r) => {
          const width = (r.count / total) * 1000;
          const rect = (
            <a key={r.id} href={hashFor("/leads", { status: r.id })}>
              <title>{`${r.label}: ${r.count}`}</title>
              <rect className={`seg-${r.stage_group}`} x={x} y="0" width={Math.max(width - 1.5, 1)} height="22" />
            </a>
          );
          x += width;
          return rect;
        })}
      </svg>
      <div className="legend">
        {rows.filter((r) => r.count).map((r) => (
          <a key={r.id} href={hashFor("/leads", { status: r.id })}><i className={`dot-${r.stage_group}`} />{r.label} <span className="num">{r.count}</span></a>
        ))}
      </div>
    </>
  );
}

export default function Dashboard() {
  const [days, setDays] = useState(30);
  const today = useLoad(() => v2("/dashboard", localDay()), []);
  const report = useLoad(() => {
    const to = new Date();
    to.setDate(to.getDate() + 1);
    to.setHours(0, 0, 0, 0);
    const from = new Date(to);
    from.setDate(from.getDate() - days - 1);
    return v2("/reports/sources", { from: from.toISOString(), to: to.toISOString() });
  }, [days]);

  const totals = (report.data?.sources || []).reduce(
    (t, s) => ({ leads: t.leads + s.leads, contacted: t.contacted + s.contacted, connected: t.connected + s.connected, quotation: t.quotation + s.reached_quotation, won: t.won + s.won }),
    { leads: 0, contacted: 0, connected: 0, quotation: 0, won: 0 },
  );
  const business = useLoad(() => v2("/business", localMonths()), []);
  const date = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  const d = today.data;
  return (
    <>
      <div className="work-head">
        <h1 className="work-title">Today</h1>
        <span className="work-date">{date}</span>
      </div>
      {report.error ? <p className="error">{report.error.message}</p> : <PressLine totals={totals} days={days} setDays={setDays} />}
      {business.data && <Month data={business.data} />}
      {today.error && <p className="error">{today.error.message}</p>}
      {d && (
        <div className="cols">
          <section aria-label="Work to do">
            <h2 className="section-title">Work to do</h2>
            <ul className="worklist">
              {WORK.map(([key, queue, title, hint, hot]) => (
                <li key={key}>
                  <a className="work-row" href={hashFor("/leads", { queue })}>
                    <span className={`plate ${d[key] === 0 ? "plate-zero" : hot ? "plate-hot" : ""}`}>{d[key]}</span>
                    <span className="work-what"><b>{title}</b><span>{d[key] === 0 ? "Nothing waiting. All clear." : hint}</span></span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
          <div>
            <section aria-label="Needs a decision">
              <h2 className="section-title">Needs a decision</h2>
              <ul className="sidelist">
                {DECISIONS.map(([key, label]) => <li key={key}><span>{label}</span><b className="num">{d[key]}</b></li>)}
              </ul>
            </section>
            <section aria-label="Where leads are now">
              <h2 className="section-title section-gap">Where leads are now</h2>
              <Pipeline rows={d.byStatus} />
            </section>
          </div>
        </div>
      )}
    </>
  );
}
