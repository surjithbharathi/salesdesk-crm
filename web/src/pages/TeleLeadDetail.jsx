import React, { useMemo, useState } from "react";
import { useCrm, userName, phoneLabel, telHref, waHref, stageText } from "../crm.jsx";
import { useToast } from "../toast.jsx";
import { day, dueText, initials, minutes, rupees, when } from "../format.js";
import Icon from "../icons.jsx";
import { Facts, Update } from "./LeadPanel.jsx";
import { absTime, relTime, ms, tagClass } from "./tele.js";

const ICON = { Call: "phone", Note: "note", Message: "chat", Visit: "pin", System: "dot" };
const KINDS = [["", "All actions"], ["Call", "Calls"], ["Note", "Notes"], ["Message", "Messages"], ["System", "System"]];

// The right-hand side of "My Calls" and "Search leads" in the TeleCRM style: who the lead is, what you can do next, and what has happened.
export default function TeleLeadDetail({ id }) {
  const crm = useCrm();
  const notify = useToast();
  const lead = crm.leadById.get(id);
  const [tab, setTab] = useState("primary");
  const [log, setLog] = useState("history");
  const [kind, setKind] = useState("");
  const activities = useMemo(
    () => crm.activities.filter((a) => a.leadId === id && (!kind || a.type === kind)).sort((a, b) => ms(b.createdAt) - ms(a.createdAt)),
    [crm.activities, id, kind],
  );
  const tasks = useMemo(() => crm.openTasks.filter((t) => t.leadId === id).sort((a, b) => String(a.due).localeCompare(String(b.due))), [crm.openTasks, id]);
  if (!lead) return <div className="tele-detail-empty"><Icon name="note" size={44} /><p>{crm.state ? "This lead is not available to you." : "Loading lead…"}</p></div>;
  const due = crm.nextDue.get(lead.id) ? dueText(crm.nextDue.get(lead.id)) : null;
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      notify("Phone number copied");
    } catch {
      notify("Could not copy. Select the number and copy it by hand.");
    }
  }
  const action = (icon, label, props) => {
    const Tag = props.href ? "a" : "button";
    return <Tag className="tele-action" {...props}><Icon name={icon} size={20} /><span>{label}</span></Tag>;
  };
  return (
    <article className="tele-detail" aria-label={`Lead ${lead.name}`}>
      <header className="tele-detail-head">
        <div>
          <h2>{lead.name}</h2>
          <div className="tele-detail-line">
            <span className={`tag ${tagClass(lead)}`}>{stageText(lead)}</span>
            {lead.repeat ? <span className="note note-good">Came back</span> : null}
          </div>
        </div>
        <span className="tele-owner">
          {lead.owner ? <><span>{userName(crm, lead.owner)}</span><span className="avatar">{initials(userName(crm, lead.owner))}</span></> : <span className="muted">No owner yet</span>}
        </span>
      </header>

      <div className="tabs tele-detail-tabs" role="tablist" aria-label="Lead details">
        {[["primary", "Primary"], ["basic", "Basic info"], ["update", "Update"]].map(([key, label]) => (
          <button key={key} role="tab" className="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      <div className="tele-detail-body" role="tabpanel">
        {tab === "update" ? (
          <Update key={lead.id} lead={lead} crm={crm} />
        ) : tab === "basic" ? (
          <Facts rows={[
            ["Captured", lead.createdAt && day(lead.createdAt)],
            ["First call or message", lead.firstTouchAt && when(lead.firstTouchAt)],
            ["Calls", lead.callCount ? `${lead.callCount}, ${lead.connectedCalls || 0} answered` : ""],
            ["Talk time", lead.totalCallSeconds ? minutes(Math.max(1, Math.round(lead.totalCallSeconds / 60))) : ""],
            ["Next follow-up", due && <span className={due.tone}>{when(crm.nextDue.get(lead.id))}, {due.text}</span>],
          ]} />
        ) : (
          <Facts rows={[
            ["Phone", lead.phone && <span>{phoneLabel(lead)} <button className="tele-copy" onClick={() => copy(lead.phone)} aria-label="Copy phone number"><Icon name="copy" size={14} /></button></span>],
            ["Email", lead.email], ["Company", lead.company], ["City", lead.city],
            ["Source", lead.source], ["Value", lead.value ? rupees(lead.value) : ""],
          ]} />
        )}
      </div>

      <div className="tele-actions" role="group" aria-label="Actions">
        {lead.phone ? action("phone", "Call", { href: telHref(lead) }) : action("phone", "Call", { disabled: true })}
        {action("again", "Call later", { type: "button", onClick: () => setTab("update") })}
        {lead.phone ? action("chat", "SMS", { href: `sms:${String(lead.phone).replace(/[^\d+]/g, "")}` }) : action("chat", "SMS", { disabled: true })}
        {lead.phone ? action("chat", "WhatsApp", { href: waHref(lead), target: "_blank", rel: "noopener noreferrer" }) : action("chat", "WhatsApp", { disabled: true })}
        {action("note", "Add note", { type: "button", onClick: () => setTab("update") })}
      </div>

      <div className="tabs tele-log-tabs" role="tablist" aria-label="History">
        {[["history", "Activity history"], ["tasks", `Task${tasks.length ? ` (${tasks.length})` : ""}`]].map(([key, label]) => (
          <button key={key} role="tab" className="tab" aria-selected={log === key} onClick={() => setLog(key)}>{label}</button>
        ))}
        {log === "history" && (
          <label className="tele-filter tele-log-filter">
            <span className="sr">Kind of action</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
        )}
      </div>
      {log === "tasks" ? (
        tasks.length ? (
          <ul className="tele-log">
            {tasks.map((t) => {
              const d = dueText(t.due);
              return <li key={t.id}><span className="tele-log-icon"><Icon name="task" size={16} /></span><span className="tele-log-text">{t.title}</span><span className={`tele-log-when ${d.tone}`}>{d.text}</span></li>;
            })}
          </ul>
        ) : <p className="tele-empty">No open follow-ups for this lead.</p>
      ) : activities.length ? (
        <ul className="tele-log">
          {activities.map((a) => (
            <li key={a.id}>
              <span className="tele-log-icon"><Icon name={ICON[a.type] || "dot"} size={16} /></span>
              <span className="tele-log-text">{a.text || a.type}{a.outcome ? <small> {a.outcome}</small> : null}</span>
              <span className="tele-log-when" title={absTime(a.createdAt)}>{relTime(a.createdAt)}{a.userId && crm.users.get(a.userId) ? <span className="avatar">{initials(crm.users.get(a.userId).name)}</span> : null}</span>
            </li>
          ))}
        </ul>
      ) : <p className="tele-empty">Nothing has been recorded for this lead yet.</p>}
    </article>
  );
}
