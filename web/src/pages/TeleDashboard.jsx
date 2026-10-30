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

// ---- more widgets, in the same shape as the others ----

function ActivityPerformance({ people, leadById, calls }) {
  const from = Date.now() - 7 * 86400000;
  const rows = people.map((p) => {
    const mine = calls.filter((c) => leadById.get(c.leadId)?.owner === p.id && ms(c.startedAt) >= from);
    const answered = mine.filter((c) => c.duration > 0);
    return { id: p.id, name: p.name, calls: mine.length, answered: answered.length, minutes: Math.round(answered.reduce((s, c) => s + c.duration, 0) / 60) };
  });
  const cols = [
    { key: "name", label: "Assignee", render: (r) => <Person row={r} /> },
    { key: "calls", label: "Calls", num: true },
    { key: "answered", label: "Answered", num: true },
    { key: "minutes", label: "Talk time (min)", num: true },
  ];
  return (
    <Widget icon="report" title="Activity & performance">
      <p className="tele-sub">Last 7 days</p>
      <SortTable cols={cols} rows={rows} initial={{ key: "calls", dir: "desc" }} search="Search by assignee" empty="No team members yet." />
    </Widget>
  );
}

function TeamAccess({ people }) {
  const rows = people.map((p) => ({ id: p.id, name: p.name, sub: p.email, role: p.role || "Caller", active: p.active !== false }));
  const cols = [
    { key: "name", label: "User name", render: (r) => <Person row={r} /> },
    { key: "role", label: "Role" },
    { key: "active", label: "State", render: (r) => <span className={`tele-chip ${r.active ? "tele-yes" : "tele-no"}`}>{r.active ? "ACTIVE" : "OFF"}</span> },
  ];
  return (
    <Widget icon="people" title="Team and access">
      <SortTable cols={cols} rows={rows} initial={{ key: "name", dir: "asc" }} search="Search by name" empty="No team members yet." />
    </Widget>
  );
}

