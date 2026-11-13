import React, { useEffect, useMemo, useRef, useState } from "react";
import { crmSend } from "../api.js";
import { useCrm, useLeadHistory, telHref, waHref } from "../crm.jsx";
import { useToast } from "../toast.jsx";
import { initials, avClass, dayLabel } from "../format.js";
import { PIPELINE, pipelineStep } from "../pipeline.js";
import { TIcon } from "./icons.jsx";
import GatewayChat, { useGatewayOn } from "../GatewayChat.jsx";
import ChatEntry, { fromActivity, userForNumber, saidInChat } from "../ChatEntry.jsx";
import { STATES, LANGUAGES } from "../regions.js";
import { SourceTag, quickTimes, localInput } from "./LeadBits.jsx";
import DateTimePicker from "../DateTimePicker.jsx";
import ErpPanel from "./ErpPanel.jsx";

// One lead: a header (who, status, owner, call and WhatsApp), the stage bar, the conversation with a composer under it,
// and on the right the next follow-up, the lead's fields and the enquiry it came with. Styles: cwt/r-leads.css (ld-*).

const STATUSES = ["New", ...PIPELINE.map((d) => d.name)];
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-");
const OUTCOMES = ["Interested", "Callback", "No answer", "Not interested", "Connected"];
const FIELDS = [
  ["primary", "email", "Email"], ["primary", "phone", "Phone"], ["primary", "company", "Business"], ["primary", "city", "City"],
  ["primary", "state", "State"], ["primary", "language", "Language"],
  ["basic", "name", "Name"], ["basic", "source", "Source"],
  ["others", "value", "Deal Value"], ["others", "id", "Lead ID"],
];
// The stage bar: the main steps of the pipeline. Steps in between light up the step they belong to.
const STAGE_BAR = [["New", "New"], ["Discussion", "Requirement Discussion"], ["Interested", "Interested Customer"], ["Quotation", "Quotation Shared"], ["Advance", "Advance Received"], ["Won", "Won"]];
const STEP_AT = { New: 0, "Requirement Discussion": 1, "Later Purchase": 1, "Interested Customer": 2, "Quotation Shared": 3, "Loan Document Collected": 3, "Loan in Process": 3, "Advance Received": 4, "Machine Dispatched": 4, "Machine Delivered - Need to Start": 4, Won: 5 };
const COMPOSE = [["note", "Note"], ["wa", "WhatsApp"], ["later", "Call later"], ["fu", "Follow-up"]];
const FU_TYPES = ["Call", "WhatsApp", "Visit"];
const when = (iso) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const clock = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const stampOf = (a) => a.occurredAt || a.createdAt;

// Quick time chips with a "Pick date" choice; `value` is a chip label or "pick".
function TimeChips({ value, onChange, pick, onPick }) {
  return (
    <div className="ld-chips">
      {quickTimes().map(([label]) => <button key={label} type="button" className={`ld-chip ${value === label ? "on" : ""}`} aria-pressed={value === label} onClick={() => onChange(label)}>{label}</button>)}
      <button type="button" className={`ld-chip ${value === "pick" ? "on" : ""}`} aria-pressed={value === "pick"} onClick={() => onChange("pick")}><TIcon name="calendar" />Pick date</button>
      {value === "pick" && <DateTimePicker className="ld-pick" value={pick} onChange={onPick} ariaLabel="Date and time" required />}
    </div>
  );
}
const chosenTime = (value, pick) => (value === "pick" ? (pick ? new Date(pick) : null) : quickTimes().find(([l]) => l === value)?.[1] || null);

