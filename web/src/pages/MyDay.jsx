import React, { useEffect, useState } from "react";
import { v2, localDay } from "../api.js";
import { useLoad } from "../hooks.js";
import { hashFor, phoneText, plural, initials } from "../format.js";
import Icon from "../icons.jsx";

const R = 44;
const C = 2 * Math.PI * R;

// A pressure gauge: the ring fills as the count nears the goal and turns green when it is reached.
function Gauge({ label, value, goal }) {
  const [shown, setShown] = useState(0);
  const share = goal > 0 ? Math.min(1, value / goal) : 0;
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(share));
    return () => cancelAnimationFrame(frame);
  }, [share]);
  const done = goal > 0 && value >= goal;
  return (
    <figure className={`gauge ${done ? "gauge-done" : ""}`} aria-label={`${label}: ${value} of ${goal}`}>
      <svg viewBox="0 0 110 110" role="img" aria-hidden="true">
        <circle className="gauge-track" cx="55" cy="55" r={R} />
        <circle className="gauge-fill" cx="55" cy="55" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - shown)} transform="rotate(-90 55 55)" />
        {done && <path className="gauge-check" d="M38 56 L51 69 L74 43" />}
      </svg>
      <figcaption>
        <b className="num gauge-value">{done ? "" : value}</b>
        <span>{label}</span>
        <small className="num">{done ? `${value} of ${goal}` : `of ${goal}`}</small>
      </figcaption>
    </figure>
  );
}

function nudge(d) {
  const left = d.goal.calls - d.today.calls;
  if (d.today.calls === 0) return d.next ? "Your first call starts the day." : "No leads are waiting for you. Check Leads for new enquiries.";
  if (left > 0) return `${plural(left, "call")} to reach today's goal.`;
  return "Goal reached. Every extra call still scores.";
}

export default function MyDay({ userId, meta }) {
  const [tick, setTick] = useState(0);
  const { data: d, error, loading } = useLoad(() => v2("/me/day", { user: userId, ...localDay(), tz: -new Date().getTimezoneOffset() }), [userId, tick]);
  const board = useLoad(() => v2("/leaderboard", { tz: -new Date().getTimezoneOffset() }), [tick]);
  // Coming back from a phone call: refresh so the call you just made counts straight away.
  useEffect(() => {
    const refresh = () => document.visibilityState === "visible" && setTick((t) => t + 1);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const name = meta.users.find((u) => u.id === userId)?.name || "";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  if (error) return <p className="error">{error.message}</p>;
  if (!d) return <p className="muted">{loading ? "Loading your day…" : ""}</p>;
  const rules = d.pointRules;
  const lines = [
    ["Calls made", d.today.calls, rules.call],
    ["Calls answered", d.today.answered, rules.answered],
    ["Follow-ups done on time", d.today.onTime, rules.onTimeFollowUp],
    ["Quotations shared", d.today.quotations, rules.quotation],
    ["Orders won", d.today.won, rules.won],
  ];
  const earned = d.badges.filter((b) => b.earned).length;
  const mine = (board.data || []).find((r) => r.userId === userId);

  return (
    <>
      <div className="work-head">
        <h1 className="work-title">{greeting}{name ? `, ${name}` : ""}</h1>
        <span className={`streak ${d.streak > 0 ? "streak-on" : ""}`} title="Working days in a row you met the calls goal">
          <Icon name="spark" />{d.streak > 0 ? `${plural(d.streak, "day")} in a row` : "No streak yet"}
        </span>
      </div>

      <section className="nextup" aria-label="Next lead to call">
        {d.next ? (
          <>
            <div>
              <span className="note note-warn">{d.next.reason}</span>
              <h2 className="nextup-name">{d.next.name}</h2>
              <p className="muted nextup-meta">{[d.next.company, d.next.city, d.next.product_interested, d.next.status].filter(Boolean).join(", ")}</p>
              <p className="nextup-nudge">{nudge(d)}</p>
            </div>
            <div className="nextup-actions">
              <a className="btn btn-primary btn-big" href={`tel:+${d.next.phone_e164}`}><Icon name="phone" />Call {phoneText(d.next)}</a>
              <a className="btn" href={hashFor("/leads", { lead: d.next.id })}>Open lead</a>
            </div>
          </>
        ) : (
          <div>
            <h2 className="nextup-name">You are all caught up</h2>
            <p className="muted nextup-meta">No late follow-ups and no uncalled leads. New enquiries will appear here.</p>
          </div>
        )}
      </section>

      <div className="cols">
        <section aria-label="Today's goals">
          <h2 className="section-title">Today's goals</h2>
          <div className="gauges">
            <Gauge label="Calls" value={d.today.calls} goal={d.goal.calls} />
            <Gauge label="Answered" value={d.today.answered} goal={d.goal.answered} />
            <Gauge label="Quotations" value={d.today.quotations} goal={d.goal.quotations} />
          </div>
          {!d.next || d.today.calls > 0 ? <p className="muted gauge-note">{nudge(d)}</p> : null}
          <h2 className="section-title section-gap">Badges today <span className="muted badge-count">{earned} of {d.badges.length}</span></h2>
          <ul className="badges">
            {d.badges.map((b) => (
              <li key={b.id} className={`badge ${b.earned ? "badge-on" : ""}`} title={b.earned ? b.label : b.hint}>
                <Icon name={b.earned ? "check" : "dot"} size={16} />
                <span>{b.label}</span>
                {!b.earned && <small>{b.hint}</small>}
              </li>
            ))}
          </ul>
        </section>

        <div>
          <section aria-label="Points">
            <h2 className="section-title">Points today</h2>
            <p className="points-total"><b className="num">{d.today.points}</b><span>points</span></p>
            <ul className="sidelist points-list">
              {lines.map(([label, count, each]) => (
                <li key={label}><span>{label}</span><b className="num">{count} × {each}</b></li>
              ))}
            </ul>
            <details className="defs">
              <summary>How points are counted</summary>
              <p className="muted">Points come only from calls and changes saved in the CRM. An answered call counts after {d.minCallSeconds} seconds, and only the first two unanswered tries on a lead each day count, so tapping cannot earn points.</p>
            </details>
          </section>
          <section aria-label="This week">
            <h2 className="section-title section-gap">This week</h2>
            <Leaderboard rows={board.data || []} me={userId} />
            {mine && <p className="muted gauge-note">You have {mine.points} points this week.</p>}
          </section>
        </div>
      </div>
    </>
  );
}

export function Leaderboard({ rows, me }) {
  const top = Math.max(1, ...rows.map((r) => r.points));
  if (!rows.length) return <p className="muted">No activity yet this week.</p>;
  return (
    <ol className="board">
      {rows.map((r) => (
        <li key={r.userId} className={r.userId === me ? "board-me" : ""}>
          <span className="board-rank num">{r.rank}</span>
          <span className="avatar">{initials(r.name)}</span>
          <span className="board-name">{r.name}</span>
          <progress max={top} value={r.points} aria-hidden="true" />
          <b className="num">{r.points}</b>
        </li>
      ))}
    </ol>
  );
}
