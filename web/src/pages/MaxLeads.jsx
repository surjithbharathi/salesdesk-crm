import React, { useEffect, useMemo, useState } from "react";
import { useCrm, userName, stageText, STAGES } from "../crm.jsx";
import { hashFor, initials } from "../format.js";
import Icon from "../icons.jsx";
import LeadPanel from "./LeadPanel.jsx";

const SIZES = [20, 50, 100];
const stageClass = (l) => (l.stage === "Closed" ? (l.disposition === "Won" ? "won" : "lost") : "");

// "Active leads" in the Salesmax style: a toolbar, then a table of lead, owner, stage and whether it has been worked yet,
// and "1 to 13 of 4,532, Page 1 of 349" at the foot.
export default function MaxLeads({ params }) {
  const crm = useCrm();
  const { queue = "", stage = "", source = "", owner = "", q = "", lead: openId = "" } = params;
  const [text, setText] = useState(q);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const set = (change) => (location.hash = hashFor("/leads", { queue, stage, source, owner, q, lead: openId, ...change }));
  useEffect(() => {
    const timer = setTimeout(() => text !== q && set({ q: text }), 250);
    return () => clearTimeout(timer);
  }, [text]);
  useEffect(() => setPage(0), [queue, stage, source, owner, q, size]);
  const todayMs = new Date().setHours(0, 0, 0, 0);
  const items = useMemo(() => {
    if (!crm.state) return [];
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    return crm.leads
      .filter((l) => {
        if (l.archived) return false;
        if (queue === "" && l.stage === "Closed") return false;
        if (queue === "closed" && l.stage !== "Closed") return false;
        if (queue === "new" && l.stage !== "New") return false;
        if (queue === "untouched" && (l.firstTouchAt || l.stage === "Closed")) return false;
        if (queue === "unassigned" && l.owner) return false;
        if (queue === "late" && !(crm.nextDue.get(l.id) && Date.parse(crm.nextDue.get(l.id)) < todayMs)) return false;
        if (stage && l.stage !== stage) return false;
        if (source && l.source !== source) return false;
        if (owner && (owner === "none" ? l.owner : l.owner !== owner)) return false;
        if (needle && !`${l.name} ${l.company || ""} ${l.city || ""}`.toLowerCase().includes(needle) && !(digits.length > 2 && String(l.phone || "").replace(/\D/g, "").includes(digits))) return false;
        return true;
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }, [crm.state, crm.leads, queue, stage, source, owner, q, todayMs]);
  if (!crm.state) return <p className="muted">{crm.error || "Loading leads…"}</p>;
  const sources = [...new Set(crm.leads.map((l) => l.source).filter(Boolean))].sort();
  const first = page * size;
  const rows = items.slice(first, first + size);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const label = { "": "Active", all: "All", new: "New", unassigned: "No owner", untouched: "Not worked", late: "Late", closed: "Closed" }[queue] || "Active";
  return (
    <>
      <section className="max-card" aria-label="Leads">
        <div className="max-tools">
          <span className="max-chipbtn">{label}<b className="num">{items.length.toLocaleString("en-IN")}</b></span>
          <label className="max-find">
            <Icon name="search" size={14} /><span className="sr">Search name or phone</span>
            <input type="search" placeholder="Search name or phone…" value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <select className="max-search" value={stage} onChange={(e) => set({ stage: e.target.value, lead: "" })} aria-label="Stage">
            <option value="">Any stage</option>
            {STAGES.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </select>
          <select className="max-search" value={source} onChange={(e) => set({ source: e.target.value, lead: "" })} aria-label="Source">
            <option value="">Any source</option>
            {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {crm.me.lead && (
            <select className="max-search" value={owner} onChange={(e) => set({ owner: e.target.value, lead: "" })} aria-label="Owner">
              <option value="">Any owner</option>
              <option value="none">No owner</option>
              {crm.me.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          {(stage || source || owner || q) && <button className="btn btn-quiet" onClick={() => { setText(""); location.hash = hashFor("/leads", { queue }); }}>Revert to default</button>}
        </div>
        <div className="max-table-wrap">
          <table className="max-table">
            <thead><tr><th>Lead name</th><th>Lead owner</th><th>Lead stage</th><th>Awaiting first touch</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} aria-selected={l.id === openId}>
                  <td><span className="max-lead"><span className="avatar">{initials(l.name)}</span><a href={hashFor("/leads", { queue, stage, source, owner, q, lead: l.id })}>{l.name}</a></span></td>
                  <td>{l.owner ? <span className="max-owner"><span className="avatar">{initials(userName(crm, l.owner))}</span>{userName(crm, l.owner)}</span> : <span className="muted">No owner yet</span>}</td>
                  <td><span className={`max-stage ${stageClass(l)}`}>{stageText(l)}</span></td>
                  <td>{!l.firstTouchAt && l.stage !== "Closed" ? "Not worked yet" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && <div className="empty"><b>No leads match</b>Try another view, or revert to the default.</div>}
        </div>
        <footer className="max-foot">
          <span className="num">{items.length ? `${first + 1} to ${Math.min(items.length, first + size)} of ${items.length.toLocaleString("en-IN")}` : "0 leads"}</span>
          <label><span className="sr">Rows per page</span>
            <select className="max-search" value={size} onChange={(e) => setSize(Number(e.target.value))}>{SIZES.map((n) => <option key={n} value={n}>{n} / page</option>)}</select>
          </label>
          <button className="btn btn-quiet" onClick={() => setPage(0)} disabled={page === 0} aria-label="First page">«</button>
          <button className="btn btn-quiet" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label="Previous page">‹</button>
          <span className="num">Page {page + 1} of {pages}</span>
          <button className="btn btn-quiet" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} aria-label="Next page">›</button>
          <button className="btn btn-quiet" onClick={() => setPage(pages - 1)} disabled={page >= pages - 1} aria-label="Last page">»</button>
        </footer>
      </section>
      {openId && <LeadPanel id={openId} onClose={() => set({ lead: "" })} />}
    </>
  );
}
