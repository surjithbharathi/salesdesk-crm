import React, { useEffect, useMemo, useState } from "react";
import { crmSend } from "../api.js";
import { useCrm, userName, stageText, STAGES } from "../crm.jsx";
import { useToast } from "../toast.jsx";
import { hashFor, initials, rupees } from "../format.js";
import Icon from "../icons.jsx";
import LeadPanel from "./LeadPanel.jsx";
import { lastWorkedMap, relTime } from "./tele.js";

const SIZES = [20, 50, 100];
// columns people can add to the table; the choice is kept in this browser
const EXTRA = [["calls", "Total calls"], ["source", "Lead source"], ["value", "Value"], ["next", "Next follow-up"], ["worked", "Last worked"]];
const readCols = () => {
  try {
    const saved = localStorage.getItem("salesdesk-max-cols");
    return saved ? JSON.parse(saved).filter((k) => EXTRA.some(([id]) => id === k)) : ["calls"];
  } catch {
    return ["calls"];
  }
};
const stageClass = (l) => (l.stage === "Closed" ? (l.disposition === "Won" ? "won" : "lost") : { New: "fresh", Prospecting: "talk", Opportunity: "keen", "Quotation given": "quote" }[l.stage] || "");

// "Active leads" in the Salesmax style: a toolbar, then a table of lead, owner, stage and whether it has been worked yet,
// and "1 to 13 of 4,532, Page 1 of 349" at the foot.
export default function MaxLeads({ params }) {
  const crm = useCrm();
  const notify = useToast();
  const { queue = "", stage = "", source = "", owner = "", q = "", lead: openId = "" } = params;
  const [text, setText] = useState(q);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const [cols, setCols] = useState(readCols);
  const [picked, setPicked] = useState(() => new Set());
  const [assigning, setAssigning] = useState(false);
  const worked = useMemo(() => lastWorkedMap(crm.activities), [crm.activities]);
  const callCount = useMemo(() => {
    const map = new Map();
    for (const c of crm.calls || []) map.set(c.leadId, (map.get(c.leadId) || 0) + 1);
    return map;
  }, [crm.calls]);
  const toggleCol = (id) => {
    const next = cols.includes(id) ? cols.filter((c) => c !== id) : [...cols, id];
    setCols(next);
    try {
      localStorage.setItem("salesdesk-max-cols", JSON.stringify(next));
    } catch {
      /* the choice then lasts for this visit only */
    }
  };
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
  // Quick assign: give the ticked leads (or, with none ticked, the leads on this page that have no owner) to one person, or share them round robin
  async function assign(person) {
    const team = crm.me.users.filter((u) => u.active !== false);
    const targets = picked.size ? items.filter((l) => picked.has(l.id)) : rows.filter((l) => !l.owner);
    if (!targets.length) return notify("No leads to give out here");
    if (!person && !team.length) return notify("There is nobody to assign to");
    setAssigning(true);
    try {
      for (let i = 0; i < targets.length; i++) await crmSend("PATCH", `leads/${targets[i].id}`, { owner: person || team[i % team.length].id });
      await crm.reload();
      setPicked(new Set());
      notify(`${targets.length} lead${targets.length === 1 ? "" : "s"} assigned`);
    } catch (e) {
      notify(e.message);
    } finally {
      setAssigning(false);
    }
  }
  const allPicked = rows.length > 0 && rows.every((l) => picked.has(l.id));
  const togglePage = () => setPicked(allPicked ? new Set() : new Set(rows.map((l) => l.id)));
  const toggleOne = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
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
          {picked.size > 0 && <span className="muted num">{picked.size} selected</span>}
          <span className="max-spacer" />
          <details className="max-menu">
            <summary className="max-chipbtn">Columns</summary>
            <div className="max-menu-list">
              {EXTRA.map(([id, name]) => <label key={id}><input type="checkbox" checked={cols.includes(id)} onChange={() => toggleCol(id)} /> {name}</label>)}
            </div>
          </details>
          {crm.me.lead && (
            <details className="max-menu">
              <summary className="max-chipbtn">Quick assign</summary>
              <div className="max-menu-list">
                <small className="muted">{picked.size ? `Give the ${picked.size} selected leads to` : "Give the leads without an owner on this page to"}</small>
                <button className="btn btn-quiet" disabled={assigning} onClick={() => assign("")}>Share round robin across the team</button>
                {crm.me.users.filter((u) => u.active !== false).map((u) => <button key={u.id} className="btn btn-quiet" disabled={assigning} onClick={() => assign(u.id)}>{u.name}</button>)}
              </div>
            </details>
          )}
          {(stage || source || owner || q) && <button className="btn btn-quiet" onClick={() => { setText(""); location.hash = hashFor("/leads", { queue }); }}>Revert to default</button>}
        </div>
        <div className="max-table-wrap">
          <table className="max-table">
            <thead><tr><th className="max-check"><input type="checkbox" checked={allPicked} onChange={togglePage} aria-label="Select all leads on this page" /></th><th>Lead name</th><th>Lead owner</th><th>Lead stage</th><th>Awaiting first touch</th>{EXTRA.filter(([id]) => cols.includes(id)).map(([id, name]) => <th key={id}>{name}</th>)}</tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} aria-selected={l.id === openId || picked.has(l.id)}>
                  <td className="max-check"><input type="checkbox" checked={picked.has(l.id)} onChange={() => toggleOne(l.id)} aria-label={`Select ${l.name}`} /></td>
                  <td><span className="max-lead"><span className="avatar">{initials(l.name)}</span><a href={hashFor("/leads", { queue, stage, source, owner, q, lead: l.id })}>{l.name}</a>{!l.owner && <em className="max-tag">Unassigned</em>}{l.repeat && <em className="max-tag repeat">Repeat</em>}</span></td>
                  <td>{l.owner ? <span className="max-owner"><span className="avatar">{initials(userName(crm, l.owner))}</span>{userName(crm, l.owner)}</span> : <span className="muted">No owner yet</span>}</td>
                  <td><span className={`max-stage ${stageClass(l)}`}>{stageText(l)}</span></td>
                  <td>{!l.firstTouchAt && l.stage !== "Closed" ? "Not worked yet" : ""}</td>
                  {cols.includes("calls") && <td className="num">{callCount.get(l.id) || ""}</td>}
                  {cols.includes("source") && <td>{l.source}</td>}
                  {cols.includes("value") && <td className="num">{l.value ? rupees(l.value) : ""}</td>}
                  {cols.includes("next") && <td>{crm.nextDue.get(l.id) ? new Date(crm.nextDue.get(l.id)).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : ""}</td>}
                  {cols.includes("worked") && <td>{worked.get(l.id) ? relTime(worked.get(l.id)) : ""}</td>}
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
