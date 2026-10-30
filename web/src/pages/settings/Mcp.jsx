import React, { useState } from "react";
import { crmGet, crmSend } from "../../api.js";
import { useLoad } from "../../hooks.js";
import { useToast } from "../../toast.jsx";

const READ = ["leads:read", "reports:read", "insights:read"];
const WRITE = ["leads:edit", "leads:assign", "transcription:run", "tasks:write"];
const SCOPE_TEXT = {
  "leads:read": "Read leads", "reports:read": "Read reports", "insights:read": "Read insights",
  "leads:edit": "Edit leads", "leads:assign": "Reassign leads", "transcription:run": "Start call transcription", "tasks:write": "Create tasks",
};
const when = (ms) => new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function Mcp() {
  const notify = useToast();
  const [version, setVersion] = useState(0);
  const keys = useLoad(() => crmGet("mcp/keys"), [version]);
  const approvals = useLoad(() => crmGet("mcp/approvals"), [version]);
  const [made, setMade] = useState(null);
  const [busy, setBusy] = useState(false);
  const error = keys.error || approvals.error;
  if (error) return <p className="error">{error.message}</p>;
  if (!keys.data || !approvals.data) return <p className="muted">Loading AI connections…</p>;
  const reload = () => setVersion((v) => v + 1);
  async function create(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    try {
      const scopes = [...READ, ...(f.get("write") === "on" ? WRITE : [])];
      setMade(await crmSend("POST", "mcp/keys", { label: f.get("label"), scopes }));
      form.reset();
      reload();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function act(path, done) {
    try {
      await crmSend("POST", path, {});
      notify(done);
      reload();
    } catch (e) {
      notify(e.message);
    }
  }
  const now = Date.now();
  return (
    <>
      <p className="muted report-meta">Let an AI assistant such as Claude read the CRM through a connection. Reading is safe by default. Anything that changes data waits here for your approval before it happens.</p>
      {made && (
        <div className="setup-link">
          <p><b>Connection created.</b> Copy this token now. It is shown only once and expires on {when(made.expires)}.</p>
          <input className="field-input" readOnly value={made.token} onFocus={(e) => e.target.select()} aria-label="Connection token" />
          <span className="newlead-actions">
            <button className="btn btn-primary" onClick={() => navigator.clipboard?.writeText(made.token).then(() => notify("Token copied"), () => notify("Select the token and copy it"))}>Copy token</button>
            <button className="btn btn-quiet" onClick={() => setMade(null)}>Done</button>
          </span>
          <p className="muted">Server address: {location.origin}/mcp</p>
        </div>
      )}
      <form className="newlead" onSubmit={create}>
        <label>Connection name<input className="field-input" name="label" maxLength="100" placeholder="For example, Claude desktop" required /></label>
        <label className="check wide"><input type="checkbox" name="write" /> Also allow changes (edit, reassign, create tasks), each approved by you first</label>
        <span className="newlead-actions"><button className="btn btn-primary" disabled={busy}>Create connection</button></span>
      </form>

      <h2 className="section-title section-gap">Waiting for your approval</h2>
      {approvals.data.length === 0 ? (
        <div className="empty"><b>Nothing waiting</b>When an assistant asks to change data, the request appears here.</div>
      ) : (
        approvals.data.map((a) => (
          <div key={a.id} className="dup-group">
            <div><b>{a.tool}</b><br /><span className="muted">{JSON.stringify(a.args).slice(0, 200)}</span></div>
            {a.approved ? <span className="muted">Approved, waiting for the assistant</span> : <button className="btn btn-primary" onClick={() => act(`mcp/approvals/${a.id}`, "Approved")}>Approve</button>}
          </div>
        ))
      )}

      <h2 className="section-title section-gap">Connections</h2>
      {keys.data.length === 0 ? (
        <div className="empty"><b>No connections yet</b>Create one above to connect an assistant.</div>
      ) : (
        <div className="table-frame">
          <table className="grid">
            <thead><tr><th>Name</th><th>Can do</th><th>Status</th><th><span className="sr">Change</span></th></tr></thead>
            <tbody>
              {keys.data.map((k) => {
                const live = !k.revoked && k.expires > now;
                return (
                  <tr key={k.id}>
                    <td><b>{k.label}</b></td>
                    <td>{k.scopes.map((s) => SCOPE_TEXT[s] || s).join(", ")}</td>
                    <td>{k.revoked ? "Turned off" : live ? `Active until ${when(k.expires)}` : "Expired"}</td>
                    <td className="right">{live && <button className="btn" onClick={() => confirm(`Turn off ${k.label}?`) && act(`mcp/keys/${k.id}/revoke`, "Connection turned off")}>Turn off</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
