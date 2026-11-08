import React, { useState } from "react";
import { crmGet, crmSend } from "../../api.js";
import { useLoad } from "../../hooks.js";
import { useToast } from "../../toast.jsx";

// The link to the Devi WhatsApp gateway (Meta Cloud API, several numbers): customer messages arrive here as signed webhooks,
// and messages go out through the gateway's API. The API key and the webhook secret are write-only: they are never shown again.
export default function Gateway({ users }) {
  const notify = useToast();
  const [version, setVersion] = useState(0);
  const { data, error } = useLoad(() => crmGet("wa-gateway/settings"), [version]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [extra, setExtra] = useState({ id: "", owner: "" });
  if (error) return <p className="error">{error.message}</p>;
  if (!data) return <p className="muted">Loading the WhatsApp gateway settings…</p>;
  const active = users.filter((u) => u.active !== false);
  const numbers = { ...data.seenNumbers, ...Object.fromEntries(Object.keys(data.numberOwners || {}).map((id) => [id, data.seenNumbers?.[id] || `Number ${id}`])) };
  async function save(event) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const owners = {};
    for (const id of Object.keys(numbers)) if (f.get(`owner-${id}`)) owners[id] = f.get(`owner-${id}`);
    if (extra.id.trim() && extra.owner) owners[extra.id.trim()] = extra.owner;
    setBusy(true);
    try {
      await crmSend("POST", "wa-gateway/settings", {
        baseUrl: f.get("baseUrl"), apiKey: f.get("apiKey") || undefined, webhookSecret: f.get("webhookSecret") || undefined,
        createLeads: f.get("createLeads") === "on", defaultOwner: f.get("defaultOwner") || "", defaultFromPhoneId: f.get("defaultFromPhoneId") || "",
        numberOwners: owners, enabled: f.get("enabled") === "on",
      });
      notify("Saved. Nothing was sent to WhatsApp.");
      setExtra({ id: "", owner: "" });
      setVersion((v) => v + 1);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setResult(null);
    try {
      setResult(await crmSend("POST", "wa-gateway/test", {}));
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="muted report-meta">Customer messages on the Devi WhatsApp numbers appear in the CRM, and people can answer from a lead. The gateway keeps doing its own work (AI replies, templates, alerts); this only connects the two.</p>
      <ol className="gauge-note">
        <li>In the gateway, open Settings, Integrations, Webhooks and add a webhook with this address and the events <b>customer.new</b> and <b>message.received</b>: <code>{data.hookUrl}</code></li>
        <li>The gateway shows a secret once. Paste it below as the webhook secret.</li>
        <li>Paste the gateway address and its API key below, save, then use Test connection.</li>
      </ol>
      <form className="newlead" onSubmit={save} key={version}>
        <label className="check wide"><input type="checkbox" name="enabled" defaultChecked={data.enabled} /> Connected (customer messages are accepted and sending is allowed)</label>
        <label>Gateway address<input className="field-input" name="baseUrl" type="url" placeholder="https://wa.example.com" defaultValue={data.baseUrl} /></label>
        <label>API key<input className="field-input" name="apiKey" type="password" autoComplete="new-password" placeholder={data.hasKey ? "Saved. Leave blank to keep it" : "The gateway API key"} /></label>
        <label>Webhook secret<input className="field-input" name="webhookSecret" type="password" autoComplete="new-password" placeholder={data.hasSecret ? "Saved. Leave blank to keep it" : "The secret the gateway showed"} /></label>
        <label className="check wide"><input type="checkbox" name="createLeads" defaultChecked={data.createLeads} /> Make a lead when a new number writes in</label>
        <label>Owner of new leads when the number has none
          <select className="field-input" name="defaultOwner" defaultValue={data.defaultOwner}><option value="">Nobody (unassigned)</option>{active.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        </label>
        <label>Send from this number when nothing else decides (number ID)<input className="field-input" name="defaultFromPhoneId" inputMode="numeric" defaultValue={data.defaultFromPhoneId} placeholder="For example 538388877117181" /></label>
        <h2 className="section-title wide">Owner of each WhatsApp number</h2>
        <p className="muted wide">A number shows up here after its first customer message. New leads from it go to the person chosen, and that person's replies go out from it.</p>
        {Object.entries(numbers).map(([id, label]) => (
          <label key={id}>{label} <small className="muted">({id})</small>
            <select className="field-input" name={`owner-${id}`} defaultValue={data.numberOwners?.[id] || ""}><option value="">Nobody</option>{active.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          </label>
        ))}
        <label>Add a number by its ID<input className="field-input" inputMode="numeric" value={extra.id} onChange={(e) => setExtra({ ...extra, id: e.target.value.replace(/\D/g, "") })} placeholder="Number ID from the gateway" /></label>
        <label>Its owner
          <select className="field-input" value={extra.owner} onChange={(e) => setExtra({ ...extra, owner: e.target.value })}><option value="">Nobody</option>{active.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        </label>
        <span className="newlead-actions"><button className="btn btn-primary" disabled={busy}>Save</button><button type="button" className="btn" disabled={busy} onClick={test}>Test connection</button></span>
      </form>
      {result && (
        <p className="gauge-note" role="status">
          {result.reachable ? "The gateway answered." : "The gateway did not answer."} {result.keyOk ? "The API key works." : "The API key was refused or is missing."}
          {result.numbers != null ? ` ${result.numbers} WhatsApp numbers connected.` : ""}{result.aiMode ? ` AI mode: ${result.aiMode}.` : ""}
        </p>
      )}
    </>
  );
}
