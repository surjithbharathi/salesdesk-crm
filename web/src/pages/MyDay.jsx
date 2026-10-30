import React, { useEffect, useRef, useState } from "react";
import { v2, localDay } from "../api.js";
import { useLoad } from "../hooks.js";
import { plural, initials } from "../format.js";
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
  const { data: d, error, loading } = useLoad(() => v2("/day", { user: userId, ...localDay(), tz: -new Date().getTimezoneOffset() }), [userId, tick]);
  const [period, setPeriod] = useState("week");
  const monthBoard = useLoad(() => (period === "month" ? v2("/leaderboard", { period: "month", tz: -new Date().getTimezoneOffset() }) : Promise.resolve(null)), [period, tick]);
  const cheer = useCelebration(d, userId);
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
    ["Quotations given", d.today.quotations, rules.quotation],
    ["Orders won", d.today.won, rules.won],
  ];
  const earned = d.badges.filter((b) => b.earned).length;
  const rows = period === "month" ? monthBoard.data || [] : d.weekBoard;
  const mine = rows.find((r) => r.userId === userId);

  return (
    <>
      <div className="work-head">
        <h1 className="work-title">{greeting}{name ? `, ${name}` : ""}</h1>
        <span className={`streak ${d.streak > 0 ? "streak-on" : ""}`} title="Working days in a row you met the calls goal">
          <Icon name="spark" />{d.streak > 0 ? `${plural(d.streak, "day")} in a row` : "No streak yet"}
        </span>
      </div>

      {cheer && <p className="cheer" role="status">{cheer}</p>}
      <LevelStrip d={d} />

      <section className="nextup" aria-label="Next lead to call">
        {d.next ? (
          <>
            <div>
              <span className="note note-warn">{d.next.reason}</span>
              <h2 className="nextup-name">{d.next.name}</h2>
              <p className="muted nextup-meta">{[d.next.company, d.next.city, d.next.product, d.next.stage].filter(Boolean).join(", ")}</p>
              <p className="nextup-nudge">{nudge(d)}</p>
            </div>
            <div className="nextup-actions">
              <a className="btn btn-primary btn-big" href={`tel:${d.next.phone}`}><Icon name="phone" />Call {d.next.phone}</a>
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
          <TeamGoal t={d.teamToday} />
          <h2 className="section-title section-gap">Challenges this week <span className="muted badge-count">{d.challenges.filter((c) => c.done).length} of {d.challenges.length}</span></h2>
          <ul className="challenges">
            {d.challenges.map((c) => (
              <li key={c.id} className={c.done ? "challenge-done" : ""}>
                <span>{c.done && <Icon name="check" size={16} />}{c.label}</span>
                <progress max={c.target} value={Math.min(c.value, c.target)} aria-label={`${c.label}: ${c.value} of ${c.target}`} />
                <b className="num">{c.value} / {c.target}</b>
              </li>
            ))}
          </ul>
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
          <h2 className="section-title section-gap">Milestones <span className="muted badge-count">{d.milestones.filter((x) => x.earned).length} of {d.milestones.length}</span></h2>
          <ul className="milestones">
            {d.milestones.map((x) => (
              <li key={x.id} className={`milestone ${x.earned ? "milestone-on" : ""}`} title={x.earned ? x.label : x.hint}>
                <Icon name={x.earned ? "trophy" : "lock"} size={18} />
                <b>{x.label}</b>
                {!x.earned && <small className="num">{x.value} of {x.target}</small>}
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
          <section aria-label="Leaderboard">
            <h2 className="section-title section-gap">Leaderboard</h2>
            <div className="tabs period-tabs" role="tablist" aria-label="Leaderboard period">
              {[["week", "This week"], ["month", "This month"]].map(([key, label]) => (
                <button key={key} role="tab" className="tab" aria-selected={period === key} onClick={() => setPeriod(key)}>{label}</button>
              ))}
            </div>
            <Leaderboard rows={rows} me={userId} />
            {mine && <p className="muted gauge-note">You have {mine.points} points {period === "month" ? "this month" : "this week"}.</p>}
            <h2 className="section-title section-gap">Stars of the week</h2>
            <HallOfFame rows={d.hallOfFame} me={userId} />
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

function LevelStrip({ d }) {
  const l = d.level;
  const span = l.next ? l.next - l.floor : 1;
  const into = l.next ? l.points - l.floor : 1;
  return (
    <section className="levelstrip" aria-label="Your level">
      <div className="level-badge" aria-hidden="true"><span className="num">{l.level}</span></div>
      <div className="level-main">
        <b className="level-name">{l.name}</b>
        <progress max={span} value={into} aria-label={l.next ? `${l.toNext} points to ${l.nextName}` : "Top level"} />
        <small className="muted num">{l.next ? `${l.toNext} points to ${l.nextName}` : "You are at the top level"}, {l.points} points in all</small>
      </div>
      <div className="level-rank">
        {d.week.rank ? (
          <><b className="num">{d.week.rank === 1 && d.week.points > 0 ? "1st" : `#${d.week.rank}`}</b><small>of {d.week.of} this week</small></>
        ) : <small>Not ranked yet</small>}
      </div>
    </section>
  );
}

function TeamGoal({ t }) {
  if (!t || t.goal <= 0) return null;
  return (
    <div className="teamgoal">
      <span>Team calls today</span>
      <progress max={t.goal} value={Math.min(t.calls, t.goal)} aria-label={`Team calls today: ${t.calls} of ${t.goal}`} />
      <b className="num">{t.calls} / {t.goal}</b>
    </div>
  );
}

function HallOfFame({ rows, me }) {
  if (!rows.length) return <p className="muted">Winners of finished weeks appear here.</p>;
  return (
    <ul className="sidelist hall">
      {rows.map((w) => (
        <li key={w.weekStart} className={w.userId === me ? "board-me" : ""}>
          <span><Icon name="trophy" size={16} /> {w.name}</span>
          <small className="muted num">week of {new Date(w.weekStart).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, {w.points} points</small>
        </li>
      ))}
    </ul>
  );
}

// A short message when something new was earned since the last refresh: a badge, a milestone, a finished challenge or a new level.
function useCelebration(d, userId) {
  const last = useRef(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!d) return undefined;
    const now = { who: userId, level: d.level.level, badges: d.badges.filter((b) => b.earned).map((b) => b.id), marks: d.milestones.filter((x) => x.earned).map((x) => x.id), done: d.challenges.filter((c) => c.done).map((c) => c.id) };
    const before = last.current;
    last.current = now;
    if (!before || before.who !== now.who) return undefined;
    const fresh = [];
    if (now.level > before.level) fresh.push(`Level ${now.level}: ${d.level.name}`);
    for (const x of d.milestones) if (x.earned && !before.marks.includes(x.id)) fresh.push(x.label);
    for (const b of d.badges) if (b.earned && !before.badges.includes(b.id)) fresh.push(b.label);
    for (const c of d.challenges) if (c.done && !before.done.includes(c.id)) fresh.push(`Challenge done: ${c.label}`);
    if (!fresh.length) return undefined;
    setMessage(`Well done. ${fresh.join(", ")}.`);
    const timer = setTimeout(() => setMessage(""), 7000);
    return () => clearTimeout(timer);
  }, [d, userId]);
  return message;
}
