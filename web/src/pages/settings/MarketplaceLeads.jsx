import React, { useState } from "react";
import { crmGet, crmSend } from "../../api.js";
import { useLoad } from "../../hooks.js";
import { useToast } from "../../toast.jsx";
import { Section, Note, Steps, Loading, Failed } from "./Parts.jsx";

// IndiaMART and TradeIndia enquiries come into Leads by themselves. Both sites are only read, with the keys saved here.
const when = (t) => (t ? new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "never");
const LABEL = { "new lead": "New lead", repeat: "Noted on the buyer's lead", blocked: "Blocked number, left out", "no contact": "No number or email", failed: "Could not be saved" };

function Recent({ side }) {
  if (!side.recent.length) return null;
  return (
    <ul className="sec-line">
      {side.recent.map((q) => (
        <li key={q.id}>{when(q.at)} · {q.buyer || "Buyer"}{q.phone ? ` (${q.phone})` : ""}{q.product ? ` · ${q.product}` : ""} · {q.leadId ? <a href={`#/leads?lead=${q.leadId}`}>{LABEL[q.status] || q.status}</a> : LABEL[q.status] || q.status}</li>
      ))}
    </ul>
  );
}

function lastLine(side, empty) {
  const run = side.lastRun;
  if (!run) return empty;
  if (!run.ok) return `${when(run.at)}. ${run.message}`;
  return `${when(run.at)}. ${run.message}. ${run.enquiries} enquiries read: ${run.newLeads} new leads, ${run.repeats} noted on existing leads${run.skipped ? `, ${run.skipped} left out` : ""}.`;
}
const runState = (side) => (side.lastRun ? (side.lastRun.ok ? ["Last read fine", "ok"] : ["Last read failed", "bad"]) : ["Nothing read yet", "off"]);

