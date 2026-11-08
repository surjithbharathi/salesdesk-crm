import React, { useMemo, useState } from "react";
import { crmSend } from "../api.js";
import { useCrm } from "../crm.jsx";
import { useToast } from "../toast.jsx";
import { hashFor, initials } from "../format.js";
import { PIPELINE, pipelineStep } from "../pipeline.js";
import { TIcon } from "./icons.jsx";
import LeadPanel, { LeadDetail } from "./LeadDetail.jsx";

// My Calls, Search, Follow Ups and Reports in the TeleCRM style. The class names are the reference web app's
// (the style sheets are cwt/pages.css and cwt/crm.css); the data is this CRM's own.

const statusOf = (l) => (l.stage === "New" ? "New" : pipelineStep(l) || "New");
const statusClass = (l) => (l.stage === "Closed" ? (l.disposition === "Won" ? "won" : "lost") : l.stage === "New" ? "new" : "");
const ago = (t) => { const m = Math.floor((Date.now() - t) / 60000); if (m < 1) return "just now"; if (m < 60) return `${m}m ago`; const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`; const d = Math.floor(h / 24); return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`; };
const when = (iso) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const hmsOf = (s) => `${Math.floor(s / 3600)}h:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m:${String(s % 60).padStart(2, "0")}s`;
const fmt = (s) => { const h = Math.floor(s / 3600); return h ? `${h}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m ${s % 60}s`; };
const phoneText = (p) => String(p || "").replace(/\s|\+/g, "");

// ---------------------------------------------------------------- My Calls
const CALL_FILTERS = [["", "All"], ["Outgoing", "Called"], ["Incoming", "Received"], ["Missed", "Missed"], ["rec", "With recording"]];
export function CwtCalls() {
  const crm = useCrm();
  const [filter, setFilter] = useState("");
  const [shown, setShown] = useState(60);
  const [pick, setPick] = useState("");
  const rows = useMemo(() => (crm.state ? crm.calls.filter((c) => !filter || (filter === "rec" ? c.recordingId : c.direction === filter)).sort((a, b) => b.startedAt - a.startedAt) : []), [crm.state, crm.calls, filter]);
  if (!crm.state) return <p className="muted">{crm.error || "Loading calls…"}</p>;
  const chosen = rows.find((c) => c.id === pick) || rows[0];
  return (
    <div className="cwt-calls">
      <div className="wrap">
        <div className="list-col">
          <h1>My Calls <button type="button" className="refresh" onClick={() => crm.reload()} aria-label="Refresh"><TIcon name="refresh" /></button></h1>
          <div className="filters-row">{CALL_FILTERS.map(([k, label]) => <button key={k || "all"} type="button" className={filter === k ? "on" : ""} onClick={() => { setFilter(k); setShown(60); }}>{label}</button>)}</div>
          {rows.slice(0, shown).map((c) => {
            const l = crm.leadById.get(c.leadId);
            const answered = c.duration > 0;
            return (
              <div key={c.id} className={`card ${chosen?.id === c.id ? "on" : ""}`} role="button" tabIndex={0} onClick={() => setPick(c.id)} onKeyDown={(e) => e.key === "Enter" && setPick(c.id)}>
                <h3>{l ? l.name : c.phone}</h3>
                <p className="ph">{phoneText(c.phone)}</p>
                {l && <p className="st-line">Status: <span className={`st ${statusClass(l)}`}>{statusOf(l)}</span></p>}
                <div className="call">
                  <span className={`ci ${answered ? "ok" : ""}`}><TIcon name="phone" /><i>{answered ? (c.direction === "Incoming" ? "↙" : "↗") : "✕"}</i></span>
                  <div>{answered && <b>{hmsOf(c.duration)}</b>} <em>{ago(c.startedAt)}</em>{answered && <div className="cs">CONNECTED</div>}{c.recordingId && <div className="cs">RECORDING</div>}</div>
                </div>
              </div>
            );
          })}
          {rows.length > shown && <button type="button" className="crm-btn ghost" onClick={() => setShown((n) => n + 60)}>Show more calls ({rows.length - shown} left)</button>}
          {!rows.length && <p className="none">No calls yet.</p>}
        </div>
        <div className="detail-col">{chosen?.leadId && crm.leadById.get(chosen.leadId) ? <LeadDetail id={chosen.leadId} key={chosen.leadId} /> : <p className="none">{chosen ? "This number is not a lead in the CRM yet." : "Pick a call to see the lead."}</p>}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Search
const MODES = [["auto", "Auto", ""], ["whatsapp", "Phone", "whatsapp"], ["text", "Text", "notePlus"], ["phone", "Phone", "phone"], ["email", "Email", "mail"]];
export function CwtSearch({ params }) {
  const crm = useCrm();
  const [query, setQuery] = useState(params.q || "");
  const [mode, setMode] = useState("auto");
  const [openId, setOpenId] = useState("");
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !crm.state) return [];
    const digits = q.replace(/\D/g, "");
    const byPhone = (p) => digits.length >= 3 && String(p || "").replace(/\D/g, "").includes(digits);
    return crm.leads.filter((l) => !l.archived && (mode === "email" ? String(l.email || "").toLowerCase().includes(q) : mode === "phone" || mode === "whatsapp" ? byPhone(l.phone)
      : mode === "text" ? `${l.name} ${l.company || ""}`.toLowerCase().includes(q) : `${l.name} ${l.email || ""} ${l.company || ""} ${l.city || ""}`.toLowerCase().includes(q) || byPhone(l.phone))).slice(0, 50);
  }, [crm.state, crm.leads, query, mode]);
  return (
    <div className="cwt-search">
      <div className="page">
        <h1>Search leads</h1>
        <div className="box">
          <label className="field"><input placeholder="Search for a lead's name, phone or other details" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus /><TIcon name="search" /></label>
          <div className="modes"><TIcon name="search" className="lens" />{MODES.map(([k, label, icon]) => <button key={k} type="button" className={mode === k ? "on" : ""} onClick={() => setMode(k)}>{icon && <TIcon name={icon} />}{label}</button>)}</div>
        </div>
        {!query.trim() ? <p className="hint">Enter search value to see results here</p> : (
          <>
            <p className="hint">{results.length} result(s)</p>
            <div className="results">
              {results.map((l) => <button key={l.id} type="button" className="res" onClick={() => setOpenId(l.id)}><b>{l.name}</b><span className="ph">{l.phone}</span><span className="row">Status: <span className="st">{statusOf(l)}</span><span className="as">{crm.users.get(l.owner)?.name || "No owner"}</span></span></button>)}
              {!results.length && <p className="hint">No leads found.</p>}
            </div>
          </>
        )}
      </div>
      {openId && <LeadPanel id={openId} ids={results.map((l) => l.id)} onOpen={setOpenId} onClose={() => setOpenId("")} />}
    </div>
  );
}

