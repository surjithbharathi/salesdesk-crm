import React, { useEffect, useState } from "react";
import { crmGet, crmSend } from "../../api.js";
import { useLoad } from "../../hooks.js";
import { useToast } from "../../toast.jsx";
import { Section, Note, Steps, Loading, Failed } from "./Parts.jsx";

// One-way copy of the TeleCRM workspace: TeleCRM stays the place where people work, this CRM shows the same people, leads,
// timelines and follow-ups and keeps them up to date. Nothing is ever written back to TeleCRM.
const when = (t) => (t ? new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "never");

export default function TelecrmMirror() {
  const notify = useToast();
  const [version, setVersion] = useState(0);
  const { data, error } = useLoad(() => crmGet("telecrm/settings"), [version]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!data?.running) return undefined;
    const timer = setInterval(() => setVersion((v) => v + 1), 3000);
    return () => clearInterval(timer);
  }, [data?.running]);
  if (error) return <Failed>{error.message}</Failed>;
  if (!data) return <Loading>Loading the TeleCRM link…</Loading>;
  const run = data.lastRun;
  async function save(event) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await crmSend("POST", "telecrm/settings", { enterpriseId: f.get("enterpriseId"), token: f.get("token") || undefined, intervalMinutes: Number(f.get("intervalMinutes")), enabled: f.get("enabled") === "on" });
      notify("Saved. Nothing was changed in TeleCRM.");
      setVersion((v) => v + 1);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function sync(full) {
    setBusy(true);
    try {
      await crmSend("POST", "telecrm/sync", { full });
      notify(full ? "Full copy started" : "Update started");
      setVersion((v) => v + 1);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  const state = data.running ? ["Copying now", "warn"] : data.enabled ? ["Keeping up to date", "ok"] : ["Switched off", "off"];
  return (
    <>
      <Section title="What this does" desc="TeleCRM stays the main system and is only read, never changed." status={state[0]} tone={state[1]}>
        <Steps>
          <>Copies the team and their permission template.</>
          <>Copies every lead with all its fields and its timeline (calls, notes, WhatsApp, status changes).</>
          <>Turns each lead's next follow-up into a task, and keeps all of it up to date.</>
        </Steps>
        <Note tone="warn">Use this in a separate workspace made for the copy. A full copy holds tens of thousands of leads, too much for the workspace your team works in every day.</Note>
      </Section>
      <form className="set-form" onSubmit={save} key={version}>
        <Section title="Connection" desc="Find the workspace ID and make a Sync token under Settings, Website and API in TeleCRM. The token is never shown again.">
          <label className="check"><input type="checkbox" name="enabled" defaultChecked={data.enabled} /> <span><b>Keep up to date.</b> Check TeleCRM on a schedule and copy what changed.</span></label>
          <div className="sec-grid">
            <label>TeleCRM workspace ID<input className="field-input" name="enterpriseId" defaultValue={data.enterpriseId} /></label>
            <label>Sync token<input className="field-input" name="token" type="password" autoComplete="new-password" placeholder={data.hasToken ? "Saved. Leave blank to keep it" : "Sync token from TeleCRM"} /></label>
            <label>Check for changes every (minutes)<input className="field-input" name="intervalMinutes" type="number" min="2" max="1440" defaultValue={data.intervalMinutes} /></label>
          </div>
        </Section>
        <div className="set-bar"><button className="btn btn-primary" disabled={busy}>Save</button></div>
      </form>
      <Section title="Copy now" desc="Updates run by themselves. Use these to copy straight away." status={run ? (run.ok ? "Last run fine" : "Last run failed") : "Nothing copied yet"} tone={run ? (run.ok ? "ok" : "bad") : "off"}>
        <p role="status" className="sec-line">
          {data.running ? "Copying from TeleCRM now…" : run ? `${when(run.at)}, ${run.mode === "full" ? "full copy" : "update"}. ${run.message}${run.ok ? `. ${run.activities} timeline entries, ${run.tasks} follow-ups, ${run.users} team members.` : ""}${run.errors ? ` ${run.errors} items could not be read.` : ""}${run.phoneConflicts ? ` ${run.phoneConflicts} leads share a number with another lead and were kept without it.` : ""}` : "Save the workspace ID and token first, then copy."}
        </p>
        <div className="newlead-actions">
          <button type="button" className="btn btn-primary" disabled={busy || data.running || !data.hasToken} onClick={() => sync(false)}>Update now</button>
          <button type="button" className="btn" disabled={busy || data.running || !data.hasToken} onClick={() => sync(true)}>Copy everything again</button>
        </div>
      </Section>
    </>
  );
}