export function LeadDetail({ id, nav = null, compose: startWith = "" }) {
  const crm = useCrm();
  const notify = useToast();
  const gatewayOn = useGatewayOn();
  const [fieldTab, setFieldTab] = useState("primary");
  const [showEmpty, setShowEmpty] = useState(true);
  const [tab, setTab] = useState("history");
  const [filter, setFilter] = useState("all");
  const [menu, setMenu] = useState("");
  const [compose, setCompose] = useState(startWith || "note");
  const [draft, setDraft] = useState("");
  const [waText, setWaText] = useState("");
  const [waFull, setWaFull] = useState(false);
  const [later, setLater] = useState("Tomorrow 10 AM");
  const [laterPick, setLaterPick] = useState(() => localInput(new Date(Date.now() + 86400000)));
  const [fuWhat, setFuWhat] = useState("");
  const [fuWhen, setFuWhen] = useState("Tomorrow 10 AM");
  const [fuPick, setFuPick] = useState(() => localInput(new Date(Date.now() + 86400000)));
  const [fuType, setFuType] = useState("Call");
  const [fuOwner, setFuOwner] = useState("");
  const [closeLate, setCloseLate] = useState(true);
  const [outcome, setOutcome] = useState("Connected");
  const [mins, setMins] = useState("");
  const [moving, setMoving] = useState(false);
  const [moveWhen, setMoveWhen] = useState("Tomorrow 10 AM");
  const [movePick, setMovePick] = useState(() => localInput(new Date(Date.now() + 86400000)));
  const [busy, setBusy] = useState(false);
  const scroller = useRef(null);
  const waInput = useRef(null);
  const raw = crm.leadById?.get(id);
  useEffect(() => { setMenu(""); setCompose(startWith || "note"); setDraft(""); setWaText(""); setWaFull(false); setFuWhat(""); setFuOwner(""); setMoving(false); setTab("history"); }, [id]);
  useEffect(() => { if (startWith) setCompose(startWith); }, [startWith]);
  const history = useLeadHistory(id);
  const acts = useMemo(() => [...(crm.activities || []).filter((a) => a.leadId === id), ...history].sort((a, b) => String(stampOf(b)).localeCompare(String(stampOf(a)))), [crm.activities, id, history]);
  // the enquiry the lead came with (IndiaMART buy lead, a TeleCRM "lead arrived" line): the latest one
  // every enquiry, newest first: how the buyer came (buy lead, call, direct...) and how often
  const enquiries = useMemo(() => acts.map((a) => [a, fromActivity(a)]).filter(([, e]) => e.kind === "buylead").map(([a, e]) => ({ ...e.lead, at: e.lead.when || stampOf(a) })), [acts]);
  const enquiry = enquiries[0] || null;
  const shown = useMemo(() => acts.filter((a) => (tab === "calls" ? a.type === "Call" : tab === "wa" ? a.type === "Message"
    : filter === "all" || (filter === "call" && a.type === "Call") || (filter === "note" && (a.type === "Note" || a.type === "Visit")) || (filter === "message" && a.type === "Message") || (filter === "status" && a.type === "System"))).reverse(), [acts, tab, filter]);
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [id, tab, filter, shown.length]);
  if (!crm.state || !raw) return <p className="muted">{crm.error || "Loading the lead…"}</p>;

  // A TeleCRM recording not here yet is either still being copied or gave up after 4 tries (or is too large).
  const pendingRec = new Map((crm.calls || []).filter((c) => !c.recordingId && c.recordingPath).map((c) => [c.activityId, (c.recordingTries || 0) >= 4 ? "failed" : "copying"]));
  const recordings = new Map((crm.calls || []).filter((c) => c.recordingId).map((c) => [c.activityId, c.recordingId]));
  const tasks = crm.tasks.filter((t) => t.leadId === id).sort((a, b) => String(a.due).localeCompare(String(b.due)));
  const openTasks = tasks.filter((t) => t.status !== "Done");
  const now = Date.now();
  const lateTasks = openTasks.filter((t) => Date.parse(t.due) < now);
  const nextTask = openTasks[0];
  const status = raw.stage === "New" ? "New" : pipelineStep(raw) || "New";
  const ownerName = crm.users.get(raw.owner)?.name || "Unassigned";
  const canEdit = crm.me?.lead;
  const isAdmin = ["owner", "admin"].includes(crm.me?.role);
  const team = (crm.me?.users || []).filter((u) => u.active !== false);
  const rating = Math.max(0, Math.min(5, Math.round(Number(raw.telecrm?.rating) || 0)));
  const stepAt = STEP_AT[status] ?? -1;
  const calls = acts.filter((a) => a.type === "Call");
  const messages = acts.filter((a) => a.type === "Message");
  const place = [raw.company, raw.city].map((s) => String(s || "").trim()).filter(Boolean).join(", ");

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
  const value = (key) => (key === "id" ? raw.id : raw[key] == null ? "" : String(raw[key]));
  const fields = FIELDS.filter(([t, key]) => t === fieldTab && (showEmpty || value(key).trim() !== ""));
  const counts = { primary: FIELDS.filter((f) => f[0] === "primary").length, basic: FIELDS.filter((f) => f[0] === "basic").length, others: FIELDS.filter((f) => f[0] === "others").length };

  async function run(done, fn) {
    setBusy(true);
    try { await fn(); await crm.reload(); if (done) notify(done); } catch (e) { notify(e.message); } finally { setBusy(false); }
  }
  const patch = (done, body) => run(done, () => crmSend("PATCH", `leads/${id}`, body));
  const setField = (key, val) => { if (value(key) === val) return; patch("Saved", { [key]: key === "value" ? Math.max(0, Number(val) || 0) : val.trim() }); };
  const setStatus = (s) => { setMenu(""); if (s === status) return; patch(`Status updated to ${s}`, s === "New" ? { stage: "New", disposition: "", deal: "" } : { deal: s }); };
  const doneTask = (t, done) => run(done ? "Follow-up done" : "", () => crmSend("PATCH", `tasks/${t.id}`, { status: done ? "Done" : "Open" }));
  const addTask = (title, due, owner) => crmSend("POST", "tasks", { leadId: id, title, due: due.toISOString(), status: "Open", owner: owner || raw.owner || crm.me.id || "" });
  const openWa = () => { setCompose("wa"); setTimeout(() => waInput.current?.focus(), 0); };

  const saveNote = (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    run("Note added", async () => { await crmSend("POST", "activities", { leadId: id, type: "Note", text: draft.trim() }); setDraft(""); });
  };
  const sendWa = (e) => {
    e.preventDefault();
    const text = waText.trim();
    if (!text) return;
    if (!gatewayOn) { window.open(`${waHref(raw)}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer"); setWaText(""); return; }
    run("Sent on WhatsApp", async () => { await crmSend("POST", `wa-gateway/leads/${id}/send`, { text }); setWaText(""); });
  };
  const saveLater = (e) => {
    e.preventDefault();
    const due = chosenTime(later, laterPick);
    if (!due) return notify("Pick a time for the call");
    run("Follow up scheduled", () => addTask(`Call ${raw.name}`, due));
  };
  const saveFollowUp = (e) => {
    e.preventDefault();
    const due = chosenTime(fuWhen, fuPick);
    if (!due) return notify("Pick a time for the follow-up");
    run("Follow-up saved", async () => {
      await addTask(fuWhat.trim() || `${fuType} ${raw.name}`, due, fuOwner);
      if (closeLate) for (const t of lateTasks) await crmSend("PATCH", `tasks/${t.id}`, { status: "Done" });
      setFuWhat("");
    });
  };
  const saveCall = (e) => {
    e.preventDefault();
    run("Call logged", async () => { await crmSend("POST", "activities", { leadId: id, type: "Call", text: "Call logged", direction: "Outgoing", duration: Math.max(0, Number(mins || 0)) * 60, outcome }); setMins(""); setCompose("note"); });
  };
  const moveTask = (label) => {
    const due = chosenTime(label, movePick);
    if (!due || !nextTask) return;
    run("Follow-up moved", async () => { await crmSend("PATCH", `tasks/${nextTask.id}`, { due: due.toISOString() }); setMoving(false); });
  };

  // the conversation, oldest at the top, with a label for each day
  const said = tab === "history" && filter === "all" ? saidInChat(acts) : null;
  const chat = [];
  let lastDay = "";
  for (const a of shown) {
    const iso = stampOf(a);
    const dayKey = new Date(iso).toDateString();
    if (dayKey !== lastDay) { chat.push(<span key={`d-${dayKey}`} className="ld-day">{dayLabel(iso)}</span>); lastDay = dayKey; }
    // whose number it happened on (Settings, People, Numbers) wins; then who logged it; then the lead owner
    const onNumber = userForNumber(crm.users, a.numberLabel);
    const by = onNumber?.name || crm.users.get(a.userId)?.name || ownerName;
    chat.push(<div key={a.id} className="ld-entry"><ChatEntry e={fromActivity(a, { by, customer: raw.name, badge: onNumber?.badge || crm.users.get(a.senderId || a.userId || raw.owner)?.badge || "", at: clock(iso), recordingId: recordings.get(a.id) || "", recordingPending: pendingRec.get(a.id) || false, said })} /></div>);
  }
  const lateNote = tab === "history" && filter === "all" && lateTasks[0];

  return (
    <div className={`cwt-detail ld ${nav ? "ld-fill" : ""}`}>
      <header className="ld-head">
        {nav && (
          <div className="ld-top">
            <button type="button" className="ld-close" onClick={nav.onClose} aria-label="Close lead"><TIcon name="x" /></button>
            <span>{nav.crumb || "Leads"}</span>
            <span className="grow" />
            {nav.total > 0 && (
              <>
                <button type="button" className="ld-step" disabled={!nav.onPrev} onClick={nav.onPrev} aria-label="Previous lead"><TIcon name="chevronLeft" /></button>
                <span>{nav.pos + 1} of {nav.total.toLocaleString("en-IN")}</span>
                <button type="button" className="ld-step" disabled={!nav.onNext} onClick={nav.onNext} aria-label="Next lead"><TIcon name="chevronRight" /></button>
              </>
            )}
          </div>
        )}

        <div className="ld-id">
          <span className={`av ld-av ${avClass(raw.name)}`} aria-hidden="true">{initials(raw.name)}</span>
          <div className="ld-who">
            <div className="ld-title">
              <h1><input className="ld-name" defaultValue={raw.name} key={`${id}-${raw.name}`} aria-label="Lead name" onBlur={(e) => e.target.value.trim() && setField("name", e.target.value)} /></h1>
              <SourceTag source={raw.source} />
              {rating > 0 && <span className="ld-stars" role="img" aria-label={`Rating ${rating} of 5`}>{[1, 2, 3, 4, 5].map((n) => <TIcon key={n} name="star" className={n <= rating ? "on" : ""} />)}</span>}
            </div>
            <div className="ld-meta">
              <span>{raw.phone || "No phone"}</span>
              {place && <><span aria-hidden="true">·</span><span>{place}</span></>}
              <span aria-hidden="true">·</span>
              <div className="drop">
                <button type="button" className={`ld-status st-${slug(status)}`} aria-haspopup="listbox" aria-expanded={menu === "status"} onClick={() => setMenu(menu === "status" ? "" : "status")}><i />{status}<TIcon name="chevronDown" /></button>
                {menu === "status" && <div className="menu" onMouseLeave={() => setMenu("")}>{STATUSES.map((s) => <button key={s} type="button" className={s === status ? "on" : ""} onClick={() => setStatus(s)}><i className={`ld-dot st-${slug(s)}`} />{s}</button>)}</div>}
              </div>
              <div className="drop">
                <button type="button" className="ld-owner" disabled={!canEdit} aria-label={`Assignee ${ownerName}`} onClick={() => canEdit && setMenu(menu === "assign" ? "" : "assign")}>{ownerName}<span className={`av ${avClass(ownerName)}`} aria-hidden="true">{initials(ownerName)}</span></button>
                {menu === "assign" && <div className="menu" onMouseLeave={() => setMenu("")}>{team.map((u) => <button key={u.id} type="button" className={u.id === raw.owner ? "on" : ""} onClick={() => { setMenu(""); patch("Owner changed", { owner: u.id }); }}>{u.name}</button>)}</div>}
              </div>
            </div>
          </div>
          <div className="ld-acts">
            <a className="ld-call" href={telHref(raw)}><TIcon name="phone" />Call</a>
            {gatewayOn ? <button type="button" className="ld-wa" onClick={openWa}><TIcon name="whatsapp" />WhatsApp</button> : <a className="ld-wa" href={waHref(raw)} target="_blank" rel="noopener noreferrer"><TIcon name="whatsapp" />WhatsApp</a>}
            <div className="drop">
              <button type="button" className="ld-more" aria-label="More: email, log a call, archive, delete, block number" aria-expanded={menu === "more"} onClick={() => setMenu(menu === "more" ? "" : "more")}><TIcon name="kebab" /></button>
              {menu === "more" && (
                <div className="menu right" onMouseLeave={() => setMenu("")}>
                  {raw.email && <a className="menu-link" href={`mailto:${raw.email}`}>Email {raw.email}</a>}
                  <a className="menu-link" href={telHref(raw)}>Call now</a>
                  <button type="button" onClick={() => { setMenu(""); setCompose("call"); }}>Log a call</button>
                  {canEdit && <button type="button" className="danger" onClick={() => { setMenu(""); confirm(`Archive ${raw.name}? The lead leaves the lists but is kept.`) && patch("Lead archived", { archived: true }); }}>Archive lead</button>}
                  <label className="menu-check"><input type="checkbox" checked={Boolean(raw.noCallSync)} disabled={busy} onChange={(e) => patch(e.target.checked ? "Calls with this lead are no longer synced" : "Calls with this lead are synced again", { noCallSync: e.target.checked })} /> Do not sync calls</label>
                  {isAdmin && <button type="button" className="danger" disabled={busy} onClick={() => remove(false)}>Delete lead</button>}
                  {isAdmin && raw.phoneKey && <button type="button" className="danger" disabled={busy} onClick={() => remove(true)}>Delete and block number</button>}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="ld-stages" role="group" aria-label="Stage">
          {STAGE_BAR.map(([label, full], i) => <button key={full} type="button" title={full} disabled={busy} aria-pressed={i === stepAt} className={`ld-chev ${i < stepAt ? "done" : i === stepAt ? "now" : ""} ${status === "Lost" ? "lost" : ""}`} onClick={() => setStatus(full)}>{label}</button>)}
        </div>
      </header>

      <div className="ld-body">
        <section className="r-card ld-main" aria-label="Activity">
          <div className="ld-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "history"} className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>Activity History <em>{acts.length}</em></button>
            <button type="button" role="tab" aria-selected={tab === "task"} className={tab === "task" ? "on" : ""} onClick={() => setTab("task")}>Task {lateTasks.length ? <em className="late">{lateTasks.length} late</em> : openTasks.length ? <em>{openTasks.length}</em> : null}</button>
            <button type="button" role="tab" aria-selected={tab === "calls"} className={tab === "calls" ? "on" : ""} onClick={() => setTab("calls")}>Calls <em>{calls.length}</em></button>
            <button type="button" role="tab" aria-selected={tab === "wa"} className={tab === "wa" ? "on" : ""} onClick={() => setTab("wa")}>WhatsApp <em>{messages.length}</em></button>
            <span className="grow" />
            {tab === "history" && (
              <label className="ld-filter">
                <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Activity type"><option value="all">All Actions</option><option value="call">Calls</option><option value="note">Notes and visits</option><option value="message">Messages</option><option value="status">Updates</option></select>
                <TIcon name="chevronDown" />
              </label>
            )}
          </div>

          {tab === "task" ? (
            <div className="ld-scroll ld-tasks">
              {tasks.map((t) => {
                const late = t.status !== "Done" && Date.parse(t.due) < now;
                return (
                  <label key={t.id} className={`ld-task ${t.status === "Done" ? "done" : ""}`}>
                    <input type="checkbox" checked={t.status === "Done"} disabled={busy} onChange={(e) => doneTask(t, e.target.checked)} aria-label={`Done: ${t.title}`} />
                    <span className="ld-task-text"><b>{t.title}</b><small>{when(t.due)} · {crm.users.get(t.owner)?.name || ownerName}</small></span>
                    <span className={`ld-task-state ${t.status === "Done" ? "done" : late ? "late" : ""}`}>{t.status === "Done" ? "Done" : late ? "Late" : "Upcoming"}</span>
                  </label>
                );
              })}
              {!tasks.length && <p className="ld-empty">No follow-ups yet. Use <b>Call later</b> or <b>Follow-up</b> below to plan one.</p>}
            </div>
          ) : (
            <div className="ld-scroll ld-chat" ref={scroller} role="log" aria-label="Activity history">
              {chat}
              {lateNote && <div className="ld-sys late"><TIcon name="alarm" />Follow-up "{lateNote.title}" is late since {Date.parse(lateNote.due) >= new Date().setHours(0, 0, 0, 0) ? clock(lateNote.due) : when(lateNote.due)}</div>}
              {!shown.length && <p className="ld-empty">{tab === "calls" ? "No calls yet." : tab === "wa" ? "No WhatsApp messages yet." : "No activity yet."}</p>}
            </div>
          )}

          <div className="ld-composer">
            <div className="ld-ctabs" role="tablist" aria-label="Add to this lead">
              {COMPOSE.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={compose === k} className={compose === k ? "on" : ""} onClick={() => (k === "wa" ? openWa() : setCompose(k))}>{label}</button>)}
              {compose === "call" && <button type="button" role="tab" aria-selected="true" className="on">Log call</button>}
            </div>

            {compose === "note" && (
              <form className="ld-cline" onSubmit={saveNote}>
                <textarea className="ld-input" rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) saveNote(e); }} placeholder="Write what the customer said…" aria-label="Write a note" maxLength={4000} />
                <button type="submit" className="ld-save" disabled={busy || !draft.trim()}>Save note</button>
              </form>
            )}

            {compose === "wa" && (
              <>
                <form className="ld-cline" onSubmit={sendWa}>
                  <textarea ref={waInput} className="ld-input" rows={1} value={waText} onChange={(e) => setWaText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) sendWa(e); }} placeholder="Write a WhatsApp message…" aria-label="WhatsApp message" maxLength={4000} />
                  <button type="submit" className="ld-save wa" disabled={busy || !waText.trim()}>{gatewayOn ? "Send" : "Open WhatsApp"}</button>
                </form>
                {gatewayOn ? (
                  <p className="ld-hint">Free text works within 24 hours of the customer's last message. <button type="button" className="ld-link" onClick={() => setWaFull(!waFull)}>{waFull ? "Hide the full chat" : "Send a template or load earlier messages"}</button></p>
                ) : gatewayOn === false ? <p className="ld-hint">Opens WhatsApp with the message. Replying from the CRM is off; an administrator can turn it on in Settings, WhatsApp gateway.</p> : null}
                {gatewayOn && waFull && <GatewayChat leadId={id} className="ld-gw" />}
              </>
            )}

            {compose === "later" && (
              <form className="ld-cform" onSubmit={saveLater}>
                <TimeChips value={later} onChange={setLater} pick={laterPick} onPick={setLaterPick} />
                <div className="ld-crow"><span className="ld-hint">Adds a follow-up "Call {raw.name}" for {ownerName === "Unassigned" ? "you" : ownerName}.</span><span className="grow" /><button type="submit" className="ld-save" disabled={busy}>Schedule call</button></div>
              </form>
            )}

            {compose === "fu" && (
              <form className="ld-cform" onSubmit={saveFollowUp}>
                <input className="ld-input one" value={fuWhat} onChange={(e) => setFuWhat(e.target.value)} placeholder={`What to do, for example "Send quotation and call back"`} aria-label="What to do" maxLength={300} />
                <TimeChips value={fuWhen} onChange={setFuWhen} pick={fuPick} onPick={setFuPick} />
                <div className="ld-crow">
                  <div className="ld-seg" role="group" aria-label="Type">{FU_TYPES.map((t) => <button key={t} type="button" aria-pressed={fuType === t} className={fuType === t ? "on" : ""} onClick={() => setFuType(t)}>{t}</button>)}</div>
                  <label className="ld-pill">
                    <span className={`av ${avClass(crm.users.get(fuOwner || raw.owner || crm.me.id)?.name || "")}`} aria-hidden="true">{initials(crm.users.get(fuOwner || raw.owner || crm.me.id)?.name || "?")}</span>
                    <select value={fuOwner || raw.owner || crm.me.id || ""} onChange={(e) => setFuOwner(e.target.value)} aria-label="Assignee">{team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                    <TIcon name="chevronDown" />
                  </label>
                </div>
                <div className="ld-crow">
                  {lateTasks.length > 0 ? <label className="ld-check"><input type="checkbox" checked={closeLate} onChange={(e) => setCloseLate(e.target.checked)} />Mark the late follow-up "{lateTasks[0].title}"{lateTasks.length > 1 ? ` and ${lateTasks.length - 1} more` : ""} as done</label> : <span className="grow" />}
                  <button type="submit" className="ld-save" disabled={busy}>Save follow-up</button>
                </div>
              </form>
            )}

            {compose === "call" && (
              <form className="ld-cform" onSubmit={saveCall}>
                <div className="ld-crow">
                  <label className="ld-pill"><span className="ld-pill-k">Outcome</span><select value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome">{OUTCOMES.map((o) => <option key={o}>{o}</option>)}</select><TIcon name="chevronDown" /></label>
                  <label className="ld-pill"><span className="ld-pill-k">Minutes talked</span><input type="number" min="0" max="1440" value={mins} onChange={(e) => setMins(e.target.value)} aria-label="Minutes talked" /></label>
                  <span className="grow" />
                  <button type="button" className="ld-ghost" onClick={() => setCompose("note")}>Cancel</button>
                  <button type="submit" className="ld-save" disabled={busy}>Save call</button>
                </div>
              </form>
            )}
          </div>
        </section>

        <aside className="ld-side">
          <section className={`r-card ld-next ${nextTask ? (Date.parse(nextTask.due) < now ? "late" : "") : "none"}`} aria-label="Next follow-up">
            {nextTask ? (
              <>
                <p className="ld-kicker">Next follow-up{Date.parse(nextTask.due) < now ? " · Late" : new Date(nextTask.due).toDateString() === new Date().toDateString() ? " · Today" : ""}</p>
                <p className="ld-next-title">{nextTask.title}</p>
                <p className="ld-next-meta">Due {when(nextTask.due)} · {crm.users.get(nextTask.owner)?.name || ownerName}</p>
                {moving ? (
                  <div className="ld-move">
                    <TimeChips value={moveWhen} onChange={(l) => { setMoveWhen(l); if (l !== "pick") moveTask(l); }} pick={movePick} onPick={setMovePick} />
                    <div className="ld-two">{moveWhen === "pick" && <button type="button" className="ld-primary" disabled={busy || !movePick} onClick={() => moveTask("pick")}>Save</button>}<button type="button" className="ld-secondary" onClick={() => setMoving(false)}>Cancel</button></div>
                  </div>
                ) : (
                  <div className="ld-two"><button type="button" className="ld-primary" disabled={busy} onClick={() => doneTask(nextTask, true)}>Mark done</button><button type="button" className="ld-secondary" onClick={() => { setMoveWhen(""); setMoving(true); }}>Move</button></div>
                )}
              </>
            ) : (
              <>
                <p className="ld-kicker">Next follow-up</p>
                <p className="ld-next-title">Nothing planned</p>
                <div className="ld-two"><button type="button" className="ld-secondary" onClick={() => setCompose("fu")}>Plan a follow-up</button></div>
              </>
            )}
          </section>

          <section className="r-card ld-fields" aria-label="Lead details">
            <div className="ld-ftabs">
              {[["primary", "Primary"], ["basic", "Basic Info"], ["others", "Others"]].map(([k, label]) => <button key={k} type="button" aria-pressed={fieldTab === k} className={fieldTab === k ? "on" : ""} onClick={() => setFieldTab(k)}>{label} <em>{counts[k]}</em></button>)}
              <span className="grow" />
              <button type="button" className={`ld-empty-toggle ${showEmpty ? "" : "off"}`} aria-pressed={!showEmpty} title={showEmpty ? "Hide empty fields" : "Show empty fields"} onClick={() => setShowEmpty(!showEmpty)}>Empty fields</button>
            </div>
            {fields.map(([, key, label]) => {
              const probable = key === "state" && !raw.state && raw.probableState;
              return (
                <div key={key} className="ld-row">
                  <label htmlFor={`ld-f-${id}-${key}`}>{label}</label>
                  <div className="ld-val">
                    <input id={`ld-f-${id}-${key}`} defaultValue={value(key)} key={`${id}-${key}-${value(key)}`} readOnly={key === "id"}
                      placeholder={probable ? `${raw.probableState}?` : key === "state" ? "Choose or type a state" : key === "language" ? "Not set" : key === "phone" ? "Enter phone number" : "Empty"}
                      list={key === "state" ? "sd-states" : key === "language" ? "sd-languages" : undefined}
                      onBlur={(e) => key !== "id" && (key !== "phone" || e.target.value.trim()) && e.target.value !== value(key) && setField(key, e.target.value)} />
                    {key === "phone" && raw.phone && <small className="ld-wa-tag" title="On WhatsApp">WA</small>}
                    {probable && raw.probableState.split(" / ").filter((s) => !/north east/i.test(s)).map((s, i, all) => <button key={s} type="button" className="ld-use" disabled={busy} title={`Guessed from ${raw.probableStateFrom === "your leads" ? "other leads with this number series" : "the mobile number series"}`} onClick={() => setField("state", s)}>{all.length > 1 ? `Use ${s}` : "Use"}</button>)}
                    {key !== "id" && !probable && <TIcon name="pencil" className="ld-pen" />}
                    {key === "language" && raw.languageGuess && <small className="ld-note warn">Guessed from the state. Change it if the customer speaks another language.</small>}
                    {key === "language" && raw.languageFrom === "call" && <small className="ld-note ok">Heard in a call recording (Call AI).</small>}
                  </div>
                </div>
              );
            })}
            {!fields.length && <p className="ld-empty">No filled fields here.</p>}
            <datalist id="sd-states">{STATES.map((s) => <option key={s} value={s} />)}</datalist>
            <datalist id="sd-languages">{LANGUAGES.map((l) => <option key={l} value={l} />)}</datalist>
          </section>

          {enquiry && (
            <section className="r-card ld-enq" aria-label="Enquiry">
              <p className="ld-kicker">{enquiry.tag} details</p>
              {(enquiry.product || enquiry.intro) && <p className="ld-next-title">{enquiry.product || enquiry.intro}</p>}
              {enquiry.product && enquiry.intro && <p className="ld-enq-intro">{enquiry.intro}</p>}
              <dl className="ld-enq-rows">
                <div><dt>Source</dt><dd>{enquiry.tag}</dd></div>
                <div><dt>How it came</dt><dd>{(() => {
                  const kinds = new Map();
                  for (const q of enquiries) { const k = String(q.kind || "Enquiry").replace(/ ·.*$/, ""); kinds.set(k, (kinds.get(k) || 0) + 1); }
                  const parts = [...kinds].map(([k, n]) => `${n} ${k.toLowerCase()}`);
                  return enquiries.length > 1 ? `${enquiries.length} enquiries: ${parts.join(", ")}` : enquiry.kind || "Enquiry";
                })()}</dd></div>
                {enquiry.requirement && <div><dt>Requirement</dt><dd>{enquiry.requirement}</dd></div>}
                {enquiry.category && <div><dt>Category</dt><dd>{enquiry.category}</dd></div>}
                {enquiry.searched && <div><dt>Searched</dt><dd>{enquiry.searched}</dd></div>}
                {enquiries.length > 1 && <div><dt>First / last</dt><dd>{dayLabel(enquiries[enquiries.length - 1].at)} · {dayLabel(enquiry.at)}</dd></div>}
              </dl>
              {(enquiries.some((q) => q.specs.length > 0) || enquiry.pin || enquiry.place) && (
                <div className="ld-specs">
                  {(() => { const seen = new Set(); return enquiries.flatMap((q) => q.specs).filter(([k]) => !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase())); })().slice(0, 8).map(([k, v], i) => <span key={i} title={k}>{k.length <= 28 ? `${k}: ${v}` : v}</span>)}
                  {enquiry.place && <span title="Place">{enquiry.place}</span>}
                  {enquiry.pin && <span title="PIN code">{enquiry.pin}</span>}
                </div>
              )}
              {enquiry.note && <p className="ld-enq-intro">"{enquiry.note}"</p>}
            </section>
          )}
          <ErpPanel leadId={raw.id} canEdit /* everyone who may open this lead; the server checks leads.write */ />
        </aside>
      </div>
    </div>
  );
}

// The lead sliding in over a list, with Previous and Next.
export default function LeadPanel({ id, ids = [], onOpen, onClose, crumb = "", compose = "" }) {
  const pos = ids.indexOf(id);
  useEffect(() => {
    const key = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  const nav = {
    onClose, crumb, pos, total: pos >= 0 && onOpen ? ids.length : 0,
    onPrev: pos > 0 && onOpen ? () => onOpen(ids[pos - 1]) : null,
    onNext: pos >= 0 && pos < ids.length - 1 && onOpen ? () => onOpen(ids[pos + 1]) : null,
  };
  return (
    <div className="cwt-panel ld-panel">
      <div className="lp-backdrop" onClick={onClose} />
      <aside className="lp-drawer ld-drawer" role="dialog" aria-modal="true" aria-label="Lead">
        <LeadDetail id={id} nav={nav} compose={compose} />
      </aside>
    </div>
  );
}
