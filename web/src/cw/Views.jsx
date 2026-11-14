import React, { useMemo, useState } from "react";
import { crmSend } from "../api.js";
import { useCrm, stageText } from "../crm.jsx";
import { useToast } from "../toast.jsx";
import { dueText, hashFor } from "../format.js";
import Icon from "../icons.jsx";
import LeadPanel from "./LeadDetail.jsx";
import Recording from "../Recording.jsx";
import { PIPELINE, pipelineStep, askLostReason } from "../pipeline.js";
import { DAY, buildModel, initials, money, startOfDay } from "./model.js";
import DateTimePicker from "../DateTimePicker.jsx";

// Opportunities, To-dos, Engagements and Conversations in the Salesmax style. The class names are the reference web app's,
// so its style sheet (cw/views.css) applies as written; the data is this CRM's own.

const PAGE = 25;
const SRC = { WhatsApp: "wa", IndiaMART: "im", JustDial: "jd" };
const srcKind = (s) => SRC[s] || (/Facebook/.test(s) ? "fb" : /Google/.test(s) ? "gg" : "other");
const ago = (t) => {
  if (t == null) return "";
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`;
};
const dateTime = (t) => new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const SrcChip = ({ source }) => <i className={`src src--${srcKind(source)}`}>{srcKind(source) === "wa" ? <Icon name="chat" size={11} /> : srcKind(source) === "other" ? "+" : source[0]}</i>;
const Scope = ({ value, onChange }) => <div className="seg">{[["my", "My"], ["all", "All"]].map(([k, t]) => <button key={k} type="button" className={value === k ? "on" : ""} onClick={() => onChange(k)}>{t}</button>)}</div>;
function Pager({ total, page, setPage }) {
  const pages = Math.max(1, Math.ceil(total / PAGE));
  return (
    <footer className="pager">
      <span>{total ? page * PAGE + 1 : 0} to {Math.min(total, (page + 1) * PAGE)} of {total.toLocaleString("en-IN")}</span>
      <button type="button" disabled={page === 0} onClick={() => setPage(0)} aria-label="First page">|‹</button>
      <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</button>
      <span>Page <b>{page + 1}</b> of <b>{pages}</b></span>
      <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next page">›</button>
      <button type="button" disabled={page >= pages - 1} onClick={() => setPage(pages - 1)} aria-label="Last page">›|</button>
    </footer>
  );
}
function useModel() {
  const crm = useCrm();
  const m = useMemo(() => (crm.state ? buildModel(crm) : null), [crm.state, crm.leads, crm.activities, crm.users, crm.nextDue]);
  return [crm, m];
}

// ---------------------------------------------------------------- Opportunities
const COLUMNS = PIPELINE.map((d) => d.name);
const columnOf = (l) => (l.raw.stage === "New" ? "" : pipelineStep(l.raw));

export function CwDeals({ params }) {
  const [crm, m] = useModel();
  const notify = useToast();
  const table = params.tab === "table";
  const [scope, setScope] = useState("all");
  const [find, setFind] = useState("");
  const [month, setMonth] = useState(false);
  const [idle, setIdle] = useState(false);
  const [attention, setAttention] = useState(false);
  const [openId, setOpenId] = useState("");
  const [dragId, setDragId] = useState("");
  const [over, setOver] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const lastWorked = (l) => (l.activities.length ? l.activities[0].at : null);
  const needs = (l) => { const c = columnOf(l); return c && c !== "Won" && c !== "Lost" && (lastWorked(l) || 0) < Date.now() - 7 * DAY; };
  const deals = useMemo(() => {
    if (!m) return [];
    const needle = find.trim().toLowerCase(), first = new Date(); first.setDate(1); first.setHours(0, 0, 0, 0);
    const recent = Date.now() - 30 * DAY;
    return m.leads.filter((l) => {
      const c = columnOf(l);
      if (!c) return false;
      if ((c === "Won" || c === "Lost") && Date.parse(l.raw.updatedAt || l.raw.createdAt) < recent) return false;
      if (scope === "my" && l.ownerId !== crm.me.id) return false;
      if (needle && !`${l.name} ${l.company}`.toLowerCase().includes(needle)) return false;
      if (month && Date.parse(l.raw.updatedAt || l.raw.createdAt) < first.getTime()) return false;
      if (idle && !needs(l)) return false;
      if (attention && !needs(l)) return false;
      return true;
    });
  }, [m, find, scope, month, idle, attention, crm.me.id]);
  if (!crm.state) return <p className="muted">{crm.error || "Loading opportunities…"}</p>;
  const attentionCount = m.leads.filter(needs).length;
  async function move(lead, target) {
    if (columnOf(lead) === target) return;
    setBusy(true);
    try {
      const lostReason = target === "Lost" ? askLostReason(lead.name) : "";
      if (target === "Lost" && !lostReason) return;
      await crmSend("PATCH", `leads/${lead.id}`, target === "Lost" ? { deal: target, lostReason } : { deal: target });
      await crm.reload();
      notify(`${lead.name} moved to ${target}`);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false); setDragId(""); setOver("");
    }
  }
  const step = (lead, by) => { const next = COLUMNS[COLUMNS.indexOf(columnOf(lead)) + by]; if (next) move(lead, next); };
  const clear = () => { setFind(""); setMonth(false); setIdle(false); setAttention(false); };
  return (
    <div className="cw-views">
      <div className="panel">
        <div className="bar">
          {crm.me.lead && <Scope value={scope} onChange={setScope} />}
          <button type="button" className="ic-btn" aria-label="Clear filters" onClick={clear}><Icon name="funnel" size={16} /></button>
          <button type="button" className={`pill-btn ${month ? "on" : ""}`} onClick={() => setMonth(!month)}>Moved: This Month {month && <span className="x">×</span>}</button>
          <button type="button" className={`pill-btn ${idle ? "on" : ""}`} onClick={() => setIdle(!idle)}>No action in{idle ? " 7 days" : ""}</button>
          <button type="button" className={`pill-btn ${attention ? "on" : ""}`} onClick={() => setAttention(!attention)}><Icon name="alert" size={13} /> Needs attention <b className="amber">{attentionCount}</b></button>
          <label className="search right"><Icon name="search" size={15} /><input type="search" placeholder="Search deal name or company" value={find} onChange={(e) => setFind(e.target.value)} /></label>
        </div>
        {!table && deals.length > 0 && (
          <div className="board board--deals">
            {COLUMNS.map((s) => {
              const list = deals.filter((l) => columnOf(l) === s);
              return (
                <section key={s} className={`col ${over === s ? "col--drop" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver("")} onDrop={(e) => { e.preventDefault(); const l = m.byId.get(dragId); if (l) move(l, s); }}>
                  <header className="col__head"><b>{s}</b><span className="n">{list.length}</span><small>{money(list.reduce((t, l) => t + l.value, 0))}</small></header>
                  {list.slice(0, 40).map((l) => (
                    <article key={l.id} className="deal" draggable onDragStart={() => setDragId(l.id)} onDragEnd={() => { setDragId(""); setOver(""); }}>
                      <button type="button" className="deal__body" onClick={() => setOpenId(l.id)}>
                        <b>{l.name}</b><span>{l.company}</span>
                        <span className="deal__meta">{l.value ? money(l.value) : "No value yet"} · {l.owner || "Unassigned"}</span>
                      </button>
                      <footer>
                        <button type="button" aria-label="Move back" disabled={busy || s === COLUMNS[0]} onClick={() => step(l, -1)}>‹</button>
                        {needs(l) ? <em className="warn">Needs attention</em> : <small>{lastWorked(l) ? ago(lastWorked(l)) : "Not worked"}</small>}
                        <button type="button" aria-label="Move forward" disabled={busy || s === COLUMNS.at(-1)} onClick={() => step(l, 1)}>›</button>
                      </footer>
                    </article>
                  ))}
                  {list.length > 40 && <p className="col__empty">+ {list.length - 40} more. Search to narrow them down.</p>}
                  {!list.length && <p className="col__empty">Drop deals here</p>}
                </section>
              );
            })}
          </div>
        )}
        {table && (
          <div className="scroll">
            <table>
              <thead><tr><th>Deal</th><th>Stage</th><th>Value</th><th>Owner</th><th>Source</th><th>Last Worked</th><th>Next Followup</th></tr></thead>
              <tbody>
                {deals.slice(page * PAGE, page * PAGE + PAGE).map((l) => (
                  <tr key={l.id}>
                    <td><button type="button" className="lnk" onClick={() => setOpenId(l.id)}>{l.name}</button> <small className="muted">{l.company}</small></td>
                    <td><em className={`st st--${l.stage.toLowerCase()}`}>{columnOf(l)}</em></td><td>{money(l.value)}</td><td>{l.owner || "—"}</td><td>{l.source}</td><td>{ago(lastWorked(l))}</td><td>{l.nextFollowUp ? ago(l.nextFollowUp) : ""}</td>
                  </tr>
                ))}
                {!deals.length && <tr><td colSpan={7} className="none">No opportunities match your filters.</td></tr>}
              </tbody>
            </table>
            <Pager total={deals.length} page={page} setPage={setPage} />
          </div>
        )}
        {!table && !deals.length && (
          <div className="empty"><span className="empty__ic"><Icon name="funnel" size={20} /></span><b>No opportunities match your filters</b><p>Clear the search, date, source, or inactivity filters to widen the pipeline.</p><button type="button" className="solid" onClick={clear}><Icon name="close" size={13} /> Clear filters</button></div>
        )}
      </div>
      {openId && <LeadPanel id={openId} onClose={() => setOpenId("")} />}
    </div>
  );
}

