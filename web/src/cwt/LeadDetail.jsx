import React, { useEffect, useMemo, useState } from "react";
import { crmSend } from "../api.js";
import { useCrm, phoneLabel, telHref, waHref } from "../crm.jsx";
import { useToast } from "../toast.jsx";
import { initials } from "../format.js";
import Recording from "../Recording.jsx";
import { PIPELINE, pipelineStep } from "../pipeline.js";
import { TIcon } from "./icons.jsx";
import GatewayChat, { useGatewayOn } from "../GatewayChat.jsx";
import ChatEntry, { fromActivity, userForNumber, saidInChat } from "../ChatEntry.jsx";

// One lead in the TeleCRM style: header with status and assignee, field tabs, the action bar and the activity history.
// The class names are the reference web app's, so its style sheet (cwt/lead-detail.css) applies as written.

const STATUSES = ["New", ...PIPELINE.map((d) => d.name)];
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-");
const OUTCOMES = ["Interested", "Callback", "No answer", "Not interested", "Connected"];
const FIELDS = [
  ["primary", "email", "Email", "mail"], ["primary", "phone", "Phone", "phone"], ["primary", "company", "Business", "box"], ["primary", "city", "City", "box"],
  ["basic", "name", "Name", "box"], ["basic", "source", "Source", "box"],
  ["others", "value", "Deal Value", "box"], ["others", "id", "Lead ID", "box"],
];
const ago = (t) => { const m = Math.floor((Date.now() - t) / 60000); if (m < 1) return "just now"; if (m < 60) return `${m}m ago`; const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`; const d = Math.floor(h / 24); return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`; };
const when = (iso) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const duration = (s) => `${Math.floor(s / 3600)}h:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m:${String(s % 60).padStart(2, "0")}s`;
const localInput = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export function LeadDetail({ id }) {
  const crm = useCrm();
  const notify = useToast();
  const gatewayOn = useGatewayOn();
  const [fieldTab, setFieldTab] = useState("primary");
  const [showEmpty, setShowEmpty] = useState(true);
  const [fieldSearch, setFieldSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [lowerTab, setLowerTab] = useState("history");
  const [menu, setMenu] = useState("");
  const [composer, setComposer] = useState("");
  const [draft, setDraft] = useState("");
  const [laterAt, setLaterAt] = useState(() => localInput(new Date(Date.now() + 86400000)));
  const [outcome, setOutcome] = useState("Connected");
  const [mins, setMins] = useState("");
  const [filter, setFilter] = useState("all");
  const [iqOpen, setIqOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const raw = crm.leadById.get(id);
  useEffect(() => { setMenu(""); setComposer(""); }, [id]);
  const acts = useMemo(() => crm.activities.filter((a) => a.leadId === id).sort((a, b) => String(b.occurredAt || b.createdAt).localeCompare(String(a.occurredAt || a.createdAt))), [crm.activities, id]);
  if (!crm.state || !raw) return <p className="muted">{crm.error || "Loading the lead…"}</p>;

  const pendingRec = new Set((crm.calls || []).filter((c) => !c.recordingId && c.recordingPath).map((c) => c.activityId));
  const recordings = new Map((crm.calls || []).filter((c) => c.recordingId).map((c) => [c.activityId, c.recordingId]));
  const tasks = crm.tasks.filter((t) => t.leadId === id).sort((a, b) => String(a.due).localeCompare(String(b.due)));
  const status = raw.stage === "New" ? "New" : pipelineStep(raw) || "New";
  const ownerName = crm.users.get(raw.owner)?.name || "Unassigned";
  const canEdit = crm.me?.lead;
  const isAdmin = ["owner", "admin"].includes(crm.me?.role);
  // Delete for good; with block, the number is also kept out of phone sync, TeleCRM and WhatsApp so the lead does not return.
  const remove = (block) => {
    setMenu("");
    const what = block
      ? `Delete ${raw.name} and block +${raw.phoneKey}?\n\nThe lead, its calls, recordings, notes, messages and follow-ups are removed. Calls and WhatsApp from this number will not create a lead again. Unblock it in Settings, Blocked numbers.`
      : `Delete ${raw.name} for good?\n\nThe lead, its calls, recordings, notes, messages and follow-ups are removed. This cannot be undone. If the number calls again or TeleCRM syncs it, the lead comes back; use "Delete and block number" to stop that.`;
    if (!confirm(what)) return;
    run(block ? "Lead deleted and number blocked" : "Lead deleted", async () => {
      await crmSend("DELETE", `leads/${id}${block ? "?block=1" : ""}`);
      location.hash = location.hash.replace(/([?&])lead=[^&]*&?/, "$1").replace(/[?&]$/, "");
    });
  };
  const q = fieldSearch.trim().toLowerCase();
  const value = (key) => (key === "id" ? raw.id : raw[key] == null ? "" : String(raw[key]));
  const fields = FIELDS.filter(([tab, key, label]) => tab === fieldTab && (!q || label.toLowerCase().includes(q)) && (showEmpty || value(key).trim() !== ""));
  const counts = { primary: FIELDS.filter((f) => f[0] === "primary").length, basic: FIELDS.filter((f) => f[0] === "basic").length, others: FIELDS.filter((f) => f[0] === "others").length };

  async function run(done, fn) {
    setBusy(true);
    try { await fn(); await crm.reload(); if (done) notify(done); } catch (e) { notify(e.message); } finally { setBusy(false); }
  }
  const patch = (done, body) => run(done, () => crmSend("PATCH", `leads/${id}`, body));
  const setField = (key, val) => { if (value(key) === val) return; patch("Saved", { [key]: key === "value" ? Math.max(0, Number(val) || 0) : val.trim() }); };
  const setStatus = (s) => { setMenu(""); patch(`Status updated to ${s}`, s === "New" ? { stage: "New", disposition: "", deal: "" } : { deal: s }); };
  const submit = (e) => {
    e.preventDefault();
    if (composer === "later") {
      if (!laterAt) return;
      run("Follow up scheduled", async () => { await crmSend("POST", "tasks", { leadId: id, title: `Call ${raw.name}`, due: new Date(laterAt).toISOString(), status: "Open", owner: raw.owner || crm.me.id || "" }); setComposer(""); });
    } else if (composer === "note") {
      if (!draft.trim()) return;
      run("Note added", async () => { await crmSend("POST", "activities", { leadId: id, type: "Note", text: draft.trim() }); setDraft(""); setComposer(""); });
    } else if (composer === "call") {
      run("Call logged", async () => { await crmSend("POST", "activities", { leadId: id, type: "Call", text: "Call logged", direction: "Outgoing", duration: Math.max(0, Number(mins || 0)) * 60, outcome }); setMins(""); setComposer(""); });
    }
  };
  const doneTask = (t, done) => run("", () => crmSend("PATCH", `tasks/${t.id}`, { status: done ? "Done" : "Open" }));
  const open = (kind) => { setDraft(""); setComposer(composer === kind ? "" : kind); };
  const entries = acts.filter((a) => filter === "all" || (filter === "call" && a.type === "Call") || (filter === "note" && (a.type === "Note" || a.type === "Visit")) || (filter === "message" && a.type === "Message") || (filter === "status" && a.type === "System"));
  const calls = acts.filter((a) => a.type === "Call");
  const connected = calls.filter((a) => (Number(a.duration) || 0) > 0).length;
  const score = Math.min(95, 20 + connected * 12 + (status === "Interested Customer" || status === "Quotation Shared" ? 20 : 0));
  const callLabel = (a) => ((Number(a.duration) || 0) > 0 ? "CONNECTED" : "NOT ANSWERED");

  return (
    <div className="cwt-detail">
      <section className="top-card">
        <div className="head">
          <div className="title-col">
            <input className="lead-name" defaultValue={raw.name} key={`${id}-${raw.name}`} aria-label="Lead name" onBlur={(e) => e.target.value.trim() && setField("name", e.target.value)} />
            <div className="status-row">
              <div className="drop">
                <button type="button" className={`status-chip st-${slug(status)}`} onClick={() => setMenu(menu === "status" ? "" : "status")}>{status} <TIcon name="chevronDown" /></button>
                {menu === "status" && <div className="menu" onMouseLeave={() => setMenu("")}>{STATUSES.map((s) => <button key={s} type="button" className={s === status ? "on" : ""} onClick={() => setStatus(s)}><i className={`dot st-${slug(s)}`} />{s}</button>)}</div>}
              </div>
            </div>
          </div>
          <div className="right-col">
            <div className="icons">
              {raw.email && <a className="ic" title="Email" href={`mailto:${raw.email}`}><TIcon name="at" /></a>}
              <div className="drop">
                <button type="button" className="more-btn" title="More: archive, delete, block number" aria-label="More actions" onClick={() => setMenu(menu === "more" ? "" : "more")}><TIcon name="kebab" className="kebab" /></button>
                {menu === "more" && (
                  <div className="menu right" onMouseLeave={() => setMenu("")}>
                    <a className="menu-link" href={telHref(raw)}>Call now</a>
                    {canEdit && <button type="button" className="danger" onClick={() => { setMenu(""); confirm(`Archive ${raw.name}? The lead leaves the lists but is kept.`) && patch("Lead archived", { archived: true }); }}>Archive lead</button>}
                    <label className="menu-check"><input type="checkbox" checked={Boolean(raw.noCallSync)} disabled={busy} onChange={(e) => patch(e.target.checked ? "Calls with this lead are no longer synced" : "Calls with this lead are synced again", { noCallSync: e.target.checked })} /> Do not sync calls</label>
                    {isAdmin && <button type="button" className="danger" disabled={busy} onClick={() => remove(false)}>Delete lead</button>}
                    {isAdmin && raw.phoneKey && <button type="button" className="danger" disabled={busy} onClick={() => remove(true)}>Delete and block number</button>}
                  </div>
                )}
              </div>
            </div>
            <div className="drop">
              <button type="button" className="assignee" onClick={() => canEdit && setMenu(menu === "assign" ? "" : "assign")}>{ownerName} <span className="av">{initials(ownerName)}</span></button>
              {menu === "assign" && <div className="menu right" onMouseLeave={() => setMenu("")}>{crm.me.users.map((u) => <button key={u.id} type="button" className={u.id === raw.owner ? "on" : ""} onClick={() => { setMenu(""); patch("Owner changed", { owner: u.id }); }}>{u.name}</button>)}</div>}
            </div>
          </div>
        </div>

        <div className="fields-card">
          <div className="field-tabs">
            {[["primary", "Primary"], ["basic", "Basic Info"], ["others", "Others"]].map(([k, label]) => <button key={k} type="button" className={fieldTab === k ? "active" : ""} onClick={() => setFieldTab(k)}>{label} <em>{counts[k]}</em></button>)}
            <span className="grow" />
            {searchOpen && <input className="field-search" placeholder="Search fields" value={fieldSearch} onChange={(e) => setFieldSearch(e.target.value)} />}
            <button type="button" className="ic sm" title="Search fields" onClick={() => { setSearchOpen(!searchOpen); setFieldSearch(""); }}><TIcon name="search" /></button>
            <button type="button" className={`empty-toggle ${showEmpty ? "" : "off"}`} onClick={() => setShowEmpty(!showEmpty)}><TIcon name="eye" />Empty Fields</button>
          </div>
          <div className="field-grid">
            {fields.map(([, key, label, icon]) => (
              <div key={key} className="field">
                <label><TIcon name={icon} />{label}{key === "phone" && <span className="wa-badge" title="On WhatsApp"><TIcon name="whatsapp" /></span>}</label>
                {key === "phone" ? <div className="phone"><span className="flag" aria-hidden="true" /><input defaultValue={value(key)} key={`${id}-${value(key)}`} placeholder="Enter Phone Number" onBlur={(e) => e.target.value.trim() && setField(key, e.target.value)} /></div>
                  : <input defaultValue={value(key)} key={`${id}-${key}-${value(key)}`} placeholder="Empty" readOnly={key === "id"} onBlur={(e) => key !== "id" && setField(key, e.target.value)} />}
              </div>
            ))}
            {!fields.length && <p className="no-fields">No fields match.</p>}
          </div>

          <nav className="action-bar">
            <a href={telHref(raw)}><TIcon name="phone" />CALL</a>
            <button type="button" className={composer === "later" ? "on" : ""} onClick={() => open("later")}><TIcon name="clock" />CALL LATER</button>
            {gatewayOn ? <button type="button" className={composer === "wa" ? "on" : ""} onClick={() => open("wa")}><TIcon name="whatsapp" />WHATSAPP</button> : <a href={waHref(raw)} target="_blank" rel="noopener noreferrer"><TIcon name="whatsapp" />WHATSAPP</a>}
            <button type="button" className={composer === "note" ? "on" : ""} onClick={() => open("note")}><TIcon name="notePlus" />ADD NOTE</button>
            <button type="button" className={composer === "call" ? "on" : ""} onClick={() => open("call")}><TIcon name="calls" />LOG CALL</button>
            <button type="button" className={iqOpen ? "on" : ""} onClick={() => setIqOpen(!iqOpen)}><TIcon name="sparkle" />LEAD-IQ</button>
          </nav>
          {composer === "wa" && <div className="composer"><GatewayChat leadId={id} /></div>}
          {composer && composer !== "wa" && (
            <form className="composer" onSubmit={submit}>
              {composer === "later" && <><label>Call back on</label><input type="datetime-local" value={laterAt} onChange={(e) => setLaterAt(e.target.value)} required /></>}
              {composer === "note" && <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add Note..." required maxLength={4000} />}
              {composer === "call" && <><label>Outcome</label><select value={outcome} onChange={(e) => setOutcome(e.target.value)}>{OUTCOMES.map((o) => <option key={o}>{o}</option>)}</select><label>Minutes talked</label><input type="number" min="0" max="1440" value={mins} onChange={(e) => setMins(e.target.value)} /></>}
              <div className="row"><button type="button" className="crm-btn ghost sm" onClick={() => setComposer("")}>Cancel</button><button type="submit" className="crm-btn sm" disabled={busy}>{composer === "note" ? "Save note" : composer === "later" ? "Schedule" : "Save call"}</button></div>
            </form>
          )}
          {iqOpen && <div className="iq"><TIcon name="sparkle" /><p>Intent score {score}/100. {calls.length} call(s), {connected} connected. {score > 60 ? "Warm lead: call back soon and share the quotation." : "Early stage: confirm the requirement on the next call."}</p></div>}
        </div>
      </section>

      <div className="lower-head">
        <div className="lower-tabs">
          <button type="button" className={lowerTab === "history" ? "active" : ""} onClick={() => setLowerTab("history")}>Activity History</button>
          <button type="button" className={lowerTab === "task" ? "active" : ""} onClick={() => setLowerTab("task")}>Task</button>
        </div>
        <div className="drop">
          <button type="button" className="action-btn" onClick={() => setMenu(menu === "action" ? "" : "action")}><TIcon name="plus" />Action<TIcon name="chevronDown" className="cv" /></button>
          {menu === "action" && (
            <div className="menu right" onMouseLeave={() => setMenu("")}>
              <button type="button" onClick={() => { setMenu(""); open("note"); }}>Add note</button>
              <button type="button" onClick={() => { setMenu(""); open("later"); }}>Add task / call later</button>
              <button type="button" onClick={() => { setMenu(""); open("call"); }}>Log a call</button>
            </div>
          )}
        </div>
      </div>

      {lowerTab === "history" ? (
        <>
          <div className="filters">
            <TIcon name="filter" className="funnel" />
            <label className="chip-sel on">
              <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Activity type"><option value="all">All Actions</option><option value="call">Calls</option><option value="note">Notes and visits</option><option value="message">Messages</option><option value="status">Updates</option></select>
            </label>
          </div>
          <ul className="history">
            {(() => { const said = filter === "all" ? saidInChat(acts) : null; return entries.map((a) => {
              // whose number it happened on (Settings, People, Numbers) wins; then who logged it; then the lead owner
              const onNumber = userForNumber(crm.users, a.numberLabel);
              const by = onNumber?.name || crm.users.get(a.userId)?.name || ownerName;
              return <li key={a.id} className="wa-li"><ChatEntry e={fromActivity(a, { by, customer: raw.name, badge: onNumber?.badge || crm.users.get(a.senderId || a.userId || raw.owner)?.badge || "", at: when(a.occurredAt || a.createdAt), recordingId: recordings.get(a.id) || "", recordingPending: pendingRec.has(a.id), said })} /></li>;
            }); })()}
            {!entries.length && <li className="none">No activity yet.</li>}
          </ul>
        </>
      ) : (
        <div className="tasks">
          {tasks.map((t) => (
            <div key={t.id} className={`task ${t.status === "Done" ? "done" : ""}`}>
              <input type="checkbox" checked={t.status === "Done"} onChange={(e) => doneTask(t, e.target.checked)} aria-label="Done" />
              <div><b>{t.title}</b><span className="muted">{when(t.due)} · {crm.users.get(t.owner)?.name || ownerName}</span></div>
              <span className={`task-state ${t.status === "Done" ? "done" : "pending"}`}>{t.status === "Done" ? "Done" : Date.parse(t.due) < Date.now() ? "Late" : "Upcoming"}</span>
            </div>
          ))}
          {!tasks.length && <p className="none">No tasks. Use <b>CALL LATER</b> to schedule one.</p>}
        </div>
      )}
    </div>
  );
}

// The lead sliding in over a list, with Previous and Next like the original.
export default function LeadPanel({ id, ids = [], onOpen, onClose }) {
  const pos = ids.indexOf(id);
  useEffect(() => {
    const key = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="cwt-panel">
      <div className="lp-backdrop" onClick={onClose} />
      <button type="button" className="lp-close" onClick={onClose} aria-label="Close lead"><TIcon name="x" /></button>
      <aside className="lp-drawer" role="dialog" aria-modal="true" aria-label="Lead">
        {pos >= 0 && onOpen && (
          <div className="lp-pager">
            <button type="button" className="lp-nav" disabled={pos === 0} onClick={() => onOpen(ids[pos - 1])} aria-label="Previous lead"><TIcon name="chevronLeft" /></button>
            <span>{pos + 1} of {ids.length}</span>
            <button type="button" className="lp-next" disabled={pos >= ids.length - 1} onClick={() => onOpen(ids[pos + 1])}>Next <TIcon name="chevronRight" /></button>
          </div>
        )}
        <LeadDetail id={id} />
      </aside>
    </div>
  );
}
