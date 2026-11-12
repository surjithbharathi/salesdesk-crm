import React, { useState } from "react";
import { crmGet, crmSend } from "../../api.js";
import { useLoad } from "../../hooks.js";
import { useToast } from "../../toast.jsx";
import { Section, Steps, Loading, Failed } from "./Parts.jsx";

// ERPNext quotations and sales invoices on leads, matched by the customer's mobile number.
const when = (t) => (t ? new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "never");

export default function Erpnext() {
  const notify = useToast();
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const s = useLoad(() => crmGet("erpnext/settings"), [tick]);
  if (s.error) return <Failed>{s.error.message}</Failed>;
  if (!s.data) return <Loading>Loading ERPNext…</Loading>;
  const d = s.data, form = draft || { baseUrl: d.baseUrl || "", apiKey: "", apiSecret: "", autoStage: d.autoStage !== false };
  const set = (patch) => setDraft({ ...form, ...patch });
  const run = async (fn, done) => {
    setBusy(true);
    try { const r = await fn(); if (done) notify(typeof done === "function" ? done(r) : done); setDraft(null); setTick((t) => t + 1); }
    catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };
  const save = (enabled) => run(() => crmSend("POST", "erpnext/settings", { ...form, ...(enabled === undefined ? {} : { enabled }) }), enabled === false ? "ERPNext turned off" : "ERPNext settings saved");
  const last = d.lastRun;
  return (
    <>
      <Section title="ERPNext" desc="Quotations and sales invoices from Devi ERP appear on the lead with the same mobile number, and move the lead along the pipeline." status={d.enabled ? "On" : "Off"} tone={d.enabled ? "ok" : "off"}>
        <Steps>
          <>In ERPNext, open your user (or a user made for the CRM) → Settings → API Access → Generate Keys.</>
          <>Copy the API key and the API secret shown, and paste them below with the ERPNext address.</>
          <>Save, use Test connection, then turn ERPNext on. The first read only takes stock of what is already there.</>
        </Steps>
        <div className="sec-grid">
          <label>ERPNext address<input className="field-input" placeholder="https://erp.deviindustries.com" value={form.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} /></label>
          <label>API key<input className="field-input" placeholder={d.hasKey ? "Saved; type a new one to replace it" : ""} value={form.apiKey} onChange={(e) => set({ apiKey: e.target.value })} autoComplete="off" /></label>
          <label>API secret<input className="field-input" type="password" placeholder={d.hasKey ? "Saved; type a new one to replace it" : ""} value={form.apiSecret} onChange={(e) => set({ apiSecret: e.target.value })} autoComplete="new-password" /></label>
        </div>
        <label className="check"><input type="checkbox" checked={form.autoStage} onChange={(e) => set({ autoStage: e.target.checked })} /> <span>Move leads forward: a submitted quotation → Quotation Shared, a part-paid invoice → Advance Received, a paid invoice → Won. Never moves a lead back.</span></label>
        <div className="newlead-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => save(d.enabled ? undefined : true)}>{d.enabled ? "Save" : "Save and turn on"}</button>
          <button type="button" className="btn" disabled={busy || !d.hasKey} onClick={() => run(() => crmSend("POST", "erpnext/test", {}), (r) => `Connected as ${r.user}`)}>Test connection</button>
          {d.enabled && <button type="button" className="btn" disabled={busy} onClick={() => run(() => crmSend("POST", "erpnext/sync", {}), (r) => r.skipped || (r.ok ? `Read ${r.quotations} quotations and ${r.invoices} invoices` : r.message))}>Read now</button>}
          {d.enabled && <button type="button" className="btn" disabled={busy} onClick={() => save(false)}>Turn off</button>}
        </div>
        <p role="status" className="sec-line">
          {d.quotations} quotations and {d.invoices} invoices copied. Last read {when(last?.at)}
          {last ? (last.ok ? `: ${last.quotations} quotations and ${last.invoices} invoices changed${last.firstRun ? " (first read: history taken in, no notes or moves)" : `, ${last.noted} lead notes, ${last.moved} pipeline moves`}.` : `: ${last.message}`) : "."} It reads again every 10 minutes.
        </p>
      </Section>
    </>
  );
}
