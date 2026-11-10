import React, { useEffect, useMemo, useState } from "react";
import { crmGet } from "../api.js";
import { useCrm } from "../crm.jsx";
import { hashFor, initials } from "../format.js";
import { PIPELINE, pipelineStep } from "../pipeline.js";
import TeleDashboard from "../pages/TeleDashboard.jsx";
import { TIcon } from "./icons.jsx";

// The detailed panels of the TeleCRM-style dashboard: SIM permissions, follow ups, leads by status for each assignee, and WhatsApp sync,
// plus "My Dashboard" (the widgets each person arranges for themselves with Configure). The owner's overview (Dashboard.jsx) shows them
// below its own cards. The class names are the reference web app's, so cwt/crm.css and cwt/dashboard.css apply as written.

const DAY = 86400000;
const dayStart = (offset = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() + offset * DAY; };
const short = (n) => (n >= 1000 ? (n / 1000).toFixed(2).replace(/\.?0+$/, "") + "K" : String(n));
const STATUSES = ["New", ...PIPELINE.map((d) => d.name)];
const FOLLOW_RANGES = ["Today", "Tomorrow", "This Week", "All"];
const LEAD_RANGES = ["All", "Today", "Last 7 Days", "This Month"];
const SIM_NAME = { all: "Track All and Create Leads", leads: "Track Only Leads", off: "Blocked" };
const ago = (t) => {
  if (!t) return "Never";
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`;
};

function Refresh({ spinning, onClick }) {
  return <button type="button" className={`refresh ${spinning ? "spin" : ""}`} onClick={onClick} aria-label="Refresh"><TIcon name="refresh" /></button>;
}
const Caret = ({ up }) => <i className={`caret ${up ? "up" : ""}`} />;
const Search = ({ value, onChange, placeholder }) => <label className="search-box"><TIcon name="search" /><input type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} /></label>;
function Range({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="drop">
      <button type="button" className="pill-btn" onClick={() => setOpen(!open)}><TIcon name="calendar" />{value}<TIcon name="chevronDown" /></button>
      {open && <div className="drop-menu" onMouseLeave={() => setOpen(false)}>{options.map((r) => <button key={r} type="button" className={r === value ? "on" : ""} onClick={() => { onChange(r); setOpen(false); }}>{r}</button>)}</div>}
    </div>
  );
}

export default function DashPanels({ meta }) {
  const crm = useCrm();
  const [tab, setTab] = useState("default");
  const [spin, setSpin] = useState("");
  const [devices, setDevices] = useState([]);
  const [simQuery, setSimQuery] = useState("");
  const [simSort, setSimSort] = useState({ key: "last", dir: 1 });
  const [followRange, setFollowRange] = useState("Today");
  const [followQuery, setFollowQuery] = useState("");
  const [followSort, setFollowSort] = useState({ key: "done", dir: 1 });
  const [leadRange, setLeadRange] = useState("All");
  const [reportSort, setReportSort] = useState({ key: "total", dir: 1 });
  const [waQuery, setWaQuery] = useState("");
  const [refreshedAt, setRefreshedAt] = useState(Date.now());
  useEffect(() => { if (crm.me.lead) crmGet("mobile/devices").then((r) => setDevices(Array.isArray(r) ? r : r.devices || [])).catch(() => {}); }, [crm.me.lead]);

  const d = useMemo(() => {
    if (!crm.state) return null;
    const now = Date.now();
    const users = [...crm.users.values()].filter((u) => u.active !== false);
    const nameOf = (id) => crm.users.get(id)?.name || "No owner";
    // SIM permission: what each person's phone is set to track, the last call it synced, and whether a recording has come in
    const lastCall = new Map(), recorded = new Set();
    for (const c of crm.calls) { lastCall.set(c.owner, Math.max(lastCall.get(c.owner) || 0, c.startedAt)); if (c.recordingId) recorded.add(c.owner); }
    const sims = (u) => {
      const modes = devices.filter((x) => x.owner === u.id && !x.revoked).flatMap((x) => Object.values(x.tracking?.sims || {}));
      return [modes[0] ? SIM_NAME[modes[0]] : "Blocked", modes[1] ? SIM_NAME[modes[1]] : "Blocked"];
    };
    const simRows = users.map((u) => ({ u, last: lastCall.get(u.id) || null, sims: sims(u), rec: recorded.has(u.id) }));

    // follow ups: each person's tasks in the chosen range
    const [from, to] = followRange === "Today" ? [dayStart(), dayStart(1)] : followRange === "Tomorrow" ? [dayStart(1), dayStart(2)] : followRange === "This Week" ? [dayStart(), dayStart(7)] : [0, Number.MAX_SAFE_INTEGER];
    const fmap = new Map();
    for (const t of crm.tasks) {
      const due = Date.parse(t.due);
      if (due < from || due >= to) continue;
      const name = nameOf(t.owner);
      const r = fmap.get(name) || { name, upcoming: 0, late: 0, done: 0, cancel: 0 };
      if (t.status === "Done") r.done++; else if (due > now) r.upcoming++; else r.late++;
      fmap.set(name, r);
    }
    // leads by status for each assignee
    const lfrom = leadRange === "Today" ? dayStart() : leadRange === "Last 7 Days" ? dayStart(-6) : leadRange === "This Month" ? new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() : 0;
    const rmap = new Map();
    for (const l of crm.leads) {
      if (l.archived || Date.parse(l.createdAt) < lfrom) continue;
      const step = l.stage === "New" ? "New" : pipelineStep(l);
      if (!STATUSES.includes(step)) continue;
      const name = nameOf(l.owner);
      const r = rmap.get(name) || { name, counts: Object.fromEntries(STATUSES.map((s) => [s, 0])), total: 0 };
      r.counts[step]++; r.total++;
      rmap.set(name, r);
    }
    // WhatsApp: the last chat on each person's leads
    const owner = new Map(crm.leads.map((l) => [l.id, l.owner]));
    const chatAt = new Map(), convoOwner = new Map((crm.state.conversations || []).map((c) => [c.id, owner.get(c.leadId)]));
    for (const m of crm.state.messages || []) { const o = convoOwner.get(m.conversationId); if (o) chatAt.set(o, Math.max(chatAt.get(o) || 0, Date.parse(m.occurredAt || m.createdAt))); }
    const waRows = users.map((u) => ({ u, last: chatAt.get(u.id) || null }));
    return { simRows, follow: [...fmap.values()], report: [...rmap.values()], waRows };
  }, [crm.state, crm.users, crm.calls, crm.tasks, crm.leads, devices, followRange, leadRange]);

  if (!d) return null;
  const refresh = (panel) => { setSpin(panel); crm.reload().then(() => setRefreshedAt(Date.now())); setTimeout(() => setSpin(""), 700); };
  const sortTo = (set, cur, key) => set({ key, dir: cur.key === key ? -cur.dir : 1 });
  const email = (u) => u.username || u.name;

  const simQ = simQuery.trim().toLowerCase();
  const simRows = d.simRows.filter((r) => !simQ || `${r.u.name} ${email(r.u)}`.toLowerCase().includes(simQ))
    .sort((a, b) => (simSort.key === "name" ? simSort.dir * email(a.u).localeCompare(email(b.u)) : simSort.dir * ((b.last || 0) - (a.last || 0))));
  const fQ = followQuery.trim().toLowerCase();
  const followRows = d.follow.filter((r) => !fQ || r.name.toLowerCase().includes(fQ))
    .sort((a, b) => (followSort.key === "name" ? followSort.dir * a.name.localeCompare(b.name) : followSort.dir * (b[followSort.key] - a[followSort.key]) || a.name.localeCompare(b.name)));
  const followTotal = followRows.reduce((t, r) => ({ upcoming: t.upcoming + r.upcoming, late: t.late + r.late, done: t.done + r.done, cancel: t.cancel + r.cancel }), { upcoming: 0, late: 0, done: 0, cancel: 0 });
  const reportRows = [...d.report].sort((a, b) => (reportSort.key === "name" ? reportSort.dir * a.name.localeCompare(b.name) : reportSort.key === "total" ? reportSort.dir * (b.total - a.total) : reportSort.dir * (b.counts[reportSort.key] - a.counts[reportSort.key])));
  const reportTotal = reportRows.reduce((t, r) => { for (const s of STATUSES) t.counts[s] += r.counts[s]; t.total += r.total; return t; }, { counts: Object.fromEntries(STATUSES.map((s) => [s, 0])), total: 0 });
  const wQ = waQuery.trim().toLowerCase();
  const waRows = d.waRows.filter((r) => !wQ || `${r.u.name} ${email(r.u)}`.toLowerCase().includes(wQ)).sort((a, b) => (b.last || 0) - (a.last || 0));
  const stamp = ago(refreshedAt);
  const Title = ({ icon, title, panel, children }) => (
    <header className="panel-head">
      <TIcon name={icon} className="p-icon" />
      <div className="panel-title"><h2>{title}</h2><div className="ago">{stamp}<Refresh spinning={spin === panel} onClick={() => refresh(panel)} /></div></div>
      {children}
    </header>
  );

  return (
    <div className="cwt-dash rd-classic">
      <div className="dash-tabs">
        <button type="button" className={tab === "default" ? "active" : ""} onClick={() => setTab("default")}>Default</button>
        <span className="tab-gear"><TIcon name="gear" /></span>
        <button type="button" className={tab === "mine" ? "active" : ""} onClick={() => setTab("mine")}>My Dashboard</button>
        <span className="rd-classic-spacer" />
        <Refresh spinning={spin === "all"} onClick={() => refresh("all")} />
        <a className="head-gear" href={hashFor("/settings")} aria-label="Settings"><TIcon name="gear" /></a>
      </div>
      {tab === "mine" ? <TeleDashboard meta={meta} /> : (
        <div className="dgrid">
          <section className="panel">
            <Title icon="sim" title="SIM Permission" panel="sim" />
            <div className="panel-body">
              <Search value={simQuery} onChange={setSimQuery} placeholder="Search by name" />
              <div className="crm-table-wrap scroll">
                <table className="crm-table">
                  <thead><tr>
                    <th className={`sortable ${simSort.key === "name" ? "sorted" : ""}`} onClick={() => sortTo(setSimSort, simSort, "name")}>User Name<Caret up={simSort.key === "name" && simSort.dir === 1} /></th>
                    <th className="c">SIM1 | SIM2 Permissions<Caret /></th>
                    <th className={`c sortable ${simSort.key === "last" ? "sorted" : ""}`} onClick={() => sortTo(setSimSort, simSort, "last")}>Last Call On<Caret up={simSort.key === "last" && simSort.dir === 1} /></th>
                    <th className="c">Recording<Caret /></th>
                  </tr></thead>
                  <tbody>
                    {simRows.map((r) => (
                      <tr key={r.u.id} className="tall">
                        <td><div className="user-cell"><span className="av">{initials(r.u.name)}</span><div className="who"><b>{email(r.u)}</b><span className="sub">{r.u.role || "Caller"}</span></div></div></td>
                        <td className="c"><span className="sims"><span className={`tag ${r.sims[0] === "Blocked" ? "bad" : "ok"}`}>{r.sims[0]}</span><span className="bar">|</span><span className={`tag ${r.sims[1] === "Blocked" ? "bad" : "ok"}`}>{r.sims[1]}</span></span></td>
                        <td className="c">{ago(r.last)}</td>
                        <td className="c"><span className={`yes ${r.rec ? "" : "no"}`}>{r.rec ? "YES" : "NO"}</span></td>
                      </tr>
                    ))}
                    {!simRows.length && <tr><td colSpan={4} className="crm-empty">No users match.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="panel">
            <Title icon="alarm" title="Follow Ups" panel="fu">
              <span className="spacer" />
              <Range value={followRange} options={FOLLOW_RANGES} onChange={setFollowRange} />
              <a className="expand-btn" href={hashFor("/todo")} aria-label="Open follow ups"><TIcon name="doubleRight" /></a>
            </Title>
            <div className="panel-body">
              <Search value={followQuery} onChange={setFollowQuery} placeholder="Search by assignee" />
              <div className="crm-table-wrap scroll">
                <table className="crm-table">
                  <thead><tr>
                    {[["name", "Assignee", ""], ["upcoming", "Upcoming", "c"], ["late", "Late", "c"], ["done", "Done", "c"], ["cancel", "Cancel", "c"]].map(([k, label, c]) => <th key={k} className={`${c} sortable ${followSort.key === k ? "sorted" : ""}`} onClick={() => sortTo(setFollowSort, followSort, k)}>{label}<Caret up={followSort.key === k && followSort.dir === 1} /></th>)}
                  </tr></thead>
                  <tbody>
                    {followRows.map((r) => (
                      <tr key={r.name} className="clickable" onClick={() => (location.hash = hashFor("/todo"))}>
                        <td><div className="user-cell"><span className="av">{initials(r.name)}</span><span className="nm">{r.name}</span></div></td>
                        <td className="c amber">{r.upcoming}</td><td className="c red">{r.late}</td><td className="c teal">{r.done}</td><td className="c grey">{r.cancel}</td>
                      </tr>
                    ))}
                    {!followRows.length && <tr><td colSpan={5} className="crm-empty">No follow ups for {followRange.toLowerCase()}.</td></tr>}
                  </tbody>
                  {followRows.length > 0 && <tfoot><tr><td>Total</td><td className="c amber">{followTotal.upcoming}</td><td className="c red">{followTotal.late}</td><td className="c teal">{followTotal.done}</td><td className="c grey">{followTotal.cancel}</td></tr></tfoot>}
                </table>
              </div>
            </div>
          </section>

          <section className="panel">
            <Title icon="barChart" title="Status vs Assignee Report" panel="rep">
              <span className="total-leads">Total Leads: {short(reportTotal.total)}</span>
              <span className="spacer" />
              <Range value={leadRange} options={LEAD_RANGES} onChange={setLeadRange} />
              <a className="expand-btn" href={hashFor("/leads")} aria-label="Open leads"><TIcon name="doubleRight" /></a>
            </Title>
            <div className="panel-body report-body">
              <div className="report-wrap">
                <table className="report">
                  <thead><tr>
                    <th className="first sortable" onClick={() => sortTo(setReportSort, reportSort, "name")}>Assignee<Caret up={reportSort.key !== "name" || reportSort.dir === 1} /></th>
                    {STATUSES.map((s) => <th key={s} className={`sortable ${reportSort.key === s ? "sorted" : ""}`} onClick={() => sortTo(setReportSort, reportSort, s)} title={s}><span className="ell">{s}</span><Caret /></th>)}
                    <th className="last sortable" onClick={() => sortTo(setReportSort, reportSort, "total")}>Total<Caret /></th>
                  </tr></thead>
                  <tbody>
                    {reportRows.map((r) => (
                      <tr key={r.name}>
                        <td className="first">{r.name}</td>
                        {STATUSES.map((s) => <td key={s} className={`num ${r.counts[s] ? "" : "zero"}`} onClick={() => (location.hash = hashFor("/leads"))}>{r.counts[s]}</td>)}
                        <td className="last num" onClick={() => (location.hash = hashFor("/leads"))}>{r.total} <span className="go">›</span></td>
                      </tr>
                    ))}
                    {!reportRows.length && <tr><td colSpan={STATUSES.length + 2} className="crm-empty">No leads in this range.</td></tr>}
                  </tbody>
                  <tfoot><tr><td className="first">Total</td>{STATUSES.map((s) => <td key={s} className="num">{reportTotal.counts[s]}</td>)}<td className="last num">{reportTotal.total}</td></tr></tfoot>
                </table>
              </div>
            </div>
          </section>

          <section className="panel">
            <Title icon="whatsapp" title="WhatsApp Sync" panel="wa" />
            <div className="panel-body">
              <Search value={waQuery} onChange={setWaQuery} placeholder="Search by name" />
              <div className="crm-table-wrap scroll">
                <table className="crm-table">
                  <thead><tr><th>User Name<Caret /></th><th className="c">Sync Permission<Caret /></th><th className="c sorted">Last Chat On<Caret up /></th></tr></thead>
                  <tbody>
                    {waRows.map((r) => (
                      <tr key={r.u.id} className="tall">
                        <td><div className="user-cell"><span className="av">{initials(r.u.name)}</span><div className="who"><b>{email(r.u)}</b><span className="sub">{r.u.role || "Caller"}</span></div></div></td>
                        <td className="c"><span className={`tag na ${r.last ? "ok" : ""}`}>{r.last ? "Allowed" : "N/A"}</span></td>
                        <td className="c">{ago(r.last)}</td>
                      </tr>
                    ))}
                    {!waRows.length && <tr><td colSpan={3} className="crm-empty">No users match.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
