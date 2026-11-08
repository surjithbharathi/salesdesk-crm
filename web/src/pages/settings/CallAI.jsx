import React, { useState } from "react";
import { crmGet, crmSend } from "../../api.js";
import { useLoad } from "../../hooks.js";
import { useToast } from "../../toast.jsx";
import { Section, Note, Loading, Failed } from "./Parts.jsx";

const PROVIDERS = {
  openai: "OpenAI", "openai-audio": "OpenAI (audio model)", google: "Google Gemini", sarvam: "Sarvam",
  elevenlabs: "ElevenLabs", claude: "Anthropic Claude", grok: "xAI Grok", ollama: "Ollama (own server)",
};
const KEY_PROVIDERS = ["openai", "google", "sarvam", "elevenlabs", "claude", "grok", "ollama"];
const STT = ["openai", "openai-audio", "google", "sarvam", "elevenlabs"];
const IQ = ["openai", "claude", "ollama", "grok"];
const canonical = (p) => (p === "openai-audio" ? "openai" : p);

function Keys({ keys, reload }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  async function add(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    try {
      await crmSend("POST", "call-ai/keys", { provider: f.get("provider"), label: f.get("label"), key: f.get("key") });
      form.reset();
      notify("API key saved securely");
      await reload();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(key) {
    try {
      await crmSend("POST", "call-ai/keys", { id: key.id, label: key.label, provider: key.provider, active: !key.active });
      await reload();
    } catch (e) {
      notify(e.message);
    }
  }
  return (
    <Section title="Saved API keys" desc="Keys are stored encrypted on the server and are never shown again after saving. To replace a key, add a new one and choose it in the settings above.">
      {keys.length > 0 && (
        <div className="table-frame">
          <table className="grid">
            <thead><tr><th>Name</th><th>Provider</th><th>Status</th><th><span className="sr">Change</span></th></tr></thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td><b>{k.label}</b></td>
                  <td>{PROVIDERS[k.provider] || k.provider}</td>
                  <td>{k.active ? "In use" : "Turned off"}</td>
                  <td className="right"><button className="btn" onClick={() => toggle(k)}>{k.active ? "Turn off" : "Turn on"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="sec-grid" onSubmit={add}>
        <label>Provider
          <select className="field-input" name="provider" defaultValue="openai">
            {KEY_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDERS[p]}</option>)}
          </select>
        </label>
        <label>Name for this key<input className="field-input" name="label" maxLength="100" required /></label>
        <label className="wide">API key<input className="field-input" name="key" type="password" autoComplete="off" required /></label>
        <div className="newlead-actions"><button className="btn btn-primary" disabled={busy}>Save key</button></div>
      </form>
    </Section>
  );
}

function Part({ part, title, providers, value, keys, onChange }) {
  const notify = useToast();
  const [models, setModels] = useState([]);
  const usable = keys.filter((k) => k.active && k.provider === canonical(value.provider));
  async function refreshModels() {
    try {
      const out = await crmSend("POST", "call-ai/models", { part, provider: value.provider, keyId: value.keyId || undefined });
      setModels(out.models || []);
      notify(`${(out.models || []).length} models found`);
    } catch (e) {
      notify(e.message);
    }
  }
  const listId = `models-${part}`;
  return (
    <fieldset className="wide ai-part">
      <legend>{title}</legend>
      <label>Provider
        <select className="field-input" value={value.provider} onChange={(e) => onChange({ provider: e.target.value, keyId: "", model: "" })}>
          {providers.map((p) => <option key={p} value={p}>{PROVIDERS[p]}</option>)}
        </select>
      </label>
      <label>Saved key
        <select className="field-input" value={value.keyId || ""} onChange={(e) => onChange({ keyId: e.target.value })}>
          <option value="">{value.provider === "ollama" ? "No key needed" : "Choose a saved key"}</option>
          {usable.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </label>
      <label>Model
        <input className="field-input" list={listId} value={value.model} onChange={(e) => onChange({ model: e.target.value })} />
        <datalist id={listId}>{models.map((m) => <option key={m} value={m} />)}</datalist>
      </label>
      <span className="newlead-actions"><button type="button" className="btn" onClick={refreshModels}>Find models</button></span>
    </fieldset>
  );
}

export default function CallAI() {
  const notify = useToast();
  const [version, setVersion] = useState(0);
  const settings = useLoad(() => crmGet("call-ai/settings"), [version]);
  const keys = useLoad(() => crmGet("call-ai/keys"), [version]);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const error = settings.error || keys.error;
  if (error) return <Failed>{error.message}</Failed>;
  if (!settings.data || !keys.data) return <Loading>Loading call AI…</Loading>;
  const form = draft || {
    enabled: Boolean(settings.data.enabled), automatic: Boolean(settings.data.automatic), iqEnabled: Boolean(settings.data.iqEnabled),
    acknowledged: false,
    stt: { provider: settings.data.stt?.provider || "openai", keyId: settings.data.stt?.keyId || "", model: settings.data.stt?.model || "" },
    iq: { provider: settings.data.iq?.provider || "openai", keyId: settings.data.iq?.keyId || "", model: settings.data.iq?.model || "" },
  };
  const set = (patch) => setDraft({ ...form, ...patch });
  const reload = async () => setVersion((v) => v + 1);
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await crmSend("POST", "call-ai/settings", form);
      notify("Call AI settings saved");
      setDraft(null);
      await reload();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <form className="set-form" onSubmit={save}>
        <Section title="Call AI" desc="Turn a call recording into a written transcript, and optionally a summary of what the customer wants. Recordings and transcripts are sent to the providers you choose." status={form.enabled ? "On" : "Off"} tone={form.enabled ? "ok" : "off"}>
          <label className="check"><input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> <span><b>Use call AI.</b></span></label>
          <label className="check"><input type="checkbox" checked={form.automatic} onChange={(e) => set({ automatic: e.target.checked })} /> <span>Transcribe new recordings automatically</span></label>
        </Section>
        <Section title="Transcription" desc="Which service turns speech into text.">
          <Part part="stt" title="Transcription service" providers={STT} value={form.stt} keys={keys.data} onChange={(p) => set({ stt: { ...form.stt, ...p } })} />
        </Section>
        {form.stt.provider !== "openai-audio" && (
          <Section title="Summary and next steps" desc="Call IQ writes what the customer wants and what to do next." status={form.iqEnabled ? "On" : "Off"} tone={form.iqEnabled ? "ok" : "off"}>
            <label className="check"><input type="checkbox" checked={form.iqEnabled} onChange={(e) => set({ iqEnabled: e.target.checked })} /> <span>Also write a summary and next steps (Call IQ)</span></label>
            {form.iqEnabled && <Part part="iq" title="Call IQ service" providers={IQ} value={form.iq} keys={keys.data} onChange={(p) => set({ iq: { ...form.iq, ...p } })} />}
          </Section>
        )}
        {form.enabled && (
          <label className="check"><input type="checkbox" checked={form.acknowledged} onChange={(e) => set({ acknowledged: e.target.checked })} /> <span>I understand call audio and transcripts will be sent to the providers selected above.</span></label>
        )}
        <div className="set-bar"><button className="btn btn-primary" disabled={busy || (form.enabled && !form.acknowledged)}>Save call AI settings</button></div>
      </form>
      <Keys keys={keys.data} reload={reload} />
    </>
  );
}
