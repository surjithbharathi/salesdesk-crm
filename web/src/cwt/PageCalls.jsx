import React, { useEffect, useMemo, useRef, useState } from "react";
import { useCrm } from "../crm.jsx";
import { avClass, initials } from "../format.js";
import Recording from "../Recording.jsx";
import { TIcon } from "./icons.jsx";
import LeadPanel from "./LeadDetail.jsx";
import { ago, addDays, dayStart, prettyPhone, stageTone, statusOf, talkText, telOf, timeText } from "./PageUtil.js";

// My Calls: every call the phones synced, newest first, grouped by day, with the recording playable in the row.

const RANGES = [["all", "All time"], ["today", "Today"], ["yesterday", "Yesterday"], ["7d", "Last 7 days"], ["30d", "Last 30 days"]];
function rangeOf(key) {
  const t0 = dayStart(Date.now());
  if (key === "today") return [t0, Infinity];
  if (key === "yesterday") return [addDays(t0, -1), t0];
  if (key === "7d") return [addDays(t0, -6), Infinity];
  if (key === "30d") return [addDays(t0, -29), Infinity];
  return [-Infinity, Infinity];
}
const isMissed = (c) => c.direction === "Missed" || c.direction === "Rejected" || (c.direction === "Incoming" && !(Number(c.duration) > 0));
const kindOf = (c) => (isMissed(c) ? "missed" : c.direction === "Incoming" ? "in" : "out");
const keyOf = (c) => c.leadId || String(c.phone || "").replace(/\D/g, "").slice(-10);
const CHIPS = [["", "All"], ["in", "Incoming"], ["out", "Outgoing"], ["missed", "Missed"], ["rec", "With recording"], ["nolead", "Not a lead"]];

function dayHead(t) {
  const t0 = dayStart(Date.now());
  if (t >= t0) return "TODAY";
  if (t >= addDays(t0, -1)) return "YESTERDAY";
  return new Date(t).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }).toUpperCase();
}

// One recording at a time: starting a row's player pauses the one that was playing.
let playingNow = null;
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
function MiniPlayer({ id, seconds }) {
  const ref = useRef(null);
  const [on, setOn] = useState(false);
  const [at, setAt] = useState(0);
  const [len, setLen] = useState(Number(seconds) || 0);
  const [bad, setBad] = useState(false);
  useEffect(() => () => { if (playingNow === ref.current) playingNow = null; }, []);
  const src = `/api/mobile/recordings/${id}`;
  function toggle() {
    const a = ref.current;
    if (!a) return;
    if (a.paused) {
      if (playingNow && playingNow !== a) playingNow.pause();
      playingNow = a;
      a.play().catch(() => setBad(true));
    } else a.pause();
  }
  function seekTo(fraction) {
    const a = ref.current;
    const d = a && Number.isFinite(a.duration) ? a.duration : len;
    if (!a || !d) return;
    a.currentTime = Math.max(0, Math.min(1, fraction)) * d;
    setAt(a.currentTime);
  }
  if (bad) return <a className="cl-norec link" href={src} target="_blank" rel="noreferrer">Open the recording</a>;
  const pct = len ? Math.min(100, (at / len) * 100) : 0;
  return (
    <div className={`cl-play ${on ? "on" : ""}`}>
      <button type="button" onClick={toggle} aria-label={on ? "Pause recording" : "Play recording"}><TIcon name={on ? "pause" : "play"} /></button>
      <span
        className="cl-bar"
        role="slider"
        tabIndex={0}
        aria-label="Recording position"
        aria-valuemin={0}
        aria-valuemax={Math.round(len)}
        aria-valuenow={Math.round(at)}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seekTo((e.clientX - r.left) / r.width); }}
        onKeyDown={(e) => { if (len && (e.key === "ArrowRight" || e.key === "ArrowLeft")) { e.preventDefault(); seekTo((at + (e.key === "ArrowRight" ? 5 : -5)) / len); } }}
      ><i style={{ width: `${pct}%` }} /></span>
      <span className="cl-time">{mmss(on || at ? at : len)}</span>
      <audio
        ref={ref}
        preload="none"
        src={src}
        onPlay={() => setOn(true)}
        onPause={() => setOn(false)}
        onEnded={() => { setOn(false); setAt(0); }}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setLen(e.currentTarget.duration)}
        onError={() => setBad(true)}
      />
    </div>
  );
}

