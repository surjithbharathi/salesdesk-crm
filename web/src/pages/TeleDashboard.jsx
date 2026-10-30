import React, { useEffect, useMemo, useState } from "react";
import { useCrm } from "../crm.jsx";
import { ago, hashFor, initials } from "../format.js";
import Icon from "../icons.jsx";
import MyDay from "./MyDay.jsx";

// The dashboard of the "TeleCRM style" skin: the same widgets in the same arrangement (follow-ups per person, leads by stage per person,
// saved filters, lead sources, phone and WhatsApp activity), filled from this CRM's own records. Lead stages are shown the way that
// product groups them: Fresh (new, not yet worked), Active (being worked), Won and Lost.

const ms = (v) => (typeof v === "number" ? v : Date.parse(v));
const dayStart = () => new Date().setHours(0, 0, 0, 0);
const RANGES = [["today", "Today"], ["week", "Last 7 days"], ["month", "This month"], ["all", "All time"]];

function inRange(iso, range) {
  if (range === "all") return true;
  const t = ms(iso);
  if (!(t > 0)) return false;
  const start = dayStart();
  if (range === "today") return t >= start;
  if (range === "week") return t >= start - 6 * 86400000;
  const first = new Date();
  first.setDate(1);
  first.setHours(0, 0, 0, 0);
  return t >= first.getTime();
}

const group = (lead) => (lead.stage === "Closed" ? (lead.disposition === "Won" ? "won" : "lost") : lead.stage === "New" ? "fresh" : "active");
const tally = (leads) => {
  const t = { fresh: 0, active: 0, won: 0, lost: 0, total: leads.length };
  for (const l of leads) t[group(l)]++;
  return t;
};

