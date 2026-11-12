import React, { useEffect, useState } from "react";
import { crmGet, crmSend } from "../api.js";
import { useCrm } from "../crm.jsx";
import { useToast } from "../toast.jsx";
import { avClass, initials } from "../format.js";
import { TIcon } from "./icons.jsx";
import { telOf, dayText, timeText } from "./PageUtil.js";
import DateTimePicker, { toLocalValue } from "../DateTimePicker.jsx";

// AI tasks (ai-tasks.mjs on the server): what to do next, from calls made since AI tasks were switched on, and from missed
// calls and waiting leads. Each says why, with the customer's words when it came from a call. Call or WhatsApp straight away,
// plan it as a follow-up (the time can be changed first), or dismiss it. The same list shows in the phone app's To-do.
// Styles: cwt/r-pages.css (ait-*).

const KINDS = [["all", "All"], ["call", "From calls"], ["signals", "Missed and waiting"]];
const ICON = { call: "phone", whatsapp: "whatsapp", quotation: "notePlus", visit: "pin", followup: "calendar" };
const whenOf = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? `${dayText(t)} ${timeText(t)}` : ""; };
const waOf = (phone) => `https://wa.me/${String(phone || "").replace(/\D/g, "")}`;

export default function AiTasks({ assignee = "", onOpenLead, onCount }) {
  const crm = useCrm();
  const notify = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState("all");
  const [busy, setBusy] = useState("");
  const [planning, setPlanning] = useState(null); // { id, due }
  const load = () => crmGet("ai-tasks").then((d) => { setData(d); setError(""); onCount?.(d.items.length); }).catch((e) => setError(e.message));
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  if (error) return <p className="fu-none">{error}</p>;
  if (!data) return <p className="fu-none">Loading AI tasks…</p>;

  const items = data.items.filter((x) => (!assignee || x.owner === assignee) && (kind === "all" || (kind === "call" ? x.kind === "call" : x.kind !== "call")));
  async function act(x, what, body = {}) {
    setBusy(x.id);
    try {
      await crmSend("POST", `ai-tasks/${encodeURIComponent(x.id)}/${what}`, body);
      if (what === "accept") await crm.reload();
      notify(what === "accept" ? "Follow-up planned" : "Dismissed");
      setPlanning(null);
      await load();
    } catch (e) { notify(e.message); } finally { setBusy(""); }
  }
  const nameOf = (id) => crm.users.get(id)?.name || "";

  return (
    <div className="ait">
      <div className="fu-filters">
        {KINDS.map(([k, label]) => <button key={k} type="button" className={`r-chip ${kind === k ? "on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>)}
        <span className="fu-gap" />
        <span className="ait-note">{data.aiOn ? `Reading calls made since ${dayText(Date.parse(data.startedAt))}` : "Calls are not read: set up a summary model in Settings, Call AI"}</span>
      </div>
      {!items.length && <p className="fu-none">Nothing to pick up right now. New tasks come from calls as they are made, and from missed calls and leads waiting for a first call.</p>}
      <div className="ait-list">
        {items.map((x) => {
          const owner = nameOf(x.owner), tel = telOf(x.phone), fromCall = x.kind === "call";
          return (
            <article key={x.id} className={`ait-card ait-${x.kind}`}>
              <p className="ait-why">
                <TIcon name={fromCall ? "sparkle" : x.kind === "missed" ? "phone" : "clock"} />
                {fromCall ? `From the ${x.from?.kind || "call"} of ${whenOf(x.from?.at)}${x.due ? ` · due ${whenOf(x.due)}` : ""}` : `${x.why}${x.at ? ` · ${whenOf(x.at)}` : ""}`}
              </p>
              <p className="ait-title">{x.title}</p>
              <p className="fu-sub">
                {x.leadId ? <button type="button" className="fu-lead" onClick={() => onOpenLead(x.leadId)}>{x.leadName || "Lead"}</button> : "Not a lead yet"}
                {[x.city, x.stage].filter(Boolean).map((s) => ` · ${s}`).join("")}
                {crm.me.lead && owner ? ` · ${owner}` : ""}
              </p>
              {fromCall && x.why && <blockquote className="ait-quote">"{x.why}"</blockquote>}
              {planning?.id === x.id ? (
                <div className="ait-plan">
                  <DateTimePicker value={planning.due} onChange={(due) => setPlanning({ ...planning, due })} ariaLabel="Follow-up time" />
                  <button type="button" className="r-btn" disabled={busy === x.id} onClick={() => act(x, "accept", { due: new Date(planning.due).toISOString() })}>Plan follow-up</button>
                  <button type="button" className="r-btn ghost" onClick={() => setPlanning(null)}>Cancel</button>
                </div>
              ) : (
                <div className="fu-foot">
                  {tel && (x.action === "call" || !fromCall) && <a className="fu-call" href={tel}><TIcon name="phone" />{x.kind === "missed" ? "Call back" : "Call now"}</a>}
                  {x.phone && x.action === "whatsapp" && <a className="fu-call ait-wa" href={waOf(x.phone)} target="_blank" rel="noopener noreferrer"><TIcon name="whatsapp" />WhatsApp</a>}
                  {x.leadId && <button type="button" className="r-btn ghost ait-btn" disabled={busy === x.id} onClick={() => setPlanning({ id: x.id, due: toLocalValue(new Date(Date.parse(x.due || "") > Date.now() ? Date.parse(x.due) : Date.now() + 3600000)) })}><TIcon name={ICON[x.action] || "calendar"} />Add as follow-up</button>}
                  <span className="fu-gap" />
                  {crm.me.lead && owner && <span className={`av fu-av ${avClass(owner)}`} title={owner} aria-label={`For ${owner}`}>{initials(owner)}</span>}
                  <button type="button" className="r-link ait-dismiss" disabled={busy === x.id} onClick={() => act(x, "dismiss")}>Dismiss</button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