// ---------------------------------------------------------------- To-dos
const WHEN = [["2h", "In 2 hours"], ["tomorrow", "Tomorrow"], ["2d", "In 2 days"], ["week", "Later this week"], ["next", "Next week"], ["pick", "Choose date and time"]];
function dueFor(key, custom) {
  const at = (days, hour = 10) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d; };
  if (key === "2h") return new Date(Date.now() + 2 * 3600000);
  if (key === "tomorrow") return at(1);
  if (key === "2d") return at(2);
  if (key === "week") return at(new Date().getDay() >= 5 ? 1 : 5 - new Date().getDay());
  if (key === "next") return at(8 - (new Date().getDay() || 7));
  const picked = new Date(custom);
  return Number.isNaN(picked.getTime()) ? null : picked;
}

function NewTask({ onClose }) {
  const crm = useCrm();
  const notify = useToast();
  const [search, setSearch] = useState("");
  const [leadId, setLeadId] = useState("");
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("2h");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const needle = search.trim().toLowerCase();
  const matches = crm.leads.filter((l) => !l.archived && (!needle || `${l.name} ${l.company || ""}`.toLowerCase().includes(needle))).slice(0, 30);
  async function save(event) {
    event.preventDefault();
    const lead = crm.leadById.get(leadId);
    if (!lead) return notify("Choose a lead first");
    const due = dueFor(when, custom);
    if (!due) return notify("Choose a date and time");
    setBusy(true);
    try {
      await crmSend("POST", "tasks", { leadId, title: title.trim(), due: due.toISOString(), status: "Open", owner: lead.owner || crm.me.id || "" });
      await crm.reload();
      notify("Task created");
      onClose();
    } catch (e) {
      notify(e.message);
      setBusy(false);
    }
  }
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <form className="dialog" role="dialog" aria-modal="true" aria-label="Create task" onSubmit={save}>
        <h2>Create task</h2>
        <label>Find the lead<input type="search" placeholder="Name or company" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <label>Lead<select value={leadId} onChange={(e) => setLeadId(e.target.value)} required><option value="">Choose a lead…</option>{matches.map((l) => <option key={l.id} value={l.id}>{l.name}{l.company ? ` · ${l.company}` : ""}</option>)}</select></label>
        <label>What's next<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example: send the quotation" required maxLength={300} /></label>
        <div className="chips-row" role="group" aria-label="Next follow-up">
          <span>Next follow-up</span>
          {WHEN.map(([k, t]) => <button type="button" key={k} className={`pill-btn ${when === k ? "on" : ""}`} onClick={() => setWhen(k)}>{t}</button>)}
        </div>
        {when === "pick" && <label>Date and time<DateTimePicker value={custom} onChange={setCustom} ariaLabel="Date and time" required /></label>}
        <div className="dialog__row"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button type="submit" className="solid" disabled={busy}>Create task</button></div>
      </form>
    </>
  );
}

