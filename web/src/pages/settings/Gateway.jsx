import React, { useEffect, useState } from "react";
import { crmGet, crmSend } from "../../api.js";
import { useLoad } from "../../hooks.js";
import { useToast } from "../../toast.jsx";
import { Section, Steps, Loading, Failed } from "./Parts.jsx";

// The link to the Devi WhatsApp gateway (Meta Cloud API, several numbers): customer messages arrive here as signed webhooks,
// and messages go out through the gateway's API. The API key and the webhook secret are write-only: they are never shown again.
export default function Gateway({ users }) {
  const notify = useToast();
  const [version, setVersion] = useState(0);
  const { data, error } = useLoad(() => crmGet("wa-gateway/settings"), [version]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [extra, setExtra] = useState({ id: "", owner: "" });
  const [address, setAddress] = useState("");
  useEffect(() => { // back from the gateway after approving: say so once, and drop the marker from the address
    if (!/[?&]gateway=connected/.test(location.hash)) return;
    notify("Connected to the WhatsApp gateway. Choose the owner of each number below.");
    history.replaceState(null, "", location.pathname + location.hash.replace(/[?&]gateway=connected/, ""));
  }, []);
  if (error) return <Failed>{error.message}</Failed>;
  if (!data) return <Loading>Loading the WhatsApp gateway settings…</Loading>;
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
  async function connect(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const { url } = await crmSend("POST", "wa-gateway/connect", { baseUrl: address || data.baseUrl || "https://wa.deviindustries.com" });
      location.assign(url);
    } catch (e) {
      notify(e.message);
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
  const state = data.enabled ? ["Connected", "ok"] : data.hasKey && data.hasSecret ? ["Ready, switched off", "warn"] : ["Not set up", "off"];
  return (
    <>
      <Section title="Connect the gateway" desc="Customer messages on the Devi WhatsApp numbers appear in the CRM, and people reply from a lead. The gateway keeps doing its own work (AI replies, templates, alerts)." status={state[0]} tone={state[1]}>
        <form className="set-bar" onSubmit={connect}>
          <label style={{ flex: "1 1 260px" }}>Gateway address<input className="field-input" type="url" required value={address || data.baseUrl || "https://wa.deviindustries.com"} onChange={(e) => setAddress(e.target.value)} /></label>
          <button className="btn btn-primary" disabled={busy}>{data.enabled ? "Connect again" : "Connect"}</button>
        </form>
        <p className="muted">Connect opens the gateway. An inbox admin signs in there and allows it, and you come back here connected. The key and the secret pass between the two servers; nobody copies them.</p>
        <details>
          <summary>Set it up by hand instead</summary>
          <Steps>
            <>In the gateway open Settings, Integrations, Webhooks and add a webhook for the events <b>customer.new</b> and <b>message.received</b> with this address: <code>{data.hookUrl}</code></>
            <>The gateway shows a secret once. Paste it below as the webhook secret.</>
            <>Paste the gateway address and its API key below, save, then press Test connection.</>
          </Steps>
        </details>
      </Section>
      <form className="set-form" onSubmit={save} key={version}>
        <Section title="Connection" desc="Where the gateway lives and the keys that prove the messages are genuine. The key and secret are never shown again.">
          <label className="check"><input type="checkbox" name="enabled" defaultChecked={data.enabled} /> <span><b>Connected.</b> Accept customer messages and allow sending from the CRM.</span></label>
          <div className="sec-grid">
            <label>Gateway address<input className="field-input" name="baseUrl" type="url" placeholder="https://wa.example.com" defaultValue={data.baseUrl} /></label>
            <label>API key<input className="field-input" name="apiKey" type="password" autoComplete="new-password" placeholder={data.hasKey ? "Saved. Leave blank to keep it" : "The gateway API key"} /></label>
            <label>Webhook secret<input className="field-input" name="webhookSecret" type="password" autoComplete="new-password" placeholder={data.hasSecret ? "Saved. Leave blank to keep it" : "The secret the gateway showed"} /></label>
            <label>Default sending number (number ID)<input className="field-input" name="defaultFromPhoneId" inputMode="numeric" defaultValue={data.defaultFromPhoneId} placeholder="Used when nothing else decides" /></label>
          </div>
        </Section>
        <Section title="New customers" desc="What happens when a number the CRM does not know writes in.">
          <label className="check"><input type="checkbox" name="createLeads" defaultChecked={data.createLeads} /> <span>Make a lead when a new number writes in</span></label>
          <div className="sec-grid">
            <label>Owner when the number has none
              <select className="field-input" name="defaultOwner" defaultValue={data.defaultOwner}><option value="">Nobody (unassigned)</option>{active.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            </label>
          </div>
        </Section>
        <Section title="Owner of each WhatsApp number" desc="A number appears here after its first customer message. New leads from it go to the person chosen, and that person's replies go out from it.">
          <div className="sec-grid">
            {Object.entries(numbers).map(([id, label]) => (
              <label key={id}>{label} <small className="muted">({id})</small>
                <select className="field-input" name={`owner-${id}`} defaultValue={data.numberOwners?.[id] || ""}><option value="">Nobody</option>{active.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
              </label>
            ))}
            <label>Add a number by its ID<input className="field-input" inputMode="numeric" value={extra.id} onChange={(e) => setExtra({ ...extra, id: e.target.value.replace(/\D/g, "") })} placeholder="Number ID from the gateway" /></label>
            <label>Its owner
              <select className="field-input" value={extra.owner} onChange={(e) => setExtra({ ...extra, owner: e.target.value })}><option value="">Nobody</option>{active.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            </label>
          </div>
        </Section>
        <div className="set-bar">
          <button className="btn btn-primary" disabled={busy}>Save</button>
          <button type="button" className="btn" disabled={busy} onClick={test}>Test connection</button>
          {result && (
            <span className={`pill pill-${result.reachable && result.keyOk ? "ok" : "bad"}`} role="status">
              {result.reachable ? "Gateway answered" : "Gateway did not answer"}. {result.keyOk ? "Key works" : "Key refused or missing"}.{result.numbers != null ? ` ${result.numbers} numbers.` : ""}{result.aiMode ? ` AI: ${result.aiMode}.` : ""}
            </span>
          )}
        </div>
      </form>
    </>
  );
}
