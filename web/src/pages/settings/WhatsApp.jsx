import React, { useEffect, useState } from "react";
import { crmGet, crmSend } from "../../api.js";
import { useToast } from "../../toast.jsx";

const STATE_TEXT = {
  disconnected: "Not connected",
  connecting: "Connecting…",
  qr: "Waiting for you to scan the code",
  connected: "Connected, syncing messages",
  reconnecting: "Reconnecting…",
  logged_out: "Signed out",
  admin_required: "Only an administrator can manage WhatsApp",
};
const LIVE = ["connecting", "qr", "reconnecting"];

export default function WhatsApp() {
  const notify = useToast();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);

  async function refresh() {
    try {
      setStatus(await crmGet("whatsapp/status"));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  // While a pairing code or a connection attempt is in progress, check again every few seconds.
  useEffect(() => {
    if (!status || !LIVE.includes(status.state)) return undefined;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [status?.state]);

  async function act(action, body, done) {
    setBusy(true);
    try {
      const next = await crmSend("POST", `whatsapp/${action}`, body);
      if (next?.state) setStatus(next);
      else await refresh();
      if (done) notify(done);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!status) return <p className="muted">Loading WhatsApp…</p>;
  const state = status.state;
  const connected = state === "connected";
  return (
    <>
      <p className="muted report-meta">Link a WhatsApp account so customer chats sync into the CRM. This is read-only: the CRM never sends a message for you. Open WhatsApp yourself to reply.</p>
      <p><b>{STATE_TEXT[state] || state}</b>{status.error && <><br /><span className="muted">{status.error}</span></>}</p>
      {status.unmatched > 0 && <p className="muted">{status.unmatched} chats could not be matched to a lead because the number is not in the CRM.</p>}
      {state === "qr" && status.qr && (
        <div className="setup-link">
          <img className="wa-qr" src={status.qr} alt="WhatsApp pairing code" width="240" height="240" />
          <p>On the phone: WhatsApp, Linked devices, Link a device, then scan this code.</p>
        </div>
      )}
      {!connected && !LIVE.includes(state) && state !== "admin_required" && (
        <div className="newlead">
          <label className="check wide">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            I understand this uses an unofficial WhatsApp client, so the number could be restricted by WhatsApp, and that synced messages are stored on this server.
          </label>
          <span className="newlead-actions">
            <button className="btn btn-primary" disabled={busy || !ack} onClick={() => act("connect", { acknowledged: true })}>Connect WhatsApp</button>
          </span>
        </div>
      )}
      {(connected || LIVE.includes(state)) && (
        <span className="newlead-actions">
          <button className="btn" disabled={busy} onClick={() => act("disconnect", {}, "WhatsApp disconnected. The link is kept, so you can reconnect without scanning.")}>Disconnect</button>
          <button
            className="btn btn-quiet"
            disabled={busy}
            onClick={() => confirm("Clear the linked session? You will need to scan a new code to connect again.") && act("logout", { confirmed: true }, "Local session cleared")}
          >Sign out and clear link</button>
        </span>
      )}
      {state === "logged_out" && status.error && <p className="muted gauge-note">{status.error}</p>}
    </>
  );
}
