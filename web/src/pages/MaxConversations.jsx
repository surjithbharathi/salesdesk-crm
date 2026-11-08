import React, { useMemo, useState } from "react";
import { useCrm, userName, stageText } from "../crm.jsx";
import { initials } from "../format.js";
import Icon from "../icons.jsx";
import LeadPanel from "./LeadPanel.jsx";
import { ms, relTime } from "./tele.js";

// "Conversations" in the Salesmax style: the WhatsApp chats synced to leads as a table, with who spoke last and which chats wait for a reply.
// The CRM only reads the chats; replies are sent from WhatsApp itself.

const DAY = 86400000;
const stamp = (m) => ms(m.occurredAt || m.createdAt);

export default function MaxConversations({ params }) {
  const crm = useCrm();
  const [scope, setScope] = useState("all");
  const [window, setWindow] = useState("all");
  const [filter, setFilter] = useState("all");
  const [find, setFind] = useState("");
  const [open, setOpen] = useState("");
  const [openLead, setOpenLead] = useState("");

  const threads = useMemo(() => {
    if (!crm.state) return [];
    const byConversation = new Map();
    for (const m of crm.state.messages || []) byConversation.set(m.conversationId, [...(byConversation.get(m.conversationId) || []), m]);
    return (crm.state.conversations || [])
      .filter((c) => c.channel === "WhatsApp")
      .map((c) => {
        const messages = (byConversation.get(c.id) || []).sort((a, b) => stamp(a) - stamp(b));
        const last = messages.at(-1);
        return { ...c, lead: crm.leadById.get(c.leadId), messages, last, waiting: Boolean(last) && last.direction !== "Outgoing" };
      })
      .sort((a, b) => (b.last ? stamp(b.last) : 0) - (a.last ? stamp(a.last) : 0));
  }, [crm.state]);

  if (!crm.state) return <p className="muted">{crm.error || "Loading conversations…"}</p>;
  const needle = find.trim().toLowerCase();
  const inScope = threads.filter((t) => {
    if (scope === "mine" && t.lead?.owner !== crm.me.id) return false;
    if (window !== "all" && !(t.last && stamp(t.last) > Date.now() - (window === "24h" ? DAY : 7 * DAY))) return false;
    return !needle || `${t.lead?.name || ""} ${t.lead?.company || ""} ${t.last?.text || ""}`.toLowerCase().includes(needle);
  });
  const waiting = inScope.filter((t) => t.waiting).length;
  const shown = inScope.filter((t) => filter === "all" || (filter === "waiting" ? t.waiting : !t.waiting));
  const current = threads.find((t) => t.id === open);

  if (params.tab === "stats")
    return (
      <section className="max-card" aria-label="Conversation numbers">
        <div className="max-tiles max-tiles-wide">
          {[["Chats", threads.length], ["Waiting for a reply", threads.filter((t) => t.waiting).length], ["Replied", threads.filter((t) => t.last && !t.waiting).length], ["Messages", (crm.state.messages || []).length]].map(([label, n]) => (
            <div key={label} className="max-tile"><b className="max-num num">{n.toLocaleString("en-IN")}</b><small>{label}</small></div>
          ))}
        </div>
      </section>
    );
  return (
    <>
      <section className="max-card" aria-label="Conversations">
        <div className="max-tools">
          {crm.me.lead && (
            <span className="max-toggle" role="group" aria-label="Whose chats">
              {[["all", "All"], ["mine", "My"]].map(([key, label]) => <button key={key} aria-pressed={scope === key} onClick={() => setScope(key)}>{label}</button>)}
            </span>
          )}
          <span className="max-toggle" role="group" aria-label="Time window">
            {[["24h", "24h"], ["7d", "7d"], ["all", "All"]].map(([key, label]) => <button key={key} aria-pressed={window === key} onClick={() => setWindow(key)}>{label}</button>)}
          </span>
          {[["all", "All chats", inScope.length], ["waiting", "Waiting for reply", waiting], ["replied", "Replied", inScope.length - waiting]].map(([key, label, n]) => (
            <button key={key} className="max-chipbtn" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}<b className="num">{n}</b></button>
          ))}
          <label className="max-find">
            <Icon name="search" size={14} /><span className="sr">Search chats</span>
            <input type="search" placeholder="Search chat…" value={find} onChange={(e) => setFind(e.target.value)} />
          </label>
        </div>
        {!threads.length ? (
          <div className="empty"><b>No messages yet</b>An administrator can link WhatsApp in Settings. Chats appear here once a customer's number matches a lead.</div>
        ) : (
          <div className="max-table-wrap">
            <table className="max-table">
              <thead><tr><th>Lead</th><th>Last message</th><th>Last message time</th><th>Last message by</th><th>Needs attention</th><th>Chat owner</th></tr></thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={t.id} aria-selected={t.id === open}>
                    <td><span className="max-lead"><span className="avatar">{initials(t.lead?.name || "?")}</span><button className="max-link" onClick={() => setOpen(t.id === open ? "" : t.id)}>{t.lead?.name || "Unknown lead"}</button></span>{t.lead && <span className="max-stage-text"> {stageText(t.lead)}</span>}</td>
                    <td className="max-what">{t.last?.text?.slice(0, 80) || "No text synced"}</td>
                    <td>{t.last ? relTime(stamp(t.last)) : ""}</td>
                    <td>{t.last ? (t.waiting ? "Customer" : "Our team") : ""}</td>
                    <td>{t.waiting ? <span className="max-status late">Not replied</span> : t.last ? <span className="max-status done">Replied</span> : ""}</td>
                    <td>{t.lead?.owner ? <span className="max-owner"><span className="avatar">{initials(userName(crm, t.lead.owner))}</span>{userName(crm, t.lead.owner)}</span> : <span className="muted">No owner</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!shown.length && <div className="empty"><b>No chats match this view</b>Try another time window or clear the search.</div>}
          </div>
        )}
      </section>
      {current && (
        <section className="max-card" aria-label={`Chat with ${current.lead?.name || "customer"}`}>
          <header className="max-card-head">
            <h2>{current.lead?.name || "Unknown lead"}</h2>
            <span>{current.lead && <button className="btn btn-quiet" onClick={() => setOpenLead(current.lead.id)}>Open lead</button>}<button className="btn btn-quiet" onClick={() => setOpen("")}>Close chat</button></span>
          </header>
          <div className="max-chat">
            {!current.messages.length && <p className="muted">No message text synced yet.</p>}
            {current.messages.map((m) => (
              <article key={m.id} className={`max-bubble ${m.direction === "Outgoing" ? "out" : ""}`}>
                <p>{m.text}</p>
                <small>{m.direction === "Outgoing" ? "Our team" : "Customer"}, {new Date(stamp(m)).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</small>
              </article>
            ))}
          </div>
        </section>
      )}
      {openLead && <LeadPanel id={openLead} onClose={() => setOpenLead("")} />}
    </>
  );
}
