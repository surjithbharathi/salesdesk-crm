import React, { useEffect, useMemo, useState } from "react";
import { crmSend } from "../api.js";
import { useCrm } from "../crm.jsx";
import { useToast } from "../toast.jsx";
import { hashFor, initials } from "../format.js";
import { PIPELINE, pipelineStep } from "../pipeline.js";
import { TIcon } from "./icons.jsx";
import LeadPanel from "./LeadDetail.jsx";
import FilterPanel, { passes, conditionText } from "./FilterPanel.jsx";
import { STATES, LANGUAGES } from "../regions.js";

// "All Views" in the TeleCRM style: view tabs, a toolbar with filters, search, columns and actions, then the lead table.
// The class names are the reference web app's, so its style sheet (cwt/views.css) applies as written.

const STATUSES = ["New", ...PIPELINE.map((d) => d.name)];
const statusOf = (l) => (l.stage === "New" ? "New" : pipelineStep(l) || "New");
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-");
// One view picker, like Salesmax: the work views first (what to do today), then every pipeline stage, then other lists,
// then the smart views a person saved from their filters. Each shows how many leads it holds.
// Old links (?view=won, ?view=new, ?queue=…) still land on the matching view.
const stageView = (s) => "st-" + slug(s);
const OLD_VIEW = { won: stageView("Won"), new: "fresh" };
const QUEUE_VIEW = { "": "active", all: "all", new: "fresh", untouched: "untouched", unassigned: "unassigned", closed: stageView("Won") };
const CUSTOMER_STEPS = ["Advance Received", "Machine Dispatched", "Machine Delivered - Need to Start", "Won"];
const WORK_VIEWS = [["active", "All Active"], ["fresh", "New Lead"], ["today", "Assigned Today"], ["neverPicked", "Never Picked"], ["discussion", "Need Discussion"], ["interested", "Intrested"], ["customer", "Is Customer"], ["due", "Follow-up Due"], ["unassigned", "Unassigned"]];
const STAGE_VIEWS = STATUSES.map((s) => [stageView(s), s]);
const OTHER_VIEWS = [["all", "All Leads"], ["mine", "My Leads"], ["untouched", "Not called yet"], ["report", "Status vs Assignee Report"]];
const STAGE_OF_VIEW = Object.fromEntries(STATUSES.map((s) => [stageView(s), s]));
const LABEL = Object.fromEntries([...WORK_VIEWS, ...STAGE_VIEWS, ...OTHER_VIEWS]);
// Which upload a lead came from: a file added in Settings, the Salesmax import, or TeleCRM's Excel upload
const uploadOf = (l) => l.upload?.name || (l.importedFrom === "salesmax" ? "Salesmax import" : l.importTouch || /^excel$/i.test(l.source || "") ? "TeleCRM Excel upload" : "");
const SMART_KEY = "salesdesk-smart-views";
const readSmart = () => { try { const v = JSON.parse(localStorage.getItem(SMART_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
const ALL_COLS = [["status", "Status"], ["assignee", "Assignee"], ["state", "State"], ["probable", "Probable State"], ["language", "Language"], ["created", "Created On"], ["phone", "Phone"], ["source", "Source"], ["value", "Deal Value"], ["next", "Next Follow-up"]];
const readCols = () => { try { const s = localStorage.getItem("salesdesk-cwt-cols"); return new Set(s ? JSON.parse(s) : ["status", "assignee", "created"]); } catch { return new Set(["status", "assignee", "created"]); } };
const ago = (t) => { const m = Math.floor((Date.now() - t) / 60000); if (m < 60) return m < 1 ? "just now" : `${m}m ago`; const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`; const d = Math.floor(h / 24); return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`; };
const stamp = (t) => { const d = new Date(t); return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`; };
const money = (v) => (v ? "₹" + Math.round(v).toLocaleString("en-IN") : "");

export default function Views({ params }) {
  const crm = useCrm();
  const notify = useToast();
  const { view: viewParam, queue = "", q: qParam = "", lead: openId = "" } = params;
  const [smart, setSmart] = useState(readSmart);
  const savedView = smart.find((v) => v.id === viewParam);
  const viewId = savedView ? savedView.base || "active" : OLD_VIEW[viewParam] || viewParam || QUEUE_VIEW[queue] || "active";
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [conds, setConds] = useState([]); // filter conditions: { key, op, value }
  const [sort, setSort] = useState({ key: "created", dir: "desc" });
  // a saved smart view brings its conditions and sort back when it is picked
  useEffect(() => { if (savedView) { setConds(savedView.conds || []); setSort(savedView.sort || { key: "created", dir: "desc" }); } }, [viewParam]);
  const [by, setBy] = useState("name");
  const [query, setQuery] = useState(qParam);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);
  const [picked, setPicked] = useState(() => new Set());
  const [cols, setCols] = useState(readCols);
  const [menu, setMenu] = useState("");
  const [mode, setMode] = useState("table");
  const [spin, setSpin] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setPage(0), [viewId, conds, query, sort]);

  const me = crm.me?.id;
  const nameOf = (id) => crm.users.get(id)?.name || "";
  // what the work views need to know about each lead: calls made / answered, and whether it was assigned today
  const facts = useMemo(() => {
    const calls = new Map(), assigned = new Set(), messages = new Map(), notes = new Map(), today = new Date().toDateString();
    const bump = (m, id) => m.set(id, (m.get(id) || 0) + 1);
    for (const a of crm.activities || []) {
      if (a.type === "Call") { const c = calls.get(a.leadId) || { n: 0, answered: 0 }; c.n++; if (Number(a.duration) > 0) c.answered++; calls.set(a.leadId, c); }
      else if (a.type === "Message") bump(messages, a.leadId);
      else if (a.type === "Note") bump(notes, a.leadId);
      else if (a.type === "System" && /assign/i.test(a.text || "") && new Date(a.occurredAt || a.createdAt).toDateString() === today) assigned.add(a.leadId);
    }
    for (const l of crm.leads || []) if (l.owner && new Date(l.createdAt).toDateString() === today) assigned.add(l.id);
    const openTasks = new Map();
    for (const t of crm.openTasks || []) if (t.leadId) bump(openTasks, t.leadId);
    return { calls, assigned, messages, notes, openTasks };
  }, [crm.activities, crm.leads]);
  const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
  const testOf = (id) => {
    const stage = STAGE_OF_VIEW[id], active = (l) => l.stage !== "Closed";
    if (stage) return (l) => statusOf(l) === stage;
    return {
      active, all: () => true, report: () => true, mine: (l) => l.owner === me,
      fresh: (l) => l.stage === "New",
      today: (l) => active(l) && facts.assigned.has(l.id),
      neverPicked: (l) => { const c = facts.calls.get(l.id); return active(l) && c && c.n > 0 && !c.answered; },
      discussion: (l) => l.stage === "Prospecting",
      interested: (l) => l.stage === "Opportunity",
      customer: (l) => l.repeat || CUSTOMER_STEPS.includes(statusOf(l)),
      due: (l) => active(l) && crm.nextDue.has(l.id) && Date.parse(crm.nextDue.get(l.id)) <= endOfDay.getTime(),
      unassigned: (l) => active(l) && !l.owner,
      untouched: (l) => active(l) && !l.firstTouchAt && !facts.calls.get(l.id),
    }[id] || (() => true);
  };
  const team = crm.me?.users?.filter((u) => u.active !== false) || [];
  const uploads = useMemo(() => [...new Set((crm.leads || []).map(uploadOf).filter(Boolean))].sort(), [crm.leads]);
  const sources = useMemo(() => [...new Set((crm.leads || []).map((l) => l.source).filter(Boolean))].sort(), [crm.leads]);
  const defs = useMemo(() => {
    const states = [...new Set([...STATES, ...(crm.leads || []).map((l) => l.state).filter(Boolean)])].sort();
    const languages = [...new Set([...LANGUAGES, ...(crm.leads || []).map((l) => l.language).filter(Boolean)])].sort();
    const cities = [...new Set((crm.leads || []).map((l) => String(l.city || "").trim()).filter(Boolean))].sort().slice(0, 400);
    const custom = new Map();
    for (const l of (crm.leads || []).slice(0, 3000)) for (const [k, v] of Object.entries(l.telecrm?.fields || {})) if (!/^(created_on|captured_on|capture_frequency|modified_on|last_activity_on)$/.test(k) && (typeof v !== "object" || v === null)) custom.set(k, (custom.get(k) || 0) + 1);
    const opts = (list) => list.map((x) => [x, x]);
    return [
      { key: "calls", group: "activity", icon: "calls", label: "Calls made", type: "count", get: (l) => facts.calls.get(l.id)?.n || 0 },
      { key: "answered", group: "activity", icon: "phone", label: "Answered calls", type: "count", get: (l) => facts.calls.get(l.id)?.answered || 0 },
      { key: "whatsapp", group: "activity", icon: "whatsapp", label: "WhatsApp messages", type: "count", get: (l) => facts.messages.get(l.id) || 0 },
      { key: "notes", group: "activity", icon: "notePlus", label: "Notes", type: "count", get: (l) => facts.notes.get(l.id) || 0 },
      { key: "tasks", group: "activity", icon: "alarm", label: "Open follow-ups", type: "count", get: (l) => facts.openTasks.get(l.id) || 0 },
      { key: "assignee", group: "field", icon: "user", label: "Assignee", type: "select", options: [...team.map((u) => [u.id, u.name]), ["", "Unassigned"]], get: (l) => l.owner || "" },
      { key: "batch", group: "field", icon: "table", label: "Batch", type: "select", options: opts(uploads), get: (l) => uploadOf(l) },
      { key: "status", group: "field", icon: "flow", label: "Lead Status", type: "select", options: opts(STATUSES), get: (l) => statusOf(l) },
      { key: "source", group: "field", icon: "link", label: "Lead Source", type: "select", options: opts(sources), get: (l) => l.source || "" },
      { key: "state", group: "field", icon: "pin", label: "State", type: "select", options: [...opts(states), ["", "Not set"]], get: (l) => l.state || "" },
      { key: "probableState", group: "field", icon: "pin", label: "Probable State", type: "select", options: [...opts([...new Set((crm.leads || []).map((l) => l.probableState).filter(Boolean))].sort()), ["", "Not known"]], get: (l) => (l.state ? "" : l.probableState || "") },
      { key: "language", group: "field", icon: "message", label: "Language", type: "select", options: [...opts(languages), ["", "Not set"]], get: (l) => l.language || "" },
      { key: "city", group: "field", icon: "pin", label: "City", type: "select", options: opts(cities), get: (l) => String(l.city || "").trim() },
      { key: "created", group: "field", icon: "calendar", label: "Created On", type: "date", get: (l) => l.createdAt },
      { key: "updated", group: "field", icon: "refresh", label: "Updated On", type: "date", get: (l) => l.updatedAt },
      { key: "next", group: "field", icon: "alarm", label: "Next Follow-up", type: "date", get: (l) => crm.nextDue.get(l.id) || "" },
      { key: "name", group: "field", icon: "user", label: "Name", type: "text", get: (l) => l.name },
      { key: "company", group: "field", icon: "box", label: "Business", type: "text", get: (l) => l.company },
      { key: "phone", group: "field", icon: "phone", label: "Phone", type: "text", get: (l) => l.phone },
      { key: "email", group: "field", icon: "mail", label: "Email", type: "text", get: (l) => l.email },
      { key: "value", group: "field", icon: "bars", label: "Deal Value", type: "number", get: (l) => l.value },
      { key: "rating", group: "field", icon: "star", label: "Rating", type: "number", get: (l) => l.telecrm?.rating ?? 0 },
      ...[...custom].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k]) => ({ key: "tc:" + k, group: "telecrm", icon: "tag", label: k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), type: "text", get: (l) => l.telecrm?.fields?.[k] })),
    ];
  }, [crm.leads, crm.me, crm.nextDue, facts, uploads, sources]);
  const defByKey = useMemo(() => new Map(defs.map((d) => [d.key, d])), [defs]);
  const passAll = (list, l) => list.every((c) => passes(defByKey.get(c.key), c, l));
  const SORTS = [["created", "Created On"], ["updated", "Updated On"], ["next", "Next Follow-up"], ["name", "Name"], ["value", "Deal Value"]];
  const sortValue = (l, k) => (k === "name" ? String(l.name || "").toLowerCase() : k === "value" ? Number(l.value) || 0 : Date.parse(k === "next" ? crm.nextDue.get(l.id) || "" : k === "updated" ? l.updatedAt : l.createdAt) || 0);
  const rows = useMemo(() => {
    if (!crm.state) return [];
    const needle = query.trim().toLowerCase(), digits = needle.replace(/\D/g, "");
    const test = testOf(viewId);
    const list = crm.leads.filter((l) => !l.archived && test(l) && passAll(conds, l)
      && (!needle || (by === "name" ? `${l.name} ${l.company || ""}`.toLowerCase().includes(needle) : by === "email" ? String(l.email || "").toLowerCase().includes(needle) : digits.length > 1 && String(l.phone || "").replace(/\D/g, "").includes(digits))));
    const dir = sort.dir === "asc" ? 1 : -1;
    return list.sort((a, b) => { const x = sortValue(a, sort.key), y = sortValue(b, sort.key); return dir * (x < y ? -1 : x > y ? 1 : 0); });
  }, [crm.state, crm.leads, crm.users, viewId, conds, query, by, sort, me, facts, defByKey]);
  const report = useMemo(() => {
    const map = new Map();
    for (const l of crm.leads || []) { if (l.archived) continue; const name = nameOf(l.owner) || "No owner"; const r = map.get(name) || { name, c: Object.fromEntries([...STATUSES.map((s) => [s, 0]), ["total", 0]]) }; r.c[statusOf(l)]++; r.c.total++; map.set(name, r); }
    return [...map.values()].sort((a, b) => b.c.total - a.c.total);
  }, [crm.leads, crm.users]);
  // how many leads each view holds (before the filters)
  const counts = useMemo(() => {
    const ids = [...WORK_VIEWS, ...STAGE_VIEWS, ...OTHER_VIEWS].map(([id]) => id).filter((id) => id !== "report"), tests = ids.map((id) => [id, testOf(id)]), c = Object.fromEntries(ids.map((id) => [id, 0]));
    for (const l of crm.leads || []) { if (l.archived) continue; for (const [id, t] of tests) if (t(l)) c[id]++; }
    return c;
  }, [crm.leads, facts, crm.nextDue, me]);
  if (!crm.state) return <p className="muted">{crm.error || "Loading leads…"}</p>;

  const pages = Math.max(1, Math.ceil(rows.length / size));
  const pageRows = rows.slice(page * size, (page + 1) * size);
  const allChecked = pageRows.length > 0 && pageRows.every((l) => picked.has(l.id));
  const filterCount = conds.length;
  const pick = (id) => { setMenu(""); setPicked(new Set()); location.hash = hashFor("/leads", { view: id }); };
  const saveSmart = (name) => {
    const v = { id: "sv-" + Date.now().toString(36), name, base: viewId, conds, sort };
    const next = [...smart.filter((x) => x.name !== name), v];
    setSmart(next);
    try { localStorage.setItem(SMART_KEY, JSON.stringify(next)); } catch { /* kept for this visit only */ }
    notify(`Smart view "${name}" saved`);
    setFiltersOpen(false);
    pick(v.id);
  };
  const dropSmart = (id) => { const next = smart.filter((x) => x.id !== id); setSmart(next); try { localStorage.setItem(SMART_KEY, JSON.stringify(next)); } catch { /* ignore */ } if (viewParam === id) pick("active"); };
  const smartCount = (v) => { const t = testOf(v.base || "active"); return (crm.leads || []).filter((l) => !l.archived && t(l) && passAll(v.conds || [], l)).length; };
  const currentLabel = savedView?.name || LABEL[viewId] || "All Active";
  const currentCount = savedView ? rows.length : counts[viewId] ?? rows.length;
  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setPicked((s) => { const n = new Set(s); pageRows.forEach((l) => (allChecked ? n.delete(l.id) : n.add(l.id))); return n; });
  const toggleCol = (c) => setCols((s) => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); try { localStorage.setItem("salesdesk-cwt-cols", JSON.stringify([...n])); } catch { /* the choice then lasts for this visit only */ } return n; });
  const clear = () => { setConds([]); setQuery(""); };
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
        <div className="view-tabs vp-bar">
          <div className="drop vp-filter">
            <button type="button" className={`vp-ficon ${filtersOpen ? "on" : ""}`} aria-label="Filters" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><TIcon name="filter" />{filterCount > 0 && <em>{filterCount}</em>}</button>
            {filtersOpen && <FilterPanel defs={defs} sorts={SORTS} conds={conds} setConds={setConds} sort={sort} setSort={setSort} onClose={() => setFiltersOpen(false)} onClear={clear} onSave={(name) => saveSmart(name)} />}
          </div>
          <div className="drop vp-drop">
            <button type="button" className="vp-btn" aria-haspopup="listbox" aria-expanded={menu === "views"} onClick={() => setMenu(menu === "views" ? "" : "views")}><b>{currentLabel}</b><em className="vt-n">{currentCount.toLocaleString("en-IN")}</em><TIcon name="chevronDown" /></button>
            {menu === "views" && (
              <div className="vp-pop vp-menu" role="listbox" aria-label="Views">
                <div className="vp-pop-head"><b>{currentLabel}</b><em className="vt-n">{currentCount.toLocaleString("en-IN")}</em></div>
                <div className="vp-list">
                  {WORK_VIEWS.map(([id, label]) => <button key={id} type="button" role="option" aria-selected={!savedView && viewId === id} className={!savedView && viewId === id ? "on" : ""} onClick={() => pick(id)}>{label}<em className="vt-n">{(counts[id] || 0).toLocaleString("en-IN")}</em></button>)}
                  {smart.length > 0 && <div className="vp-group">Smart views</div>}
                  {smart.map((v) => <div key={v.id} className={`vp-row ${viewParam === v.id ? "on" : ""}`}><button type="button" role="option" aria-selected={viewParam === v.id} onClick={() => pick(v.id)}>{v.name}<em className="vt-n">{smartCount(v).toLocaleString("en-IN")}</em></button><button type="button" className="vp-x" aria-label={`Delete smart view ${v.name}`} onClick={() => dropSmart(v.id)}><TIcon name="x" /></button></div>)}
                  <div className="vp-group">By stage</div>
                  {STAGE_VIEWS.map(([id, label]) => <button key={id} type="button" role="option" aria-selected={!savedView && viewId === id} className={!savedView && viewId === id ? "on" : ""} onClick={() => pick(id)}>{label}<em className="vt-n">{(counts[id] || 0).toLocaleString("en-IN")}</em></button>)}
                  <div className="vp-group">Other lists</div>
                  {OTHER_VIEWS.map(([id, label]) => <button key={id} type="button" role="option" aria-selected={!savedView && viewId === id} className={!savedView && viewId === id ? "on" : ""} onClick={() => pick(id)}>{label}{counts[id] !== undefined && <em className="vt-n">{counts[id].toLocaleString("en-IN")}</em>}</button>)}
                </div>
                <p className="vp-hint">Add filters, then save them here as a smart view.</p>
              </div>
            )}
          </div>
          {conds.map((c, i) => defByKey.get(c.key) && <span key={i} className="vp-chip"><button type="button" onClick={() => setFiltersOpen(true)}><TIcon name={defByKey.get(c.key).icon} /><b>{defByKey.get(c.key).label}</b> {conditionText(defByKey.get(c.key), c)}</button><button type="button" className="vp-chip-x" aria-label={`Remove ${defByKey.get(c.key).label} filter`} onClick={() => setConds(conds.filter((_, j) => j !== i))}><TIcon name="x" /></button></span>)}
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
                {report.map((r) => <tr key={r.name}><td>{r.name}</td>{STATUSES.map((s) => <td key={s} className="c"><button type="button" className="num" onClick={() => { setConds([{ key: "assignee", op: "in", value: [r.name === "No owner" ? "" : team.find((u) => u.name === r.name)?.id || ""] }, { key: "status", op: "in", value: [s] }]); pick("all"); }}>{r.c[s]}</button></td>)}<td className="c"><b>{r.c.total}</b></td></tr>)}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <div className="toolbar">
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
                      {cols.has("state") && <th>State</th>}
                      {cols.has("probable") && <th>Probable State</th>}
                      {cols.has("language") && <th>Language</th>}
                      {cols.has("assignee") && <th>Assignee<TIcon name="filter" className="f" /></th>}
                      {cols.has("source") && <th>Source</th>}
                      {cols.has("value") && <th>Deal Value</th>}
                      {cols.has("next") && <th>Next Follow-up</th>}
                      {cols.has("created") && <th className="sortable" onClick={() => setSort({ key: "created", dir: sort.key === "created" && sort.dir === "desc" ? "asc" : "desc" })}>Created On<span className="sort"><TIcon name="filter" className="f on" /><em>1</em><svg viewBox="0 0 24 24" className={`arrow ${sort.dir === "desc" ? "" : "up"}`}><path d="M12 5v14M6 13l6 6 6-6" /></svg></span></th>}
                    </tr></thead>
                    <tbody>
                      {pageRows.map((l) => (
                        <tr key={l.id} className={picked.has(l.id) ? "picked" : ""}>
                          <td className="cb"><input type="checkbox" checked={picked.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Select ${l.name}`} /></td>
                          <td className="name-col"><button type="button" className="lead-link" onClick={() => open(l.id)}>{l.name}</button></td>
                          {cols.has("status") && <td><span className={`st st-${slug(statusOf(l))}`}>{statusOf(l)}</span></td>}
                          {cols.has("phone") && <td>{l.phone}</td>}
                          {cols.has("state") && <td>{l.state || ""}</td>}
                          {cols.has("probable") && <td>{l.state ? "" : l.probableState || ""}</td>}
                          {cols.has("language") && <td>{l.language || ""}{l.languageGuess && l.language ? <small className="muted"> (guess)</small> : null}</td>}
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
