import React, { useEffect, useMemo, useRef, useState } from "react";
import { useCrm, stageText, telHref } from "../crm.jsx";
import { crmGet, crmSend } from "../api.js";
import { hashFor, initials } from "../format.js";
import { useToast } from "../toast.jsx";
import { GatewayReplyBar, insideWindow, useGatewaySend } from "../GatewayChat.jsx";
import { sourceKeys, sourceLabel, secondsText } from "../ChatEntry.jsx";
import DateTimePicker from "../DateTimePicker.jsx";

const stamp = (m) => m.occurredAt || m.createdAt || "";
const dayStart = (t) => new Date(t).setHours(0, 0, 0, 0);
const clock = (iso) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
// In the list: the time for today, "Yesterday", else the date
function listTime(iso) {
  if (!iso) return "";
  const days = Math.round((dayStart(Date.now()) - dayStart(iso)) / 86400000);
  return days <= 0 ? clock(iso) : days === 1 ? "Yesterday" : new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
// Between bubbles: TODAY, YESTERDAY or the date
function dayMark(iso) {
  const days = Math.round((dayStart(Date.now()) - dayStart(iso)) / 86400000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: days > 300 ? "numeric" : undefined });
}
const whenText = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" }) : "");
const agoText = (iso) => {
  const days = Math.round((dayStart(Date.now()) - dayStart(iso)) / 86400000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
};
// The same person always gets the same avatar colour
const avTone = (text) => { let h = 0; for (const ch of String(text || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return `rm-av-${h % 6}`; };
const Av = ({ name, size = "" }) => <span className={`rm-av ${size} ${avTone(name)}`} aria-hidden="true">{initials(name || "?")}</span>;

const SearchMark = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
);

// Messages: the chats synced onto leads (read and answered here through the WhatsApp gateway), and the gateway's own inbox
// shown inside Salesdesk (the gateway must allow this site to frame it and keep its sign-in in a cookie that works inside a frame).
export default function Messages() {
  const [tab, setTab] = useState(() => { try { return localStorage.getItem("salesdesk-msg-tab") || "leads"; } catch { return "leads"; } });
  const [gateway, setGateway] = useState(null); // null while asking
  useEffect(() => { crmGet("wa-gateway/status").then((r) => setGateway({ on: Boolean(r.enabled), inbox: r.inboxUrl || "" })).catch(() => setGateway({ on: false, inbox: "" })); }, []);
  const pick = (t) => { setTab(t); try { localStorage.setItem("salesdesk-msg-tab", t); } catch { /* this visit only */ } };
  const tabs = (
    <div className="rm-tabs" role="tablist" aria-label="Messages view">
      <button type="button" role="tab" aria-selected={tab === "leads"} onClick={() => pick("leads")}>Chats</button>
      <button type="button" role="tab" aria-selected={tab === "inbox"} onClick={() => pick("inbox")}>Gateway inbox</button>
    </div>
  );
  return <div className="rmsg">{tab === "inbox" ? <Inbox gateway={gateway} tabs={tabs} /> : <LeadChats gatewayOn={gateway?.on ?? null} tabs={tabs} />}</div>;
}

function Inbox({ gateway, tabs }) {
  const inbox = gateway?.inbox;
  return (
    <section className="rm-inbox" aria-label="WhatsApp inbox">
      <header className="rm-inbox-head">
        <h1>Messages</h1>
        {tabs}
        <span className="rm-grow" />
        {inbox && <a className="rm-ghost" href={inbox} target="_blank" rel="noopener noreferrer">Open in new tab</a>}
      </header>
      {gateway === null ? <p className="rm-empty">Loading the WhatsApp inbox…</p>
        : !inbox ? <div className="rm-empty"><b>The WhatsApp gateway is not connected</b>An administrator can connect it in Settings, WhatsApp gateway. Until then, chats on leads are under Chats.</div>
        : <>
            <iframe className="rm-frame" src={inbox} title="WhatsApp inbox" allow="clipboard-write; microphone" referrerPolicy="strict-origin-when-cross-origin" />
            <p className="rm-frame-note">If this stays blank or asks you to sign in again and again, the gateway does not yet allow Salesdesk to show it: use Open in new tab.</p>
          </>}
    </section>
  );
}

// WhatsApp chats synced to leads, three columns: the chats, the open chat with a reply bar, and the lead beside it.
function LeadChats({ gatewayOn, tabs }) {
  const crm = useCrm();
  const [open, setOpen] = useState("");
  const [find, setFind] = useState("");
  const [only, setOnly] = useState("all");
  const threads = useMemo(() => {
    if (!crm.state) return [];
    const byConversation = new Map();
    for (const m of crm.state.messages || []) byConversation.set(m.conversationId, [...(byConversation.get(m.conversationId) || []), m]);
    return (crm.state.conversations || [])
      .filter((c) => c.channel === "WhatsApp")
      .map((c) => {
        const messages = (byConversation.get(c.id) || []).sort((a, b) => stamp(a).localeCompare(stamp(b)));
        // customer messages since our last answer: the chat is waiting for a reply
        let waiting = 0;
        for (let i = messages.length - 1; i >= 0 && messages[i].direction !== "Outgoing"; i--) waiting++;
        const lead = crm.leadById.get(c.leadId);
        return { ...c, lead, messages, last: messages.at(-1), waiting, meta: Boolean(lead && sourceKeys(lead.source).includes("meta")) };
      })
      .sort((a, b) => stamp(b.last || b).localeCompare(stamp(a.last || a)));
  }, [crm.state, crm.leadById]);
  if (!crm.state) return <p className="rm-empty">Loading messages…</p>;
  const needle = find.trim().toLowerCase();
  const shown = threads.filter((t) => (only === "waiting" ? t.waiting > 0 : only === "meta" ? t.meta : true)
    && (!needle || `${t.lead?.name || ""} ${t.lead?.company || ""} ${t.lead?.phone || ""}`.toLowerCase().includes(needle)));
  const current = threads.find((t) => t.id === open) || shown[0];
  const waitingCount = threads.filter((t) => t.waiting > 0).length;
  const chip = (key, label) => <button type="button" className="rm-chip" aria-pressed={only === key} onClick={() => setOnly(key)}>{label}</button>;
  return (
    <>
      <section className="rm-list" aria-label="Conversations">
        <div className="rm-list-head">
          <div className="rm-title-row"><h1>Messages</h1>{tabs}</div>
          <label className="rm-search"><SearchMark /><input type="search" placeholder="Search chats" aria-label="Search chats" value={find} onChange={(e) => setFind(e.target.value)} /></label>
          <div className="rm-chips">
            {chip("all", "All")}
            {chip("waiting", `Waiting${waitingCount ? ` ${waitingCount}` : ""}`)}
            {chip("meta", "Meta ads")}
          </div>
        </div>
        <div className="rm-convs">
          {shown.map((t) => {
            const name = t.lead?.name || t.lead?.phone || "Unknown lead";
            const out = t.last?.direction === "Outgoing";
            return (
              <button key={t.id} type="button" className="rm-conv" aria-current={current?.id === t.id ? "true" : undefined} onClick={() => setOpen(t.id)}>
                <Av name={name} />
                <span className="rm-conv-main">
                  <span className="rm-conv-top"><b>{name}</b><small className={t.waiting ? "rm-hot" : ""}>{listTime(t.last ? stamp(t.last) : "")}</small></span>
                  <span className="rm-conv-bottom">
                    <span className={`rm-preview ${t.waiting ? "rm-preview-hot" : ""}`}>{t.last ? `${out ? "You: " : ""}${t.last.text || "Message"}` : "No text synced"}</span>
                    {t.waiting > 0 && <span className="rm-unread" aria-label={`${t.waiting} waiting for a reply`}>{t.waiting}</span>}
                  </span>
                </span>
              </button>
            );
          })}
          {!threads.length && <p className="rm-list-empty"><b>No messages yet</b>Chats appear here once a customer's number matches a lead. An administrator links WhatsApp in Settings.</p>}
          {threads.length > 0 && !shown.length && <p className="rm-list-empty">Nobody matches.</p>}
        </div>
      </section>
      {current ? <Chat key={current.id} t={current} gatewayOn={gatewayOn} /> : <section className="rm-chat rm-chat-empty"><p>Pick a chat on the left.</p></section>}
      {current?.lead ? <LeadSide lead={current.lead} /> : current ? <aside className="rm-side" aria-label="Lead details"><p className="rm-side-none">This chat is not linked to a lead.</p></aside> : null}
    </>
  );
}

function Chat({ t, gatewayOn }) {
  const crm = useCrm();
  const body = useRef(null);
  const lead = t.lead;
  const name = lead?.name || lead?.phone || "Unknown lead";
  const via = [...t.messages].reverse().find((m) => m.numberLabel)?.numberLabel;
  const { busy, load } = useGatewaySend(lead?.id || "");
  useEffect(() => { if (body.current) body.current.scrollTop = body.current.scrollHeight; }, [t.messages.length]);
  let lastDay = 0;
  return (
    <section className="rm-chat" aria-label={`Chat with ${name}`}>
      <header className="rm-chat-head">
        <Av name={name} size="rm-av-md" />
        <div className="rm-chat-who">
          <b>{name}</b>
          <small>{[lead?.phone, via ? `on ${via}` : ""].filter(Boolean).join(" · ")}</small>
        </div>
        {lead?.phone && <a className="rm-call" href={telHref(lead)}>Call</a>}
        {lead && <a className="rm-ghost" href={hashFor("/leads", { lead: lead.id })}>Open lead</a>}
      </header>
      <div className="rm-thread" ref={body} role="log" aria-label="WhatsApp chat">
        {gatewayOn && lead && <button type="button" className="rm-earlier" disabled={busy} onClick={load}>Load earlier messages</button>}
        {!t.messages.length && <p className="rm-day">No message text synced yet</p>}
        {t.messages.map((m) => {
          const at = stamp(m), d = at ? dayStart(at) : 0, mark = d && d !== lastDay;
          if (mark) lastDay = d;
          const out = m.direction === "Outgoing";
          const who = out ? m.sender || crm.users.get(m.senderId || m.userId)?.name || "" : "";
          return (
            <React.Fragment key={m.id}>
              {mark ? <p className="rm-day">{dayMark(at)}</p> : null}
              <article className={`rm-bub ${out ? "out" : ""}`}>
                <p>{m.text}</p>
                <small>{[who, m.numberLabel && out ? m.numberLabel : "", at ? clock(at) : ""].filter(Boolean).join(" · ")}</small>
              </article>
            </React.Fragment>
          );
        })}
      </div>
      {gatewayOn && lead ? <GatewayReplyBar leadId={lead.id} inside={insideWindow(t.messages)} />
        : gatewayOn === false ? <p className="rm-compose-off">Replying from the CRM is off. An administrator can turn it on in Settings, WhatsApp gateway. Until then, reply from WhatsApp itself.</p>
        : null}
    </section>
  );
}

// The lead beside the chat: stage, where it came from, who has it, the next follow-up and the last call.
function LeadSide({ lead }) {
  const crm = useCrm();
  const notify = useToast();
  const [adding, setAdding] = useState(false);
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const lastCall = useMemo(() => crm.activities.filter((a) => a.leadId === lead.id && a.type === "Call").sort((a, b) => stamp(b).localeCompare(stamp(a)))[0], [crm.activities, lead.id]);
  const next = crm.nextDue.get(lead.id);
  const place = [lead.city, lead.state].filter(Boolean).join(", ");
  async function addFollowUp(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await crmSend("POST", "tasks", { leadId: lead.id, title: `Call ${lead.name || lead.phone}`, due: new Date(due).toISOString(), status: "Open", owner: lead.owner || crm.me?.id || "" });
      await crm.reload();
      notify("Follow up scheduled");
      setAdding(false);
      setDue("");
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  const facts = [
    ["Source", lead.source ? sourceLabel(lead.source) : ""],
    ["Assignee", crm.users.get(lead.owner)?.name || "Unassigned"],
    ["City", place],
    ["Next follow-up", next ? whenText(next) : "None", next ? "rm-blue" : ""],
    ["Last call", lastCall ? `${agoText(stamp(lastCall))}${Number(lastCall.duration) > 0 ? ` · ${secondsText(lastCall.duration)}` : ""}` : "None yet"],
  ].filter(([, v]) => v);
  return (
    <aside className="rm-side" aria-label="Lead details">
      <div className="rm-side-who">
        <Av name={lead.name || lead.phone} size="rm-av-lg" />
        <b>{lead.name || lead.phone}</b>
        <span className="rm-stage">{stageText(lead)}</span>
      </div>
      <dl className="rm-facts">
        {facts.map(([k, v, tone]) => <div key={k}><dt>{k}</dt><dd className={tone || undefined}>{v}</dd></div>)}
      </dl>
      {adding ? (
        <form className="rm-fu" onSubmit={addFollowUp}>
          <label>Follow up on<DateTimePicker value={due} onChange={setDue} ariaLabel="Follow up on" required /></label>
          <div className="rm-fu-actions">
            <button className="rm-fu-save" disabled={busy}>Save</button>
            <button type="button" className="rm-fu-cancel" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      ) : <button type="button" className="rm-add" onClick={() => setAdding(true)}>+ Add follow-up</button>}
    </aside>
  );
}
