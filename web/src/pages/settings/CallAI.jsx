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

// is call AI working: when the last recording came, what is done, waiting or failed, and the latest jobs with their errors
const DAY = 86400000;
const stamp = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");
const JOB = { complete: "Summary done", error: "Failed", queued: "Waiting its turn", waiting: "Transcribing", processing: "Transcribing" };
function Status() {
  const [tick, setTick] = useState(0);
  const status = useLoad(() => crmGet("call-ai/status"), [tick]);
  if (status.error) return <Failed>{status.error.message}</Failed>;
  if (!status.data) return <Loading>Checking call AI…</Loading>;
  const row = (j) => (
    <li key={j.recordingId}>
      <span><a href={`#/leads?lead=${j.leadId}`}>{j.leadName || "Lead"}</a>{j.source && <span className="muted"> · {j.source}</span>}</span>
      <span className="muted">{stamp(j.callAt || j.updatedAt)}</span>
      <span className={`cai-job cai-job-${j.status}`}>{JOB[j.status] || j.status}{j.error ? `: ${j.error}` : ""}</span>
    </li>
  );
  const d = status.data, quietDays = d.lastRecordingAt ? Math.floor((Date.now() - Date.parse(d.lastRecordingAt)) / DAY) : null;
  const quiet = !d.waiting && (quietDays === null || quietDays >= 2);
  const pill = !d.enabled ? ["Off", "off"] : d.waiting ? [`Transcribing ${d.waiting}`, "ok"] : d.failed ? [`${d.failed} failed`, "bad"] : quiet ? ["No new recordings", "warn"] : ["Working", "ok"];
  return (
    <Section title="Status" desc="Whether recordings still reach the CRM and what call AI did with them." status={pill[0]} tone={pill[1]}>
      {d.enabled && d.waiting > 0 && (
        <Note>{d.waiting} recording{d.waiting === 1 ? " is" : "s are"} being transcribed, one after another. About {Math.max(1, Math.ceil(d.waiting / 2))} min left; summaries appear on each lead as they finish.</Note>
      )}
      {d.enabled && quiet && (
        <Note tone="warn">{quietDays === null ? "No recording has reached the CRM yet." : `No new recording for ${quietDays} days (last: ${stamp(d.lastRecordingAt)}).`} Call AI is ready; the phones and TeleCRM are not sending recordings.</Note>
      )}
      <div className="cai-stats">
        <div className="cai-stat"><span>Recordings, 7 days</span><b>{d.week.total}</b><small>Phone {d.week.phone} · TeleCRM {d.week.telecrm}</small></div>
        <div className="cai-stat"><span>Summaries done</span><b>{d.done}</b><small>all time</small></div>
        <div className="cai-stat"><span>Waiting</span><b>{d.waiting}</b></div>
        <div className="cai-stat"><span>Failed</span><b className={d.failed ? "cai-bad" : ""}>{d.failed}</b></div>
      </div>
      {d.failedJobs?.length > 0 && (
        <>
          <p className="sec-line cai-head">Failed ({d.failedJobs.length})</p>
          <ul className="cai-jobs" aria-label="Failed jobs">{d.failedJobs.map(row)}</ul>
        </>
      )}
      {d.jobs.length > 0 && (
        <>
          <p className="sec-line cai-head">Latest</p>
          <ul className="cai-jobs" aria-label="Recent jobs">{d.jobs.map(row)}</ul>
        </>
      )}
      <div className="set-bar"><button type="button" className="btn" onClick={() => setTick((t) => t + 1)}>Refresh</button></div>
    </Section>
  );
}

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
      <Status />
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
