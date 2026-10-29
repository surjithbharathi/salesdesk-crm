import React, { useEffect, useRef, useState } from "react";
import { v2 } from "../api.js";
import { useLoad } from "../hooks.js";
import { useToast } from "../toast.jsx";
import { when, day, rupees, phoneText, minutes, dueText, timeOnly, dayLabel, initials, avatarClass } from "../format.js";
import Icon from "../icons.jsx";
import LeadWork from "./LeadWork.jsx";

const ICON = {
  call: "phone", call_outcome: "check", status_change: "swap", assignment: "swap", note: "note", message: "chat",
  whatsapp: "chat", task: "task", visit: "pin", repeat_enquiry: "again", field_change: "note", system: "dot", ai_summary: "spark",
};

function Facts({ rows }) {
  return (
    <dl className="facts">
      {rows.map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{value || <span className="muted">Not recorded</span>}</dd></div>
      ))}
    </dl>
  );
}

function Timeline({ id }) {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [busy, setBusy] = useState(true);
  async function load(next) {
    setBusy(true);
    const page = await v2(`/leads/${id}/activities`, { cursor: next, limit: 25 });
    setItems((old) => (next ? [...old, ...page.items] : page.items));
    setCursor(page.nextCursor);
    setBusy(false);
  }
  useEffect(() => {
    setItems([]);
    load(null).catch(() => setBusy(false));
  }, [id]);
  const groups = [];
  for (const item of items) {
    const label = dayLabel(item.occurred_at);
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push(item);
  }
  return (
    <>
      {groups.map((g) => (
        <section key={g.label}>
          <h3 className="tl-day">{g.label}</h3>
          <ul className="timeline">
            {g.items.map((a) => (
              <li key={a.id} className="tl-item">
                <span className="tl-icon"><Icon name={ICON[a.type] || "dot"} size={16} /></span>
                <span>
                  <span className="tl-what">{a.text || a.type}</span>
                  <br /><span className="tl-when">{timeOnly(a.occurred_at)}, {a.source}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!busy && !items.length && <p className="empty">Nothing has been recorded for this lead yet.</p>}
      {cursor && <p className="keys"><button className="btn" disabled={busy} onClick={() => load(cursor)}>Show older activity</button></p>}
    </>
  );
}

export default function LeadPanel({ id, meta, onClose, onChanged = () => {} }) {
  const [rev, setRev] = useState(0);
  const { data: lead, error, loading } = useLoad(() => v2(`/leads/${id}`), [id, rev]);
  const [tab, setTab] = useState("overview");
  const notify = useToast();
  const closeButton = useRef(null);
  useEffect(() => {
    closeButton.current?.focus();
  }, [id]);
  useEffect(() => setTab("overview"), [id]);
  const sourceLabel = (sid) => meta.sources.find((s) => s.id === sid)?.label;
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      notify("Phone number copied");
    } catch {
      notify("Could not copy. Select the number and copy it by hand.");
    }
  }
  const due = lead && dueText(lead.next_followup_at);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={lead ? `Lead ${lead.name}` : "Lead"}>
        <header className="drawer-head">
          <button ref={closeButton} className="icon-btn drawer-close" onClick={onClose} aria-label="Close lead"><Icon name="close" /></button>
          {loading && <p className="muted">Loading lead…</p>}
          {error && <p className="error">{error.message}</p>}
          {lead && (
            <>
              <h2 className="drawer-title">{lead.name}</h2>
              <div className="drawer-line">
                <span className={`tag tag-${lead.stage_group}`}>{lead.status}</span>
                {lead.lost_reason && <span className="note note-bad">{lead.lost_reason}</span>}
                {lead.tags.map((t) => <span key={t.id} className="note">{t.label}</span>)}
                <span className="muted">{lead.owner_name ? `With ${lead.owner_name}` : "No owner yet"}</span>
              </div>
              <div className="drawer-actions">
                {lead.phone_e164 && (
                  <>
                    <a className="btn btn-primary" href={`tel:+${lead.phone_e164}`}><Icon name="phone" />Call {phoneText(lead)}</a>
                    <a className="btn" href={`https://wa.me/${lead.phone_e164}`} target="_blank" rel="noopener noreferrer"><Icon name="chat" />WhatsApp</a>
                    <button className="btn btn-quiet" onClick={() => copy(`+${lead.phone_e164}`)}><Icon name="copy" />Copy number</button>
                  </>
                )}
                {!lead.phone_e164 && <span className="muted">No phone number on this lead.</span>}
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
              {tab === "timeline" ? <Timeline id={lead.id} /> : tab === "work" ? <LeadWork lead={lead} meta={meta} onChanged={() => { setRev((r) => r + 1); onChanged(); }} /> : (
                <>
                  <h3>Work so far</h3>
                  <Facts rows={[
                    ["First call or message", lead.first_touch_at && when(lead.first_touch_at)],
                    ["Last activity", lead.last_activity_at && when(lead.last_activity_at)],
                    ["Calls", lead.call_count ? `${lead.call_count}, ${lead.connected_count} answered` : ""],
                    ["Talk time", lead.total_call_seconds ? minutes(Math.max(1, Math.round(lead.total_call_seconds / 60))) : ""],
                    ["Next follow-up", lead.next_followup_at && (<span className={due.tone}>{when(lead.next_followup_at)}, {due.text}</span>)],
                    ["Calls placed", lead.attempts ? String(lead.attempts) : ""],
                  ]} />
                  <h3>What they want</h3>
                  <Facts rows={[
                    ["Machine", lead.product_interested],
                    ["Capacity needed", lead.required_capacity],
                    ["Planning to buy", lead.purchase_timeline],
                    ["Budget or value", lead.expected_value ? rupees(lead.expected_value) : ""],
                    ["Language", lead.customer_language],
                    ["Company", lead.company],
                    ["City and state", [lead.city, lead.state].filter(Boolean).join(", ")],
                    ["Email", lead.email],
                  ]} />
                  <h3>Where they came from</h3>
                  <Facts rows={[
                    ["First source", sourceLabel(lead.first_source_id)],
                    ["Latest source", sourceLabel(lead.latest_source_id)],
                    ["Enquired again", lead.repeat_count ? `${lead.repeat_count} time${lead.repeat_count === 1 ? "" : "s"}` : ""],
                    ["First captured", lead.captured_at && day(lead.captured_at)],
                  ]} />
                  {lead.summary && (<><h3>Summary</h3><p>{lead.summary}</p></>)}
                  {lead.phones.length > 0 && (<><h3>Other numbers</h3><p>{lead.phones.map((p) => "+" + p.phone_e164).join(", ")}</p></>)}
                </>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
