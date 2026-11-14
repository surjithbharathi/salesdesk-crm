import React, { useEffect, useRef, useState } from "react";
import { login, otpStart, otpVerify, crmGet, crmSend } from "../api.js";

// The sign-in screen: brand side on the left, the form on the right.
// Username + password always; a WhatsApp code and Devi ERP only when an admin has turned them on.

const Mark = ({ className }) => <svg className={className} viewBox="0 0 100 100" aria-hidden="true"><path d="M8 72h22v22H8z" /><path d="M26 40h34v34H44V57H26z" /><path d="M44 6h48v51H76V23H44z" /></svg>;
const I = ({ d, className = "r-ic" }) => <svg className={className} viewBox="0 0 24 24" aria-hidden="true">{d}</svg>;
const icons = {
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  phone: <><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M11 18h2" /></>,
  erp: <><path d="M3 21h18" /><path d="M5 21V9l7-5 7 5v12" /><path d="M9 21v-6h6v6" /></>,
  bag: <><path d="M20 7H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1z" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /></>,
  call: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />,
  clock: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2" /></>,
  shield: <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" />,
};

function errorFromLink() {
  const m = /[?&]error=([^&]*)/.exec(location.hash);
  if (!m) return "";
  try {
    return decodeURIComponent(m[1]).slice(0, 200);
  } catch {
    return "";
  }
}

function Brand() {
  return (
    <section className="r-login-brand" aria-label="Salesdesk">
      <Mark className="r-login-watermark" />
      <div className="r-login-logo"><span className="r-login-tile"><Mark /></span><div><p className="r-login-name">Salesdesk</p><p className="r-login-co">Devi Industries</p></div></div>
      <div className="r-login-pitch">
        <h2>Every enquiry,<br />every call,<br />one place.</h2>
        <p>IndiaMART, TradeIndia and WhatsApp leads land here. Call from your phone, and the call, recording and next follow-up are saved for you.</p>
        <div className="r-login-cards" aria-hidden="true">
          <div className="r-login-mini a"><span className="r-dot orange"><I d={icons.bag} /></span><div><b>New enquiry · Cold Press Oil Machine</b><small>From TradeIndia</small></div></div>
          <div className="r-login-mini b"><span className="r-dot green"><I d={icons.call} /></span><div><b>Call answered · 2m 14s</b><small>Recording saved</small></div></div>
          <div className="r-login-mini c"><span className="r-dot blue"><I d={icons.clock} /></span><div><b>Follow-up tomorrow 10 AM</b><small>Reminder on the phone</small></div></div>
        </div>
      </div>
      <p className="r-login-foot">© Devi Industries</p>
    </section>
  );
}

function PasswordForm({ methods, onDone, onOtp, initialError }) {
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await login(form.get("username"), form.get("password"));
      onDone();
    } catch (e) {
      setError(e.message === "Invalid credentials or session" ? "That username and password do not match." : e.message);
    } finally {
      setBusy(false);
    }
  }
  const others = methods.otp || methods.erp;
  return (
    <form className="r-login-form" onSubmit={submit} aria-label="Sign in">
      <div><h1>Sign in</h1><p className="r-login-sub">Use the username and password your admin gave you.</p></div>
      <label className="r-fld"><span>Username</span>
        <span className="r-inp"><I d={icons.user} /><input name="username" autoComplete="username" required autoFocus /></span>
      </label>
      <label className="r-fld"><span>Password</span>
        <span className="r-inp"><I d={icons.lock} /><input name="password" type={show ? "text" : "password"} autoComplete="current-password" required /><button type="button" className="r-eye" aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} onClick={() => setShow(!show)}><I d={icons.eye} /></button></span>
      </label>
      <p className="r-login-help">Forgot your password? Ask your admin to reset it.</p>
      {error && <p className="r-login-error" role="alert">{error}</p>}
      <button className="r-login-primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      {others && <div className="r-or" aria-hidden="true"><i />or<i /></div>}
      {others && (
        <div className="r-login-alt">
          {methods.otp && <button type="button" className="r-login-other" onClick={onOtp}><span className="r-alt-ic green"><I d={icons.phone} /></span>OTP on WhatsApp</button>}
          {methods.erp && <a className="r-login-other" href="/api/auth/erp/start"><span className="r-alt-ic dark"><I d={icons.erp} /></span>Devi ERP</a>}
        </div>
      )}
      <div className="r-login-note"><span className="r-dot green"><I d={icons.phone} /></span><p><b>Calling from your phone?</b> Install the Salesdesk app and sign in there with the same username.</p></div>
    </form>
  );
}

