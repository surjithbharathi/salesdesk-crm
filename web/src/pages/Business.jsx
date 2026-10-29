import React from "react";
import { v2, localMonths } from "../api.js";
import { useLoad } from "../hooks.js";
import { rupees } from "../format.js";

function change(now, before) {
  if (!before) return now ? "Nothing to compare with last month" : "No orders in either month";
  const diff = now - before;
  return diff === 0 ? "Same as last month" : `${diff > 0 ? "Up" : "Down"} ${Math.abs(diff)} from last month`;
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
