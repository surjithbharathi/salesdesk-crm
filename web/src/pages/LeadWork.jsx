import React, { useState } from "react";
import { v2, v2Send } from "../api.js";
import { useLoad } from "../hooks.js";
import { useToast } from "../toast.jsx";
import { when, dueText, minutes } from "../format.js";

// Local date and time in the box's own format, for example 2026-11-02T10:00.
const localInput = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
function atTen(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(10, 0, 0, 0);
  return localInput(d);
}

export default function LeadWork({ lead, meta, onChanged }) {
  const notify = useToast();
  const [version, setVersion] = useState(0);
  const work = useLoad(() => v2(`/leads/${lead.id}/work`), [lead.id, version]);
  const [busy, setBusy] = useState(false);
  const [statusId, setStatusId] = useState(lead.status_id);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(atTen(1));
  const target = meta.statuses.find((s) => s.id === statusId);
  const closing = target?.stage_group === "LOST";

  async function change(label, call) {
    setBusy(true);
    try {
      await call();
      notify(label);
      setVersion((v) => v + 1);
      onChanged();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h3>Calls</h3>
      {work.data && !work.data.calls.length && <p className="muted">No calls recorded for this lead yet.</p>}
      <ul className="work-calls">
        {(work.data?.calls || []).map((c) => (
          <li key={c.id}>
            <span>
              <b>{c.direction === "Outgoing" ? "Called" : c.direction === "Incoming" ? "Received" : c.direction}</b> {when(c.started_at)}
              <small className="muted"> {c.connected ? `talked ${minutes(Math.max(1, Math.round(c.duration_seconds / 60)))}` : "not answered"}{c.caller ? `, ${c.caller}` : ""}</small>
            </span>
            <select className="field-input" value={c.outcome_id || ""} aria-label="What happened on this call" disabled={busy}
                    onChange={(e) => e.target.value && change("Call outcome saved", () => v2Send("POST", `/calls/${c.id}/outcome`, { outcome: e.target.value }))}>
              <option value="">{c.connected ? "What happened?" : "Outcome"}</option>
              {meta.callOutcomes.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </li>
        ))}
      </ul>

      <h3>Next follow-up</h3>
      <ul className="work-tasks">
        {(work.data?.tasks || []).map((t) => {
          const d = dueText(t.due_at);
          return (
            <li key={t.id}>
              <span><b>{t.title}</b> <span className={d.tone}>{d.text}</span></span>
              <button className="btn" disabled={busy} onClick={() => change("Follow-up marked done", () => v2Send("POST", `/tasks/${t.id}/close`, {}))}>Done</button>
            </li>
          );
        })}
      </ul>
      <form className="work-form" onSubmit={(e) => {
        e.preventDefault();
        change("Follow-up added", async () => { await v2Send("POST", `/leads/${lead.id}/tasks`, { title, dueAt: new Date(due).toISOString() }); setTitle(""); });
      }}>
        <input className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What to do, for example Send quotation" aria-label="Follow-up task" required maxLength={200} />
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
        change("Note saved", async () => { await v2Send("POST", `/leads/${lead.id}/notes`, { text: note }); setNote(""); });
      }}>
        <textarea className="field-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What the customer said, what they need" aria-label="Note" required maxLength={2000} />
        <button className="btn" disabled={busy}>Save note</button>
      </form>

      <h3>Stage</h3>
      <form className="work-form" onSubmit={(e) => {
        e.preventDefault();
        change(`Moved to ${target.label}`, () => v2Send("POST", `/leads/${lead.id}/status`, { status: statusId, lostReason: closing ? reason : undefined }));
      }}>
        <select className="field-input" value={statusId} onChange={(e) => setStatusId(e.target.value)} aria-label="Stage">
          {meta.statuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        {closing && (
          <select className="field-input" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Why the lead was lost" required>
            <option value="">Why was it lost?</option>
            {meta.lostReasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        )}
        <button className="btn" disabled={busy || statusId === lead.status_id}>Change stage</button>
      </form>
    </>
  );
}
