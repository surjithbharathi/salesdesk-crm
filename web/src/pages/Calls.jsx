import React, { useMemo, useState } from "react";
import { useCrm, userName } from "../crm.jsx";
import { hashFor, when, minutes, plural } from "../format.js";

const FILTERS = [["", "All calls"], ["Outgoing", "Called"], ["Incoming", "Received"], ["Missed", "Missed"]];

export default function Calls() {
  const crm = useCrm();
  const [filter, setFilter] = useState("");
  const [shown, setShown] = useState(100);
  const rows = useMemo(
    () => (crm.state ? crm.calls.filter((c) => !filter || c.direction === filter).sort((a, b) => b.startedAt - a.startedAt) : []),
    [crm.state, crm.calls, filter],
  );
  if (!crm.state) return <p className="muted">{crm.error || "Loading calls…"}</p>;
  return (
    <>
      <div className="work-head">
        <h1 className="work-title">Calls</h1>
        <span className="work-date num">{plural(rows.length, "call")}</span>
      </div>
      <div className="bar">
        <div className="pills" role="group" aria-label="Kind of call">
          {FILTERS.map(([key, label]) => <button key={key || "all"} className="pill" aria-pressed={filter === key} onClick={() => { setFilter(key); setShown(100); }}>{label}</button>)}
        </div>
      </div>
      <div className="table-frame">
        <table className="grid">
          <thead><tr><th>When</th><th>Lead</th><th>Kind</th><th>Talk time</th>{crm.me.lead && <th>Owner</th>}</tr></thead>
          <tbody>
            {rows.slice(0, shown).map((c) => {
              const lead = crm.leadById.get(c.leadId);
              return (
                <tr key={c.id}>
                  <td>{when(new Date(c.startedAt).toISOString())}</td>
                  <td>{lead ? <b><a href={hashFor("/leads", { lead: lead.id })}>{lead.name}</a></b> : <span className="muted">{c.phone}</span>}</td>
                  <td>{c.direction === "Outgoing" ? "Called" : c.direction === "Incoming" ? "Received" : c.direction}</td>
                  <td className="num">{c.duration > 0 ? minutes(Math.max(1, Math.round(c.duration / 60))) : <span className="muted">Not answered</span>}</td>
                  {crm.me.lead && <td>{lead ? userName(crm, lead.owner) : ""}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <div className="empty"><b>No calls yet</b>Calls made from the phone app appear here once they sync.</div>}
      </div>
      {rows.length > shown && <p className="keys"><button className="btn" onClick={() => setShown((n) => n + 100)}>Show more calls ({rows.length - shown} left)</button></p>}
    </>
  );
}
