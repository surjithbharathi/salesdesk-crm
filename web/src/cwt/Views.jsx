import React, { useEffect, useMemo, useState } from "react";
import { crmSend } from "../api.js";
import { useCrm } from "../crm.jsx";
import { useToast } from "../toast.jsx";
import { hashFor, initials } from "../format.js";
import { PIPELINE, pipelineStep } from "../pipeline.js";
import { TIcon } from "./icons.jsx";
import LeadPanel from "./LeadDetail.jsx";

// "All Views" in the TeleCRM style: view tabs, a toolbar with filters, search, columns and actions, then the lead table.
// The class names are the reference web app's, so its style sheet (cwt/views.css) applies as written.

const STATUSES = ["New", ...PIPELINE.map((d) => d.name)];
const statusOf = (l) => (l.stage === "New" ? "New" : pipelineStep(l) || "New");
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-");
// The tabs are the pipeline stages, so the team sees at once how many leads stand where. The less used stages and the
// work lists (my leads, no owner, the report) sit under "more". Old links (?view=won, ?view=new) still land on their stage.
const stageView = (s) => "st-" + slug(s);
const OLD_VIEW = { won: stageView("Won"), new: stageView("New") };
const QUEUE_VIEW = { "": "all", all: "all", new: stageView("New"), untouched: "untouched", unassigned: "unassigned", closed: stageView("Won") };
const MAIN_STAGES = ["New", "Interested Customer", "Requirement Discussion", "Quotation Shared", "Loan in Process", "Advance Received", "Won", "Lost"];
const MAIN = [["all", "All Leads"], ...MAIN_STAGES.map((s) => [stageView(s), s])];
const MORE = [
  ...STATUSES.filter((s) => !MAIN_STAGES.includes(s)).map((s) => [stageView(s), s]),
  ["mine", "My Leads"], ["active", "All Active Leads"], ["untouched", "Untouched Leads"], ["unassigned", "No Owner"], ["report", "Status vs Assignee Report"],
];
const STAGE_OF_VIEW = Object.fromEntries(STATUSES.map((s) => [stageView(s), s]));
const ALL_COLS = [["status", "Status"], ["assignee", "Assignee"], ["created", "Created On"], ["phone", "Phone"], ["source", "Source"], ["value", "Deal Value"], ["next", "Next Follow-up"]];
const readCols = () => { try { const s = localStorage.getItem("salesdesk-cwt-cols"); return new Set(s ? JSON.parse(s) : ["status", "assignee", "created"]); } catch { return new Set(["status", "assignee", "created"]); } };
const ago = (t) => { const m = Math.floor((Date.now() - t) / 60000); if (m < 60) return m < 1 ? "just now" : `${m}m ago`; const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`; const d = Math.floor(h / 24); return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`; };
const stamp = (t) => { const d = new Date(t); return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`; };
const money = (v) => (v ? "₹" + Math.round(v).toLocaleString("en-IN") : "");

export default function Views({ params }) {
  const crm = useCrm();
  const notify = useToast();
  const { view: viewParam, queue = "", q: qParam = "", lead: openId = "" } = params;
  const viewId = OLD_VIEW[viewParam] || viewParam || QUEUE_VIEW[queue] || "all";
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [assignee, setAssignee] = useState("");
  const [source, setSource] = useState("");
  const [by, setBy] = useState("name");
  const [query, setQuery] = useState(qParam);
  const [sortDesc, setSortDesc] = useState(true);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const [picked, setPicked] = useState(() => new Set());
  const [cols, setCols] = useState(readCols);
  const [menu, setMenu] = useState("");
  const [mode, setMode] = useState("table");
  const [spin, setSpin] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setPage(0), [viewId, status, assignee, source, query]);

  const me = crm.me?.id;
  const nameOf = (id) => crm.users.get(id)?.name || "";
  const rows = useMemo(() => {
    if (!crm.state) return [];
    const needle = query.trim().toLowerCase(), digits = needle.replace(/\D/g, "");
    const stage = STAGE_OF_VIEW[viewId];
    const test = stage ? (l) => statusOf(l) === stage : {
      all: () => true, mine: (l) => l.owner === me, active: (l) => l.stage !== "Closed",
      untouched: (l) => !l.firstTouchAt && l.stage !== "Closed", unassigned: (l) => !l.owner && l.stage !== "Closed", report: () => true,
    }[viewId] || (() => true);
    const list = crm.leads.filter((l) => !l.archived && test(l) && (!status || statusOf(l) === status) && (!assignee || nameOf(l.owner) === assignee) && (!source || l.source === source)
      && (!needle || (by === "name" ? `${l.name} ${l.company || ""}`.toLowerCase().includes(needle) : by === "email" ? String(l.email || "").toLowerCase().includes(needle) : digits.length > 1 && String(l.phone || "").replace(/\D/g, "").includes(digits))));
    return list.sort((a, b) => (sortDesc ? -1 : 1) * (Date.parse(a.createdAt) - Date.parse(b.createdAt)));
  }, [crm.state, crm.leads, crm.users, viewId, status, assignee, source, query, by, sortDesc, me]);
  const report = useMemo(() => {
    const map = new Map();
    for (const l of crm.leads || []) { if (l.archived) continue; const name = nameOf(l.owner) || "No owner"; const r = map.get(name) || { name, c: Object.fromEntries([...STATUSES.map((s) => [s, 0]), ["total", 0]]) }; r.c[statusOf(l)]++; r.c.total++; map.set(name, r); }
    return [...map.values()].sort((a, b) => b.c.total - a.c.total);
  }, [crm.leads, crm.users]);
  // how many leads each tab holds
  const counts = useMemo(() => {
    const c = { all: 0 };
    for (const l of crm.leads || []) { if (l.archived) continue; c.all++; const v = stageView(statusOf(l)); c[v] = (c[v] || 0) + 1; }
    return c;
  }, [crm.leads]);
  const sources = useMemo(() => [...new Set((crm.leads || []).map((l) => l.source).filter(Boolean))].sort(), [crm.leads]);
  const team = crm.me?.users?.filter((u) => u.active !== false) || [];
  if (!crm.state) return <p className="muted">{crm.error || "Loading leads…"}</p>;

  const pages = Math.max(1, Math.ceil(rows.length / size));
  const pageRows = rows.slice(page * size, (page + 1) * size);
  const allChecked = pageRows.length > 0 && pageRows.every((l) => picked.has(l.id));
  const filterCount = 1 + [status, assignee, source].filter(Boolean).length;
  const pick = (id) => { setMenu(""); setPicked(new Set()); location.hash = hashFor("/leads", { view: id }); };
  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setPicked((s) => { const n = new Set(s); pageRows.forEach((l) => (allChecked ? n.delete(l.id) : n.add(l.id))); return n; });
  const toggleCol = (c) => setCols((s) => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); try { localStorage.setItem("salesdesk-cwt-cols", JSON.stringify([...n])); } catch { /* the choice then lasts for this visit only */ } return n; });
  const clear = () => { setStatus(""); setAssignee(""); setSource(""); setQuery(""); };
  const refresh = () => { setSpin(true); crm.reload(); setTimeout(() => setSpin(false), 700); };
  const open = (id) => (location.hash = hashFor("/leads", { view: viewParam || "", queue, lead: id }));
  async function each(ids, body, done) {
    setBusy(true);
    try { for (const id of ids) await crmSend("PATCH", `leads/${id}`, body); await crm.reload(); setPicked(new Set()); setMenu(""); notify(done); } catch (e) { notify(e.message); } finally { setBusy(false); }
  }
  const exportCsv = () => {
    setMenu("");
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [["Name", "Phone", "Email", "Status", "Assignee", "Source", "Created On"].join(","), ...rows.map((l) => [l.name, l.phone, l.email, statusOf(l), nameOf(l.owner), l.source, l.createdAt].map(esc).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "leads.csv"; a.click(); URL.revokeObjectURL(a.href);
    notify(`Exported ${rows.length} leads`);
  };

  const chart = STATUSES.map((s) => ({ s, n: rows.filter((l) => statusOf(l) === s).length }));
  const cmax = Math.max(1, ...chart.map((b) => b.n));

  return (
    <div className="cwt-views">
      <div className="page">
        <h1>Leads</h1>
        <div className="view-tabs">
          {MAIN.map(([id, label]) => <button key={id} type="button" className={`vt ${viewId === id ? "active" : ""}`} onClick={() => pick(id)}>{label}<em className="vt-n">{(counts[id] || 0).toLocaleString("en-IN")}</em></button>)}
          <div className="drop">
            <button type="button" className={`more ${MORE.some(([id]) => id === viewId) ? "on" : ""}`} onClick={() => setMenu(menu === "more" ? "" : "more")}>{MORE.find(([id]) => id === viewId)?.[1] || `+${MORE.length} more`} <TIcon name="chevronDown" /></button>
            {menu === "more" && <div className="menu" onMouseLeave={() => setMenu("")}>{MORE.map(([id, label]) => <button key={id} type="button" className={viewId === id ? "on" : ""} onClick={() => pick(id)}>{label}{counts[id] !== undefined && <em className="vt-n">{counts[id].toLocaleString("en-IN")}</em>}</button>)}</div>}
          </div>
          <span className="grow" />
          <div className="mode">
            <button type="button" className={mode === "table" ? "on" : ""} onClick={() => setMode("table")} aria-label="Table"><TIcon name="table" /></button>
            <button type="button" className={mode === "chart" ? "on" : ""} onClick={() => setMode("chart")} aria-label="Chart"><TIcon name="barChart" /></button>
          </div>
        </div>

        {viewId === "report" ? (
          <div className="table-wrap">
            <table className="grid-table report">
              <thead><tr><th>Assignee</th>{STATUSES.map((s) => <th key={s} className="c">{s}</th>)}<th className="c">Total</th></tr></thead>
              <tbody>
                {report.map((r) => <tr key={r.name}><td>{r.name}</td>{STATUSES.map((s) => <td key={s} className="c"><button type="button" className="num" onClick={() => { setAssignee(r.name === "No owner" ? "" : r.name); setStatus(s); pick("all"); }}>{r.c[s]}</button></td>)}<td className="c"><b>{r.c.total}</b></td></tr>)}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <div className="toolbar">
              <button type="button" className={`filters-btn ${filtersOpen ? "on" : ""}`} onClick={() => setFiltersOpen(!filtersOpen)}><TIcon name="filter" />Filters <em>{filterCount}</em></button>
              <div className="search">
                <div className="drop">
                  <button type="button" className="by" onClick={() => setMenu(menu === "by" ? "" : "by")}><span className="t">T</span>{by === "name" ? "Name" : by === "phone" ? "Phone" : "Email"}<TIcon name="chevronDown" /></button>
                  {menu === "by" && <div className="menu" onMouseLeave={() => setMenu("")}>{[["name", "Name"], ["phone", "Phone"], ["email", "Email"]].map(([k, t]) => <button key={k} type="button" onClick={() => { setBy(k); setMenu(""); }}>{t}</button>)}</div>}
                </div>
                <input placeholder="Search lead" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search lead" />
              </div>
              <span className="count">{rows.length.toLocaleString("en-IN")} leads<button type="button" className={`ref ${spin ? "spin" : ""}`} onClick={refresh} aria-label="Refresh"><TIcon name="refresh" /></button></span>
              {picked.size > 0 && <span className="sel">{picked.size} selected</span>}
              <span className="grow" />
              <div className="drop">
                <button type="button" className="tb" onClick={() => setMenu(menu === "cols" ? "" : "cols")}><TIcon name="columns" />Columns <em>{cols.size + 1}</em></button>
                {menu === "cols" && <div className="menu right" onMouseLeave={() => setMenu("")}>{ALL_COLS.map(([id, label]) => <label key={id} className="chk"><input type="checkbox" checked={cols.has(id)} onChange={() => toggleCol(id)} />{label}</label>)}</div>}
              </div>
              <div className="drop">
                <button type="button" className="tb" onClick={() => setMenu(menu === "actions" ? "" : "actions")}>Actions <TIcon name="chevronDown" /></button>
                {menu === "actions" && (
                  <div className="menu right" onMouseLeave={() => setMenu("")}>
                    <button type="button" onClick={exportCsv}>Export leads</button>
                    {crm.me?.lead && picked.size > 0 && (
                      <>
                        <div className="sub-title">Assign {picked.size} selected to</div>
                        {team.map((u) => <button key={u.id} type="button" disabled={busy} onClick={() => each([...picked], { owner: u.id }, `${picked.size} lead(s) assigned to ${u.name}`)}>{u.name}</button>)}
                        <button type="button" className="danger" disabled={busy} onClick={() => confirm(`Archive ${picked.size} selected lead(s)? They leave the lists but are kept.`) && each([...picked], { archived: true }, `${picked.size} lead(s) archived`)}>Archive selected</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {filtersOpen && (
              <div className="filter-row">
                <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Assignee"><option value="">Any assignee</option>{team.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}</select>
                <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source"><option value="">Any source</option>{sources.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                <button type="button" className="clear" onClick={clear}>Clear all</button>
              </div>
            )}

            {mode === "chart" ? (
              <div className="chart">{chart.map((b) => <div key={b.s} className="bar-row"><span className="lbl">{b.s}</span><div className="bar"><i className={`st-${slug(b.s)} cwt-w-${Math.round((b.n / cmax) * 100)}`} /></div><b>{b.n}</b></div>)}</div>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="grid-table">
                    <thead><tr>
                      <th className="cb"><input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all" /></th>
                      <th className="name-col">Name<TIcon name="filter" className="f" /></th>
                      {cols.has("status") && <th>Status<TIcon name="filter" className="f" /></th>}
                      {cols.has("phone") && <th>Phone</th>}
                      {cols.has("assignee") && <th>Assignee<TIcon name="filter" className="f" /></th>}
                      {cols.has("source") && <th>Source</th>}
                      {cols.has("value") && <th>Deal Value</th>}
                      {cols.has("next") && <th>Next Follow-up</th>}
                      {cols.has("created") && <th className="sortable" onClick={() => setSortDesc(!sortDesc)}>Created On<span className="sort"><TIcon name="filter" className="f on" /><em>1</em><svg viewBox="0 0 24 24" className={`arrow ${sortDesc ? "" : "up"}`}><path d="M12 5v14M6 13l6 6 6-6" /></svg></span></th>}
                    </tr></thead>
                    <tbody>
                      {pageRows.map((l) => (
                        <tr key={l.id} className={picked.has(l.id) ? "picked" : ""}>
                          <td className="cb"><input type="checkbox" checked={picked.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Select ${l.name}`} /></td>
                          <td className="name-col"><button type="button" className="lead-link" onClick={() => open(l.id)}>{l.name}</button></td>
                          {cols.has("status") && <td><span className={`st st-${slug(statusOf(l))}`}>{statusOf(l)}</span></td>}
                          {cols.has("phone") && <td>{l.phone}</td>}
                          {cols.has("assignee") && <td>{l.owner ? <span className="who"><span className="av">{initials(nameOf(l.owner))}</span>{nameOf(l.owner)}</span> : <span className="muted">—</span>}</td>}
                          {cols.has("source") && <td>{l.source}</td>}
                          {cols.has("value") && <td>{money(l.value)}</td>}
                          {cols.has("next") && <td>{crm.nextDue.get(l.id) ? stamp(Date.parse(crm.nextDue.get(l.id))) : ""}</td>}
                          {cols.has("created") && <td><span className="created"><TIcon name="calendar" /><span><b>{ago(Date.parse(l.createdAt))}</b><small>{stamp(Date.parse(l.createdAt))}</small></span></span></td>}
                        </tr>
                      ))}
                      {!pageRows.length && <tr><td colSpan={9} className="empty">No leads match.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="pager">
                  <span>{rows.length ? page * size + 1 : 0}–{Math.min((page + 1) * size, rows.length)} of {rows.length.toLocaleString("en-IN")}</span>
                  <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page"><TIcon name="chevronLeft" /></button>
                  <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next page"><TIcon name="chevronRight" /></button>
                  <select value={size} onChange={(e) => { setSize(+e.target.value); setPage(0); }} aria-label="Rows per page">{[20, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}</select>
                </div>
              </>
            )}
          </>
        )}
      </div>
      {openId && <LeadPanel id={openId} ids={rows.map((l) => l.id)} onOpen={open} onClose={() => (location.hash = hashFor("/leads", { view: viewParam || "", queue }))} />}
    </div>
  );
}
