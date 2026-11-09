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

// One WhatsApp message as a chat bubble: what was said, who said it (the customer, or which sales person), through which number.
export function WaBubble({ text, outgoing, sender, via, label, at }) {
  return (
    <article className={`gwchat-msg ${outgoing ? "out" : ""}`}>
      <p>{text}</p>
      <small>{sender || (outgoing ? "Our team" : "Customer")}{via ? ` · via ${via}` : ""}{label ? ` · ${label}` : ""}{at ? `, ${at}` : ""}</small>
    </article>
  );
}

export default function GatewayChat({ leadId, className = "" }) {
  const crm = useCrm();
  const notify = useToast();
  const on = useGatewayOn();
  const [text, setText] = useState("");
  const [template, setTemplate] = useState("");
  const [params, setParams] = useState("");
  const [useTemplate, setUseTemplate] = useState(false);
  const [busy, setBusy] = useState(false);
  const thread = useMemo(() => {
    if (!crm.state) return [];
    const ids = new Set((crm.state.conversations || []).filter((c) => c.leadId === leadId && c.channel === "WhatsApp").map((c) => c.id));
    return (crm.state.messages || []).filter((m) => ids.has(m.conversationId)).sort((a, b) => stamp(a) - stamp(b));
  }, [crm.state, leadId]);
  const lastIn = [...thread].reverse().find((m) => m.direction !== "Outgoing");
  const inside = lastIn && Date.now() - stamp(lastIn) < 24 * 3600000;
  async function send(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await crmSend("POST", `wa-gateway/leads/${leadId}/send`, useTemplate ? { template: template.trim(), params: params.split(",").map((p) => p.trim()).filter(Boolean) } : { text });
      await crm.reload();
      setText("");
      notify("Sent on WhatsApp");
    } catch (e) {
      notify(e.message);
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
