import React, { useState } from "react";
import { crmGet, crmSend } from "../../api.js";
import { useLoad } from "../../hooks.js";
import { useToast } from "../../toast.jsx";

export default function Email() {
  const notify = useToast();
  const [version, setVersion] = useState(0);
  const { data, error } = useLoad(() => crmGet("email/settings"), [version]);
  const [busy, setBusy] = useState(false);
  if (error) return <p className="error">{error.message}</p>;
  if (!data) return <p className="muted">Loading email settings…</p>;
  const c = { host: "smtp.hostinger.com", port: 465, fromName: "Salesdesk CRM", ...data };
  async function save(event) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await crmSend("POST", "email/settings", {
        enabled: f.get("enabled") === "on", host: f.get("host"), port: Number(f.get("port")), username: f.get("username"),
        password: f.get("password") || undefined, fromEmail: f.get("fromEmail"), fromName: f.get("fromName"),
      });
      notify("Email settings saved. No email was sent.");
      setVersion((v) => v + 1);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function test(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await crmSend("POST", "email/test", { to: new FormData(event.currentTarget).get("to") });
      notify("Test email sent. Check the inbox and Spam.");
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="muted report-meta">Outgoing email is used for new-user setup links and password resets. This workspace keeps its own settings, encrypted on the server.</p>
      <form className="newlead" onSubmit={save} key={version}>
        <label className="check wide"><input type="checkbox" name="enabled" defaultChecked={Boolean(c.enabled)} /> Send email from this CRM</label>
        <label>Mail server<input className="field-input" name="host" defaultValue={c.host} required /></label>
        <label>Security
          <select className="field-input" name="port" defaultValue={String(c.port)}>
            <option value="465">465, SSL/TLS</option>
            <option value="587">587, STARTTLS</option>
          </select>
        </label>
        <label>Mailbox (username)<input className="field-input" name="username" type="email" defaultValue={c.username || ""} required /></label>
        <label>Password<input className="field-input" name="password" type="password" autoComplete="new-password" placeholder={c.hasPassword ? "Saved. Leave blank to keep it" : "Mailbox password"} /></label>
        <label>From address<input className="field-input" name="fromEmail" type="email" defaultValue={c.fromEmail || ""} required /></label>
        <label>Sender name<input className="field-input" name="fromName" defaultValue={c.fromName} required /></label>
        <span className="newlead-actions"><button className="btn btn-primary" disabled={busy}>Save email settings</button></span>
      </form>
      <h2 className="section-title section-gap">Send a test</h2>
      <form className="newlead" onSubmit={test}>
        <label>Send to<input className="field-input" name="to" type="email" required /></label>
        <span className="newlead-actions"><button className="btn" disabled={busy}>Send test email</button></span>
      </form>
      <p className="muted gauge-note">Save first, then send a test. The mail server accepting a message does not guarantee it reaches the inbox, so check Spam as well.</p>
    </>
  );
}
