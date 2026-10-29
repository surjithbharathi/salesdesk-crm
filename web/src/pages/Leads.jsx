import React, { useEffect, useMemo, useRef, useState } from "react";
import { crmSend } from "../api.js";
import { useCrm, userName, phoneLabel, telHref, waHref, STAGES, stageText } from "../crm.jsx";
import { hashFor, dueText, ago, initials, avatarClass, plural } from "../format.js";
import { useToast } from "../toast.jsx";
import Icon from "../icons.jsx";
import LeadPanel from "./LeadPanel.jsx";

const tagClass = (lead) => (lead.stage === "Closed" ? (lead.disposition === "Won" ? "tag-WON" : "tag-LOST") : lead.stage === "New" ? "tag-FRESH" : "tag-ACTIVE");

const QUEUES = [
  ["", "All active"],
  ["new", "New"],
  ["untouched", "Not called yet"],
  ["late", "Late follow-up"],
  ["unassigned", "No owner"],
  ["closed", "Closed"],
];
const PAGE = 100;

function typingInField(event) {
  const tag = event.target.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || event.target.isContentEditable;
}

function NewLead({ crm, onDone, onCancel }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sources = [...new Set(crm.leads.map((l) => l.source).filter(Boolean))].sort();
  async function submit(event) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const lead = await crmSend("POST", "leads", {
        name: f.get("name"), phone: f.get("phone"), source: f.get("source") || "Manual", company: f.get("company") || "", city: f.get("city") || "",
        stage: "New", owner: crm.me.lead ? f.get("owner") || "" : crm.me.id,
      });
      notify("Lead added");
      await crm.reload();
      onDone(lead.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="newlead" onSubmit={submit}>
      <label>Name<input className="field-input" name="name" required maxLength={200} autoFocus /></label>
      <label>Phone<input className="field-input" name="phone" type="tel" inputMode="tel" required placeholder="98400 11111" /></label>
      <label>Where did they come from
        <input className="field-input" name="source" list="lead-sources" placeholder="IndiaMART, Website, Referral" maxLength={200} />
        <datalist id="lead-sources">{sources.map((s) => <option key={s} value={s} />)}</datalist>
      </label>
      <label>Company<input className="field-input" name="company" maxLength={200} /></label>
      <label>City<input className="field-input" name="city" maxLength={200} /></label>
      {crm.me.lead && (
        <label>Owner
          <select className="field-input" name="owner" defaultValue="">
            <option value="">No owner yet</option>
            {crm.me.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <span className="newlead-actions">
        <button className="btn btn-primary" disabled={busy}>{busy ? "Adding…" : "Add lead"}</button>
        <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>
      </span>
    </form>
  );
}

export default function Leads({ params }) {
  const crm = useCrm();
  const { queue = "", stage = "", source = "", owner = "", q = "", lead: openId = "" } = params;
  const [text, setText] = useState(q);
  const [shown, setShown] = useState(PAGE);
  const [row, setRow] = useState(-1);
  const [adding, setAdding] = useState(false);
  const searchBox = useRef(null);
  const set = (change) => (location.hash = hashFor("/leads", { queue, stage, source, owner, q, lead: openId, ...change }));

  useEffect(() => {
    const timer = setTimeout(() => text !== q && set({ q: text }), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const items = useMemo(() => {
    if (!crm.state) return [];
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    return crm.leads
      .filter((l) => {
        if (queue === "closed" ? l.stage !== "Closed" : queue === "" ? !crm.isOpen(l) : !crm.isOpen(l)) return false;
        if (queue === "new" && l.stage !== "New") return false;
        if (queue === "untouched" && l.firstTouchAt) return false;
        if (queue === "unassigned" && l.owner) return false;
        if (queue === "late" && !(crm.nextDue.get(l.id) && Date.parse(crm.nextDue.get(l.id)) < todayMs)) return false;
        if (stage && l.stage !== stage) return false;
        if (source && l.source !== source) return false;
        if (owner && (owner === "none" ? l.owner : l.owner !== owner)) return false;
        if (needle && !`${l.name} ${l.company || ""} ${l.city || ""}`.toLowerCase().includes(needle) && !(digits.length > 2 && String(l.phone || "").replace(/\D/g, "").includes(digits))) return false;
        return true;
      })
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  }, [crm.state, crm.leads, queue, stage, source, owner, q]);
  useEffect(() => setShown(PAGE), [queue, stage, source, owner, q]);
  const visible = items.slice(0, shown);

  useEffect(() => {
    function onKey(event) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape" && openId) return set({ lead: "" });
      if (typingInField(event) || openId) return;
      if (event.key === "/") {
        event.preventDefault();
        searchBox.current?.focus();
      } else if (event.key === "j") setRow((r) => Math.min(visible.length - 1, r + 1));
      else if (event.key === "k") setRow((r) => Math.max(0, r - 1));
      else if (event.key === "Enter" && visible[row]) set({ lead: visible[row].id });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    if (row >= 0) document.querySelector(`[data-index="${row}"]`)?.scrollIntoView({ block: "nearest" });
  }, [row]);

  if (!crm.state) return <p className="muted">{crm.error || "Loading leads…"}</p>;
  const sources = [...new Set(crm.leads.map((l) => l.source).filter(Boolean))].sort();
  const filtered = Boolean(queue || stage || source || owner || q);
  return (
    <>
      <div className="work-head">
        <h1 className="work-title">Leads</h1>
        <span className="work-date num">{plural(items.length, "lead")}{filtered ? " match" : ""}</span>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>New lead</button>
      </div>
      {adding && <NewLead crm={crm} onCancel={() => setAdding(false)} onDone={(id) => { setAdding(false); set({ lead: id }); }} />}
      <div className="bar">
        <div className="pills" role="group" aria-label="Work queue">
          {QUEUES.filter(([key]) => crm.me.lead || key !== "unassigned").map(([key, label]) => (
            <button key={key || "all"} className="pill" aria-pressed={queue === key} onClick={() => set({ queue: key, lead: "" })}>{label}</button>
          ))}
        </div>
      </div>
      <div className="bar">
        <input ref={searchBox} className="field-input bar-search" type="search" placeholder="Search name, company, city or phone" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search leads" />
        <select className="field-input" value={stage} onChange={(e) => set({ stage: e.target.value, lead: "" })} aria-label="Stage">
          <option value="">Any stage</option>
          {STAGES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <select className="field-input" value={source} onChange={(e) => set({ source: e.target.value, lead: "" })} aria-label="Source">
          <option value="">Any source</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {crm.me.lead && (
          <select className="field-input" value={owner} onChange={(e) => set({ owner: e.target.value, lead: "" })} aria-label="Owner">
            <option value="">Any owner</option>
            <option value="none">No owner</option>
            {crm.me.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        {filtered && <button className="btn btn-quiet" onClick={() => { setText(""); location.hash = hashFor("/leads"); }}>Clear filters</button>}
      </div>
      <div className="table-frame">
        <table className="grid">
          <thead><tr><th>Lead</th><th>Stage</th>{crm.me.lead && <th>Owner</th>}<th>Calls</th><th>Next follow-up</th><th>Updated</th><th><span className="sr">Quick actions</span></th></tr></thead>
          <tbody>
            {visible.map((l, i) => {
              const due = crm.nextDue.get(l.id) ? dueText(crm.nextDue.get(l.id)) : null;
              return (
                <tr key={l.id} className="row" data-index={i} data-cursor={i === row} aria-selected={l.id === openId} onClick={() => set({ lead: l.id })}>
                  <td>
                    <div className="who-cell">
                      <span className={`avatar ${avatarClass(l.name)}`}>{initials(l.name)}</span>
                      <span>
                        <b><a href={hashFor("/leads", { queue, stage, source, owner, q, lead: l.id })} onClick={(e) => e.stopPropagation()}>{l.name}</a></b>
                        <small>{[l.company, l.city, phoneLabel(l)].filter(Boolean).join(", ")}</small>
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className={`tag ${tagClass(l)}`}>{stageText(l)}</span>
                    {l.repeat ? <span className="note note-good lead-note">Came back</span> : null}
                  </td>
                  {crm.me.lead && <td>{userName(crm, l.owner)}</td>}
                  <td className="num">{l.firstTouchAt ? <>{l.callCount || 0} <small className="muted">({l.connectedCalls || 0} answered)</small></> : <span className="untouched">Not called yet</span>}</td>
                  <td>{due ? <span className={due.tone}>{due.text}</span> : <span className="muted">None set</span>}</td>
                  <td className="muted">{ago(l.updatedAt || l.createdAt)}</td>
                  <td>
                    {l.phone && (
                      <span className="quick">
                        <a className="icon-btn" href={telHref(l)} onClick={(e) => e.stopPropagation()} aria-label={`Call ${l.name}`}><Icon name="phone" /></a>
                        <a className="icon-btn" href={waHref(l)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} aria-label={`WhatsApp ${l.name}`}><Icon name="chat" /></a>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!items.length && <div className="empty"><b>No leads match</b>Try another queue, or clear the filters to see every active lead.</div>}
      </div>
      {items.length > shown && <p className="keys"><button className="btn" onClick={() => setShown((n) => n + PAGE)}>Show more leads ({items.length - shown} left)</button></p>}
      <p className="keys"><kbd>J</kbd> and <kbd>K</kbd> move down and up, <kbd>Enter</kbd> opens a lead, <kbd>/</kbd> searches, <kbd>Esc</kbd> closes.</p>
      {openId && <LeadPanel id={openId} onClose={() => set({ lead: "" })} />}
    </>
  );
}
