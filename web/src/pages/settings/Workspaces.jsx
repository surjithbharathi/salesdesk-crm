import React, { useState } from "react";
import { crmGet, crmSend } from "../../api.js";
import { useLoad } from "../../hooks.js";
import { useToast } from "../../toast.jsx";

// For the CRM owner only: each workspace is a separate company database with its own users and keys.
export default function Workspaces({ currentName }) {
  const notify = useToast();
  const [version, setVersion] = useState(0);
  const { data, error } = useLoad(() => crmGet("workspaces"), [version]);
  const [made, setMade] = useState(null);
  const [busy, setBusy] = useState(false);
  if (error) return <p className="error">{error.message}</p>;
  if (!data) return <p className="muted">Loading workspaces…</p>;
  async function create(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    try {
      setMade(await crmSend("POST", "workspaces", { name: f.get("name"), ownerName: f.get("ownerName"), ownerUsername: f.get("ownerUsername") }));
      form.reset();
      setVersion((v) => v + 1);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(w) {
    const next = w.state === "active" ? "suspended" : "active";
    if (!confirm(`${next === "suspended" ? "Suspend" : "Activate"} ${w.name}?`)) return;
    try {
      await crmSend("PATCH", `workspaces/${w.id}`, { state: next });
      notify(next === "suspended" ? "Workspace suspended" : "Workspace active");
      setVersion((v) => v + 1);
    } catch (e) {
      notify(e.message);
    }
  }
  return (
    <>
      <p className="muted report-meta">You are signed in as the CRM owner. Each workspace has its own database, users, recordings and keys. This server has room for {data.capacity} more. This one is {currentName}.</p>
      {made && (
        <div className="setup-link">
          <p><b>{made.name} is ready.</b> Send {made.ownerUsername} this one-use link so they can choose a password. It expires {new Date(made.expiresAt).toLocaleDateString("en-IN")}.</p>
          <input className="field-input" readOnly value={made.setupUrl} onFocus={(e) => e.target.select()} aria-label="Setup link" />
          <span className="newlead-actions">
            <button className="btn btn-primary" onClick={() => navigator.clipboard?.writeText(made.setupUrl).then(() => notify("Link copied"), () => notify("Select the link and copy it"))}>Copy link</button>
            <button className="btn btn-quiet" onClick={() => setMade(null)}>Done</button>
          </span>
        </div>
      )}
      <form className="newlead" onSubmit={create}>
        <label>Workspace name<input className="field-input" name="name" required maxLength="120" /></label>
        <label>Owner's name<input className="field-input" name="ownerName" required maxLength="120" /></label>
        <label>Owner's username<input className="field-input" name="ownerUsername" required minLength="3" maxLength="120" pattern="[a-z0-9.@_+\-]{3,120}" title="Lowercase letters, numbers and . @ _ + -" /></label>
        <span className="newlead-actions"><button className="btn btn-primary" disabled={busy}>Create workspace</button></span>
      </form>
      {data.workspaces.length === 0 ? (
        <div className="empty"><b>No other workspaces</b>Create one above for another company.</div>
      ) : (
        <div className="table-frame">
          <table className="grid">
            <thead><tr><th>Workspace</th><th>Status</th><th><span className="sr">Actions</span></th></tr></thead>
            <tbody>
              {data.workspaces.map((w) => (
                <tr key={w.id}>
                  <td><b>{w.name}</b><small><a href={w.url} target="_blank" rel="noopener">{w.url.replace("https://", "")}</a></small></td>
                  <td>{w.state === "active" ? "Active" : "Suspended"}</td>
                  <td className="right"><button className="btn" onClick={() => toggle(w)}>{w.state === "active" ? "Suspend" : "Activate"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
