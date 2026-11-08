import React, { useEffect, useState } from "react";
import { crmGet, crmSend } from "../../api.js";
import { useLoad } from "../../hooks.js";
import { useToast } from "../../toast.jsx";

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
  if (error) return <p className="error">{error.message}</p>;
  if (!data) return <p className="muted">Loading the TeleCRM link…</p>;
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
  return (
    <>
      <p className="muted report-meta">Copies TeleCRM into this workspace: the team and their permission template, every lead with all its fields, each lead's timeline (calls, notes, WhatsApp, status changes) and its follow-up as a task. TeleCRM stays the main system and is only read, never changed.</p>
      <p className="gauge-note" role="note">Use this in a separate workspace made for the copy. A full copy holds tens of thousands of leads, which is too much for the workspace your team works in every day.</p>
      <form className="newlead" onSubmit={save} key={version}>
        <label className="check wide"><input type="checkbox" name="enabled" defaultChecked={data.enabled} /> Keep this workspace up to date from TeleCRM</label>
        <label>TeleCRM workspace ID<input className="field-input" name="enterpriseId" defaultValue={data.enterpriseId} placeholder="Settings, Website and API in TeleCRM" /></label>
        <label>Sync token<input className="field-input" name="token" type="password" autoComplete="new-password" placeholder={data.hasToken ? "Saved. Leave blank to keep it" : "Sync token from TeleCRM, Website and API"} /></label>
        <label>Check for changes every (minutes)<input className="field-input" name="intervalMinutes" type="number" min="2" max="1440" defaultValue={data.intervalMinutes} /></label>
        <span className="newlead-actions">
          <button className="btn btn-primary" disabled={busy}>Save</button>
          <button type="button" className="btn" disabled={busy || data.running || !data.hasToken} onClick={() => sync(false)}>Update now</button>
          <button type="button" className="btn" disabled={busy || data.running || !data.hasToken} onClick={() => sync(true)}>Copy everything again</button>
        </span>
      </form>
      <p className="gauge-note" role="status">
        {data.running ? "Copying from TeleCRM now…" : run ? `${run.ok ? "Last run" : "Last run failed"}: ${when(run.at)}, ${run.mode === "full" ? "full copy" : "update"}. ${run.message}${run.ok ? `. ${run.activities} timeline entries, ${run.tasks} follow-ups, ${run.users} team members.` : ""}${run.errors ? ` ${run.errors} items could not be read.` : ""}${run.phoneConflicts ? ` ${run.phoneConflicts} leads share a number with another lead and were kept without it.` : ""}` : "Nothing copied yet."}
      </p>
    </>
  );
}
