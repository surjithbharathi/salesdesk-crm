import React, { useMemo, useState } from "react";
import { useCrm } from "../crm.jsx";
import { hashFor } from "../format.js";

const stamp = (m) => m.occurredAt || m.createdAt || "";
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");

// WhatsApp chats synced to leads. The CRM only reads them; replies are sent from WhatsApp itself.
export default function Messages() {
  const crm = useCrm();
  const [open, setOpen] = useState("");
  const [find, setFind] = useState("");
  const threads = useMemo(() => {
    if (!crm.state) return [];
    const byConversation = new Map();
    for (const m of crm.state.messages || []) byConversation.set(m.conversationId, [...(byConversation.get(m.conversationId) || []), m]);
    return (crm.state.conversations || [])
      .filter((c) => c.channel === "WhatsApp")
      .map((c) => {
        const messages = (byConversation.get(c.id) || []).sort((a, b) => stamp(a).localeCompare(stamp(b)));
        return { ...c, lead: crm.leadById.get(c.leadId), messages, last: messages.at(-1) };
      })
      .sort((a, b) => stamp(b.last || b).localeCompare(stamp(a.last || a)));
  }, [crm.state]);
  if (!crm.state) return <p className="muted">Loading messages…</p>;
  const shown = threads.filter((t) => !find || `${t.lead?.name || ""} ${t.lead?.company || ""} ${t.lead?.phone || ""}`.toLowerCase().includes(find.toLowerCase()));
  const current = threads.find((t) => t.id === open) || shown[0];
  return (
    <>
      <div className="work-head"><h1 className="work-title">Messages</h1><span className="work-date">WhatsApp chats synced to your leads</span></div>
      {!threads.length ? (
        <div className="empty"><b>No messages yet</b>An administrator can link WhatsApp in Settings. Chats appear here once a customer's number matches a lead. Reply from WhatsApp itself.</div>
      ) : (
        <div className="msg-layout">
          <div className="msg-list">
            <input className="field-input" type="search" placeholder="Find a customer" aria-label="Find a customer" value={find} onChange={(e) => setFind(e.target.value)} />
            {shown.map((t) => (
              <button key={t.id} className="msg-thread" aria-current={current?.id === t.id ? "true" : undefined} onClick={() => setOpen(t.id)}>
                <b>{t.lead?.name || "Unknown lead"}</b>
                <small>{t.last?.text?.slice(0, 60) || "No text synced"}</small>
                <small>{when(t.last ? stamp(t.last) : "")}</small>
              </button>
            ))}
            {!shown.length && <p className="muted">Nobody matches that search.</p>}
          </div>
          {current && (
            <section className="msg-pane" aria-label={`Chat with ${current.lead?.name || "customer"}`}>
              <header>
                <b>{current.lead?.name || "Unknown lead"}</b>
                {current.lead && <a href={hashFor("/leads", { lead: current.lead.id })}>Open lead</a>}
              </header>
              <div className="msg-body">
                {current.messages.length === 0 && <p className="muted">No message text synced yet.</p>}
                {current.messages.map((m) => (
                  <article key={m.id} className={`msg ${m.direction === "Outgoing" ? "msg-out" : ""}`}>
                    <p>{m.text}</p>
                    <small>{m.direction === "Outgoing" ? "You" : "Customer"}, {when(stamp(m))}</small>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
