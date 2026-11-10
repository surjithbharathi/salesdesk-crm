import React, { useEffect, useMemo, useState } from "react";
import { useCrm } from "../crm.jsx";
import { crmGet } from "../api.js";
import { hashFor } from "../format.js";

const stamp = (m) => m.occurredAt || m.createdAt || "";
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");

// Messages: the WhatsApp gateway's own inbox, shown inside Salesdesk (the gateway must allow this site to frame it and keep
// its sign-in in a cookie that works inside a frame), and the chats already synced onto leads.
export default function Messages() {
  const [tab, setTab] = useState(() => { try { return localStorage.getItem("salesdesk-msg-tab") || "inbox"; } catch { return "inbox"; } });
  const [inbox, setInbox] = useState(null); // null while asking, "" when the gateway is not set up
  useEffect(() => { crmGet("wa-gateway/status").then((r) => setInbox(r.inboxUrl || "")).catch(() => setInbox("")); }, []);
  const pick = (t) => { setTab(t); try { localStorage.setItem("salesdesk-msg-tab", t); } catch { /* this visit only */ } };
  return (
    <>
      <div className="work-head msg-head">
        <h1 className="work-title">Messages</h1>
        <div className="msg-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "inbox"} className={tab === "inbox" ? "on" : ""} onClick={() => pick("inbox")}>WhatsApp inbox</button>
          <button type="button" role="tab" aria-selected={tab === "leads"} className={tab === "leads" ? "on" : ""} onClick={() => pick("leads")}>Chats on leads</button>
        </div>
        {tab === "inbox" && inbox && <a className="msg-newtab" href={inbox} target="_blank" rel="noopener noreferrer">Open in new tab</a>}
      </div>
      {tab === "inbox" ? (
        inbox === null ? <p className="muted">Loading the WhatsApp inbox…</p>
        : !inbox ? <div className="empty"><b>The WhatsApp gateway is not connected</b>An administrator can connect it in Settings, WhatsApp gateway. Until then, chats on leads are under the other tab.</div>
        : <>
            <iframe className="msg-frame" src={inbox} title="WhatsApp inbox" allow="clipboard-write; microphone" referrerPolicy="strict-origin-when-cross-origin" />
            <p className="muted msg-frame-note">If this stays blank or asks you to sign in again and again, the gateway does not yet allow Salesdesk to show it: use Open in new tab.</p>
          </>
      ) : <LeadChats />}
    </>
  );
}

// WhatsApp chats synced to leads. The CRM only reads them; replies are sent from WhatsApp itself.
function LeadChats() {
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
                    <small>{m.sender || (m.direction === "Outgoing" ? "You" : "Customer")}{m.numberLabel ? ` · ${m.numberLabel}` : ""}, {when(stamp(m))}</small>
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
