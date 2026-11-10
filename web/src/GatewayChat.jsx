import React, { useEffect, useMemo, useState } from "react";
import { crmGet, crmSend } from "./api.js";
import { useCrm } from "./crm.jsx";
import { useToast } from "./toast.jsx";

// A lead's WhatsApp chat with the Devi WhatsApp gateway: what was said in both directions, and a box to answer.
// Free text works inside WhatsApp's 24 hours after the customer's last message; after that an approved template is needed.
const when = (iso) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const stamp = (m) => Date.parse(m.occurredAt || m.createdAt);

export function useGatewayOn() {
  const [on, setOn] = useState(null);
  useEffect(() => {
    crmGet("wa-gateway/status").then((r) => setOn(Boolean(r.enabled))).catch(() => setOn(false));
  }, []);
  return on;
}

// Whether the customer wrote in the last 24 hours, the only time WhatsApp allows free text.
export const insideWindow = (messages) => {
  const lastIn = [...(messages || [])].reverse().find((m) => m.direction !== "Outgoing");
  return Boolean(lastIn && Date.now() - stamp(lastIn) < 24 * 3600000);
};

// Sending through the gateway for one lead, and pulling in earlier messages. Shared by the lead's chat and the Messages page.
export function useGatewaySend(leadId) {
  const crm = useCrm();
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  async function send(body) {
    setBusy(true);
    try {
      await crmSend("POST", `wa-gateway/leads/${leadId}/send`, body);
      await crm.reload();
      notify("Sent on WhatsApp");
      return true;
    } catch (e) {
      notify(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    setBusy(true);
    try {
      const r = await crmSend("POST", `wa-gateway/leads/${leadId}/history`, {});
      await crm.reload();
      notify(r.added ? `${r.added} earlier messages added` : "Nothing new in the gateway");
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, send, load };
}

const templateBody = (template, params) => ({ template: template.trim(), params: params.split(",").map((p) => p.trim()).filter(Boolean) });

// One WhatsApp message as a chat bubble: what was said, who said it (the customer, or which sales person), through which number.
export function WaBubble({ text, outgoing, sender, via, label, at }) {
  return (
    <article className={`gwchat-msg ${outgoing ? "out" : ""}`}>
      <p>{text}</p>
      <small>{sender || (outgoing ? "Our team" : "Customer")}{via ? ` · via ${via}` : ""}{label ? ` · ${label}` : ""}{at ? `, ${at}` : ""}</small>
    </article>
  );
}

const SendMark = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M22 2l-7 20-4-9-9-4zM22 2L11 13" /></svg>
);

// The one-line reply bar of the Messages page: a switch between a message and an approved template, the box, and a round send button.
export function GatewayReplyBar({ leadId, inside }) {
  const { busy, send } = useGatewaySend(leadId);
  const [text, setText] = useState("");
  const [template, setTemplate] = useState("");
  const [params, setParams] = useState("");
  const [useTemplate, setUseTemplate] = useState(!inside);
  useEffect(() => { setUseTemplate(!inside); setText(""); }, [leadId, inside]);
  async function submit(event) {
    event.preventDefault();
    if (await send(useTemplate ? templateBody(template, params) : { text })) { setText(""); if (useTemplate) setParams(""); }
  }
  return (
    <form className="rm-compose" onSubmit={submit}>
      {!inside && <p className="rm-compose-note">The customer has not written in the last 24 hours: WhatsApp only allows an approved template now.</p>}
      <div className="rm-compose-row">
        <button type="button" className="rm-tpl" aria-pressed={useTemplate} onClick={() => setUseTemplate(!useTemplate)}>{useTemplate ? "Message" : "Templates"}</button>
        {useTemplate ? (
          <>
            <label className="rm-box"><input value={template} onChange={(e) => setTemplate(e.target.value)} placeholder="Template name, like devi_welcome_v2" aria-label="Template name" pattern="[a-z0-9_]+" required /></label>
            <label className="rm-box rm-box-sm"><input value={params} onChange={(e) => setParams(e.target.value)} placeholder="Values, separated by commas" aria-label="Template values" /></label>
          </>
        ) : (
          <label className="rm-box"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" aria-label="Type a message" maxLength={4000} required /></label>
        )}
        <button className="rm-send" disabled={busy} aria-label={busy ? "Sending" : useTemplate ? "Send template" : "Send"}><SendMark /></button>
      </div>
    </form>
  );
}

export default function GatewayChat({ leadId, className = "" }) {
  const crm = useCrm();
  const on = useGatewayOn();
  const { busy, send: sendBody, load } = useGatewaySend(leadId);
  const [text, setText] = useState("");
  const [template, setTemplate] = useState("");
  const [params, setParams] = useState("");
  const [useTemplate, setUseTemplate] = useState(false);
  const thread = useMemo(() => {
    if (!crm.state) return [];
    const ids = new Set((crm.state.conversations || []).filter((c) => c.leadId === leadId && c.channel === "WhatsApp").map((c) => c.id));
    return (crm.state.messages || []).filter((m) => ids.has(m.conversationId)).sort((a, b) => stamp(a) - stamp(b));
  }, [crm.state, leadId]);
  const inside = insideWindow(thread);
  async function send(event) {
    event.preventDefault();
    if (await sendBody(useTemplate ? templateBody(template, params) : { text })) setText("");
  }
  return (
    <div className={`gwchat ${className}`}>
      <div className="gwchat-thread" role="log" aria-label="WhatsApp chat">
        {thread.map((m) => (
          <WaBubble key={m.id} text={m.text} outgoing={m.direction === "Outgoing"} sender={m.sender} via={m.via} label={m.numberLabel} at={when(stamp(m))} />
        ))}
        {!thread.length && <p className="muted">No WhatsApp messages for this lead yet.</p>}
      </div>
      {on ? (
        <form className="gwchat-form" onSubmit={send}>
          <p className="muted gwchat-note">{inside ? "The customer wrote in the last 24 hours, so you can reply freely." : "The customer has not written in the last 24 hours: WhatsApp only allows an approved template now."}</p>
          {!useTemplate ? (
            <textarea className="field-input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a WhatsApp message" aria-label="WhatsApp message" maxLength={4000} required />
          ) : (
            <>
              <input className="field-input" value={template} onChange={(e) => setTemplate(e.target.value)} placeholder="Template name, for example devi_welcome_v2" aria-label="Template name" pattern="[a-z0-9_]+" required />
              <input className="field-input" value={params} onChange={(e) => setParams(e.target.value)} placeholder="Values for the template, separated by commas (if it has any)" aria-label="Template values" />
            </>
          )}
          <div className="gwchat-actions">
            <button className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : useTemplate ? "Send template" : "Send"}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setUseTemplate(!useTemplate)}>{useTemplate ? "Write a message instead" : "Send a template"}</button>
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={load}>Load earlier messages</button>
          </div>
        </form>
      ) : on === false ? (
        <p className="muted gwchat-note">Replying from the CRM is off. An administrator can turn it on in Settings, WhatsApp gateway.</p>
      ) : null}
    </div>
  );
}
