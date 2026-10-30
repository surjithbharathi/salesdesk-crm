import React, { useEffect, useState } from "react";
import { crmGet, crmSend } from "./api.js";

const WAITING = ["queued", "processing", "waiting"];

// A synced call recording (or a voice note): play it, and see the Call IQ transcript and summary when call AI is set up.
// The audio comes from the CRM with the signed-in session, so a caller only hears recordings of their own leads.
export default function Recording({ id, ai = true }) {
  const [open, setOpen] = useState(false);
  const [job, setJob] = useState(null);
  const [tab, setTab] = useState("summary");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setJob(await crmGet(`call-ai/recordings/${id}`));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    if (open && !job) load();
  }, [open]);
  useEffect(() => {
    if (!open || !job || !WAITING.includes(job.status)) return undefined;
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [open, job?.status]);

  async function run() {
    setBusy(true);
    try {
      await crmSend("POST", `call-ai/recordings/${id}`, {});
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rec">
      <audio className="rec-audio" controls preload="none" src={`/api/mobile/recordings/${id}`}>
        <a href={`/api/mobile/recordings/${id}`}>Open the recording</a>
      </audio>
      {ai && (
        <button className="btn btn-quiet rec-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Hide Call IQ" : "Call IQ"}
        </button>
      )}
      {ai && open && (
        <div className="rec-ai">
          {error ? (
            <p className="muted">{/403|Administrator|permission/i.test(error) ? "Call IQ is not available to your account." : error}</p>
          ) : !job ? (
            <p className="muted">Loading…</p>
          ) : job.status === "not_started" ? (
            <p className="rec-line"><span className="muted">Not transcribed yet.</span> <button className="btn" onClick={run} disabled={busy}>{busy ? "Starting…" : "Transcribe this call"}</button></p>
          ) : WAITING.includes(job.status) ? (
            <p className="muted">Transcribing. This updates by itself.</p>
          ) : job.status === "failed" ? (
            <p className="rec-line"><span className="error">{job.error || "Transcription failed."}</span> <button className="btn" onClick={run} disabled={busy}>Try again</button></p>
          ) : (
            <>
              <div className="rec-tabs" role="tablist" aria-label="Call IQ">
                {[["summary", "Summary"], ["transcript", "Transcript"]].map(([k, l]) => (
                  <button key={k} role="tab" className="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
                ))}
              </div>
              <p className="rec-text">{tab === "summary" ? job.summary || "No summary. Call IQ may be switched off in Settings, Call AI." : job.transcript || "No transcript."}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