// ---------------------------------------------------------------- Follow Ups
const FU_TABS = [["late", "Late"], ["today", "Today"], ["upcoming", "Upcoming"], ["done", "Done"]];
export function CwtFollowups() {
  const crm = useCrm();
  const notify = useToast();
  const [tab, setTab] = useState("today");
  const [assignee, setAssignee] = useState("");
  const [openId, setOpenId] = useState("");
  const [busy, setBusy] = useState("");
  const groups = useMemo(() => {
    const g = { late: [], today: [], upcoming: [], done: [] };
    if (!crm.state) return g;
    const now = Date.now(), end = new Date(); end.setHours(23, 59, 59, 999);
    for (const t of crm.tasks) {
      if (assignee && t.owner !== assignee) continue;
      const due = Date.parse(t.due);
      if (t.status === "Done") g.done.push(t); else if (due < now) g.late.push(t); else if (due <= end.getTime()) g.today.push(t); else g.upcoming.push(t);
    }
    for (const k of Object.keys(g)) g[k].sort((a, b) => String(a.due).localeCompare(String(b.due)));
    return g;
  }, [crm.state, crm.tasks, assignee]);
  if (!crm.state) return <p className="muted">{crm.error || "Loading follow ups…"}</p>;
  async function mark(t, status) {
    setBusy(t.id);
    try { await crmSend("PATCH", `tasks/${t.id}`, { status }); await crm.reload(); notify(status === "Done" ? "Follow up marked done" : "Follow up reopened"); } catch (e) { notify(e.message); } finally { setBusy(""); }
  }
  return (
    <div className="cwt-follow">
      <div className="crm-page">
        <div className="crm-page-head">
          <div><h1>Follow Ups</h1><p>Calls the team promised to make. Mark them done once the lead is called.</p></div>
          {crm.me.lead && <select className="crm-select" value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Assignee"><option value="">All assignees</option>{crm.me.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
        </div>
        <div className="tabs">{FU_TABS.map(([k, label]) => <button key={k} type="button" className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{label} <span className={`n ${k}`}>{groups[k].length}</span></button>)}</div>
        <div className="list">
          {groups[tab].slice(0, 100).map((t) => {
            const l = crm.leadById.get(t.leadId);
            return (
              <div key={t.id} className="item">
                <span className="av md">{initials(l?.name || t.title)}</span>
                <button type="button" className="info" onClick={() => l && setOpenId(l.id)}><b>{l?.name || t.title}</b><span className="crm-muted">{t.title} · {crm.users.get(t.owner)?.name || "No owner"}</span></button>
                <span className="when">{when(t.due)}</span>
                <div className="acts">
                  {t.status !== "Done" ? (
                    <>
                      {l && <a className="icon-btn call" href={`tel:${String(l.phone || "").replace(/[^\d+]/g, "")}`} aria-label="Call"><TIcon name="phone" /></a>}
                      <button type="button" className="crm-btn sm" disabled={busy === t.id} onClick={() => mark(t, "Done")}>Done</button>
                    </>
                  ) : <button type="button" className="crm-btn ghost sm" disabled={busy === t.id} onClick={() => mark(t, "Open")}>Reopen</button>}
                </div>
              </div>
            );
          })}
          {!groups[tab].length && <div className="crm-empty">Nothing here. 🎉</div>}
        </div>
      </div>
      {openId && <LeadPanel id={openId} onClose={() => setOpenId("")} />}
    </div>
  );
}

// ---------------------------------------------------------------- Reports
const R_TABS = [["leaderboard", "Leaderboard"], ["calls", "Call Report"], ["download", "Report Download"], ["duplicates", "Duplicate Leads"], ["deleted", "Deleted leads"]];
const R_HINT = { leaderboard: "Who is closing the most leads and making the most calls.", calls: "Calls made by each person, how many connected and for how long.", download: "Download your data as spreadsheets.", duplicates: "Leads that share the same name and company.", deleted: "Leads that were archived. Restore them here." };
function csvOf(rows) { const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`; return rows.map((r) => r.map(esc).join(",")).join("\n"); }
function save(name, csv) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = name; a.click(); URL.revokeObjectURL(a.href); }

export function CwtReports({ params }) {
  const crm = useCrm();
  const notify = useToast();
  const tab = params.tab || "leaderboard";
  const board = useMemo(() => {
    if (!crm.state) return [];
    const users = [...crm.users.values()].filter((u) => u.active !== false);
    return users.map((u) => {
      const acts = crm.activities.filter((a) => a.type === "Call" && a.userId === u.id);
      const secs = acts.reduce((s, a) => s + (Number(a.duration) || 0), 0);
      const mine = crm.leads.filter((l) => l.owner === u.id && !l.archived);
      return { name: u.name, leads: mine.length, won: mine.filter((l) => l.stage === "Closed" && l.disposition === "Won").length, calls: acts.length, connected: acts.filter((a) => (Number(a.duration) || 0) > 0).length, talk: secs };
    }).sort((a, b) => b.won - a.won || b.connected - a.connected);
  }, [crm.state, crm.users, crm.activities, crm.leads]);
  const duplicates = useMemo(() => {
    const map = new Map();
    for (const l of crm.leads || []) { if (l.archived) continue; const key = `${String(l.name).trim().toLowerCase()}|${String(l.company || "").trim().toLowerCase()}`; map.set(key, [...(map.get(key) || []), l]); }
    return [...map.values()].filter((g) => g.length > 1);
  }, [crm.leads]);
  if (!crm.state) return <p className="muted">{crm.error || "Loading reports…"}</p>;
  const deleted = crm.leads.filter((l) => l.archived);
  const nameOf = (id) => crm.users.get(id)?.name || "";
  const downloads = [
    ["leads", "All leads", "Every lead with its status, owner and source.", () => csvOf([["Name", "Phone", "Email", "Status", "Assignee", "Source", "Created On"], ...crm.leads.filter((l) => !l.archived).map((l) => [l.name, l.phone, l.email, statusOf(l), nameOf(l.owner), l.source, l.createdAt])])],
    ["calls", "Call log", "Every call the phones synced, with caller, direction and duration.", () => csvOf([["Lead", "Phone", "Caller", "Direction", "Duration (s)", "Started"], ...crm.calls.map((c) => [crm.leadById.get(c.leadId)?.name || "", c.phone, nameOf(c.owner), c.direction, c.duration, new Date(c.startedAt).toISOString()])])],
    ["status", "Status vs Assignee", "Lead counts per person and status.", () => { const steps = ["New", ...PIPELINE.map((d) => d.name)]; const rows = [...crm.users.values()].map((u) => [u.name, ...steps.map((s) => crm.leads.filter((l) => !l.archived && l.owner === u.id && statusOf(l) === s).length)]); return csvOf([["Assignee", ...steps], ...rows]); }],
  ];
  async function restore(l) { try { await crmSend("PATCH", `leads/${l.id}`, { archived: false }); await crm.reload(); notify("Lead restored"); } catch (e) { notify(e.message); } }
  return (
    <div className="cwt-reports">
      <div className="crm-page">
        <div className="crm-page-head"><div><h1>{R_TABS.find(([k]) => k === tab)?.[1] || "Reports"}</h1><p>{R_HINT[tab]}</p></div></div>
        <div className="tabs">{R_TABS.map(([k, label]) => <a key={k} href={hashFor("/reports", { tab: k })} className={tab === k ? "active" : ""}>{label}</a>)}</div>

        {tab === "leaderboard" && (
          <>
            <div className="podium">{board.slice(0, 3).map((r, i) => <div key={r.name} className={`place p${i + 1}`}><span className="medal">{i + 1}</span><span className="av lg">{initials(r.name)}</span><b>{r.name}</b><span className="crm-muted">{r.won} won · {r.connected} connected calls</span></div>)}</div>
            <div className="flush"><table className="crm-table"><thead><tr><th>#</th><th>Member</th><th className="c">Leads</th><th className="c">Won</th><th className="c">Calls</th><th className="c">Connected</th><th className="c">Talk Time</th></tr></thead>
              <tbody>{board.map((r, i) => <tr key={r.name}><td>{i + 1}</td><td><div className="user-cell"><span className="av">{initials(r.name)}</span><b>{r.name}</b></div></td><td className="c">{r.leads}</td><td className="c teal">{r.won}</td><td className="c">{r.calls}</td><td className="c">{r.connected}</td><td className="c">{fmt(r.talk)}</td></tr>)}</tbody></table></div>
          </>
        )}
        {tab === "calls" && (
          <div className="flush"><table className="crm-table"><thead><tr><th>Caller</th><th className="c">Calls</th><th className="c">Connected</th><th className="c">Not Connected</th><th className="c">Connect Rate</th><th className="c">Talk Time</th><th className="c">Avg Call</th></tr></thead>
            <tbody>{board.map((r) => <tr key={r.name}><td><div className="user-cell"><span className="av">{initials(r.name)}</span><b>{r.name}</b></div></td><td className="c">{r.calls}</td><td className="c teal">{r.connected}</td><td className="c red">{r.calls - r.connected}</td><td className="c">{r.calls ? Math.round((r.connected / r.calls) * 100) : 0}%</td><td className="c">{fmt(r.talk)}</td><td className="c">{fmt(r.connected ? Math.round(r.talk / r.connected) : 0)}</td></tr>)}</tbody></table></div>
        )}
        {tab === "download" && <div className="downloads">{downloads.map(([id, name, desc, make]) => <div key={id} className="dl"><div><b>{name}</b><p>{desc}</p></div><button type="button" className="crm-btn ghost" onClick={() => save(`${id}.csv`, make())}>Download CSV</button></div>)}</div>}
        {tab === "duplicates" && (
          <div className="flush"><table className="crm-table"><thead><tr><th>Name</th><th>Phones</th><th>Assignees</th></tr></thead>
            <tbody>{duplicates.map((g) => <tr key={g[0].id}><td>{g[0].name}</td><td>{g.map((l) => l.phone).join(", ")}</td><td>{[...new Set(g.map((l) => nameOf(l.owner) || "No owner"))].join(", ")}</td></tr>)}{!duplicates.length && <tr><td colSpan={3} className="crm-empty">No duplicate leads.</td></tr>}</tbody></table></div>
        )}
        {tab === "deleted" && (
          <div className="flush"><table className="crm-table"><thead><tr><th>Lead</th><th>Phone</th><th>Status</th><th>Created</th><th /></tr></thead>
            <tbody>{deleted.map((l) => <tr key={l.id}><td><b>{l.name}</b></td><td>{l.phone}</td><td>{statusOf(l)}</td><td>{ago(Date.parse(l.createdAt))}</td><td className="r">{crm.me.lead && <button type="button" className="crm-btn ghost sm" onClick={() => restore(l)}>Restore</button>}</td></tr>)}{!deleted.length && <tr><td colSpan={5} className="crm-empty">No archived leads. Leads you archive show up here so you can restore them.</td></tr>}</tbody></table></div>
        )}
      </div>
    </div>
  );
}
