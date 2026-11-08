import React, { useEffect, useMemo, useState } from "react";
import { crmSend } from "../api.js";
import { useCrm, stageText } from "../crm.jsx";
import { useToast } from "../toast.jsx";
import { hashFor } from "../format.js";
import Icon from "../icons.jsx";
import LeadPanel from "./LeadDetail.jsx";
import { DAY, STAGES, STAGE_LABEL, buildModel, initials, money, startOfDay } from "./model.js";

// "Leads" in the Salesmax style: a toolbar, then a wide table with the lead and its call numbers, and a pager.
// Same class names as the reference web app, so its style sheet (cw/leads-grid.css) applies as written.

const PAGE = 24;
const COLUMNS = [
  ["owner", "Lead Owner"], ["stage", "Lead Stage"], ["awaiting", "Awaiting First Touch"], ["attempts", "Attempts"], ["total", "Total Calls"], ["today", "Calls Today"],
  ["last", "Last Worked"], ["started", "Started Work On"], ["speed", "Speed to First Call"], ["next", "Next Followup"], ["opp", "Became Opportunity"], ["source", "Source"], ["value", "Deal Value"],
];
const DEFAULT_HIDDEN = ["source", "value"];
const readHidden = () => {
  try {
    const saved = localStorage.getItem("salesdesk-cw-cols");
    return new Set(saved ? JSON.parse(saved) : DEFAULT_HIDDEN);
  } catch {
    return new Set(DEFAULT_HIDDEN);
  }
};
const sourceKind = (s) => (s === "WhatsApp" ? "wa" : s === "IndiaMART" ? "im" : s === "JustDial" ? "jd" : /Facebook/.test(s) ? "fb" : /Google/.test(s) ? "gg" : "other");
const short = (ms) => { const m = Math.round(ms / 60000); if (m < 60) return `${m}m`; const h = Math.round(m / 60); return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`; };
const agoShort = (t) => {
  if (t === null) return "";
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 60) return m < 1 ? "just now" : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`;
};
const dateOf = (t) => (t === null ? "" : new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" }));

function rowOf(l) {
  const now = Date.now(), t = startOfDay(now);
  const work = l.activities;
  const calls = work.filter((a) => a.kind === "call");
  const firstCall = calls.length ? Math.min(...calls.map((a) => a.at)) : null;
  const opp = l.activities.find((a) => a.kind === "stage" && /→ (Opportunity|Quotation given)/.test(a.text));
  let speed = { text: "—", tone: "none" };
  if (firstCall !== null) {
    const gap = Math.max(0, firstCall - l.createdAt);
    speed = gap < 10 * 60000 ? { text: "now", tone: "good" } : { text: "▲ " + short(gap), tone: "bad" };
  }
  let next = { text: "", tone: "none" };
  if (l.nextFollowUp !== null) next = l.nextFollowUp < now ? { text: `▲ ${short(now - l.nextFollowUp)} over`, tone: "over" } : { text: l.nextFollowUp < t + DAY ? "Today" : `in ${short(l.nextFollowUp - now)}`, tone: "plain" };
  return {
    lead: l, unassigned: !l.owner, repeat: l.repeat || calls.filter((a) => a.dir === "in").length >= 2, awaiting: !work.some((a) => a.kind === "call" || a.kind === "whatsapp"),
    attempts: calls.filter((a) => a.dir === "out").length, total: calls.length, today: calls.filter((a) => a.at >= t).length,
    last: work.length ? Math.max(...work.map((a) => a.at)) : null, started: work.length ? Math.min(...work.map((a) => a.at)) : null, speed, next, opp: opp ? opp.at : null,
  };
}

export default function LeadsGrid({ params }) {
  const crm = useCrm();
  const notify = useToast();
  const { queue = "", q = "", lead: openId = "" } = params;
  const [scope, setScope] = useState("all");
  const [stage, setStage] = useState("");
  const [menu, setMenu] = useState("");
  const [hidden, setHidden] = useState(readHidden);
  const [sortAsc, setSortAsc] = useState(null);
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState(q);
  const m = useMemo(() => (crm.state ? buildModel(crm) : null), [crm.state, crm.leads, crm.activities, crm.users, crm.nextDue]);
  useEffect(() => { const timer = setTimeout(() => text !== q && (location.hash = hashFor("/leads", { queue, q: text })), 250); return () => clearTimeout(timer); }, [text]);
  useEffect(() => setPage(0), [queue, q, scope, stage]);

  const today = startOfDay(Date.now());
  const inQueue = useMemo(() => {
    if (!m) return [];
    return m.leads.filter((l) => {
      const r = l.raw;
      if (queue === "" && r.stage === "Closed") return false;
      if (queue === "closed" && r.stage !== "Closed") return false;
      if (queue === "new" && r.stage !== "New") return false;
      if (queue === "untouched" && (r.firstTouchAt || r.stage === "Closed")) return false;
      if (queue === "unassigned" && r.owner) return false;
      return true;
    });
  }, [m, queue]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase(), digits = needle.replace(/\D/g, "");
    let list = inQueue.filter((l) => (scope === "all" || l.ownerId === crm.me.id) && (!stage || l.stage === stage)
      && (!needle || [l.name, l.company, l.source, l.owner].some((v) => String(v || "").toLowerCase().includes(needle)) || (digits.length > 2 && l.phone.replace(/\D/g, "").includes(digits))));
    if (sortAsc !== null) list = [...list].sort((a, b) => (sortAsc ? 1 : -1) * a.name.localeCompare(b.name));
    else list = [...list].sort((a, b) => b.createdAt - a.createdAt);
    return list.map(rowOf);
  }, [inQueue, q, scope, stage, sortAsc, crm.me.id]);
  if (!crm.state) return <p className="muted">{crm.error || "Loading leads…"}</p>;

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const show = (id) => !hidden.has(id);
  const allPicked = shown.length > 0 && shown.every((r) => picked.has(r.lead.id));
  const toggleCol = (id) => setHidden((h) => {
    const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id);
    try { localStorage.setItem("salesdesk-cw-cols", JSON.stringify([...n])); } catch { /* the choice then lasts for this visit only */ }
    return n;
  });
  const revert = () => { setHidden(new Set(DEFAULT_HIDDEN)); setScope("all"); setStage(""); setSortAsc(null); setText(""); try { localStorage.removeItem("salesdesk-cw-cols"); } catch { /* ignore */ } location.hash = hashFor("/leads", { queue }); };
  const toggleAll = () => setPicked((p) => { const n = new Set(p); shown.forEach((r) => (allPicked ? n.delete(r.lead.id) : n.add(r.lead.id))); return n; });
  const togglePick = (id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const stageCount = (s) => inQueue.filter((l) => !s || l.stage === s).length;
  const label = queue === "new" ? "New Leads" : queue === "untouched" ? "Not Worked" : queue === "unassigned" ? "No Owner" : queue === "all" ? "All Leads" : queue === "closed" ? "Closed" : "All Active";
  const team = crm.me.users.filter((u) => u.active !== false);

  async function assign(personId) {
    const targets = picked.size ? rows.filter((r) => picked.has(r.lead.id)) : shown.filter((r) => r.unassigned);
    if (!targets.length) return notify("No leads to give out here");
    if (!personId && !team.length) return notify("There is nobody to assign to");
    setBusy(true);
    try {
      for (let i = 0; i < targets.length; i++) await crmSend("PATCH", `leads/${targets[i].lead.id}`, { owner: personId || team[i % team.length].id });
      await crm.reload();
      setPicked(new Set());
      setMenu("");
      notify(`${targets.length} lead${targets.length === 1 ? "" : "s"} assigned`);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  const open = (id) => (location.hash = hashFor("/leads", { queue, q, lead: id }));
  return (
    <div className="cw-grid">
      <div className="grid-card">
        <div className="bar">
          <label className="chk" aria-label="Select all on this page"><input type="checkbox" checked={allPicked} onChange={toggleAll} /></label>
          {crm.me.lead && <div className="seg" role="group" aria-label="Whose leads">{[["my", "My"], ["all", "All"]].map(([k, t]) => <button key={k} type="button" className={scope === k ? "on" : ""} onClick={() => setScope(k)}>{t}</button>)}</div>}
          <button type="button" className="ic-btn" aria-label="Filter by stage" onClick={() => setMenu(menu === "stage" ? "" : "stage")}><Icon name="funnel" size={17} /></button>
          <div className="drop">
            <button type="button" className="view-pick" aria-expanded={menu === "stage"} onClick={() => setMenu(menu === "stage" ? "" : "stage")}>
              <b>{stage ? STAGE_LABEL[stage] : label}</b><span className="count">{rows.length}</span><Icon name="swap" size={15} />
            </button>
            {menu === "stage" && (
              <div className="pop" role="menu">
                <button type="button" role="menuitem" className={!stage ? "on" : ""} onClick={() => { setStage(""); setMenu(""); }}>{label} <span>{stageCount("")}</span></button>
                {STAGES.map((s) => <button key={s} type="button" role="menuitem" className={stage === s ? "on" : ""} onClick={() => { setStage(s); setMenu(""); }}>{STAGE_LABEL[s]} <span>{stageCount(s)}</span></button>)}
              </div>
            )}
          </div>
          {picked.size > 0 && <span className="picked">{picked.size} selected</span>}
          <div className="bar__right">
            <label className="search"><Icon name="search" size={16} /><input type="search" placeholder="Name, phone, email, business..." value={text} onChange={(e) => setText(e.target.value)} aria-label="Search leads" /></label>
            <div className="drop">
              <button type="button" className="tool" onClick={() => setMenu(menu === "cols" ? "" : "cols")}><Icon name="leads" size={14} /> Columns</button>
              {menu === "cols" && <div className="pop pop--right" role="menu">{COLUMNS.map(([id, name]) => <label key={id} className="pop__chk"><input type="checkbox" checked={show(id)} onChange={() => toggleCol(id)} /> {name}</label>)}</div>}
            </div>
            {crm.me.lead && (
              <div className="drop">
                <button type="button" className="tool" onClick={() => setMenu(menu === "assign" ? "" : "assign")}><Icon name="again" size={14} /> Quick Assign</button>
                {menu === "assign" && (
                  <div className="pop pop--right" role="menu">
                    <small className="pop__note">{picked.size ? `Give the ${picked.size} selected leads to` : "Give the unassigned leads on this page to"}</small>
                    <button type="button" role="menuitem" disabled={busy} onClick={() => assign("")}><Icon name="again" size={14} /> Round robin across the team</button>
                    {team.map((u) => <button key={u.id} type="button" role="menuitem" disabled={busy} onClick={() => assign(u.id)}>{u.name}</button>)}
                  </div>
                )}
              </div>
            )}
            <button type="button" className="tool" onClick={revert}>Revert to Default</button>
          </div>
        </div>

        <div className="scroll" onClick={() => menu && setMenu("")}>
          <table>
            <thead>
              <tr>
                <th className="sticky name-col"><span className="th">Lead Name <button type="button" className="sort" aria-label="Sort by name" onClick={() => setSortAsc(sortAsc === null ? true : sortAsc ? false : null)}><Icon name="funnel" size={14} /></button></span></th>
                {COLUMNS.filter(([id]) => show(id)).map(([id, name]) => <th key={id}><span className="th"><Icon name="trend" size={13} />{name}</span></th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.lead.id} className={picked.has(r.lead.id) || r.lead.id === openId ? "on" : ""}>
                  <td className="sticky name-col">
                    <span className="name">
                      <input type="checkbox" checked={picked.has(r.lead.id)} onChange={() => togglePick(r.lead.id)} aria-label={`Select ${r.lead.name}`} />
                      <i className={`src src--${sourceKind(r.lead.source)}`} title={r.lead.source}>{sourceKind(r.lead.source) === "wa" ? <Icon name="chat" size={13} /> : sourceKind(r.lead.source) === "other" ? "+" : r.lead.source[0]}</i>
                      <button type="button" className="name__link" onClick={() => open(r.lead.id)}>{r.lead.name}</button>
                      {r.unassigned && <em className="tag">Unassigned</em>}
                      {r.repeat && <em className="tag tag--repeat">Repeat</em>}
                    </span>
                  </td>
                  {show("owner") && <td>{r.lead.owner ? <span className="owner"><i>{initials(r.lead.owner)}</i>{r.lead.owner}</span> : <span className="muted">—</span>}</td>}
                  {show("stage") && <td><em className={`stage stage--${r.lead.stage.toLowerCase()}`}>{stageText(r.lead.raw)}</em></td>}
                  {show("awaiting") && <td>{r.awaiting ? "Not Worked Yet" : ""}</td>}
                  {show("attempts") && <td className="c"><span className={`chip ${r.attempts > 0 && r.attempts < 10 ? "chip--good" : r.attempts >= 10 ? "chip--bad" : ""}`}>{r.attempts >= 10 ? `▲ ${r.attempts}` : r.attempts || "—"}</span></td>}
                  {show("total") && <td className="c">{r.total || ""}</td>}
                  {show("today") && <td className="c">{r.today || ""}</td>}
                  {show("last") && <td>{agoShort(r.last)}</td>}
                  {show("started") && <td>{agoShort(r.started)}</td>}
                  {show("speed") && <td className="c"><span className={`chip chip--wide ${r.speed.tone === "good" ? "chip--good" : r.speed.tone === "bad" ? "chip--bad" : ""}`}>{r.speed.text}</span></td>}
                  {show("next") && <td>{r.next.tone === "over" ? <span className="over">{r.next.text}</span> : r.next.text}</td>}
                  {show("opp") && <td>{dateOf(r.opp)}</td>}
                  {show("source") && <td>{r.lead.source}</td>}
                  {show("value") && <td>{money(r.lead.value)}</td>}
                </tr>
              ))}
              {!shown.length && <tr><td className="none" colSpan={14}>No leads match these filters.</td></tr>}
            </tbody>
          </table>
        </div>

        <footer className="pager">
          <span>{rows.length ? page * PAGE + 1 : 0} to {Math.min(rows.length, (page + 1) * PAGE)} of {rows.length.toLocaleString("en-IN")}</span>
          <button type="button" aria-label="First page" disabled={page === 0} onClick={() => setPage(0)}>|‹</button>
          <button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button>
          <span>Page <b>{page + 1}</b> of <b>{pages}</b></span>
          <button type="button" aria-label="Next page" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>›</button>
          <button type="button" aria-label="Last page" disabled={page >= pages - 1} onClick={() => setPage(pages - 1)}>›|</button>
        </footer>
      </div>
      {openId && <LeadPanel id={openId} onClose={() => (location.hash = hashFor("/leads", { queue, q }))} />}
    </div>
  );
}
