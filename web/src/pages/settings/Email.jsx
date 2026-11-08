import React, { useState } from "react";
import { crmGet, crmSend } from "../../api.js";
import { useLoad } from "../../hooks.js";
import { useToast } from "../../toast.jsx";
import { Section, Note, Loading, Failed } from "./Parts.jsx";

export default function Email() {
  const notify = useToast();
  const [version, setVersion] = useState(0);
  const { data, error } = useLoad(() => crmGet("email/settings"), [version]);
  const [busy, setBusy] = useState(false);
  if (error) return <Failed>{error.message}</Failed>;
  if (!data) return <Loading>Loading email settings…</Loading>;
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
      <form className="set-form" onSubmit={save} key={version}>
        <Section title="Mail account" desc="Used for new-user setup links and password resets. This workspace keeps its own settings, encrypted on the server." status={c.enabled ? "Sending" : "Switched off"} tone={c.enabled ? "ok" : "off"}>
          <label className="check"><input type="checkbox" name="enabled" defaultChecked={Boolean(c.enabled)} /> <span><b>Send email from this CRM.</b></span></label>
          <div className="sec-grid">
            <label>Mail server<input className="field-input" name="host" defaultValue={c.host} required /></label>
            <label>Security
              <select className="field-input" name="port" defaultValue={String(c.port)}>
                <option value="465">465, SSL/TLS</option>
                <option value="587">587, STARTTLS</option>
              </select>
            </label>
            <label>Mailbox (username)<input className="field-input" name="username" type="email" defaultValue={c.username || ""} required /></label>
            <label>Password<input className="field-input" name="password" type="password" autoComplete="new-password" placeholder={c.hasPassword ? "Saved. Leave blank to keep it" : "Mailbox password"} /></label>
          </div>
        </Section>
        <Section title="Sender" desc="What people see in their inbox.">
          <div className="sec-grid">
            <label>From address<input className="field-input" name="fromEmail" type="email" defaultValue={c.fromEmail || ""} required /></label>
            <label>Sender name<input className="field-input" name="fromName" defaultValue={c.fromName} required /></label>
          </div>
        </Section>
        <div className="set-bar"><button className="btn btn-primary" disabled={busy}>Save email settings</button></div>
      </form>
      <Section title="Send a test" desc="Save first, then send a test. The mail server accepting a message does not guarantee it reaches the inbox, so check Spam as well.">
        <form className="sec-grid" onSubmit={test}>
          <label>Send to<input className="field-input" name="to" type="email" required /></label>
          <div className="newlead-actions"><button className="btn" disabled={busy}>Send test email</button></div>
        </form>
      </Section>
    </>
  );
}
