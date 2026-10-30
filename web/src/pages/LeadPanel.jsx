import React, { useEffect, useMemo, useRef, useState } from "react";
import { crmSend } from "../api.js";
import { useCrm, userName, phoneLabel, telHref, waHref, STAGES, stageText } from "../crm.jsx";
import { useToast } from "../toast.jsx";
import { when, day, rupees, dueText, timeOnly, dayLabel, minutes } from "../format.js";
import Icon from "../icons.jsx";
import Recording from "../Recording.jsx";

const OUTCOMES = ["Interested", "Callback", "No answer", "Not interested", "Connected"];
const ICON = { Call: "phone", Note: "note", Message: "chat", Visit: "pin", System: "dot" };
const tagClass = (lead) => (lead.stage === "Closed" ? (lead.disposition === "Won" ? "tag-WON" : "tag-LOST") : lead.stage === "New" ? "tag-FRESH" : "tag-ACTIVE");

// Local date and time in the format of a datetime-local box.
const localInput = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
function atTen(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(10, 0, 0, 0);
  return localInput(d);
}

export function Facts({ rows }) {
  return (
    <dl className="facts">
      {rows.map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{value || <span className="muted">Not recorded</span>}</dd></div>
      ))}
    </dl>
  );
}

function Timeline({ items }) {
  const groups = [];
  for (const item of items) {
    const label = dayLabel(item.createdAt);
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push(item);
  }
  if (!items.length) return <p className="empty">Nothing has been recorded for this lead yet.</p>;
  return groups.map((g) => (
    <section key={g.label}>
      <h3 className="tl-day">{g.label}</h3>
      <ul className="timeline">
        {g.items.map((a) => (
          <li key={a.id} className="tl-item">
            <span className="tl-icon"><Icon name={ICON[a.type] || "dot"} size={16} /></span>
            <span>
              <span className="tl-what">{a.text || a.type}</span>
              <br /><span className="tl-when">{timeOnly(a.createdAt)}{a.outcome ? `, ${a.outcome}` : ""}</span>
              {a.voiceNoteId && <Recording id={a.voiceNoteId} ai={false} />}
            </span>
          </li>
        ))}
      </ul>
    </section>
  ));
}