function MyTasks({ crm, me }) {
  const start = dayStart();
  const rows = crm.openTasks
    .filter((t) => t.owner === me)
    .sort((a, b) => String(a.due).localeCompare(String(b.due)))
    .slice(0, 30)
    .map((t) => ({ id: t.id, name: t.title, lead: crm.leadById.get(t.leadId), due: t.due, late: ms(t.due) < start }));
  return (
    <Widget icon="task" title="Tasks">
      {!rows.length ? <div className="tele-empty"><Icon name="check" size={44} /><p>No open tasks. You are all caught up.</p></div> : (
        <ul className="tele-log tele-tasklist">
          {rows.map((r) => (
            <li key={r.id}>
              <span className="tele-log-icon"><Icon name="task" size={16} /></span>
              <span className="tele-log-text">{r.name}{r.lead && <small> <a href={hashFor("/leads", { lead: r.lead.id })}>{r.lead.name}</a></small>}</span>
              <span className={`tele-log-when ${r.late ? "late" : ""}`}>{r.late ? "Late" : "Due"} {relDue(r.due)}</span>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}
const relDue = (iso) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

function MissedCalls({ crm }) {
  const rows = crm.calls
    .filter((c) => c.direction === "Missed" || (c.direction === "Incoming" && !c.duration))
    .sort((a, b) => ms(b.startedAt) - ms(a.startedAt))
    .slice(0, 20);
  return (
    <Widget icon="phone" title="Missed calls">
      {!rows.length ? <div className="tele-empty"><Icon name="phone" size={44} /><p>No missed calls.</p></div> : (
        <ul className="tele-log tele-tasklist">
          {rows.map((c) => {
            const lead = crm.leadById.get(c.leadId);
            return (
              <li key={c.id}>
                <span className="tele-log-icon"><Icon name="phone" size={16} /></span>
                <span className="tele-log-text">{lead ? <a href={hashFor("/leads", { lead: lead.id })}>{lead.name}</a> : c.phone}<small> {c.phone}</small></span>
                <span className="tele-log-when">{ago(new Date(ms(c.startedAt)).toISOString())}<a className="btn btn-quiet" href={`tel:${String(c.phone || "").replace(/[^\d+]/g, "")}`}>Call back</a></span>
              </li>
            );
          })}
        </ul>
      )}
    </Widget>
  );
}

// A saved filter drawn as one bar split into fresh, active, won and lost.
function FilterChart({ title, leads, test, to }) {
  const live = leads.filter((l) => !l.archived && test(l));
  const t = tally(live);
  const parts = [["fresh", "Fresh"], ["active", "Active"], ["won", "Won"], ["lost", "Lost"]];
  let x = 0;
  return (
    <Widget icon="dashboard" title={title}>
      <div className="tele-chart">
        <p className="tele-chart-total"><b className="num">{t.total.toLocaleString("en-IN")}</b> leads</p>
        <svg viewBox="0 0 100 6" preserveAspectRatio="none" role="img" aria-label={`${title}: ${parts.map(([k, l]) => `${l} ${t[k]}`).join(", ")}`}>
          {t.total === 0 ? <rect x="0" y="0" width="100" height="6" className="chart-empty" /> : parts.filter(([k]) => t[k]).map(([k]) => {
            const w = (t[k] / t.total) * 100;
            const rect = <rect key={k} x={x} y="0" width={w} height="6" className={`chart-${k}`} />;
            x += w;
            return rect;
          })}
        </svg>
        <ul className="tele-chart-legend">
          {parts.map(([k, l]) => <li key={k}><i className={`chart-key chart-${k}`} />{l} <b className="num">{t[k]}</b></li>)}
        </ul>
        <a className="btn btn-quiet" href={to}>Open these leads</a>
      </div>
    </Widget>
  );
}

// ---- every widget a person can put on their dashboard; `wide` ones take the full width ----
const WIDGETS = [
  { id: "followups", icon: "task", title: "Follow-ups", note: "See upcoming, late, completed and cancelled follow-ups", render: (x) => <FollowUps people={x.people} tasks={x.crm.tasks} /> },
  { id: "stages", icon: "leads", title: "Lead by stages", note: "See lead stages by assignee", render: (x) => <LeadByStages people={x.people} leads={x.crm.leads} /> },
  { id: "filters", icon: "dashboard", title: "Filters", note: "See lead-stage counts for saved filters", render: (x) => <Filters leads={x.scopeLeads} me={x.me} /> },
  { id: "phone", icon: "phone", title: "SIM permission", note: "See call sync and recording per person", render: (x) => <PhoneSync people={x.people} leadById={x.crm.leadById} calls={x.crm.calls} /> },
  { id: "whatsapp", icon: "chat", title: "WhatsApp sync", note: "See WhatsApp sync and last chat time", render: (x) => <WhatsAppSync people={x.people} leadById={x.crm.leadById} state={x.crm.state} /> },
  { id: "status", icon: "report", title: "Status vs assignee report", note: "See every stage per person", wide: true, render: (x) => <StatusReport people={x.people} leads={x.crm.leads} stages={STATUS_STAGES} /> },
  { id: "sources", icon: "pin", title: "Source-wise lead distribution", note: "See new, recaptured, and distinct leads by source", render: (x) => <Sources leads={x.scopeLeads} /> },
  { id: "spread", icon: "people", title: "Assignee-wise lead distribution", note: "See new, recaptured, and distinct leads by assignee", render: (x) => <AssigneeSpread people={x.people} leads={x.crm.leads} /> },
  { id: "activity", icon: "report", title: "Activity & performance", note: "See team calls, answered calls and talk time", render: (x) => <ActivityPerformance people={x.people} leadById={x.crm.leadById} calls={x.crm.calls} /> },
  { id: "team", icon: "people", title: "Team and access", note: "See team roles and who is active", render: (x) => <TeamAccess people={x.people} /> },
  { id: "tasks", icon: "task", title: "Tasks", note: "See your late and upcoming tasks", render: (x) => <MyTasks crm={x.crm} me={x.me} /> },
  { id: "missed", icon: "phone", title: "Missed calls", note: "See recent missed calls and call leads back", render: (x) => <MissedCalls crm={x.crm} /> },
  { id: "c-new", icon: "report", title: "NEW LEADS", note: "See a saved filter as a chart", render: (x) => <FilterChart title="New leads" leads={x.scopeLeads} test={(l) => l.stage === "New"} to={hashFor("/leads", { queue: "new" })} /> },
  { id: "c-active", icon: "report", title: "All active leads", note: "See a saved filter as a chart", render: (x) => <FilterChart title="All active leads" leads={x.scopeLeads} test={(l) => l.stage !== "Closed"} to={hashFor("/leads")} /> },
  { id: "c-all", icon: "report", title: "All leads", note: "See a saved filter as a chart", render: (x) => <FilterChart title="All leads" leads={x.scopeLeads} test={() => true} to={hashFor("/leads", { queue: "all" })} /> },
  { id: "c-mine", icon: "report", title: "Leads assigned to me", note: "See a saved filter as a chart", render: (x) => <FilterChart title="Leads assigned to me" leads={x.scopeLeads} test={(l) => l.owner === x.me} to={hashFor("/leads", { owner: x.me })} /> },
  { id: "goals", icon: "trophy", title: "Goals and points", note: "See your level, goal rings, challenges and the leaderboard", wide: true, render: (x) => <MyDay userId={x.me} meta={x.meta} /> },
];
const STATUS_STAGES = [["New", "New"], ["Prospecting", "Discussion"], ["Opportunity", "Interested"], ["Quotation given", "Quotation given"]];
const MAX_CARDS = 6;
const DEFAULTS = {
  default: ["phone", "followups", "status", "whatsapp", "stages", "filters"],
  mine: ["followups", "filters", "stages", "goals"],
};
const KNOWN = new Set(WIDGETS.map((w) => w.id));
const byId = new Map(WIDGETS.map((w) => [w.id, w]));

// Which widgets, in which order, is kept per person and per tab in this browser.
function useLayout(person, tab) {
  const key = `salesdesk-dash:${person || "anyone"}:${tab}`;
  const read = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if (Array.isArray(saved)) return saved.filter((id) => KNOWN.has(id)).slice(0, MAX_CARDS);
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
  return [layout, save];
}

// The "Configure dashboard" page: the cards on the dashboard (drag to reorder, remove with the red button), then the ones that can be added.
// Nothing changes on the dashboard until Save.
function Configure({ tab, layout, onSave, onCancel }) {
  const [draft, setDraft] = useState(layout);
  const [drag, setDrag] = useState(-1);
  const full = draft.length >= MAX_CARDS;
  const move = (from, to) => {
    if (from === to || to < 0 || to >= draft.length) return;
    const next = [...draft];
    next.splice(to, 0, next.splice(from, 1)[0]);
    setDraft(next);
  };
  const same = draft.length === layout.length && draft.every((id, i) => id === layout[i]);
  return (
    <section className="tele-config" aria-label="Configure dashboard">
      <h2>Configure dashboard <span className="muted">({tab === "mine" ? "My dashboard" : "Default"})</span></h2>
      <ul className="tele-config-grid">
        {draft.map((id, i) => {
          const w = byId.get(id);
          return (
            <li key={id} className="tele-tile tele-tile-on" draggable onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { move(drag, i); setDrag(-1); }}>
              <span className="tele-grip" aria-hidden="true">⠿</span>
              <button className="tele-round tele-minus" onClick={() => setDraft(draft.filter((x) => x !== id))} aria-label={`Remove ${w.title}`}>−</button>
              <span className="tele-tile-main"><b><Icon name={w.icon} size={18} /> {w.title}</b><small>{w.note}</small></span>
              <span className="tele-tile-move">
                <button className="btn btn-quiet" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move ${w.title} earlier`}>▲</button>
                <button className="btn btn-quiet" onClick={() => move(i, i + 1)} disabled={i === draft.length - 1} aria-label={`Move ${w.title} later`}>▼</button>
              </span>
            </li>
          );
        })}
      </ul>
      {draft.length === 0 && <p className="tele-empty">No cards yet. Add one below.</p>}
      <div className="tele-config-actions">
        <button className="btn btn-quiet tele-cancel" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onSave(draft)} disabled={same}>✓ Save</button>
      </div>
      <p className="tele-config-note">Max. {MAX_CARDS} cards can be active at a same time{full ? ". Remove one to add another." : "."}</p>
      <ul className="tele-config-grid">
        {WIDGETS.filter((w) => !draft.includes(w.id)).map((w) => (
          <li key={w.id} className="tele-tile">
            <button className="tele-round tele-plus" onClick={() => setDraft([...draft, w.id])} disabled={full} aria-label={`Add ${w.title}`}>+</button>
            <span className="tele-tile-main"><b><Icon name={w.icon} size={18} /> {w.title}</b><small>{w.note}</small></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function TeleDashboard({ meta }) {
  const crm = useCrm();
  const [tab, setTab] = useState("default");
  const [editing, setEditing] = useState(false);
  const me = meta.id || meta.users[0]?.id;
  const [layout, setLayout] = useLayout(me, tab);
  const everyone = useMemo(() => (crm.state ? [...crm.users.values()].filter((u) => u.active !== false) : []), [crm.state, crm.users]);
  const mine = useMemo(() => everyone.filter((p) => p.id === me), [everyone, me]);
  const ctx = { crm, me, meta, people: tab === "mine" ? mine : everyone, scopeLeads: tab === "mine" ? crm.leads.filter((l) => l.owner === me) : crm.leads };
  if (editing) return <Configure key={tab} tab={tab} layout={layout} onSave={(next) => { setLayout(next); setEditing(false); }} onCancel={() => setEditing(false)} />;
  return (
    <>
      <div className="work-head">
        <h1 className="work-title">Dashboard</h1>
        <button className="tele-gear" onClick={() => setEditing(true)} aria-label="Configure dashboard" title="Configure dashboard"><Icon name="gear" size={18} /></button>
      </div>
      <div className="tabs tele-tabs" role="tablist" aria-label="Dashboard">
        {[["default", "Default"], ["mine", "My dashboard"]].map(([key, label]) => (
          <button key={key} role="tab" className="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      {!crm.state ? (
        <p className="muted">Loading the dashboard…</p>
      ) : layout.length === 0 ? (
        <div className="tele-empty"><Icon name="dashboard" size={44} /><p>No cards on this dashboard yet.</p><button className="btn btn-primary" onClick={() => setEditing(true)}>Add cards</button></div>
      ) : (
        <div className="tele-grid">
          {layout.map((id) => <div key={id} className={byId.get(id).wide ? "tele-wide" : ""}>{byId.get(id).render(ctx)}</div>)}
        </div>
      )}
    </>
  );
}
