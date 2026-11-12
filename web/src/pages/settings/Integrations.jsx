import React, { useMemo } from "react";
import { crmGet } from "../../api.js";
import { useLoad } from "../../hooks.js";
import { hashFor } from "../../format.js";
import { useCrm } from "../../crm.jsx";
import { sourceKeys } from "../../ChatEntry.jsx";

// Every connection this CRM has, on one page: whether it is working, what came in today, and a way to its own settings.
// Each card reads the same status its own settings page reads; nothing is changed from here.
const count = (x) => (Array.isArray(x) ? x.length : Array.isArray(x?.keys) ? x.keys.length : 0);

function Card({ k, mark, tone, name, desc, state, extra }) {
  const on = state === "on";
  return (
    <article className="rs-int" aria-label={name}>
      <div className="rs-int-top">
        <span className={`rs-logo rs-logo-${tone}`} aria-hidden="true">{mark}</span>
        <div className="rs-int-name"><b>{name}</b><small>{desc}</small></div>
      </div>
      <div className="rs-int-foot">
        <span className={`rs-pill ${on ? "rs-pill-on" : state === "warn" ? "rs-pill-warn" : ""}`}>{extra?.pill || (on ? "Connected" : state === "warn" ? "Switched off" : state === "unknown" ? "Checking" : "Not connected")}</span>
        {extra?.note && <span className="rs-int-note">{extra.note}</span>}
        <span className="rs-grow" />
        <a className={`rs-btn ${on ? "" : "rs-btn-primary"}`} href={hashFor("/settings", { tab: k })}>{on ? "Manage" : "Connect"}</a>
      </div>
    </article>
  );
}

// state: "on" when it works, "warn" when set up but switched off, "off" when not set up, "unknown" while asking
const stateOf = (load, on, setUp) => (load.error ? "off" : !load.data ? "unknown" : on(load.data) ? "on" : setUp(load.data) ? "warn" : "off");

export default function Integrations({ has }) {
  const crm = useCrm();
  const none = () => Promise.resolve(null);
  const indiamart = useLoad(() => (has("indiamart") ? crmGet("indiamart/settings") : none()), []);
  const market = useLoad(() => (has("marketplace") ? crmGet("marketplace/settings") : none()), []);
  const gateway = useLoad(() => (has("gateway") ? crmGet("wa-gateway/settings") : none()), []);
  const whatsapp = useLoad(() => (has("whatsapp") ? crmGet("whatsapp/status") : none()), []);
  const telecrm = useLoad(() => (has("telecrm") ? crmGet("telecrm/settings") : none()), []);
  const email = useLoad(() => (has("email") ? crmGet("email/settings") : none()), []);
  const mcp = useLoad(() => (has("mcp") ? crmGet("mcp/keys") : none()), []);
  // leads that arrived today, by where they came from
  const today = useMemo(() => {
    const from = new Date().setHours(0, 0, 0, 0), n = {};
    for (const l of crm?.leads || []) {
      const at = typeof l.createdAt === "number" ? l.createdAt : Date.parse(l.createdAt);
      if (!(at >= from)) continue;
      for (const k of sourceKeys(l.source)) n[k] = (n[k] || 0) + 1;
    }
    return n;
  }, [crm?.leads]);
  const todayNote = (k, word = "leads today") => (crm?.leads ? `${today[k] || 0} ${word}` : "");
  const gwNumbers = gateway.data ? new Set([...Object.keys(gateway.data.seenNumbers || {}), ...Object.keys(gateway.data.numberOwners || {})]).size : 0;
  const gwState = stateOf(gateway, (d) => d.enabled, (d) => d.hasKey && d.hasSecret);
  const cards = [
    has("indiamart") && <Card key="indiamart" k="indiamart" mark="IM" tone="red" name="IndiaMART calls" desc="Call enquiries linked to the buyer's lead, with recordings"
      state={stateOf(indiamart, (d) => d.enabled, (d) => d.hasKey)} extra={{ note: todayNote("indiamart") }} />,
    has("marketplace") && <Card key="im-leads" k="marketplace" mark="IM" tone="red" name="IndiaMART leads" desc="Direct enquiries, buy-leads and calls become leads"
      state={stateOf(market, (d) => d.indiamart.enabled, (d) => d.indiamart.hasKey)} extra={{ note: todayNote("indiamart") }} />,
    has("marketplace") && <Card key="ti-leads" k="marketplace" mark="TI" tone="blue" name="TradeIndia" desc="TradeIndia inquiries become leads"
      state={stateOf(market, (d) => d.tradeindia.enabled, (d) => d.tradeindia.hasKey)} extra={{ note: todayNote("tradeindia") }} />,
    has("gateway") && <Card key="gateway" k="gateway" mark="W" tone="green" name="WhatsApp Business" desc="Chats and templates in Messages, through the Devi gateway"
      state={gwState} extra={gwState === "on" ? { pill: gwNumbers ? `${gwNumbers} ${gwNumbers === 1 ? "number" : "numbers"}` : "Connected", note: todayNote("whatsapp", "today") } : null} />,
    has("gateway") && <Card key="meta" k="gateway" mark="M" tone="blue" name="Meta ads" desc="Click-to-WhatsApp ad leads, arriving through the gateway"
      state={gwState} extra={{ note: todayNote("meta", "today") }} />,
    has("whatsapp") && <Card key="whatsapp" k="whatsapp" mark="WA" tone="teal" name="WhatsApp phone link" desc="Read-only chat sync from a phone, by QR code"
      state={stateOf(whatsapp, (d) => d.state === "connected", (d) => ["connecting", "qr", "reconnecting"].includes(d.state))} />,
    has("telecrm") && <Card key="telecrm" k="telecrm" mark="TC" tone="indigo" name="TeleCRM copy" desc="A read-only copy of the TeleCRM workspace"
      state={stateOf(telecrm, (d) => d.enabled, (d) => d.hasToken)} />,
    has("email") && <Card key="email" k="email" mark="@" tone="slate" name="Email" desc="Sign-in invitations and password resets"
      state={stateOf(email, (d) => d.enabled, (d) => d.hasPassword)} />,
    has("mcp") && <Card key="mcp" k="mcp" mark="AI" tone="plum" name="AI connections" desc="Assistants that work with this CRM through your keys"
      state={stateOf(mcp, (d) => count(d) > 0, () => false)} extra={mcp.data && count(mcp.data) ? { pill: `${count(mcp.data)} ${count(mcp.data) === 1 ? "key" : "keys"}` } : null} />,
  ].filter(Boolean);
  if (!cards.length) return <p className="muted">No connections you can manage.</p>;
  return <div className="rs-ints">{cards}</div>;
}