export default function CwtCalls() {
  const crm = useCrm();
  const [range, setRange] = useState("all");
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState("");
  const [shown, setShown] = useState(60);
  const [openId, setOpenId] = useState("");
  const [iq, setIq] = useState("");

  // calls in the chosen days that match the search box; the chips and the numbers on top work on these
  const inRange = useMemo(() => {
    if (!crm.state) return [];
    const [from, to] = rangeOf(range);
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return crm.calls
      .filter((c) => c.startedAt >= from && c.startedAt < to)
      .filter((c) => {
        if (!q) return true;
        const l = crm.leadById.get(c.leadId);
        return (digits.length >= 3 && String(c.phone || "").replace(/\D/g, "").includes(digits)) || (l && `${l.name} ${l.company || ""}`.toLowerCase().includes(q));
      })
      .sort((a, b) => b.startedAt - a.startedAt);
  }, [crm.state, crm.calls, crm.leadById, range, query]);

  const facts = useMemo(() => {
    const out = { calls: inRange.length, connected: 0, talk: 0, unreturned: 0, missed: 0, in: 0, out: 0, rec: 0, nolead: 0 };
    if (!crm.state) return out;
    // the last time each number was called back or answered, to tell which missed calls nobody returned
    const answered = new Map();
    for (const c of crm.calls) if (!isMissed(c) && (c.direction === "Outgoing" || Number(c.duration) > 0)) answered.set(keyOf(c), Math.max(answered.get(keyOf(c)) || 0, c.startedAt));
    const open = new Set();
    for (const c of inRange) {
      const d = Number(c.duration) || 0;
      if (d > 0) { out.connected++; out.talk += d; }
      out[kindOf(c)]++;
      if (c.recordingId) out.rec++;
      if (!crm.leadById.get(c.leadId)) out.nolead++;
      if (isMissed(c) && (answered.get(keyOf(c)) || 0) < c.startedAt) open.add(keyOf(c));
    }
    out.unreturned = open.size;
    return out;
  }, [crm.state, crm.calls, crm.leadById, inRange]);

  const rows = useMemo(() => inRange.filter((c) => !chip || (chip === "rec" ? c.recordingId : chip === "nolead" ? !crm.leadById.get(c.leadId) : kindOf(c) === chip)), [inRange, chip, crm.leadById]);

  if (!crm.state) return <p className="muted">{crm.error || "Loading calls…"}</p>;
  const lastSync = crm.calls.reduce((m, c) => Math.max(m, Date.parse(c.createdAt || "") || c.startedAt || 0), 0);
  const anyRec = crm.calls.some((c) => c.recordingId);
  const pctConnected = facts.calls ? Math.round((facts.connected / facts.calls) * 100) : 0;
  const nameOf = (id) => crm.users.get(id)?.name || "";
  const page = rows.slice(0, shown);
  const leadIds = [...new Set(page.map((c) => c.leadId).filter((id) => crm.leadById.get(id)))];

  let lastHead = "";
  return (
    <div className="r-page r-calls">
      <div className="r-head">
        <div className="r-title">
          <h1>My Calls</h1>
          <p>{lastSync ? `Synced from your phone ${ago(lastSync)}` : "No calls synced yet"}{anyRec ? " · recordings included" : ""}</p>
        </div>
        <label className="r-search">
          <TIcon name="search" />
          <input type="search" placeholder="Name or number" aria-label="Search calls" value={query} onChange={(e) => { setQuery(e.target.value); setShown(60); }} />
        </label>
        <label className="r-chip r-select">
          <select value={range} onChange={(e) => { setRange(e.target.value); setShown(60); }} aria-label="Days">
            {RANGES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <TIcon name="chevronDown" />
        </label>
        <button type="button" className="r-icon-btn" onClick={() => crm.reload()} aria-label="Refresh calls"><TIcon name="refresh" /></button>
      </div>

      <div className="cl-stats">
        <div className="r-card cl-stat"><p>Calls</p><b>{facts.calls}</b></div>
        <div className="r-card cl-stat"><p>Connected</p><b className="green">{facts.connected} <small>{pctConnected}%</small></b></div>
        <div className="r-card cl-stat"><p>Talk time</p><b>{talkText(facts.talk)}</b></div>
        <div className="r-card cl-stat"><p>Missed, not returned</p><b className={facts.unreturned ? "red" : ""}>{facts.unreturned}</b></div>
      </div>

      <div className="r-chips" role="group" aria-label="Show">
        {CHIPS.map(([k, label]) => {
          const n = k === "" ? facts.calls : facts[k];
          return (
            <button key={k || "all"} type="button" className={`r-chip ${chip === k ? "on" : ""} ${k === "missed" ? "warn" : ""}`} aria-pressed={chip === k} onClick={() => { setChip(k); setShown(60); }}>
              {label}{(k === "" || k === "missed") && <em>{n}</em>}
            </button>
          );
        })}
      </div>

      <section className="r-card cl-list" aria-label="Calls">
        {page.map((c) => {
          const l = crm.leadById.get(c.leadId);
          const kind = kindOf(c);
          const dur = Number(c.duration) || 0;
          const head = dayHead(dayStart(c.startedAt));
          const showHead = head !== lastHead;
          lastHead = head;
          const tel = telOf(c.phone);
          const by = crm.me.lead && c.owner && c.owner !== crm.me.id ? nameOf(c.owner) : "";
          const sub = [l && prettyPhone(c.phone), l?.city, by && `by ${by}`].filter(Boolean).join(" · ");
          return (
            <React.Fragment key={c.id}>
              {showHead && <div className="cl-day">{head}</div>}
              <div className={`cl-row ${kind === "missed" ? "missed" : ""}`}>
                <span className={`cl-dir ${kind}`} aria-label={kind === "missed" ? "Missed call" : kind === "in" ? "Incoming call" : "Outgoing call"}>{kind === "out" ? "↗" : "↙"}</span>
                <span className={`av cl-av ${l ? avClass(l.name) : "anon"}`} aria-hidden="true">{l ? initials(l.name) : "?"}</span>
                <div className="cl-main">
                  <div className="cl-name">
                    {l ? <button type="button" className="cl-lead" onClick={() => setOpenId(l.id)}>{l.name}</button> : <b className="cl-num">{prettyPhone(c.phone) || "Unknown number"}</b>}
                    {l ? <span className={`r-tag ${stageTone(l)}`}>{statusOf(l)}</span> : <span className="r-tag grey">Not a lead</span>}
                    {l?.archived && <span className="r-tag grey">Archived</span>}
                  </div>
                  <p className="cl-sub">
                    {sub || (l ? "" : "This number is not a lead in the CRM.")}
                    {c.recordingId && <button type="button" className="cl-iq" aria-expanded={iq === c.id} onClick={() => setIq(iq === c.id ? "" : c.id)}>{iq === c.id ? "Hide Call IQ" : "Call IQ"}</button>}
                  </p>
                </div>
                <div className="cl-dur">
                  <b className={dur > 0 ? "green" : kind === "missed" ? "red" : "muted"}>{dur > 0 ? talkText(dur) : kind === "missed" ? "Missed" : "No answer"}</b>
                  <span>{timeText(c.startedAt)}</span>
                </div>
                <div className="cl-rec">
                  {c.recordingId ? <MiniPlayer id={c.recordingId} seconds={dur} />
                    : c.recordingPath ? <span className="cl-norec">{(c.recordingTries || 0) >= 4 ? "Recording not copied" : "Copying recording…"}</span>
                    : <span className="cl-norec">No recording</span>}
                </div>
                {tel ? <a className="cl-dial" href={tel} aria-label={`Call ${l ? l.name : prettyPhone(c.phone)}`}><TIcon name="phone" /></a> : <span className="cl-dial none" />}
              </div>
              {iq === c.id && c.recordingId && <div className="cl-iqpanel"><Recording id={c.recordingId} /></div>}
            </React.Fragment>
          );
        })}
        {!rows.length && <p className="r-empty">{crm.calls.length ? "No calls match." : "No calls yet. Calls appear here once the phone app syncs them."}</p>}
      </section>
      {rows.length > shown && <button type="button" className="r-more" onClick={() => setShown((n) => n + 60)}>Show more calls ({rows.length - shown} left)</button>}
      {openId && <LeadPanel id={openId} ids={leadIds} onOpen={setOpenId} onClose={() => setOpenId("")} />}
    </div>
  );
}
