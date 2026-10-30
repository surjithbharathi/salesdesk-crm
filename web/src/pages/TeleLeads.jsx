import React, { useEffect, useMemo, useState } from "react";
import { useCrm, userName, stageText, STAGES } from "../crm.jsx";
import { hashFor, initials, plural } from "../format.js";
import Icon from "../icons.jsx";
import LeadPanel from "./LeadPanel.jsx";
import { absTime, relTime, tagClass } from "./tele.js";

const SIZES = [20, 50, 100];

// "All Views" in the TeleCRM style: saved views as tabs, filters and a name search above a table, and the number of the page at the foot.
export default function TeleLeads({ params }) {
  const crm = useCrm();
  const { queue = "", stage = "", source = "", owner = "", q = "", lead: openId = "" } = params;
  const [text, setText] = useState(q);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const [picked, setPicked] = useState([]);
  const me = crm.me.id;
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
  const views = [
    ["all-active", "All active leads", { queue: "", owner: "" }, !queue && !owner],
    ["mine", "Leads assigned to me", { queue: "", owner: me }, !queue && owner === me],
    ["all", "All leads", { queue: "all", owner: "" }, queue === "all" && !owner],
    ["new", "New leads", { queue: "new", owner: "" }, queue === "new" && !owner],
    ...(crm.me.lead ? [["none", "Leads with no owner", { queue: "unassigned", owner: "" }, queue === "unassigned"]] : []),
  ];
  const filters = [stage, source, owner && !views.some((v) => v[3] && v[2].owner === owner) ? owner : ""].filter(Boolean).length;
  const first = page * size;
  const rows = items.slice(first, first + size);
  const last = Math.min(items.length, first + size);
  const allOn = rows.length > 0 && rows.every((l) => picked.includes(l.id));
  return (
    <>
      <div className="work-head"><h1 className="work-title">All views</h1></div>
      <div className="tele-views" role="tablist" aria-label="Views">
        {views.map(([key, label, change, on]) => (
          <button key={key} role="tab" className="tele-view" aria-selected={on} onClick={() => set({ ...change, stage: "", source: "", lead: "" })}>{label}</button>
        ))}
      </div>
      <div className="tele-bar">
        <details className="tele-filters">
          <summary><Icon name="leads" size={14} />Filters{filters ? <span className="tele-badge">{filters}</span> : null}</summary>
          <div className="tele-filter-pop">
            <label>Stage
              <select value={stage} onChange={(e) => set({ stage: e.target.value, lead: "" })}>
                <option value="">Any stage</option>
                {STAGES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <label>Source
              <select value={source} onChange={(e) => set({ source: e.target.value, lead: "" })}>
                <option value="">Any source</option>
                {sources.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            {crm.me.lead && (
              <label>Owner
                <select value={owner} onChange={(e) => set({ owner: e.target.value, lead: "" })}>
                  <option value="">Any owner</option>
                  <option value="none">No owner</option>
                  {crm.me.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
            )}
            <button className="btn btn-quiet" onClick={() => { setText(""); location.hash = hashFor("/leads"); }}>Clear all</button>
          </div>
        </details>
        <label className="tele-search tele-search-inline">
          <Icon name="search" size={14} /><span className="sr">Search lead</span>
          <input type="search" placeholder="Search lead" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <span className="tele-count">{plural(items.length, "lead")}</span>
        <span className="tele-spacer" />
        {picked.length > 0 && <span className="tele-count">{picked.length} selected</span>}
      </div>
      <div className="tele-leads-wrap">
        <table className="tele-leads">
          <thead>
            <tr>
              <th className="tele-check"><input type="checkbox" aria-label="Select all on this page" checked={allOn} onChange={(e) => setPicked(e.target.checked ? [...new Set([...picked, ...rows.map((l) => l.id)])] : picked.filter((id) => !rows.some((l) => l.id === id)))} /></th>
              <th>Name</th><th>Status</th><th>Assignee</th><th>Created on</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} aria-selected={l.id === openId}>
                <td className="tele-check"><input type="checkbox" aria-label={`Select ${l.name}`} checked={picked.includes(l.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, l.id] : picked.filter((id) => id !== l.id))} /></td>
                <td><a className="tele-lead-link" href={hashFor("/leads", { queue, stage, source, owner, q, lead: l.id })}>{l.name}</a></td>
                <td><span className={`tag ${tagClass(l)}`}>{stageText(l)}</span></td>
                <td>{l.owner ? <span className="tele-person"><span className="avatar">{initials(userName(crm, l.owner))}</span>{userName(crm, l.owner)}</span> : <span className="muted">No owner yet</span>}</td>
                <td><b className="tele-rel">{relTime(l.createdAt)}</b><small className="muted">{absTime(l.createdAt)}</small></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <div className="tele-empty"><Icon name="note" size={44} /><p>No leads match. Try another view or clear the filters.</p></div>}
      </div>
      <footer className="tele-pager">
        <span className="num">{items.length ? `${first + 1}–${last} of ${items.length.toLocaleString("en-IN")}` : "0 leads"}</span>
        <button className="btn btn-quiet" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label="Previous page">‹</button>
        <button className="btn btn-quiet" onClick={() => setPage((p) => p + 1)} disabled={last >= items.length} aria-label="Next page">›</button>
        <label className="tele-filter"><span className="sr">Rows per page</span>
          <select value={size} onChange={(e) => setSize(Number(e.target.value))}>{SIZES.map((n) => <option key={n} value={n}>{n} / page</option>)}</select>
        </label>
      </footer>
      {openId && <LeadPanel id={openId} onClose={() => set({ lead: "" })} />}
    </>
  );
}
