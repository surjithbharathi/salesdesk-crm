import React, { useState } from "react";
import { v2Send } from "../api.js";
import { useToast } from "../toast.jsx";

// Adds a lead. The server checks the phone number, so an enquiry from a known number is added to that lead's history, not duplicated.
export default function NewLead({ meta, onDone, onCancel }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const out = await v2Send("POST", "/leads/capture", {
        name: f.get("name"), phone: f.get("phone"), source: f.get("source"),
        productInterested: f.get("machine") || undefined, city: f.get("city") || undefined, company: f.get("company") || undefined,
      });
      notify(out.created ? "Lead added" : "This number is already a lead. The enquiry was added to its history.");
      onDone(out.lead.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="newlead" onSubmit={submit}>
      <label>Name<input className="field-input" name="name" required maxLength={120} autoFocus /></label>
      <label>Phone<input className="field-input" name="phone" type="tel" inputMode="tel" required placeholder="98400 11111" /></label>
      <label>Where did they come from
        <select className="field-input" name="source" defaultValue="Manual">
          {meta.sources.map((s) => <option key={s.id} value={s.label}>{s.label}</option>)}
        </select>
      </label>
      <label>Machine they asked about<input className="field-input" name="machine" maxLength={120} /></label>
      <label>Company<input className="field-input" name="company" maxLength={120} /></label>
      <label>City<input className="field-input" name="city" maxLength={80} /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <span className="newlead-actions">
        <button className="btn btn-primary" disabled={busy}>{busy ? "Adding…" : "Add lead"}</button>
        <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>
      </span>
    </form>
  );
}
