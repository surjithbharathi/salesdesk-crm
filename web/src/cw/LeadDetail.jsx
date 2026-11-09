import React, { useEffect, useMemo, useState } from "react";
import { crmSend } from "../api.js";
import { useCrm, phoneLabel, telHref, waHref, stageText } from "../crm.jsx";
import { useToast } from "../toast.jsx";
import { dueText } from "../format.js";
import Icon from "../icons.jsx";
import Recording from "../Recording.jsx";
import GatewayChat from "../GatewayChat.jsx";
import ChatEntry from "../ChatEntry.jsx";
import { PIPELINE, pipelineStep } from "../pipeline.js";
import { buildModel, hms, initials, money, startOfDay } from "./model.js";

// The lead page in the Salesmax style: the lead's profile on the left, its timeline and records on the right.
// The class names are the reference web app's, so its style sheet (cw/detail.css) applies as written. Everything is this CRM's own data.

const CHIPS = [["important", "Important"], ["all", "All"], ["calls", "Calls"], ["notes", "Notes"], ["messages", "Messages"], ["visits", "Visits"]];
const OUTCOMES = ["Interested", "Callback", "No answer", "Not interested", "Connected"];
const ago = (t) => {
  if (t == null) return "";
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 60) return m < 1 ? "just now" : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`;
};
const when = (t) => new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const localInput = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const at10 = (days) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(10, 0, 0, 0); return localInput(d); };
const iconOf = (a) => (a.kind === "call" ? (a.dir === "in" ? "incoming" : "outgoing") : a.kind === "whatsapp" ? "chat" : a.kind === "stage" ? "trend" : a.kind === "visit" ? "pin" : "edit");

export default function CwLeadDetail({ id, onClose }) {
  const crm = useCrm();
  const notify = useToast();
  const [tab, setTab] = useState("interactions");
  const [chip, setChip] = useState("important");
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const [composing, setComposing] = useState("");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState({ name: "", phone: "", company: "" });
  const [stepsHidden, setStepsHidden] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState(() => at10(1));
  const [busy, setBusy] = useState(false);
  const [callForm, setCallForm] = useState(null);
  const m = useMemo(() => (crm.state ? buildModel(crm) : null), [crm.state, crm.leads, crm.activities, crm.users, crm.nextDue]);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && (menu ? setMenu(false) : onClose());
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu, onClose]);

  const raw = crm.leadById.get(id);
  const l = m?.byId.get(id);
  if (!crm.state || !raw || !l) return <div className="cw-detail"><div className="scrim" onClick={onClose} /><div className="sheet"><p className="empty">{crm.error || "Loading the lead…"}</p></div></div>;

  const recordings = new Map((crm.calls || []).filter((c) => c.recordingId).map((c) => [c.activityId, c.recordingId]));
  const rawActs = crm.activities.filter((a) => a.leadId === id);
  const tasks = crm.tasks.filter((t) => t.leadId === id).sort((a, b) => String(a.due).localeCompare(String(b.due)));
  const openTasks = tasks.filter((t) => t.status !== "Done");
  const next = openTasks[0];
  const acts = l.activities;
  const calls = acts.filter((a) => a.kind === "call");
  const interactions = acts.filter((a) => ["call", "whatsapp", "note", "visit"].includes(a.kind));
  const q = search.trim().toLowerCase();
  const timeline = interactions.filter((a) => {
    const keep = chip === "all" ? true : chip === "important" ? (a.kind === "call" && a.connected) || a.kind === "note" || a.kind === "visit" : chip === "calls" ? a.kind === "call" : chip === "notes" ? a.kind === "note" : chip === "messages" ? a.kind === "whatsapp" : a.kind === "visit";
    return keep && (!q || a.text.toLowerCase().includes(q));
  });
  const journey = [
    ...rawActs.filter((a) => a.type === "System").map((a) => ({ text: a.text, at: Date.parse(a.createdAt) })),
    { text: "Lead created", at: Date.parse(raw.createdAt) },
  ].sort((a, b) => b.at - a.at).slice(0, 8);
  const firstTouch = Boolean(raw.firstTouchAt) || calls.length > 0;
  const lastWorked = acts.length ? acts[0].at : null;
  const conversation = (crm.state.conversations || []).find((c) => c.leadId === id && c.channel === "WhatsApp");
  const thread = conversation ? (crm.state.messages || []).filter((x) => x.conversationId === conversation.id).sort((a, b) => Date.parse(a.occurredAt || a.createdAt) - Date.parse(b.occurredAt || b.createdAt)) : [];
  const docs = (crm.state.documents || []).filter((d) => d.leadId === id);
  const tickets = (crm.state.tickets || []).filter((t) => t.leadId === id);
  const counts = { interactions: interactions.length, tasks: tasks.length, deals: raw.value ? 1 : 0, tickets: tickets.length, documents: docs.length };
  const canEdit = crm.me.lead;
  const step = raw.stage === "New" ? "New" : pipelineStep(raw);

  async function run(done, fn) {
    setBusy(true);
    try { await fn(); await crm.reload(); if (done) notify(done); } catch (e) { notify(e.message); } finally { setBusy(false); }
  }
  const patch = (done, body) => run(done, () => crmSend("PATCH", `leads/${id}`, body));
  const logCall = (connected) => run("Call logged", async () => {
    await crmSend("POST", "activities", { leadId: id, type: "Call", text: connected ? "Call logged" : "Call logged, not answered", direction: "Outgoing", duration: connected ? Math.max(0, Number(callForm?.mins || 0)) * 60 : 0, outcome: connected ? callForm?.outcome || "Connected" : "No answer" });
    setCallForm(null); setTab("interactions"); setChip("all");
  });
  const saveNote = () => run("Note saved", async () => { await crmSend("POST", "activities", { leadId: id, type: "Note", text: note.trim() }); setNote(""); setComposing(""); setChip("all"); });
  const visit = () => run("Visit logged", async () => { await crmSend("POST", "activities", { leadId: id, type: "Visit", text: "Visit logged" }); setTab("interactions"); setChip("visits"); });
  const addTask = (e) => { e.preventDefault(); run("Follow-up added", async () => { await crmSend("POST", "tasks", { leadId: id, title: taskTitle.trim(), due: new Date(taskDue).toISOString(), status: "Open", owner: raw.owner || crm.me.id || "" }); setTaskTitle(""); }); };
  const doneTask = (t) => run("Follow-up marked done", () => crmSend("PATCH", `tasks/${t.id}`, { status: "Done" }));
  const saveEdit = (e) => { e.preventDefault(); patch("Contact saved", { name: edit.name.trim(), phone: edit.phone.trim(), company: edit.company.trim() }).then(() => setEditing(false)); };
  const startEdit = () => { setEdit({ name: raw.name, phone: raw.phone || "", company: raw.company || "" }); setEditing(true); };
  const moveTo = (s) => { setMenu(false); patch(`Moved to ${s}`, s === "New" ? { stage: "New", disposition: "", deal: "" } : { deal: s }); };
  const ownerName = l.owner || "Unassigned";
  const dueLabel = (iso) => { const d = dueText(iso); return `${new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}${d?.tone === "late" ? " · overdue" : ""}`; };

  return (
    <div className="cw-detail">
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={l.name}>
        <aside className="side">
          <header className="hero">
            <i className={`hero__src ${l.source === "WhatsApp" ? "hero__src--wa" : ""}`}>{l.source === "WhatsApp" ? <Icon name="chat" size={30} /> : initials(l.name)}</i>
            <div><h2>{l.name}</h2><em className="hero__stage">{stageText(raw)}</em></div>
          </header>

          <section className="box owner">
            <span className="owner__ava">{l.owner ? initials(l.owner) : "—"}</span>
            <span className="owner__who"><small>Owner</small><b>{ownerName}</b></span>
            {canEdit && (reassigning
              ? <select className="owner__pick" value={raw.owner || ""} onChange={(e) => { setReassigning(false); patch("Owner changed", { owner: e.target.value }); }} aria-label="New owner"><option value="">Unassigned</option>{crm.me.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
              : <button type="button" className="ghost" onClick={() => setReassigning(true)}><Icon name="again" size={13} /> Reassign</button>)}
          </section>

          <div className="cta">
            <a className="cta__call" href={telHref(raw)}><Icon name="phone" size={16} /> Call</a>
            <a className="cta__wa" href={waHref(raw)} target="_blank" rel="noopener noreferrer"><Icon name="chat" size={16} /> WhatsApp</a>
          </div>
          <div className="quick">
            <button type="button" onClick={() => { setTab("interactions"); setComposing("note"); }}><Icon name="edit" size={14} /> Note</button>
            <button type="button" onClick={() => { setTab("interactions"); setCallForm({ mins: "", outcome: "Connected" }); }}><Icon name="task" size={14} /> Log call</button>
            <button type="button" onClick={() => setTab("tasks")}><Icon name="check" size={14} /> Task</button>
            <button type="button" disabled={busy} onClick={visit}><Icon name="info" size={14} /> Visit</button>
          </div>

          {calls.length > 0 && (
            <div className="strip">
              <b>{calls.length}</b> calls
              <div className="strip__dots">{calls.slice(0, 5).reverse().map((c) => <span key={c.id} className="strip__dot"><i className={c.connected ? "" : "bad"}><Icon name={c.connected ? "phone" : "missed"} size={12} /></i><small>{ago(c.at)}</small></span>)}</div>
            </div>
          )}
          <dl className="facts">
            <dt><Icon name="square" size={13} /> Type</dt><dd>{l.company ? "BUSINESS" : "OTHER"}</dd>
            <dt><Icon name="trend" size={13} /> Source</dt><dd><span className="src-chip">{String(l.source).toUpperCase()}</span><span className="facts__sub">{phoneLabel(raw)}</span></dd>
          </dl>

          {!stepsHidden && (
            <section className="box steps">
              <header><span><Icon name="alert" size={13} /> Next steps</span><button type="button" aria-label="Hide" onClick={() => setStepsHidden(true)}><Icon name="close" size={13} /></button></header>
              {!firstTouch ? <p><b>{ago(l.createdAt).replace(" ago", "")} since assigned</b> <span>start first touch</span></p> : <p><b>Last worked {ago(lastWorked)}</b> <span>{next ? "follow-up is set" : "set the next follow-up"}</span></p>}
            </section>
          )}

          <section className="box">
            <h3>Up next</h3>
            {next ? (
              <>
                <p className={`soft ${Date.parse(next.due) < Date.now() ? "late" : ""}`}>{next.title} · {dueLabel(next.due)}</p>
                <div className="row"><button type="button" className="ghost" disabled={busy} onClick={() => doneTask(next)}>Mark done</button><button type="button" className="ghost" onClick={() => setTab("tasks")}>Change</button></div>
              </>
            ) : (
              <>
                <p className="soft">{firstTouch ? "No follow-up set yet." : "Follow-ups start after the first call."}</p>
                <div className="row"><button type="button" className="ghost" onClick={() => { setTab("interactions"); setCallForm({ mins: "", outcome: "Connected" }); }}>Log call</button><button type="button" className="ghost" onClick={() => setTab("tasks")}>Add task</button></div>
              </>
            )}
          </section>

          <section className="box">
            <header><h3>Contact details</h3>{canEdit && <button type="button" className="link" onClick={() => (editing ? setEditing(false) : startEdit())}><Icon name="edit" size={13} /> {editing ? "Cancel" : "Edit"}</button>}</header>
            {editing ? (
              <form className="edit" onSubmit={saveEdit}>
                <label>Name<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required /></label>
                <label>Mobile<input type="tel" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></label>
                <label>Business<input value={edit.company} onChange={(e) => setEdit({ ...edit, company: e.target.value })} /></label>
                <button type="submit" className="solid" disabled={busy}>Save</button>
              </form>
            ) : (
              <div className="phone">
                <span className="phone__ic"><Icon name="phone" size={15} /></span>
                <span><small>Phone</small><b>{phoneLabel(raw)}</b></span>
                <a className="mini mini--call" href={telHref(raw)} aria-label="Call"><Icon name="phone" size={13} /></a>
                <a className="mini mini--wa" href={waHref(raw)} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp"><Icon name="chat" size={13} /></a>
              </div>
            )}
            <label className="check-row"><input type="checkbox" checked={Boolean(raw.noCallSync)} disabled={busy} onChange={(e) => patch(e.target.checked ? "Calls with this lead are no longer synced" : "Calls with this lead are synced again", { noCallSync: e.target.checked })} /> Do not sync phone calls with this lead</label>
          </section>

          <section className="box">
            <header><h3>More on this lead</h3></header>
            {raw.value ? <p className="soft">Deal value {money(raw.value)}</p> : <p className="soft">No custom properties set.</p>}
          </section>

          <section className="box">
            <h3>Lead journey</h3>
            <ol className="journey">{journey.map((j, i) => <li key={i} className={i === 0 ? "first" : ""}><span>{j.text}</span><small>{ago(j.at)}</small></li>)}</ol>
          </section>

          <section className="box">
            <header><h3>Businesses</h3></header>
            {l.company ? <p className="biz"><Icon name="people" size={14} /> {l.company}</p> : <p className="soft">No businesses linked yet.</p>}
          </section>
        </aside>

        <section className="main">
          <nav className="tabs" aria-label="Lead records">
            {[["interactions", "again", "Interactions"], ["tasks", "task", "Tasks"], ["deals", "rupee", "Deals"], ["tickets", "square", "Tickets"], ["conversation", "chat", "Conversation"], ["documents", "note", "Documents"], ["activities", "people", "Activities"]].map(([k, icon, label]) => (
              <button key={k} type="button" className={tab === k ? "on" : ""} onClick={() => setTab(k)}><Icon name={icon} size={15} /> {label} {counts[k] != null && counts[k] !== undefined ? <span>{counts[k]}</span> : null}</button>
            ))}
          </nav>
          <div className="top-actions">
            <div className="actions">
              <button type="button" className="actions__btn" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="spark" size={15} /> Actions <Icon name="swap" size={14} /></button>
              {menu && (
                <div className="actions__menu" role="menu">
                  <div className="actions__stages">
                    <small>Change stage or close</small>
                    {["New", ...PIPELINE.map((d) => d.name)].map((s) => <button key={s} type="button" role="menuitem" className={step === s ? "on" : ""} onClick={() => moveTo(s)}>{s}</button>)}
                  </div>
                  <div className="actions__col">
                    <small>Activity</small>
                    <button type="button" role="menuitem" onClick={() => { setMenu(false); setTab("interactions"); setCallForm({ mins: "", outcome: "Connected" }); }}><Icon name="phone" size={15} /> Log call</button>
                    <button type="button" role="menuitem" onClick={() => { setMenu(false); setTab("interactions"); setComposing("note"); }}><Icon name="task" size={15} /> Add note</button>
                    <button type="button" role="menuitem" onClick={() => { setMenu(false); visit(); }}><Icon name="calendar" size={15} /> Log visit</button>
                    <button type="button" role="menuitem" onClick={() => { setMenu(false); setTab("tasks"); }}><Icon name="check" size={15} /> Quick task</button>
                    {canEdit && <button type="button" role="menuitem" onClick={() => { setMenu(false); setReassigning(true); }}><Icon name="userplus" size={15} /> Assign</button>}
                  </div>
                </div>
              )}
            </div>
            <button type="button" className="close" aria-label="Close" onClick={onClose}><Icon name="close" size={22} /></button>
          </div>

          <div className={`body ${tab === "conversation" ? "body--chat" : ""}`}>
            {tab === "interactions" && (
              <>
                <div className="filters">
                  {CHIPS.map(([k, label]) => <button key={k} type="button" className={chip === k ? "on" : ""} onClick={() => setChip(k)}>{chip === k && <Icon name="check" size={14} />} {label}</button>)}
                  <label className="tl-search"><Icon name="search" size={13} /><input type="search" placeholder="Search timeline" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search timeline" /></label>
                </div>
                {composing === "note" && (
                  <form className="composer" onSubmit={(e) => { e.preventDefault(); saveNote(); }}>
                    <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Write a note about this lead…" aria-label="Note" required maxLength={4000} />
                    <div className="row"><button type="button" className="ghost" onClick={() => setComposing("")}>Cancel</button><button type="submit" className="solid" disabled={busy}>Save note</button></div>
                  </form>
                )}
                {callForm && (
                  <form className="composer" onSubmit={(e) => { e.preventDefault(); logCall(true); }}>
                    <label>Outcome<select value={callForm.outcome} onChange={(e) => setCallForm({ ...callForm, outcome: e.target.value })}>{OUTCOMES.map((o) => <option key={o}>{o}</option>)}</select></label>
                    <label>Minutes talked<input type="number" min="0" max="1440" value={callForm.mins} onChange={(e) => setCallForm({ ...callForm, mins: e.target.value })} /></label>
                    <div className="row"><button type="button" className="ghost" onClick={() => setCallForm(null)}>Cancel</button><button type="button" className="ghost" disabled={busy} onClick={() => logCall(false)}>Not answered</button><button type="submit" className="solid" disabled={busy}>Save call</button></div>
                  </form>
                )}
                {timeline.map((a) => {
                  const by = a.by || ownerName;
                  const e = a.kind === "call" ? { id: a.id, kind: "call", out: a.dir === "out", dir: a.dir === "in" ? "Incoming" : "Outgoing", secs: a.secs, by, at: when(a.at), recordingId: recordings.get(a.id) || "" }
                    : a.kind === "whatsapp" ? { id: a.id, kind: "message", out: a.out, text: a.text, sender: a.sender, via: a.via, label: a.label, by, at: when(a.at) }
                    : a.kind === "stage" ? { id: a.id, kind: "system", text: a.text, at: when(a.at) }
                    : { id: a.id, kind: a.kind === "visit" ? "visit" : "note", out: true, text: a.text, by, at: when(a.at) };
                  return <div key={a.id} className="item item--wa"><ChatEntry e={e} /></div>;
                })}
                {!timeline.length && (
                  <div className="empty">
                    <span className="empty__ic"><Icon name="clock" size={24} /></span><b>No {chip === "all" ? "interactions" : `${CHIPS.find(([k]) => k === chip)[1].toLowerCase()} interactions`} yet</b>
                    <p>Calls, messages, notes and visits with this lead show up here as they happen.</p>
                    <div className="row"><button type="button" className="ghost" onClick={() => setChip("all")}>Show all interactions</button><a className="solid solid--blue" href={telHref(raw)}><Icon name="phone" size={14} /> Call</a><button type="button" className="ghost" onClick={() => setComposing("note")}><Icon name="edit" size={14} /> Add note</button></div>
                  </div>
                )}
              </>
            )}
            {tab === "tasks" && (
              <div className="pane">
                {tasks.map((t) => (
                  <div key={t.id} className="item">
                    <span className="item__ic item__ic--note"><Icon name="task" size={15} /></span>
                    <span className="item__body"><b>{t.title}</b><small>{t.status === "Done" ? "Done" : dueLabel(t.due)} · {ownerName}</small></span>
                    {t.status !== "Done" && <button type="button" className="ghost" disabled={busy} onClick={() => doneTask(t)}>Mark done</button>}
                  </div>
                ))}
                <form className="task-form" onSubmit={addTask}>
                  <b>Add a task</b>
                  <input type="datetime-local" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} aria-label="Due" required />
                  <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="What's next? e.g. Send quote" aria-label="Task" required maxLength={300} />
                  <span className="quick-days"><button type="button" className="ghost" onClick={() => setTaskDue(at10(1))}>Tomorrow</button><button type="button" className="ghost" onClick={() => setTaskDue(at10(3))}>In 3 days</button><button type="button" className="ghost" onClick={() => setTaskDue(at10(7))}>Next week</button></span>
                  <button type="submit" className="solid" disabled={busy}>Save task</button>
                </form>
              </div>
            )}
            {tab === "deals" && (
              <div className="pane deal">
                <label>Stage
                  <select value={step} onChange={(e) => moveTo(e.target.value)}><option value="New">New</option>{PIPELINE.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}</select>
                </label>
                <label>Deal value (₹)<input type="number" min="0" defaultValue={raw.value || 0} key={`${id}-${raw.value}`} onBlur={(e) => Number(e.target.value) !== (raw.value || 0) && patch("Deal value saved", { value: Math.max(0, Number(e.target.value) || 0) })} /></label>
                <label>Source<input value={raw.source || ""} readOnly /></label>
              </div>
            )}
            {tab === "conversation" && (
              <div className="chat">
                <header className="chat__head">
                  <span className="chat__ava">{initials(l.name)}</span>
                  <div className="chat__who"><b>{l.name} <em className="chat__stage">{stageText(raw)}</em></b><small>{phoneLabel(raw)}</small></div>
                  <div className="chat__tools"><span className="chat__owner"><Icon name="people" size={14} /> {ownerName}</span><a className="chat__ic" href={telHref(raw)} aria-label="Call"><Icon name="phone" size={16} /></a></div>
                </header>
                <GatewayChat leadId={id} />
                <div className="chat__notice"><Icon name="info" size={14} /> You can also continue in WhatsApp itself. <a href={waHref(raw)} target="_blank" rel="noopener noreferrer">Open WhatsApp</a></div>
              </div>
            )}
            {tab === "documents" && (
              <div className="pane">
                <div className="docs__bar"><b>{docs.length} document{docs.length === 1 ? "" : "s"}</b></div>
                <div className="docs">{docs.map((d) => <article key={d.id} className="doc"><b className="doc__name">{d.name || d.title || "Document"}</b><small>{d.type || "File"} · {ago(Date.parse(d.createdAt))}</small></article>)}</div>
                {!docs.length && <div className="empty"><span className="empty__ic"><Icon name="note" size={24} /></span><b>No documents yet</b><p>Quotes, brochures and pictures shared with this lead show up here.</p></div>}
              </div>
            )}
            {tab === "tickets" && (
              <div className="pane">
                {tickets.map((t) => <div key={t.id} className="item"><span className="item__ic item__ic--meeting"><Icon name="square" size={14} /></span><span className="item__body"><b>{t.subject || t.title || "Ticket"}</b><small>{t.status || "Open"} · {ago(Date.parse(t.createdAt))}</small></span></div>)}
                {!tickets.length && <div className="empty"><span className="empty__ic"><Icon name="square" size={24} /></span><b>No tickets yet</b><p>Support tickets raised for this lead will show up here.</p></div>}
              </div>
            )}
            {tab === "activities" && (
              <ol className="pane acts">
                {acts.map((a) => <li key={a.id}><span className={`item__ic item__ic--${a.kind}`}><Icon name={iconOf(a)} size={14} /></span><span>{a.text}</span><small>{ago(a.at)}</small></li>)}
                {!acts.length && <li><span>Nothing has been recorded for this lead yet.</span></li>}
              </ol>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
