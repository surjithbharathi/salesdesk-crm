import React, { useCallback, useEffect, useRef, useState } from "react";
import { v2, localDay } from "../api.js";
import { hashFor, phoneText, dueText, ago, initials, avatarClass, plural } from "../format.js";
import Icon from "../icons.jsx";
import LeadPanel from "./LeadPanel.jsx";

const QUEUES = [
  ["", "All leads"],
  ["untouched", "Not called yet"],
  ["overdue", "Late"],
  ["today", "Due today"],
  ["new", "New"],
  ["repeat", "Came back"],
];

function typingInField(event) {
  const tag = event.target.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || event.target.isContentEditable;
}

export default function Leads({ meta, params }) {
  const { queue = "", status = "", source = "", q = "", owner = "", lead: openId = "" } = params;
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [text, setText] = useState(q);
  const [row, setRow] = useState(-1);
  const generation = useRef(0);
  const searchBox = useRef(null);
  const userName = (id) => meta.users.find((u) => u.id === id)?.name || "No owner";

  const set = useCallback(
    (change) => {
      location.hash = hashFor("/leads", { queue, status, source, q, owner, lead: openId, ...change });
    },
    [queue, status, source, q, owner, openId],
  );

  async function load(next) {
    const mine = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const page = await v2("/leads", { queue, status, source, q, owner, cursor: next, limit: 50, ...localDay() });
      if (mine !== generation.current) return;
      setItems((old) => (next ? [...old, ...page.items] : page.items));
      setTotal(page.total);
      setCursor(page.nextCursor);
      if (!next) setRow(-1);
    } catch (e) {
      if (mine === generation.current) setError(e.message);
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    load(null);
  }, [queue, status, source, q, owner]);
  useEffect(() => {
    const timer = setTimeout(() => text !== q && set({ q: text }), 300);
    return () => clearTimeout(timer);
  }, [text]);

  // Keyboard: j/k move, Enter opens, / searches, Escape closes the panel.
  useEffect(() => {
    function onKey(event) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape" && openId) return set({ lead: "" });
      if (typingInField(event) || openId) return;
      if (event.key === "/") {
        event.preventDefault();
        searchBox.current?.focus();
      } else if (event.key === "j") setRow((r) => Math.min(items.length - 1, r + 1));
      else if (event.key === "k") setRow((r) => Math.max(0, r - 1));
      else if (event.key === "Enter" && items[row]) set({ lead: items[row].id });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, row, openId, set]);
  useEffect(() => {
    if (row >= 0) document.querySelector(`[data-index="${row}"]`)?.scrollIntoView({ block: "nearest" });
  }, [row]);

  const filtered = Boolean(queue || status || source || q || owner);
  return (
    <>
      <div className="work-head">
        <h1 className="work-title">Leads</h1>
        <span className="work-date num">{plural(total, "lead")}{filtered ? " match" : ""}</span>
      </div>
      <div className="bar">
        <div className="pills" role="group" aria-label="Work queue">
          {QUEUES.map(([key, label]) => (
            <button key={key || "all"} className="pill" aria-pressed={queue === key} onClick={() => set({ queue: key, lead: "" })}>{label}</button>
          ))}
        </div>
      </div>
      <div className="bar">
        <input ref={searchBox} className="field-input bar-search" type="search" placeholder="Search name, company or phone" value={text}
               onChange={(e) => setText(e.target.value)} aria-label="Search leads" />
        <select className="field-input" value={status} onChange={(e) => set({ status: e.target.value, lead: "" })} aria-label="Status">
          <option value="">Any status</option>
          {meta.statuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select className="field-input" value={source} onChange={(e) => set({ source: e.target.value, lead: "" })} aria-label="Source">
          <option value="">Any source</option>
          {meta.sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        {filtered && <button className="btn btn-quiet" onClick={() => { setText(""); location.hash = hashFor("/leads"); }}>Clear filters</button>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="table-frame">
        <table className="grid">
          <thead>
            <tr><th>Lead</th><th>Status</th><th>Owner</th><th>Calls</th><th>Next follow-up</th><th>Updated</th><th><span className="sr">Quick actions</span></th></tr>
          </thead>
          <tbody>
            {items.map((l, i) => {
              const due = dueText(l.next_followup_at);
              return (
                <tr key={l.id} className="row" data-index={i} data-cursor={i === row} aria-selected={l.id === openId}
                    onClick={() => set({ lead: l.id })}>
                  <td>
                    <div className="who-cell">
                      <span className={`avatar ${avatarClass(l.name)}`}>{initials(l.name)}</span>
                      <span>
                        <b><a href={hashFor("/leads", { queue, status, source, q, lead: l.id })} onClick={(e) => e.stopPropagation()}>{l.name}</a></b>
                        <small>{[l.company, l.city, phoneText(l)].filter(Boolean).join(", ")}</small>
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className={`tag tag-${l.stage_group}`}>{l.status}</span>
                    {l.is_repeat ? <span className="note note-good lead-note">Came back</span> : null}
                  </td>
                  <td>{userName(l.owner_id)}</td>
                  <td className="num">
                    {l.first_touch_at
                      ? <>{l.call_count} <small className="muted">({l.connected_count} answered)</small></>
                      : <span className="untouched">Not called yet</span>}
                  </td>
                  <td>{due ? <span className={due.tone}>{due.text}</span> : <span className="muted">None set</span>}</td>
                  <td className="muted">{ago(l.updated_at)}</td>
                  <td>
                    {l.phone_e164 && (
                      <span className="quick">
                        <a className="icon-btn" href={`tel:+${l.phone_e164}`} onClick={(e) => e.stopPropagation()} aria-label={`Call ${l.name}`}><Icon name="phone" /></a>
                        <a className="icon-btn" href={`https://wa.me/${l.phone_e164}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} aria-label={`WhatsApp ${l.name}`}><Icon name="chat" /></a>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && !items.length && (
          <div className="empty"><b>No leads match</b>Try another queue, or clear the filters to see every active lead.</div>
        )}
        {loading && !items.length && <div className="empty">Loading leads…</div>}
      </div>
      {cursor && <p className="keys"><button className="btn" disabled={loading} onClick={() => load(cursor)}>{loading ? "Loading…" : `Show more leads (${total - items.length} left)`}</button></p>}
      <p className="keys"><kbd>J</kbd> and <kbd>K</kbd> move down and up, <kbd>Enter</kbd> opens a lead, <kbd>/</kbd> searches, <kbd>Esc</kbd> closes.</p>
      {openId && <LeadPanel id={openId} meta={meta} onClose={() => set({ lead: "" })} />}
    </>
  );
}