export default function MarketplaceLeads({ users = [] }) {
  const notify = useToast();
  const [version, setVersion] = useState(0);
  const { data, error } = useLoad(() => crmGet("marketplace/settings"), [version]);
  const [busy, setBusy] = useState(false);
  if (error) return <Failed>{error.message}</Failed>;
  if (!data) return <Loading>Loading IndiaMART and TradeIndia…</Loading>;
  const { indiamart: im, tradeindia: ti } = data;
  async function act(fn, done) {
    setBusy(true);
    try { await fn(); notify(done); setVersion((v) => v + 1); } catch (e) { notify(e.message); } finally { setBusy(false); }
  }
  function save(event) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    act(() => crmSend("POST", "marketplace/settings", {
      intervalMinutes: Number(f.get("intervalMinutes")), owner: f.get("owner") || "",
      indiamart: { key: f.get("imKey") || undefined, backfillDays: Number(f.get("imDays")), enabled: f.get("imOn") === "on" },
      tradeindia: { userid: f.get("tiUser") || "", profileId: f.get("tiProfile") || "", key: f.get("tiKey") || undefined, backfillDays: Number(f.get("tiDays")), enabled: f.get("tiOn") === "on" },
    }), "Saved. Nothing was changed in IndiaMART or TradeIndia.");
  }
  const read = (source, name) => act(() => crmSend("POST", "marketplace/sync", { source }), `Read from ${name}`);
  const active = users.filter((u) => u.active !== false);
  const on = [im.enabled && "IndiaMART", ti.enabled && "TradeIndia"].filter(Boolean);
  return (
    <>
      <Section title="What this does" desc="Both sites are only read, never changed." status={on.length ? `Reading ${on.join(" and ")}` : "Switched off"} tone={on.length ? "ok" : "off"}>
        <Steps>
          <>Every few minutes the CRM reads new enquiries from your IndiaMART Lead Manager and your TradeIndia inquiries.</>
          <>A buyer not in the CRM yet becomes a new lead, with source IndiaMART or TradeIndia, the product and the buyer's message.</>
          <>A buyer already in the CRM (same mobile number) is not made twice: the new enquiry is noted on that lead's timeline.</>
        </Steps>
        <Note>Who gets a new lead is decided by your workflows (for example "A new lead comes in" and Source is IndiaMART). Blocked numbers are left out.</Note>
      </Section>
      <form className="set-form" onSubmit={save} key={version}>
        <Section title="IndiaMART" desc="Make the key in IndiaMART Lead Manager → Import/Export Leads → Pull API (CRM key). The same key as the IndiaMART call link is fine. Keys are never shown again.">
          <label className="check"><input type="checkbox" name="imOn" defaultChecked={im.enabled} /> <span><b>Read IndiaMART enquiries.</b> Direct enquiries, buy-leads and calls.</span></label>
          <div className="sec-grid">
            <label>IndiaMART CRM key<input className="field-input" name="imKey" type="password" autoComplete="new-password" placeholder={im.hasKey ? "Saved. Leave blank to keep it" : "CRM key from IndiaMART"} /></label>
            <label>First read goes back (days)<input className="field-input" name="imDays" type="number" min="1" max="90" defaultValue={im.backfillDays} /></label>
          </div>
        </Section>
        <Section title="TradeIndia" desc="Find these in TradeIndia → My Profile → Inquiries and Contacts → My Inquiry API.">
          <label className="check"><input type="checkbox" name="tiOn" defaultChecked={ti.enabled} /> <span><b>Read TradeIndia inquiries.</b></span></label>
          <div className="sec-grid">
            <label>User id<input className="field-input" name="tiUser" autoComplete="off" defaultValue={ti.userid} /></label>
            <label>Profile id<input className="field-input" name="tiProfile" autoComplete="off" defaultValue={ti.profileId} /></label>
            <label>Key<input className="field-input" name="tiKey" type="password" autoComplete="new-password" placeholder={ti.hasKey ? "Saved. Leave blank to keep it" : "Key from TradeIndia"} /></label>
            <label>First read goes back (days)<input className="field-input" name="tiDays" type="number" min="1" max="90" defaultValue={ti.backfillDays} /></label>
          </div>
        </Section>
        <Section title="For both">
          <div className="sec-grid">
            <label>Read every (minutes)<input className="field-input" name="intervalMinutes" type="number" min="10" max="1440" defaultValue={data.intervalMinutes} /></label>
            <label>New leads go to
              <select className="field-input" name="owner" defaultValue={data.owner}>
                <option value="">Nobody (workflows assign)</option>
                {active.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
          </div>
        </Section>
        <div className="set-bar"><button className="btn btn-primary" disabled={busy}>Save</button></div>
      </form>
      <Section title="IndiaMART reads" desc="IndiaMART allows one read every 5 minutes and 7 days per read, so older enquiries come in over several reads." status={runState(im)[0]} tone={runState(im)[1]}>
        <p role="status" className="sec-line">{lastLine(im, "Save the CRM key first, then read.")} {im.enquiries ? `${im.enquiries} enquiries so far, ${im.leadsMade} new leads.` : ""}</p>
        <div className="newlead-actions"><button type="button" className="btn btn-primary" disabled={busy || !im.hasKey} onClick={() => read("indiamart", "IndiaMART")}>Read IndiaMART now</button></div>
        <Recent side={im} />
      </Section>
      <Section title="TradeIndia reads" desc="TradeIndia is read by whole days; the last day is read again so later inquiries that day are not missed." status={runState(ti)[0]} tone={runState(ti)[1]}>
        <p role="status" className="sec-line">{lastLine(ti, "Save the user id, profile id and key first, then read.")} {ti.enquiries ? `${ti.enquiries} inquiries so far, ${ti.leadsMade} new leads.` : ""}</p>
        <div className="newlead-actions"><button type="button" className="btn btn-primary" disabled={busy || !ti.hasKey} onClick={() => read("tradeindia", "TradeIndia")}>Read TradeIndia now</button></div>
        <Recent side={ti} />
      </Section>
    </>
  );
}
