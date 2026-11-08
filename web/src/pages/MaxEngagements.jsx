import React, { useMemo, useState } from "react";
import { useCrm, userName, stageText } from "../crm.jsx";
import { initials } from "../format.js";
import Icon from "../icons.jsx";
import Calls from "./Calls.jsx";
import LeadPanel from "./LeadPanel.jsx";
import { ms, relTime } from "./tele.js";

// "Engagements" in the Salesmax style: everything the team did with leads, newest first. The Calls tab is the call list with recordings.

const PAGE = 25;
const ICON = { Call: "phone", Note: "note", WhatsApp: "chat" };

export default function MaxEngagements({ params }) {
  const crm = useCrm();
  const [scope, setScope] = useState("all");
  const [find, setFind] = useState("");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState("");
  const rows = useMemo(() => {
    if (!crm.state) return [];
    const needle = find.trim().toLowerCase();
    return crm.activities
      .filter((a) => a.type !== "System" && (scope === "all" || a.userId === crm.me.id))
      .map((a) => ({ a, lead: crm.leadById.get(a.leadId), at: ms(a.occurredAt || a.createdAt) }))
      .filter(({ a, lead }) => lead && (!needle || `${lead.name} ${a.text || ""}`.toLowerCase().includes(needle)))
      .sort((x, y) => y.at - x.at);
  }, [crm.state, crm.activities, crm.me.id, scope, find]);
  if (params.tab === "calls") return <Calls />;
  if (!crm.state) return <p className="muted">{crm.error || "Loading engagements…"}</p>;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const slice = rows.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <>
      <section className="max-card" aria-label="Engagements">
        <div className="max-tools">
          {crm.me.lead && (
            <span className="max-toggle" role="group" aria-label="Whose engagements">
              {[["all", "All"], ["mine", "My"]].map(([key, label]) => <button key={key} aria-pressed={scope === key} onClick={() => { setScope(key); setPage(0); }}>{label}</button>)}
            </span>
          )}
          <label className="max-find">
            <Icon name="search" size={14} /><span className="sr">Search engagements</span>
            <input type="search" placeholder="Search lead or note…" value={find} onChange={(e) => { setFind(e.target.value); setPage(0); }} />
          </label>
        </div>
        <div className="max-table-wrap">
          <table className="max-table">
            <thead><tr><th>Lead</th><th>Lead source</th><th>Type</th><th>What happened</th><th>By</th><th>When</th></tr></thead>
            <tbody>
              {slice.map(({ a, lead, at }) => (
                <tr key={a.id}>
                  <td><span className="max-lead"><span className="avatar">{initials(lead.name)}</span><button className="max-link" onClick={() => setOpenId(lead.id)}>{lead.name}</button></span> <span className="max-stage-text">{stageText(lead)}</span></td>
                  <td>{lead.source}</td>
                  <td><span className="max-type"><Icon name={ICON[a.type] || "dot"} size={14} />{a.type}</span></td>
                  <td className="max-what">{a.text}</td>
                  <td>{a.userId ? <span className="max-owner"><span className="avatar">{initials(userName(crm, a.userId))}</span>{userName(crm, a.userId)}</span> : <span className="muted">—</span>}</td>
                  <td>{relTime(at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <div className="empty"><b>Nothing logged yet</b>Calls, notes and messages with leads show up here.</div>}
        </div>
        <footer className="max-foot">
          <span className="num">{rows.length ? `${page * PAGE + 1} to ${Math.min(rows.length, page * PAGE + PAGE)} of ${rows.length.toLocaleString("en-IN")}` : "0 engagements"}</span>
          <button className="btn btn-quiet" onClick={() => setPage(0)} disabled={page === 0} aria-label="First page">«</button>
          <button className="btn btn-quiet" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label="Previous page">‹</button>
          <span className="num">Page {page + 1} of {pages}</span>
          <button className="btn btn-quiet" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} aria-label="Next page">›</button>
          <button className="btn btn-quiet" onClick={() => setPage(pages - 1)} disabled={page >= pages - 1} aria-label="Last page">»</button>
        </footer>
      </section>
      {openId && <LeadPanel id={openId} onClose={() => setOpenId("")} />}
    </>
  );
}
