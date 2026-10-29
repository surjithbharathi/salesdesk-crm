import React from "react";
import { v2, localMonths } from "../api.js";
import { useLoad } from "../hooks.js";
import { rupees, hashFor } from "../format.js";
import { useCrm, STAGES } from "../crm.jsx";

function change(now, before) {
  if (!before) return now ? "Nothing to compare with last month" : "No orders in either month";
  const diff = now - before;
  return diff === 0 ? "Same as last month" : `${diff > 0 ? "Up" : "Down"} ${Math.abs(diff)} from last month`;
}

function WorkQueues() {
  const crm = useCrm();
  if (!crm.state) return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = start.getTime() + 86400000;
  const open = crm.leads.filter(crm.isOpen);
  const lateIds = new Set(open.filter((l) => crm.nextDue.get(l.id) && Date.parse(crm.nextDue.get(l.id)) < start.getTime()).map((l) => l.id));
  const todayIds = new Set(open.filter((l) => crm.nextDue.get(l.id) && Date.parse(crm.nextDue.get(l.id)) >= start.getTime() && Date.parse(crm.nextDue.get(l.id)) < end).map((l) => l.id));
  const rows = [
    ["late", lateIds.size, "Late follow-ups", "Calls promised to a customer that are past due", true],
    ["", todayIds.size, "Follow-ups due today", "Calls and messages scheduled for today", false, "today"],
    ["untouched", open.filter((l) => !l.firstTouchAt).length, "Leads nobody has called yet", "No call or message recorded so far", true],
    ["new", open.filter((l) => l.stage === "New").length, "New enquiries", "Still waiting at New", false],
    ["unassigned", open.filter((l) => !l.owner).length, "Leads with no owner", "Nobody is responsible for these yet", true],
  ];
  const byStage = STAGES.map(([key, label]) => ({ key, label, count: crm.leads.filter((l) => l.stage === key && !l.archived).length }));
  const total = byStage.reduce((s, r) => s + r.count, 0) || 1;
  let x = 0;
  return (
    <div className="cols">
      <section aria-label="Work to do">
        <h2 className="section-title">Work to do</h2>
        <ul className="worklist">
          {rows.map(([queue, count, title, hint, hot, none]) => (
            <li key={title}>
              <a className="work-row" href={none ? hashFor("/todo") : hashFor("/leads", { queue })}>
                <span className={`plate ${count === 0 ? "plate-zero" : hot ? "plate-hot" : ""}`}>{count}</span>
                <span className="work-what"><b>{title}</b><span>{count === 0 ? "Nothing waiting. All clear." : hint}</span></span>
              </a>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Where leads are now">
        <h2 className="section-title">Where leads are now</h2>
        <svg className="stack" viewBox="0 0 1000 22" preserveAspectRatio="none" role="img" aria-label="Leads by stage">
          {byStage.filter((r) => r.count).map((r) => {
            const width = (r.count / total) * 1000;
            const rect = <a key={r.key} href={hashFor("/leads", { stage: r.key })}><title>{`${r.label}: ${r.count}`}</title><rect className={r.key === "New" ? "seg-FRESH" : r.key === "Closed" ? "seg-WON" : "seg-ACTIVE"} x={x} y="0" width={Math.max(width - 1.5, 1)} height="22" /></a>;
            x += width;
            return rect;
          })}
        </svg>
        <div className="legend">
          {byStage.filter((r) => r.count).map((r) => <a key={r.key} href={hashFor("/leads", { stage: r.key })}>{r.label} <span className="num">{r.count}</span></a>)}
        </div>
      </section>
    </div>
  );
}

export default function Business() {
  const { data, error } = useLoad(() => v2("/business", localMonths()), []);
  const month = new Date().toLocaleDateString("en-IN", { month: "long" });
  const date = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  if (error) return <p className="error">{error.message}</p>;
  return (
    <>
      <div className="work-head">
        <h1 className="work-title">Business</h1>
        <span className="work-date">{date}</span>
      </div>
      <WorkQueues />
      {data && (
        <section aria-label="This month" className="month">
          <h2 className="section-title">{month} so far</h2>
          <div className="month-tiles">
            <div className="month-tile"><b className="num">{data.thisMonth.n}</b><span>{data.thisMonth.n === 1 ? "order" : "orders"}</span><small>{change(data.thisMonth.n, data.lastMonth.n)}</small></div>
            <div className="month-tile"><b className="num">{rupees(data.thisMonth.value)}</b><span>order value</span><small>{data.lastMonth.value ? `Last month ${rupees(data.lastMonth.value)}` : "No orders last month"}</small></div>
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
          <p className="muted gauge-note">An order is counted in the month its lead was closed as Won. Value is the lead's value in the CRM.</p>
        </section>
      )}
    </>
  );
}
