import React, { useState } from "react";
import { signinSettings, saveSigninSettings } from "../../api.js";
import { useLoad } from "../../hooks.js";
import { useToast } from "../../toast.jsx";
import { Section, Note, Steps, Loading, Failed } from "./Parts.jsx";

// Two more ways to sign in, for people who already have a login: a 6-digit code on WhatsApp, and Devi ERP (ERPNext).
export default function SigninMethods() {
  const notify = useToast();
  const [version, setVersion] = useState(0);
  const { data, error } = useLoad(() => signinSettings(), [version]);
  const [busy, setBusy] = useState(false);
  if (error) return <Failed>{error.message}</Failed>;
  if (!data) return <Loading>Loading sign-in settings…</Loading>;

  async function act(input, done) {
    setBusy(true);
    try {
      await saveSigninSettings(input);
      notify(done);
      setVersion((v) => v + 1);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  function saveOtp(event) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const mobiles = Object.fromEntries(data.people.map((p) => [p.id, String(f.get(`m-${p.id}`) || "").trim()]));
    act({ mobiles, otpTemplate: String(f.get("otpTemplate") || "").trim(), otpEnabled: f.get("otpEnabled") === "on" }, "Saved. The sign-in screen shows OTP only when it is on.");
  }
  function saveErp(event) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    act({ erpBaseUrl: String(f.get("erpBaseUrl") || "").trim(), erpClientId: String(f.get("erpClientId") || "").trim(), erpClientSecret: String(f.get("erpClientSecret") || "") || undefined, erpEnabled: f.get("erpEnabled") === "on" }, "Saved. Nothing was changed in Devi ERP.");
  }

  return (
    <>
      <form className="set-form" onSubmit={saveOtp} key={`otp${version}`}>
        <Section title="OTP on WhatsApp" desc="Staff type their mobile number and get a 6-digit code on WhatsApp. Codes work once, for 5 minutes." status={data.otpEnabled ? "On" : data.gatewayReady ? "Off" : "Needs the WhatsApp gateway"} tone={data.otpEnabled ? "ok" : "off"}>
          <label className="check"><input type="checkbox" name="otpEnabled" defaultChecked={data.otpEnabled} disabled={!data.gatewayReady && !data.otpEnabled} /> <span><b>Allow sign-in with a WhatsApp code.</b> {data.gatewayReady ? "Codes go out from your WhatsApp gateway's default number." : "Turn on the WhatsApp gateway in Settings first."}</span></label>
          <div className="sec-grid">
            <label>Approved template name (optional)<input className="field-input" name="otpTemplate" defaultValue={data.otpTemplate} placeholder="e.g. salesdesk_login_code" /></label>
          </div>
          <Note>WhatsApp only lets a business send plain text to someone who wrote to it in the last 24 hours. For codes to reach staff at any time, make an Authentication template in Meta with one number field for the code and put its name here.</Note>
          <div className="sec-line"><b>Mobile number of each person</b></div>
          <div className="sec-grid">
            {data.people.map((p) => (
              <label key={p.id}>{p.name}<input className="field-input" name={`m-${p.id}`} inputMode="tel" defaultValue={p.mobile ? `+${p.mobile}` : ""} placeholder="+91 98765 43210" /></label>
            ))}
          </div>
          {!data.people.length && <Note>No one has a login yet.</Note>}
        </Section>
        <div className="set-bar"><button className="btn btn-primary" disabled={busy}>Save</button></div>
      </form>

      <form className="set-form" onSubmit={saveErp} key={`erp${version}`}>
        <Section title="Devi ERP sign-in" desc="Staff sign in with their ERPNext login. Salesdesk matches them by email, so each person's Salesdesk email must be the same as in ERP." status={data.erpEnabled ? "On" : "Off"} tone={data.erpEnabled ? "ok" : "off"}>
          <Steps>
            <>In ERPNext, open <b>OAuth Client</b> and add a new one. App name: Salesdesk. Grant type: Authorization Code. Response type: Code. Scopes: openid.</>
            <>Set the redirect URI to <code>{data.erpRedirectUri}</code> (also as the default redirect URI).</>
            <>Copy the client ID and client secret into the boxes below, save, then turn it on.</>
          </Steps>
          <label className="check"><input type="checkbox" name="erpEnabled" defaultChecked={data.erpEnabled} /> <span><b>Show "Devi ERP" on the sign-in screen.</b></span></label>
          <div className="sec-grid">
            <label>ERP address<input className="field-input" name="erpBaseUrl" type="url" defaultValue={data.erpBaseUrl} placeholder="https://deviindustries.com" /></label>
            <label>Client ID<input className="field-input" name="erpClientId" defaultValue={data.erpClientId} autoComplete="off" /></label>
            <label>Client secret<input className="field-input" name="erpClientSecret" type="password" autoComplete="new-password" placeholder={data.erpHasSecret ? "Saved. Leave blank to keep it" : "From the OAuth client"} /></label>
          </div>
          <Note>People without a matching email, or without a Salesdesk login, are refused. ERP sign-in never creates logins.</Note>
        </Section>
        <div className="set-bar"><button className="btn btn-primary" disabled={busy}>Save</button></div>
      </form>
    </>
  );
}
