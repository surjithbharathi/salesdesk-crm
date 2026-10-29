import React, { useState } from "react";
import { v2, v2Send } from "../api.js";
import { useLoad } from "../hooks.js";
import { useToast } from "../toast.jsx";

const METRICS = [["calls", "Calls a day"], ["answered", "Answered calls a day"], ["quotations", "Quotations a day"]];

export default function Goals({ meta }) {
  const notify = useToast();
  const [version, setVersion] = useState(0);
  const { data, error } = useLoad(() => v2("/targets"), [version]);
  const people = meta.users.filter((u) => u.active);
  const find = (scope, metric) => data?.targets.find((t) => t.scope === scope && t.metric === metric)?.value;

  async function save(scope, metric, raw) {
    try {
      await v2Send("POST", "/targets", { scope, metric, value: raw === "" ? "" : Number(raw) });
      notify("Goal saved");
      setVersion((v) => v + 1);
    } catch (e) {
      notify(e.message);
    }
  }
  // Uncontrolled inputs keyed by their saved value, so they show the stored number after every save.
  const cell = (scope, metric, placeholder) => (
    <input key={`${scope}-${metric}-${find(scope, metric) ?? "x"}`} className="field-input goal-input" type="number" min="0" max="1000" inputMode="numeric"
           defaultValue={find(scope, metric) ?? ""} placeholder={placeholder} aria-label={`${scope === "default" ? "Everyone" : meta.users.find((u) => u.id === scope)?.name}: ${metric}`}
           onBlur={(e) => { const v = e.target.value; if (v !== String(find(scope, metric) ?? "")) save(scope, metric, v); }} />
  );
  if (error) return <p className="error">{error.message}</p>;
  return (
    <>
      <div className="work-head"><h1 className="work-title">Daily goals</h1></div>
      <p className="muted report-meta">These goals fill the gauges on each person's "My day" screen. Leave a person's box empty to use the goal for everyone. Changes save when you leave the box.</p>
      <div className="table-frame">
        <table className="grid">
          <thead><tr><th>Who</th>{METRICS.map(([k, label]) => <th key={k}>{label}</th>)}</tr></thead>
          <tbody>
            <tr><td><b>Everyone</b></td>{METRICS.map(([k]) => <td key={k}>{cell("default", k, "")}</td>)}</tr>
            {people.map((u) => (
              <tr key={u.id}><td>{u.name}</td>{METRICS.map(([k]) => <td key={k}>{cell(u.id, k, String(find("default", k) ?? ""))}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
