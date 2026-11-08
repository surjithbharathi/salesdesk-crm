import React, { useMemo, useState } from "react";
import { crmSend } from "../api.js";
import { useCrm, userName, stageText } from "../crm.jsx";
import { useToast } from "../toast.jsx";
import { dueText, initials } from "../format.js";
import Icon from "../icons.jsx";
import LeadPanel from "./LeadPanel.jsx";
import { ms, relTime } from "./tele.js";

// "To-dos" in the Salesmax style: follow-ups as a board (overdue, due today, upcoming, completed) or as a table.
// Read from this CRM's own tasks; nothing is copied from Salesmax.

const DAY = 86400000;
const PAGE = 25;
const CAP = 40;
const startOfToday = () => new Date().setHours(0, 0, 0, 0);

function Card({ task, lead, owner, tone, busy, onDone, onOpen }) {
  const due = task.status === "Done" ? null : dueText(task.due);
  return (
    <article className="max-task">
      <header>
        <button className="max-task-title" onClick={onOpen}>{task.title}</button>
        {task.status === "Done"
          ? <span className="max-badge done">Done {relTime(task.updatedAt || task.due)}</span>
          : <span className={`max-badge ${tone}`}><Icon name="again" size={11} /> {due?.text}</span>}
      </header>
      <p className="max-task-lead"><span className="avatar">{initials(lead?.name || "?")}</span><b>{lead?.name || "No lead"}</b><span className="muted">{owner}</span></p>
      {lead && <p className="max-task-stage">Stage: {stageText(lead)}</p>}
      {task.status !== "Done" && <button className="btn btn-quiet" disabled={busy} onClick={onDone}><Icon name="check" size={13} /> Mark done</button>}
    </article>
  );
}