export function Update({ lead, crm }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(lead.stage);
  const [disposition, setDisposition] = useState(lead.disposition || "");
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState("");
  const [callText, setCallText] = useState("");
  const [duration, setDuration] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(atTen(1));
  const tasks = crm.openTasks.filter((t) => t.leadId === lead.id).sort((a, b) => a.due.localeCompare(b.due));
  const closing = stage === "Closed";

  async function change(label, call) {
    setBusy(true);
    try {
      await call();
      await crm.reload();
      notify(label);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h3>Log a call</h3>
      <form className="work-form" onSubmit={(e) => {
        e.preventDefault();
        change("Call saved", async () => { await crmSend("POST", "activities", { leadId: lead.id, type: "Call", direction: "Outgoing", outcome, text: callText || `${outcome} call`, duration: Number(duration) || 0 }); setCallText(""); setDuration(""); setOutcome(""); });
      }}>
        <select className="field-input" value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="What happened on the call" required>
          <option value="">What happened?</option>
          {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <input className="field-input" value={callText} onChange={(e) => setCallText(e.target.value)} placeholder="What was discussed (optional)" aria-label="Call summary" maxLength={4000} />
        <input className="field-input" type="number" min="0" max="86400" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="Talk time in seconds (optional)" aria-label="Talk time in seconds" />
        <button className="btn btn-primary" disabled={busy}>Save call</button>
      </form>

      <h3>Next follow-up</h3>
      <ul className="work-tasks">
        {tasks.map((t) => {
          const d = dueText(t.due);
          return (
            <li key={t.id}>
              <span><b>{t.title}</b> <span className={d.tone}>{d.text}</span></span>
              <button className="btn" disabled={busy} onClick={() => change("Follow-up marked done", () => crmSend("PATCH", `tasks/${t.id}`, { status: "Done" }))}>Done</button>
            </li>
          );
        })}
      </ul>
      <form className="work-form" onSubmit={(e) => {
        e.preventDefault();
        change("Follow-up added", async () => { await crmSend("POST", "tasks", { leadId: lead.id, title, due: new Date(due).toISOString(), status: "Open", owner: lead.owner || crm.me.id || "" }); setTitle(""); });
      }}>
        <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What to do, for example Send quotation" aria-label="Follow-up task" required maxLength={300} />
        <input className="field-input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due" required />
        <span className="work-quick">
          <button type="button" className="btn btn-quiet" onClick={() => setDue(atTen(1))}>Tomorrow</button>
          <button type="button" className="btn btn-quiet" onClick={() => setDue(atTen(3))}>In 3 days</button>
          <button type="button" className="btn btn-quiet" onClick={() => setDue(atTen(7))}>Next week</button>
        </span>
        <button className="btn btn-primary" disabled={busy}>Add follow-up</button>
      </form>

      <h3>Note</h3>
      <form className="work-form" onSubmit={(e) => {
        e.preventDefault();
        change("Note saved", async () => { await crmSend("POST", "activities", { leadId: lead.id, type: "Note", text: note }); setNote(""); });
      }}>
        <textarea className="field-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What the customer said, what they need" aria-label="Note" required maxLength={4000} />
        <button className="btn" disabled={busy}>Save note</button>
      </form>

      <h3>Stage</h3>
      <form className="work-form" onSubmit={(e) => {
        e.preventDefault();
        change(`Moved to ${closing ? disposition : STAGES.find(([k]) => k === stage)[1]}`, () => crmSend("PATCH", `leads/${lead.id}`, { stage, disposition: closing ? disposition : "" }));
      }}>
        <select className="field-input" value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">
          {STAGES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        {closing && (
          <select className="field-input" value={disposition} onChange={(e) => setDisposition(e.target.value)} aria-label="Won or lost" required>
            <option value="">Won or lost?</option>
            <option value="Won">Won</option>
            <option value="Lost">Lost</option>
          </select>
        )}
        <button className="btn" disabled={busy || (stage === lead.stage && (!closing || disposition === (lead.disposition || "")))}>Change stage</button>
      </form>

      {crm.me.lead && (
        <>
          <h3>Owner</h3>
          <form className="work-form" onSubmit={(e) => {
            e.preventDefault();
            change("Owner changed", () => crmSend("PATCH", `leads/${lead.id}`, { owner: new FormData(e.currentTarget).get("owner") }));
          }}>
            <select className="field-input" name="owner" defaultValue={lead.owner || ""} aria-label="Owner" key={lead.owner}>
              <option value="">No owner</option>
              {crm.me.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <button className="btn" disabled={busy}>Change owner</button>
          </form>
        </>
      )}
    </>
  );
}

export default function LeadPanel({ id, onClose }) {
  const crm = useCrm();
  const lead = crm.leadById.get(id);
  const [tab, setTab] = useState("overview");
  const closeButton = useRef(null);
  const notify = useToast();
  useEffect(() => closeButton.current?.focus(), [id]);
  useEffect(() => setTab("overview"), [id]);
  const activities = useMemo(() => crm.activities.filter((a) => a.leadId === id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))), [crm.activities, id]);
  const calls = useMemo(() => crm.calls.filter((c) => c.leadId === id).sort((a, b) => b.startedAt - a.startedAt), [crm.calls, id]);
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      notify("Phone number copied");
    } catch {
      notify("Could not copy. Select the number and copy it by hand.");
    }
  }
  const due = lead && crm.nextDue.get(lead.id) ? dueText(crm.nextDue.get(lead.id)) : null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={lead ? `Lead ${lead.name}` : "Lead"}>
        <header className="drawer-head">
          <button ref={closeButton} className="icon-btn drawer-close" onClick={onClose} aria-label="Close lead"><Icon name="close" /></button>
          {!lead && <p className="muted">{crm.state ? "This lead is not available to you." : "Loading lead…"}</p>}
          {lead && (
            <>
              <h2 className="drawer-title">{lead.name}</h2>
              <div className="drawer-line">
                <span className={`tag ${tagClass(lead)}`}>{stageText(lead)}</span>
                {lead.repeat ? <span className="note note-good">Came back</span> : null}
                <span className="muted">{lead.owner ? `With ${userName(crm, lead.owner)}` : "No owner yet"}</span>
              </div>
              <div className="drawer-actions">
                {lead.phone ? (
                  <>
                    <a className="btn btn-primary" href={telHref(lead)}><Icon name="phone" />Call {phoneLabel(lead)}</a>
                    <a className="btn" href={waHref(lead)} target="_blank" rel="noopener noreferrer"><Icon name="chat" />WhatsApp</a>
                    <button className="btn btn-quiet" onClick={() => copy(lead.phone)}><Icon name="copy" />Copy number</button>
                  </>
                ) : <span className="muted">No phone number on this lead.</span>}
              </div>
            </>
          )}
        </header>
        {lead && (
          <>
            <div className="tabs" role="tablist" aria-label="Lead sections">
              {[["overview", "Overview"], ["work", "Update"], ["timeline", "Timeline"]].map(([key, label]) => (
                <button key={key} className="tab" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>
              ))}
            </div>
            <div className="drawer-body" role="tabpanel">
              {tab === "timeline" ? <Timeline items={activities} /> : tab === "work" ? <Update key={lead.id} lead={lead} crm={crm} /> : (
                <>
                  <h3>Work so far</h3>
                  <Facts rows={[
                    ["First call or message", lead.firstTouchAt && when(lead.firstTouchAt)],
                    ["Calls", lead.callCount ? `${lead.callCount}, ${lead.connectedCalls || 0} answered` : ""],
                    ["Talk time", lead.totalCallSeconds ? minutes(Math.max(1, Math.round(lead.totalCallSeconds / 60))) : ""],
                    ["Next follow-up", due && <span className={due.tone}>{when(crm.nextDue.get(lead.id))}, {due.text}</span>],
                  ]} />
                  <h3>Details</h3>
                  <Facts rows={[
                    ["Company", lead.company], ["City", lead.city], ["Email", lead.email], ["Value", lead.value ? rupees(lead.value) : ""],
                    ["Source", lead.source], ["Captured", lead.createdAt && day(lead.createdAt)],
                  ]} />
                  {calls.length > 0 && (
                    <>
                      <h3>Recent calls</h3>
                      <ul className="work-calls">
                        {calls.slice(0, 8).map((c) => (
                          <li key={c.id}><span><b>{c.direction === "Outgoing" ? "Called" : c.direction === "Incoming" ? "Received" : c.direction}</b> {when(new Date(c.startedAt).toISOString())}
                            <small className="muted"> {c.duration > 0 ? `talked ${minutes(Math.max(1, Math.round(c.duration / 60)))}` : "not answered"}</small></span>{c.recordingId && <Recording id={c.recordingId} />}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