export function CwTodos({ params }) {
  const [crm, m] = useModel();
  const notify = useToast();
  const table = params.tab === "table";
  const [scope, setScope] = useState("all");
  const [find, setFind] = useState("");
  const [dueToday, setDueToday] = useState(false);
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState("");
  const today = startOfDay(Date.now());
  const rows = useMemo(() => {
    if (!crm.state) return [];
    const needle = find.trim().toLowerCase();
    return crm.tasks.map((t) => ({ t, lead: m.byId.get(t.leadId), due: Date.parse(t.due), done: t.status === "Done" }))
      .filter((r) => r.lead && (scope === "all" || r.t.owner === crm.me.id) && (!needle || `${r.t.title} ${r.lead.name}`.toLowerCase().includes(needle)) && (!dueToday || (!r.done && r.due >= today && r.due < today + DAY)))
      .sort((a, b) => a.due - b.due);
  }, [crm.state, crm.tasks, m, scope, find, dueToday, today]);
  if (!crm.state) return <p className="muted">{crm.error || "Loading to-dos…"}</p>;
  const open = rows.filter((r) => !r.done);
  const cols = [
    { id: "today", title: "Getting Due Today", tone: "blue", items: open.filter((r) => r.due >= today && r.due < today + DAY && r.due >= Date.now() - 12 * 3600000 && r.due < today + 2 * 3600000) },
    { id: "now", title: "Follow up Today", tone: "blue", items: open.filter((r) => r.due >= today && r.due < today + DAY) },
    { id: "soon", title: "Upcoming", tone: "green", items: open.filter((r) => r.due >= today + DAY) },
    { id: "over", title: "Overdue", tone: "red", items: open.filter((r) => r.due < today) },
    { id: "done", title: "Done", tone: "green", items: rows.filter((r) => r.done && Date.parse(r.t.updatedAt || r.t.due) > Date.now() - 7 * DAY) },
  ].filter((c) => c.id !== "today");
  async function done(task) {
    setBusy(task.id);
    try { await crmSend("PATCH", `tasks/${task.id}`, { status: "Done" }); await crm.reload(); notify("Follow-up marked done"); } catch (e) { notify(e.message); } finally { setBusy(""); }
  }
  const calls = (lead) => lead.activities.filter((a) => a.kind === "call" || a.kind === "whatsapp").slice(0, 5);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  return (
    <div className="cw-views">
      <div className="panel">
        <div className="bar">
          {crm.me.lead && <Scope value={scope} onChange={setScope} />}
          {table ? <button type="button" className={`pill-btn pill-btn--hot ${dueToday ? "" : "off"}`} onClick={() => setDueToday(!dueToday)}>Due Today</button> : <span className="pill-btn pill-btn--grey">No Action In</span>}
          <input className={`under-search ${table ? "right" : ""}`} type="search" placeholder="Type first three letters...." value={find} onChange={(e) => { setFind(e.target.value); setPage(0); }} aria-label="Search tasks" />
          <button type="button" className="ic-btn" aria-label="Create task" onClick={() => setCreating(true)}><Icon name="people" size={18} /><span className="plus">+</span></button>
        </div>
        {!table ? (
          <div className="kanban">
            {cols.map((c) => (
              <section key={c.id} className="kcol">
                <header className={`kcol__head kcol__head--${c.tone}`}><b>{c.title}</b><span className="n">{c.items.length}</span></header>
                {c.items.slice(0, 40).map(({ t, lead, due, done: isDone }) => {
                  const d = dueText(t.due);
                  return (
                    <article key={t.id} className="task">
                      <header>
                        <button type="button" className="task__title" onClick={() => setOpenId(lead.id)}>{t.title}</button>
                        {isDone ? <span className="badge badge--done">Completed : {ago(Date.parse(t.updatedAt || t.due))}</span> : <span className={`badge ${c.id === "over" ? "badge--late" : ""}`}><Icon name="again" size={11} /> {d?.text}</span>}
                      </header>
                      <div className="task__lead"><SrcChip source={lead.source} /><b>{lead.name}</b><span className="owner-dot">{lead.owner || "Unassigned"}</span></div>
                      <p className="task__stage">Last Deal Stage: {stageText(lead.raw)}</p>
                      {!isDone && c.id === "over" && <footer className="task__foot"><em className="idle">OVERDUE</em><span className="calls">{calls(lead).map((a) => <i key={a.id} className={`call ${a.kind === "call" && !a.connected ? "call--bad" : ""}`}><Icon name={a.kind === "call" ? "phone" : "chat"} size={10} />{ago(a.at).replace(" ago", "")}</i>)}</span></footer>}
                      {!isDone && <button type="button" className="task__done" disabled={busy === t.id} onClick={() => done(t)}><Icon name="check" size={12} /> Mark done</button>}
                    </article>
                  );
                })}
                {c.items.length > 40 && <p className="muted">+ {c.items.length - 40} more. Search to narrow them down.</p>}
              </section>
            ))}
          </div>
        ) : (
          <>
            <div className="scroll">
              <table>
                <thead><tr><th>Contact</th><th>Lead Source</th><th>Task Type</th><th>Task Owner</th><th>Status</th><th>Next Followup On</th><th>Started Working</th><th>Last Worked</th><th>Attempts</th><th>Recent Actions</th></tr></thead>
                <tbody>
                  {rows.slice(page * PAGE, page * PAGE + PAGE).map(({ t, lead, due, done: isDone }) => (
                    <tr key={t.id}>
                      <td><button type="button" className="lnk" onClick={() => setOpenId(lead.id)}>{lead.name}</button></td><td>{lead.source}</td><td>{t.title}</td><td>{lead.owner || "—"}</td>
                      <td><em className={`status ${isDone ? "status--done" : due < Date.now() ? "status--late" : ""}`}>{isDone ? "Done" : due < Date.now() ? "Overdue" : "Open"}</em></td>
                      <td>{isDone ? "" : dateTime(due)}</td><td>{ago(lead.activities.at(-1)?.at)}</td><td>{ago(lead.activities[0]?.at)}</td><td>{lead.activities.filter((a) => a.kind === "call").length}</td>
                      <td><span className="calls">{calls(lead).map((a) => <i key={a.id} className={`call ${a.kind === "call" && !a.connected ? "call--bad" : ""}`}><Icon name={a.kind === "call" ? "phone" : "chat"} size={10} />{ago(a.at).replace(" ago", "")}</i>)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rows.length && <div className="empty"><span className="empty__ic"><Icon name="task" size={20} /></span><b>No {dueToday ? "Due Today" : "tasks"} here</b><p>Tasks and follow-ups matching this view will appear here.</p><button type="button" className="solid" onClick={() => setCreating(true)}>Create task</button></div>}
            </div>
            <footer className="pager"><span>{rows.length ? page * PAGE + 1 : 0} to {Math.min(rows.length, (page + 1) * PAGE)} of {rows.length}</span><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button><span>Page {page + 1} of {pages}</span><button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>›</button></footer>
          </>
        )}
      </div>
      {creating && <NewTask onClose={() => setCreating(false)} />}
      {openId && <LeadPanel id={openId} onClose={() => setOpenId("")} />}
    </div>
  );
}

// ---------------------------------------------------------------- Engagements
const ICON = { call: "phone", note: "note", whatsapp: "chat", stage: "trend" };
export function CwEngagements({ params }) {
  const [crm, m] = useModel();
  const [scope, setScope] = useState("all");
  const [find, setFind] = useState("");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState("");
  const calls = params.tab === "calls";
  const rows = useMemo(() => {
    if (!m) return [];
    const needle = find.trim().toLowerCase();
    return m.allActivities.filter((a) => (!calls || a.kind === "call") && a.kind !== "stage" && (scope === "all" || a.by === m.me) && (!needle || `${a.lead.name} ${a.text}`.toLowerCase().includes(needle)));
  }, [m, calls, scope, find]);
  const recordings = useMemo(() => new Map((crm.calls || []).filter((c) => c.recordingId).map((c) => [c.activityId, c.recordingId])), [crm.calls]);
  if (!crm.state) return <p className="muted">{crm.error || "Loading engagements…"}</p>;
  const status = (a) => (a.kind === "call" ? (a.connected ? "Completed" : a.dir === "in" ? "Missed" : "Not answered") : "Completed");
  return (
    <div className="cw-views">
      <div className="panel">
        <div className="bar">
          {crm.me.lead && <Scope value={scope} onChange={(s) => { setScope(s); setPage(0); }} />}
          <input className="under-search right" type="search" placeholder="Type first 3 letters..." value={find} onChange={(e) => { setFind(e.target.value); setPage(0); }} aria-label="Search engagements" />
        </div>
        <div className="scroll">
          <table>
            <thead><tr><th className="w-lead">Lead</th><th>Lead Source</th><th className="c">Engagement Type</th><th>What happened</th><th>Engagement Status</th><th>Engagement Owner</th><th>Last Updated</th>{calls && <th>Recording</th>}</tr></thead>
            <tbody>
              {rows.slice(page * PAGE, page * PAGE + PAGE).map((a) => (
                <tr key={a.id}>
                  <td className="w-lead"><span className="lead-cell"><SrcChip source={a.lead.source} /><button type="button" className="lnk" onClick={() => setOpenId(a.lead.id)}>{a.lead.name}</button><em className={`tag tag--${a.lead.stage.toLowerCase()}`}>{stageText(a.lead.raw)}</em></span></td>
                  <td>{a.lead.source}</td>
                  <td className="c"><Icon name={ICON[a.kind] || "dot"} size={15} /></td>
                  <td>{a.text}</td>
                  <td><em className={`done ${status(a) !== "Completed" ? "done--bad" : ""}`}>{status(a)}</em></td>
                  <td>{a.by ? <span className="owner"><i>{initials(a.by)}</i>{a.by}</span> : "—"}</td>
                  <td>{ago(a.at)}</td>
                  {calls && <td>{recordings.get(a.id) ? <Recording id={recordings.get(a.id)} /> : ""}</td>}
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={calls ? 8 : 7} className="none">{calls ? "No calls yet. Calls synced from the phone app are listed here." : "Nothing logged yet."}</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager total={rows.length} page={page} setPage={setPage} />
      </div>
      {openId && <LeadPanel id={openId} onClose={() => setOpenId("")} />}
    </div>
  );
}

// ---------------------------------------------------------------- Conversations
const stamp = (x) => Date.parse(x.occurredAt || x.createdAt);
export function CwConversations({ params }) {
  const [crm, m] = useModel();
  const [scope, setScope] = useState("all");
  const [win, setWin] = useState("all");
  const [filter, setFilter] = useState("all");
  const [find, setFind] = useState("");
  const [open, setOpen] = useState("");
  const [openLead, setOpenLead] = useState("");
  const threads = useMemo(() => {
    if (!m) return [];
    const by = new Map();
    for (const x of crm.state.messages || []) by.set(x.conversationId, [...(by.get(x.conversationId) || []), x]);
    return (crm.state.conversations || []).filter((c) => c.channel === "WhatsApp").map((c) => {
      const messages = (by.get(c.id) || []).sort((a, b) => stamp(a) - stamp(b));
      const last = messages.at(-1);
      return { ...c, lead: m.byId.get(c.leadId), messages, last, waiting: Boolean(last) && last.direction !== "Outgoing" };
    }).sort((a, b) => (b.last ? stamp(b.last) : 0) - (a.last ? stamp(a.last) : 0));
  }, [m, crm.state]);
  if (!crm.state) return <p className="muted">{crm.error || "Loading conversations…"}</p>;
  const needle = find.trim().toLowerCase();
  const inScope = threads.filter((t) => (scope === "all" || t.lead?.ownerId === crm.me.id) && (win === "all" || (t.last && stamp(t.last) > Date.now() - (win === "24h" ? DAY : 7 * DAY))) && (!needle || `${t.lead?.name || ""} ${t.last?.text || ""}`.toLowerCase().includes(needle)));
  const waiting = inScope.filter((t) => t.waiting).length;
  const shown = inScope.filter((t) => filter === "all" || (filter === "waiting" ? t.waiting : !t.waiting));
  const current = threads.find((t) => t.id === open);
  if (params.tab === "stats")
    return (
      <div className="cw-views"><div className="panel"><div className="stat-grid">
        {[["Chats", threads.length], ["Waiting for a reply", threads.filter((t) => t.waiting).length], ["Replied", threads.filter((t) => t.last && !t.waiting).length], ["Messages", (crm.state.messages || []).length]].map(([label, n]) => <div key={label} className="stat-card"><b>{n.toLocaleString("en-IN")}</b><span>{label}</span></div>)}
      </div></div></div>
    );
  return (
    <div className="cw-views">
      <div className="panel">
        <div className="bar bar--chat">
          {crm.me.lead && <Scope value={scope} onChange={setScope} />}
          <span className="win">{[["24h", "24h"], ["7d", "7d"], ["all", "All"]].map(([k, t]) => <button key={k} type="button" className={win === k ? "on" : ""} onClick={() => setWin(k)}>{t}</button>)}</span>
          <div className="stats">{[["all", "All chats", inScope.length], ["waiting", "Waiting for reply", waiting], ["replied", "Replied", inScope.length - waiting]].map(([k, t, n]) => <button key={k} type="button" className={`stat ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}><b>{n}</b><small>{t}</small></button>)}</div>
          <label className="search right"><Icon name="search" size={15} /><input type="search" placeholder="Search chat..." value={find} onChange={(e) => setFind(e.target.value)} /></label>
        </div>
        {!threads.length ? (
          <div className="empty"><span className="empty__ic"><Icon name="chat" size={20} /></span><b>No messages yet</b><p>An administrator can link WhatsApp in Settings. Chats appear here once a customer's number matches a lead.</p></div>
        ) : (
          <div className="scroll">
            <table>
              <thead><tr><th className="w-lead">Lead Name</th><th>Last Message</th><th>Last Message Time</th><th>Last Message By</th><th>Needs Attention</th><th>Chat Owner</th></tr></thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={t.id}>
                    <td className="w-lead"><span className="lead-cell"><i className="src src--wa"><Icon name="chat" size={11} /></i><button type="button" className="lnk" onClick={() => setOpen(t.id === open ? "" : t.id)}>{t.lead?.name || "Unknown lead"}</button>{t.lead && <em className={`tag tag--${t.lead.stage.toLowerCase()}`}>{stageText(t.lead.raw)}</em>}</span></td>
                    <td className="msg">{t.last?.text?.slice(0, 80) || "No text synced"}</td>
                    <td>{t.last ? ago(stamp(t.last)) : ""}</td>
                    <td>{t.last ? (t.waiting ? "Customer" : "Our team") : ""}</td>
                    <td>{t.last ? <span className={`attn ${t.waiting ? "" : "attn--read"}`}>{t.waiting ? "Not Replied" : "Replied"}</span> : ""}</td>
                    <td>{t.lead?.owner ? <span className="owner"><i>{initials(t.lead.owner)}</i>{t.lead.owner}</span> : <span className="muted">No owner</span>}</td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={6} className="none">No chats match this view.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {current && (
          <div className="chat-pane">
            <header><b>{current.lead?.name || "Unknown lead"}</b>{current.lead && <button type="button" className="lnk" onClick={() => setOpenLead(current.lead.id)}>Open lead</button>}<button type="button" className="lnk" onClick={() => setOpen("")}>Close chat</button></header>
            <div className="chat-pane__body">
              {!current.messages.length && <p className="muted">No message text synced yet.</p>}
              {current.messages.map((x) => <article key={x.id} className={`bubble ${x.direction === "Outgoing" ? "out" : ""}`}><p>{x.text}</p><small>{x.sender || (x.direction === "Outgoing" ? "Our team" : "Customer")}{x.numberLabel ? ` · ${x.numberLabel}` : ""}, {dateTime(stamp(x))}</small></article>)}
            </div>
          </div>
        )}
      </div>
      {openLead && <LeadPanel id={openLead} onClose={() => setOpenLead("")} />}
    </div>
  );
}