function OtpForm({ onDone, onBack }) {
  const [step, setStep] = useState("number");
  const [mobile, setMobile] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [wait, setWait] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const boxes = useRef([]);
  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function send(event) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await otpStart(mobile);
      setSentTo(r.sentTo);
      setWait(r.resendAfter || 30);
      setDigits(["", "", "", "", "", ""]);
      setStep("code");
      setTimeout(() => boxes.current[0]?.focus(), 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function verify(code) {
    setBusy(true);
    setError("");
    try {
      await otpVerify(mobile, code);
      onDone();
    } catch (e) {
      setError(e.message);
      setDigits(["", "", "", "", "", ""]);
      boxes.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  }
  function type(i, value) {
    const only = value.replace(/\D/g, "");
    const next = [...digits];
    if (only.length > 1) {
      only.slice(0, 6 - i).split("").forEach((d, k) => (next[i + k] = d));
    } else next[i] = only;
    setDigits(next);
    const filled = next.join("");
    if (filled.length === 6) verify(filled);
    else if (only) boxes.current[Math.min(i + only.length, 5)]?.focus();
  }
  function key(i, e) {
    if (e.key === "Backspace" && !digits[i] && i > 0) boxes.current[i - 1]?.focus();
  }

  if (step === "number") {
    return (
      <form className="r-login-form" onSubmit={send} aria-label="Sign in with a WhatsApp code">
        <button type="button" className="r-back" onClick={onBack}>‹ Back</button>
        <div><h1>Sign in with OTP</h1><p className="r-login-sub">Enter the mobile number your admin saved for you. We will send a 6-digit code on WhatsApp.</p></div>
        <label className="r-fld"><span>Mobile number</span>
          <span className="r-inp"><span className="r-cc">+91</span><input inputMode="numeric" autoComplete="tel-national" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="98765 00008" required autoFocus /></span>
        </label>
        {error && <p className="r-login-error" role="alert">{error}</p>}
        <button className="r-login-primary" disabled={busy}>{busy ? "Sending…" : "Send code on WhatsApp"}</button>
        <div className="r-login-note"><span className="r-dot blue"><I d={icons.shield} /></span><p>Only numbers your admin added to the team can sign in with OTP.</p></div>
      </form>
    );
  }
  return (
    <form className="r-login-form" onSubmit={(e) => { e.preventDefault(); if (digits.join("").length === 6) verify(digits.join("")); }} aria-label="Enter the code">
      <button type="button" className="r-back" onClick={() => { setStep("number"); setError(""); }}>‹ Back</button>
      <div><h1>Enter the OTP</h1><p className="r-login-sub">If this number is on the team, a 6-digit code is on its way on WhatsApp to <b>{sentTo}</b>. <button type="button" className="r-link" onClick={() => { setStep("number"); setError(""); }}>Change number</button></p></div>
      <div className="r-otp" role="group" aria-label="6-digit code">
        {digits.map((d, i) => (
          <input key={i} ref={(el) => (boxes.current[i] = el)} className="r-otp-box" inputMode="numeric" autoComplete={i === 0 ? "one-time-code" : "off"} aria-label={`Digit ${i + 1}`} maxLength={6} value={d} onChange={(e) => type(i, e.target.value)} onKeyDown={(e) => key(i, e)} />
        ))}
      </div>
      <div className="r-resend">{wait > 0 ? <span>Didn't get it? Resend in <b>0:{String(wait).padStart(2, "0")}</b></span> : <button type="button" className="r-link" onClick={send} disabled={busy}>Send the code again</button>}</div>
      {error && <p className="r-login-error" role="alert">{error}</p>}
      <button className="r-login-primary" disabled={busy || digits.join("").length !== 6}>{busy ? "Checking…" : "Verify and sign in"}</button>
    </form>
  );
}

export default function Login({ methods = {}, onDone }) {
  const [mode, setMode] = useState("password");
  const [linkError] = useState(errorFromLink);
  useEffect(() => {
    if (linkError) history.replaceState(null, "", location.pathname);
  }, [linkError]);
  return (
    <div className="cwt r-login">
      <Brand />
      <main className="r-login-main">
        {mode === "otp" ? <OtpForm onDone={onDone} onBack={() => setMode("password")} /> : <PasswordForm methods={methods} onDone={onDone} onOtp={() => setMode("otp")} initialError={linkError} />}
      </main>
    </div>
  );
}

// When an AI app (Claude and others) asks to connect to this CRM over MCP, the CRM sends the admin here
// (#mcp?oauth_request=…) to approve or deny it; the answer then goes back to that app.
const SCOPE_WORDS = {
  "leads:read": "Read leads, calls and messages",
  "reports:read": "Read daily reports",
  "insights:read": "Read call AI results and lead insights",
  "leads:edit": "Propose lead changes (each one waits for your approval)",
  "leads:assign": "Propose lead assignments (each one waits for your approval)",
  "transcription:run": "Ask for call transcriptions (each one waits for your approval)",
  "tasks:write": "Add follow-up tasks",
};
export function McpConsent({ id, admin }) {
  const [request, setRequest] = useState(null);
  const [error, setError] = useState(admin ? "" : "Only an admin can connect an app to this CRM. Sign in with an admin account.");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!admin) return;
    crmGet("mcp/oauth/" + id).then(setRequest, (e) => setError(e.message === "Authorization request expired or already used" ? "This request has expired or was already answered. Start the connection again from the app." : e.message));
  }, [id, admin]);
  async function answer(approved) {
    setBusy(true);
    setError("");
    try {
      const result = await crmSend("POST", "mcp/oauth/" + id, { approved });
      location.assign(result.redirect);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  let host = "";
  try {
    host = request ? new URL(request.redirectUri).host : "";
  } catch {
    host = request?.redirectUri || "";
  }
  return (
    <div className="cwt r-login">
      <Brand />
      <main className="r-login-main">
        <div className="r-login-form" role="region" aria-label="Connect an app">
          <div><h1>Connect an app</h1><p className="r-login-sub">{request ? <><b>{request.clientName}</b> wants to use this CRM.</> : "Checking the request…"}</p></div>
          {request && (
            <>
              <div className="r-login-note"><p>After you approve, you go back to <b>{host}</b>. The app's name is given by the app itself, so approve only if you started this connection.</p></div>
              <ul className="r-login-sub">{request.scopes.map((s) => <li key={s}>{SCOPE_WORDS[s] || s}</li>)}</ul>
              <p className="r-login-help">The app stays connected for up to 7 days unless you remove it.</p>
            </>
          )}
          {error && <p className="r-login-error" role="alert">{error}</p>}
          {request && (
            <div className="r-login-alt">
              <button type="button" className="r-login-other" disabled={busy} onClick={() => answer(false)}>Deny</button>
              <button type="button" className="r-login-primary r-grow" disabled={busy} onClick={() => answer(true)}>{busy ? "Connecting…" : "Approve"}</button>
            </div>
          )}
          {!request && error && <a className="r-login-other" href="#/">Go to the CRM</a>}
        </div>
      </main>
    </div>
  );
}