export default function MaxTodos({ params }) {
  const crm = useCrm();
  const notify = useToast();
  const table = params.tab === "table";
  const [scope, setScope] = useState("all");
  const [find, setFind] = useState("");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState("");
  const [busy, setBusy] = useState("");
  const [creating, setCreating] = useState(false);
  const today = startOfToday();

  const rows = useMemo(() => {
    if (!crm.state) return [];
    const needle = find.trim().toLowerCase();
    return crm.tasks
      .filter((t) => (scope === "all" || t.owner === crm.me.id) && (!needle || `${t.title} ${crm.leadById.get(t.leadId)?.name || ""}`.toLowerCase().includes(needle)))
      .sort((a, b) => String(a.due).localeCompare(String(b.due)));
  }, [crm.state, crm.tasks, crm.me.id, scope, find]);

  const columns = useMemo(() => {
    const open = rows.filter((t) => t.status !== "Done");
    return [
      ["over", "Overdue", open.filter((t) => ms(t.due) < today)],
      ["today", "Due today", open.filter((t) => ms(t.due) >= today && ms(t.due) < today + DAY)],
      ["soon", "Upcoming", open.filter((t) => ms(t.due) >= today + DAY)],
      ["done", "Completed", rows.filter((t) => t.status === "Done" && ms(t.updatedAt || t.due) > Date.now() - 7 * DAY).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))],
    ];
  }, [rows, today]);

  async function done(task) {
    setBusy(task.id);
    try {
      await crmSend("PATCH", `tasks/${task.id}`, { status: "Done" });
      await crm.reload();
      notify("Follow-up marked done");
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy("");
    }
  }

  if (!crm.state) return <p className="muted">{crm.error || "Loading to-dos…"}</p>;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const slice = rows.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <>
      <section className="max-card" aria-label="To-dos">
        <div className="max-tools">
          {crm.me.lead && (
            <span className="max-toggle" role="group" aria-label="Whose tasks">
              {[["all", "All"], ["mine", "My"]].map(([key, label]) => <button key={key} aria-pressed={scope === key} onClick={() => { setScope(key); setPage(0); }}>{label}</button>)}
            </span>
          )}
          <label className="max-find">
            <Icon name="search" size={14} /><span className="sr">Search tasks</span>
            <input type="search" placeholder="Search task or lead…" value={find} onChange={(e) => { setFind(e.target.value); setPage(0); }} />
          </label>
          <span className="max-spacer" />
          <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Create task</button>
        </div>
        {!table ? (
          <div className="max-board">
            {columns.map(([key, title, list]) => (
              <section key={key} className="max-col" aria-label={title}>
                <header className={`max-col-head ${key}`}><b>{title}</b><span className="num">{list.length}</span></header>
                {list.slice(0, CAP).map((t) => {
                  const lead = crm.leadById.get(t.leadId);
                  return <Card key={t.id} task={t} lead={lead} tone={key} owner={crm.me.lead ? userName(crm, t.owner) : ""} busy={busy === t.id} onDone={() => done(t)} onOpen={() => lead && setOpenId(lead.id)} />;
                })}
                {list.length > CAP && <p className="muted max-more">+ {list.length - CAP} more. Search to narrow them down.</p>}
                {!list.length && <p className="muted max-none">{key === "done" ? "Nothing finished this week" : "Nothing here"}</p>}
              </section>
            ))}
          </div>
        ) : (
          <>
            <div className="max-table-wrap">
              <table className="max-table">
                <thead><tr><th>Contact</th><th>Lead source</th><th>Task</th><th>Owner</th><th>Status</th><th>Due</th><th>Lead stage</th></tr></thead>
                <tbody>
                  {slice.map((t) => {
                    const lead = crm.leadById.get(t.leadId);
                    const late = t.status !== "Done" && ms(t.due) < today;
                    return (
                      <tr key={t.id}>
                        <td>{lead ? <span className="max-lead"><span className="avatar">{initials(lead.name)}</span><button className="max-link" onClick={() => setOpenId(lead.id)}>{lead.name}</button></span> : <span className="muted">No lead</span>}</td>
                        <td>{lead?.source || ""}</td>
                        <td>{t.title}</td>
                        <td>{t.owner ? userName(crm, t.owner) : <span className="muted">No owner</span>}</td>
                        <td><span className={`max-status ${t.status === "Done" ? "done" : late ? "late" : ""}`}>{t.status === "Done" ? "Done" : late ? "Overdue" : "Open"}</span></td>
                        <td>{t.status === "Done" ? "" : new Date(t.due).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</td>
                        <td>{lead ? stageText(lead) : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!rows.length && <div className="empty"><b>No tasks here</b>Create one to plan the next customer action.</div>}
            </div>
            <footer className="max-foot">
              <span className="num">{rows.length ? `${page * PAGE + 1} to ${Math.min(rows.length, page * PAGE + PAGE)} of ${rows.length}` : "0 tasks"}</span>
              <button className="btn btn-quiet" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label="Previous page">‹</button>
              <span className="num">Page {page + 1} of {pages}</span>
              <button className="btn btn-quiet" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} aria-label="Next page">›</button>
            </footer>
          </>
        )}
      </section>
      {creating && <NewTask onClose={() => setCreating(false)} />}
      {openId && <LeadPanel id={openId} onClose={() => setOpenId("")} />}
    </>
  );
}

const WHEN = [["2h", "In 2 hours"], ["tomorrow", "Tomorrow"], ["2d", "In 2 days"], ["week", "Later this week"], ["next", "Next week"], ["pick", "Choose date and time"]];
function dueFor(key, custom) {
  const at = (days, hour = 10) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d; };
  if (key === "2h") return new Date(Date.now() + 2 * 3600000);
  if (key === "tomorrow") return at(1);
  if (key === "2d") return at(2);
  if (key === "week") return at(new Date().getDay() >= 5 ? 1 : 5 - new Date().getDay()); // this Friday, or tomorrow once Friday has come
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
      <div className="max-scrim" onClick={onClose} />
      <form className="max-dialog" role="dialog" aria-modal="true" aria-label="Create task" onSubmit={save}>
        <h2>Create task</h2>
        <label>Find the lead<input className="field-input" type="search" placeholder="Name or company" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <label>Lead
          <select className="field-input" value={leadId} onChange={(e) => setLeadId(e.target.value)} required>
            <option value="">Choose a lead…</option>
            {matches.map((l) => <option key={l.id} value={l.id}>{l.name}{l.company ? ` · ${l.company}` : ""}</option>)}
          </select>
        </label>
        <label>What is next<input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example: send the quotation" required maxLength={300} /></label>
        <div className="max-when" role="group" aria-label="Next follow-up">
          <span>Next follow-up</span>
          {WHEN.map(([key, label]) => <button type="button" key={key} className="max-chipbtn" aria-pressed={when === key} onClick={() => setWhen(key)}>{label}</button>)}
        </div>
        {when === "pick" && <label>Date and time<input className="field-input" type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} required /></label>}
        <div className="max-dialog-row"><button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>Create task</button></div>
      </form>
    </>
  );
}