function Range({ prefix, value, onChange }) {
  return (
    <label className="tele-filter">
      <span>{prefix}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${prefix} range`}>
        {RANGES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </label>
  );
}

function Widget({ icon, title, filter, children }) {
  const crm = useCrm();
  const [at, setAt] = useState(Date.now());
  useEffect(() => setAt(Date.now()), [crm.state]);
  return (
    <section className="tele-card" aria-label={title}>
      <header className="tele-card-head">
        <span className="tele-card-icon"><Icon name={icon} size={18} /></span>
        <div>
          <h2>{title}</h2>
          <small>
            Updated {new Date(at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
            <button className="tele-refresh" onClick={() => crm.reload()} aria-label={`Refresh ${title}`}><Icon name="again" size={12} /></button>
          </small>
        </div>
        {filter}
      </header>
      {children}
    </section>
  );
}

function Person({ row }) {
  return (
    <span className="tele-person">
      <span className="avatar">{initials(row.name)}</span>
      <span><b>{row.name}</b>{row.sub && <small>{row.sub}</small>}</span>
    </span>
  );
}

// A table whose headings sort, with a search box and an optional arrow at the end of each row that opens that person's leads.
function SortTable({ cols, rows, initial, foot, empty, search, href, footHref }) {
  const [sort, setSort] = useState(initial);
  const [q, setQ] = useState("");
  const sorted = useMemo(() => {
    const out = rows.filter((r) => !q || String(r.name).toLowerCase().includes(q.toLowerCase()));
    out.sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      const r = typeof x === "string" || typeof y === "string" ? String(x ?? "").localeCompare(String(y ?? "")) : (x ?? 0) - (y ?? 0);
      return sort.dir === "asc" ? r : -r;
    });
    return out;
  }, [rows, sort, q]);
  if (!rows.length) return <div className="tele-empty"><Icon name="note" size={44} /><p>{empty}</p></div>;
  const arrow = (to, label) => <td className="tele-go"><a href={to} aria-label={label}>›</a></td>;
  return (
    <>
      {search && (
        <label className="tele-search">
          <Icon name="leads" size={14} /><span className="sr">{search}</span>
          <input type="search" placeholder={search} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      )}
      <div className="tele-table-wrap">
        <table className="tele-table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={c.num ? "num" : ""} aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                  <button onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === "asc" ? "desc" : "asc" }))}>
                    {c.label}<span className="sort" aria-hidden="true">{sort.key === c.key ? (sort.dir === "asc" ? "▲" : "▼") : "▾"}</span>
                  </button>
                </th>
              ))}
              {href && <th className="tele-go"><span className="sr">Open</span></th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id}>
                {cols.map((c) => <td key={c.key} className={c.num ? "num" : ""}>{c.render ? c.render(r) : r[c.key]}</td>)}
                {href && arrow(href(r), `Open ${r.name}`)}
              </tr>
            ))}
          </tbody>
          {foot && (
            <tfoot>
              <tr>
                {cols.map((c) => <td key={c.key} className={c.num ? "num" : ""}>{foot[c.key]}</td>)}
                {href && (footHref ? arrow(footHref, "Open all") : <td className="tele-go" />)}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}

const stageCols = (first) => [
  first,
  { key: "fresh", label: "Fresh", num: true, render: (r) => <span className="tele-fresh">{r.fresh}</span> },
  { key: "active", label: "Active", num: true },
  { key: "won", label: "Won", num: true, render: (r) => <span className="tele-done">{r.won}</span> },
  { key: "lost", label: "Lost", num: true, render: (r) => <span className="tele-late">{r.lost}</span> },
];
const stageFoot = (rows, name) => ({ name, ...Object.fromEntries(["fresh", "active", "won", "lost"].map((k) => [k, rows.reduce((s, r) => s + r[k], 0)])) });

function FollowUps({ people, tasks }) {
  const [range, setRange] = useState("today");
  const start = dayStart();
  const now = Date.now();
  const rows = people.map((p) => {
    const mine = tasks.filter((t) => t.owner === p.id);
    const open = mine.filter((t) => !["Done", "Cancelled"].includes(t.status));
    const closedIn = (status) => mine.filter((t) => t.status === status && inRange(t.completedAt || t.updatedAt, range)).length;
    return { id: p.id, name: p.name, upcoming: open.filter((t) => ms(t.due) >= now).length, late: open.filter((t) => ms(t.due) < start).length, done: closedIn("Done"), cancel: closedIn("Cancelled") };
  });
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const cols = [
    { key: "name", label: "Assignee", render: (r) => <Person row={r} /> },
    { key: "upcoming", label: "Upcoming", num: true, render: (r) => <span className="tele-up">{r.upcoming}</span> },
    { key: "late", label: "Late", num: true, render: (r) => <span className="tele-late">{r.late}</span> },
    { key: "done", label: "Done", num: true, render: (r) => <span className="tele-done">{r.done}</span> },
    { key: "cancel", label: "Cancel", num: true, render: (r) => <span className="tele-cancel">{r.cancel}</span> },
  ];
  return (
    <Widget icon="task" title="Follow ups" filter={<Range prefix="Done in" value={range} onChange={setRange} />}>
      <SortTable cols={cols} rows={rows} initial={{ key: "upcoming", dir: "desc" }} empty="No follow-ups yet." search="Search by assignee"
        foot={{ name: "Total", upcoming: sum("upcoming"), late: sum("late"), done: sum("done"), cancel: sum("cancel") }} />
    </Widget>
  );
}

function LeadByStages({ people, leads }) {
  const [range, setRange] = useState("all");
  const rows = people.map((p) => ({ id: p.id, name: p.name, ...tally(leads.filter((l) => l.owner === p.id && !l.archived && inRange(l.createdAt, range))) })).filter((r) => r.total > 0);
  const cols = stageCols({ key: "name", label: "Assignee", render: (r) => <Person row={r} /> });
  return (
    <Widget icon="leads" title="Lead by stages" filter={<Range prefix="Created on" value={range} onChange={setRange} />}>
      <SortTable cols={cols} rows={rows} initial={{ key: "fresh", dir: "desc" }} empty="No leads in this period." search="Search by assignee"
        foot={stageFoot(rows, "Total")} href={(r) => hashFor("/leads", { owner: r.id })} footHref={hashFor("/leads")} />
    </Widget>
  );
}

function Filters({ leads, me }) {
  const [range, setRange] = useState("all");
  const live = leads.filter((l) => !l.archived && inRange(l.createdAt, range));
  const sets = [
    ["all-active", "All active leads", (l) => l.stage !== "Closed", hashFor("/leads")],
    ["all", "All leads", () => true, hashFor("/leads")],
    ["mine", "My leads", (l) => l.owner === me, hashFor("/leads", { owner: me })],
    ["new", "New leads", (l) => l.stage === "New", hashFor("/leads", { queue: "new" })],
    ["none", "Leads with no owner", (l) => !l.owner, hashFor("/leads", { queue: "unassigned" })],
  ];
  const rows = sets.map(([id, name, test, to]) => ({ id, name, to, ...tally(live.filter(test)) }));
  const cols = stageCols({ key: "name", label: "Filters", render: (r) => <span className="tele-filter-name"><Icon name="leads" size={14} />{r.name}</span> });
  return (
    <Widget icon="dashboard" title="Filter(s)" filter={<Range prefix="Created on" value={range} onChange={setRange} />}>
      <SortTable cols={cols} rows={rows} initial={{ key: "name", dir: "asc" }} empty="No filters." search="Search by filter name" href={(r) => r.to} />
    </Widget>
  );
}

function Sources({ leads }) {
  const [range, setRange] = useState("all");
  const live = leads.filter((l) => !l.archived && inRange(l.createdAt, range));
  const bySource = new Map();
  for (const l of live) bySource.set(l.source || "Unknown", [...(bySource.get(l.source || "Unknown") || []), l]);
  const rows = [...bySource].map(([name, ls]) => ({ id: name, name, fresh: ls.filter((l) => l.stage === "New").length, recaptured: ls.filter((l) => l.repeat).length, total: ls.length }));
  const cols = [
    { key: "name", label: "Source" },
    { key: "fresh", label: "New lead", num: true },
    { key: "recaptured", label: "Recaptured lead", num: true },
    { key: "total", label: "Distinct lead counts", num: true },
  ];
  return (
    <Widget icon="pin" title="Source-wise lead distribution" filter={<Range prefix="Duration" value={range} onChange={setRange} />}>
      <SortTable cols={cols} rows={rows} initial={{ key: "total", dir: "desc" }} search="Search by source"
        href={(r) => hashFor("/leads", { source: r.name })} empty="No leads in this period." />
      {!rows.length && <p className="tele-cta"><a className="btn" href={hashFor("/leads")}>+ Create lead</a></p>}
    </Widget>
  );
}

function AssigneeSpread({ people, leads }) {
  const [range, setRange] = useState("all");
  const live = leads.filter((l) => !l.archived && inRange(l.createdAt, range));
  const rows = people.map((p) => {
    const mine = live.filter((l) => l.owner === p.id);
    return { id: p.id, name: p.name, total: mine.length, fresh: mine.filter((l) => l.stage === "New").length, recaptured: mine.filter((l) => l.repeat).length, share: live.length ? Math.round((mine.length / live.length) * 100) : 0 };
  }).filter((r) => r.total > 0);
  const cols = [
    { key: "name", label: "Assignee", render: (r) => <Person row={r} /> },
    { key: "fresh", label: "New lead", num: true },
    { key: "recaptured", label: "Recaptured lead", num: true },
    { key: "total", label: "Distinct lead counts", num: true },
    { key: "share", label: "Share", num: true, render: (r) => `${r.share}%` },
  ];
  return (
    <Widget icon="people" title="Assignee-wise lead distribution" filter={<Range prefix="Duration" value={range} onChange={setRange} />}>
      <SortTable cols={cols} rows={rows} initial={{ key: "total", dir: "desc" }} search="Search by assignee" href={(r) => hashFor("/leads", { owner: r.id })} empty="No leads in this period." />
    </Widget>
  );
}

function StatusReport({ people, leads, stages }) {
  const rows = people.map((p) => {
    const mine = leads.filter((l) => l.owner === p.id && !l.archived);
    const row = { id: p.id, name: p.name, won: mine.filter((l) => l.stage === "Closed" && l.disposition === "Won").length, lost: mine.filter((l) => l.stage === "Closed" && l.disposition !== "Won").length, total: mine.length };
    for (const [key] of stages) row[key] = mine.filter((l) => l.stage === key).length;
    return row;
  }).filter((r) => r.total > 0);
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const cols = [
    { key: "name", label: "Assignee" },
    ...stages.map(([key, label]) => ({ key, label, num: true })),
    { key: "won", label: "Won", num: true },
    { key: "lost", label: "Lost", num: true },
    { key: "total", label: "Total", num: true },
  ];
  const foot = { name: "Total", won: sum("won"), lost: sum("lost"), total: sum("total"), ...Object.fromEntries(stages.map(([k]) => [k, sum(k)])) };
  return (
    <Widget icon="report" title="Status vs assignee report">
      <p className="tele-sub">Total leads: {sum("total").toLocaleString("en-IN")}</p>
      <SortTable cols={cols} rows={rows} initial={{ key: "total", dir: "desc" }} foot={foot} empty="No leads with an owner yet." />
    </Widget>
  );
}

function PhoneSync({ people, leadById, calls }) {
  const week = Date.now() - 7 * 86400000;
  const rows = people.map((p) => {
    const mine = calls.filter((c) => leadById.get(c.leadId)?.owner === p.id);
    const last = mine.reduce((m, c) => Math.max(m, ms(c.startedAt) || 0), 0);
    return { id: p.id, name: p.name, sub: p.email, last, hasRecording: mine.some((c) => c.recordingId && ms(c.startedAt) >= week) };
  });
  const cols = [
    { key: "name", label: "User name", render: (r) => <Person row={r} /> },
    { key: "last", label: "Last call on", render: (r) => (r.last ? ago(new Date(r.last).toISOString()) : "No calls yet") },
    { key: "hasRecording", label: "Recording", render: (r) => <span className={`tele-chip ${r.hasRecording ? "tele-yes" : "tele-no"}`}>{r.hasRecording ? "YES" : "NO"}</span> },
  ];
  return (
    <Widget icon="phone" title="Phone sync">
      <SortTable cols={cols} rows={rows} initial={{ key: "last", dir: "desc" }} empty="No team members yet." search="Search by name" />
    </Widget>
  );
}

function WhatsAppSync({ people, leadById, state }) {
  const conv = new Map((state.conversations || []).map((c) => [c.id, c]));
  const rows = people.map((p) => {
    const last = (state.messages || []).reduce((m, x) => (leadById.get(conv.get(x.conversationId)?.leadId)?.owner === p.id ? Math.max(m, ms(x.occurredAt || x.createdAt) || 0) : m), 0);
    return { id: p.id, name: p.name, sub: p.email, last };
  });
  const cols = [
    { key: "name", label: "User name", render: (r) => <Person row={r} /> },
    { key: "last", label: "Last chat on", render: (r) => (r.last ? ago(new Date(r.last).toISOString()) : "No chats yet") },
  ];
  return (
    <Widget icon="chat" title="WhatsApp sync">
      <SortTable cols={cols} rows={rows} initial={{ key: "last", dir: "desc" }} empty="No team members yet." search="Search by name" />
    </Widget>
  );
}

// Every widget a person can put on their dashboard. `wide` ones take the full width.
const WIDGETS = [
  { id: "phone", title: "Phone sync", note: "Last call and recording per person", render: (x) => <PhoneSync people={x.people} leadById={x.crm.leadById} calls={x.crm.calls} /> },
  { id: "followups", title: "Follow ups", note: "Upcoming, late, done and cancelled", render: (x) => <FollowUps people={x.people} tasks={x.crm.tasks} /> },
  { id: "status", title: "Status vs assignee report", note: "Every stage per person", wide: true, render: (x) => <StatusReport people={x.people} leads={x.crm.leads} stages={STATUS_STAGES} /> },
  { id: "whatsapp", title: "WhatsApp sync", note: "Last chat per person", render: (x) => <WhatsAppSync people={x.people} leadById={x.crm.leadById} state={x.crm.state} /> },
  { id: "stages", title: "Lead by stages", note: "Fresh, active, won and lost per person", render: (x) => <LeadByStages people={x.people} leads={x.crm.leads} /> },
  { id: "filters", title: "Filter(s)", note: "Saved views with their counts", render: (x) => <Filters leads={x.scopeLeads} me={x.me} /> },
  { id: "sources", title: "Source-wise lead distribution", note: "Where leads come from", render: (x) => <Sources leads={x.scopeLeads} /> },
  { id: "spread", title: "Assignee-wise lead distribution", note: "Who holds how many leads", render: (x) => <AssigneeSpread people={x.people} leads={x.crm.leads} /> },
  { id: "goals", title: "Goals and points", note: "Level, goal rings, challenges and the leaderboard", wide: true, render: (x) => <MyDay userId={x.me} meta={x.meta} /> },
];
const STATUS_STAGES = [["New", "New"], ["Prospecting", "Discussion"], ["Opportunity", "Interested"], ["Quotation given", "Quotation given"]];
const DEFAULTS = {
  default: ["phone", "followups", "status", "whatsapp", "stages", "filters", "sources", "spread"],
  mine: ["followups", "filters", "stages", "goals"],
};
const KNOWN = new Set(WIDGETS.map((w) => w.id));

// Which widgets, in which order, is kept per person and per tab in this browser.
function useLayout(person, tab) {
  const key = `salesdesk-dash:${person || "anyone"}:${tab}`;
  const read = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if (Array.isArray(saved)) return saved.filter((id) => KNOWN.has(id));
    } catch {
      /* storage can be blocked or hold something else; fall back to the default */
    }
    return DEFAULTS[tab];
  };
  const [layout, setLayout] = useState(read);
  useEffect(() => setLayout(read()), [key]);
  const save = (next) => {
    setLayout(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* the change then lasts for this visit only */
    }
  };
  const reset = () => {
    setLayout(DEFAULTS[tab]);
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing was saved */
    }
  };
  return [layout, save, reset];
}

function Customize({ layout, onChange, onReset, onClose }) {
  const hidden = WIDGETS.filter((w) => !layout.includes(w.id));
  const move = (index, by) => {
    const next = [...layout];
    const to = index + by;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  };
  const byId = new Map(WIDGETS.map((w) => [w.id, w]));
  return (
    <section className="tele-custom" aria-label="Customize dashboard">
      <header>
        <div><h2>Customize dashboard</h2><p className="muted">Choose the widgets you want and the order they appear in. This applies to the tab you are on, and stays in this browser.</p></div>
        <span className="tele-custom-actions">
          <button className="btn btn-quiet" onClick={onReset}>Reset to default</button>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </span>
      </header>
      <h3>On your dashboard</h3>
      {layout.length === 0 && <p className="tele-empty">Nothing is showing. Add a widget below.</p>}
      <ol className="tele-custom-list">
        {layout.map((id, i) => (
          <li key={id}>
            <span><b>{byId.get(id).title}</b><small>{byId.get(id).note}</small></span>
            <span className="tele-custom-buttons">
              <button className="btn btn-quiet" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${byId.get(id).title} up`}>▲</button>
              <button className="btn btn-quiet" onClick={() => move(i, 1)} disabled={i === layout.length - 1} aria-label={`Move ${byId.get(id).title} down`}>▼</button>
              <button className="btn" onClick={() => onChange(layout.filter((x) => x !== id))}>Hide</button>
            </span>
          </li>
        ))}
      </ol>
      {hidden.length > 0 && (
        <>
          <h3>Available to add</h3>
          <ul className="tele-custom-list">
            {hidden.map((w) => (
              <li key={w.id}>
                <span><b>{w.title}</b><small>{w.note}</small></span>
                <button className="btn" onClick={() => onChange([...layout, w.id])}>Add</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export default function TeleDashboard({ meta }) {
  const crm = useCrm();
  const [tab, setTab] = useState("default");
  const [editing, setEditing] = useState(false);
  const me = meta.id || meta.users[0]?.id;
  const [layout, setLayout, resetLayout] = useLayout(me, tab);
  const everyone = useMemo(() => (crm.state ? [...crm.users.values()].filter((u) => u.active !== false) : []), [crm.state, crm.users]);
  const mine = useMemo(() => everyone.filter((p) => p.id === me), [everyone, me]);
  const ctx = { crm, me, meta, people: tab === "mine" ? mine : everyone, scopeLeads: tab === "mine" ? crm.leads.filter((l) => l.owner === me) : crm.leads };
  const byId = new Map(WIDGETS.map((w) => [w.id, w]));
  return (
    <>
      <div className="work-head">
        <h1 className="work-title">Dashboard</h1>
        <button className="tele-gear" onClick={() => setEditing((v) => !v)} aria-expanded={editing} aria-label="Customize dashboard" title="Customize dashboard"><Icon name="gear" size={18} /></button>
      </div>
      <div className="tabs tele-tabs" role="tablist" aria-label="Dashboard">
        {[["default", "Default"], ["mine", "My dashboard"]].map(([key, label]) => (
          <button key={key} role="tab" className="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      {editing && <Customize layout={layout} onChange={setLayout} onReset={resetLayout} onClose={() => setEditing(false)} />}
      {!crm.state ? (
        <p className="muted">Loading the dashboard…</p>
      ) : layout.length === 0 ? (
        <div className="tele-empty"><Icon name="dashboard" size={44} /><p>No widgets on this dashboard yet.</p><button className="btn btn-primary" onClick={() => setEditing(true)}>Add widgets</button></div>
      ) : (
        <div className="tele-grid">
          {layout.map((id) => <div key={id} className={byId.get(id).wide ? "tele-wide" : ""}>{byId.get(id).render(ctx)}</div>)}
        </div>
      )}
    </>
  );
}
