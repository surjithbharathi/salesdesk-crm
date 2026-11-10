import React, { useEffect, useMemo, useState } from "react";
import { v2, localDay } from "../api.js";
import { useLoad } from "../hooks.js";
import { useCrm, stageText } from "../crm.jsx";
import { plural, initials, hashFor } from "../format.js";
import { pipelineStep } from "../pipeline.js";
import { TIcon } from "../cwt/icons.jsx";
import { DAY, MIN_TALK, ms, periodRange, workDays, dateLine, clock, since, talk, shortTalk, money, share, width, peakHour, hourName, Seg, Kpi, Tile, HourChart } from "../cwt/DashParts.jsx";

// A caller's day: their numbers against the daily goals, the work waiting for them, the next lead to call, their calls by hour,
// their pipeline and a short to-do list. Calls, answered calls and quotations are the server's KPI counts (/api/kpi); talk time,
// follow-ups, missed calls and the pipeline are read from the CRM's records. No points or levels here.

const CLOSED = /(?:^Lead stage changed: .* → Closed|^Pipeline step changed: .* → Won)$/;
const OPEN_TASK = (t) => !["Done", "Cancelled"].includes(t.status);
const MISSED = ["Missed", "Rejected"];
const PIPE = [
  ["New", (l) => l.stage === "New", "blue"],
  ["Requirement Discussion", (l) => l.stage === "Prospecting" && pipelineStep(l) !== "Later Purchase", "amber"],
  ["Interested Customer", (l) => l.stage === "Opportunity", "green"],
  ["Quotation Shared", (l) => l.stage === "Quotation given", "navy"],
];

export default function MyDay({ userId, meta }) {
  const crm = useCrm();
  const [tick, setTick] = useState(0);
  const [period, setPeriod] = useState("today");
  const { data: d, error, loading } = useLoad(() => v2("/day", { user: userId, ...localDay(), tz: -new Date().getTimezoneOffset() }), [userId, tick]);
  // The week and month numbers come from the same KPI counts as today's (the leaderboard rows, without the points)
  const board = useLoad(() => (period === "today" ? Promise.resolve(null) : v2("/leaderboard", { period, tz: -new Date().getTimezoneOffset() })), [period, tick]);
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

  const w = useMemo(() => {
    if (!crm?.state) return null;
    const now = Date.now();
    const r = periodRange(period, now);
    const today = periodRange("today", now);
    const ownerOf = (c) => c.owner || crm.leadById.get(c.leadId)?.owner || "";
    const calls = crm.calls.filter((c) => ownerOf(c) === userId);
    const inRange = calls.filter((c) => c.startedAt >= r.from && c.startedAt < r.to);
    const spoke = inRange.filter((c) => c.duration > 0).reduce((s, c) => s + c.duration, 0);
    const real = inRange.filter((c) => c.duration >= MIN_TALK).length;
    const hours = {};
    for (const c of inRange) if (c.direction === "Outgoing") { const h = new Date(c.startedAt).getHours(); hours[h] = (hours[h] || 0) + 1; }

    const tasks = crm.tasks.filter((t) => t.owner === userId && OPEN_TASK(t)).sort((a, b) => ms(a.due) - ms(b.due));
    const late = tasks.filter((t) => ms(t.due) < now);
    const dueToday = tasks.filter((t) => ms(t.due) >= now && ms(t.due) < today.to);
    const leadName = (id) => crm.leadById.get(id)?.name;
    const lateNames = [...new Set(late.map((t) => leadName(t.leadId)).filter(Boolean))];

    const mine = crm.leads.filter((l) => l.owner === userId && !l.archived);
    const open = mine.filter((l) => l.stage !== "Closed");
    const waiting = open.filter((l) => !l.firstTouchAt).sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
    const fresh = mine.filter((l) => ms(l.createdAt) >= r.from && ms(l.createdAt) < r.to);

    // Missed calls in the last week that nobody has rung back since (no later outgoing call and no later answered call with that number)
    const missed = calls.filter((c) => MISSED.includes(c.direction) && c.startedAt > now - 7 * DAY)
      .filter((c) => !crm.calls.some((x) => x.phone === c.phone && x.startedAt > c.startedAt && (x.direction === "Outgoing" || x.duration > 0)))
      .sort((a, b) => b.startedAt - a.startedAt);
    const missedByPhone = [...new Map(missed.map((c) => [c.phone, c])).values()];

    const month = periodRange("month", now);
    const wonIds = new Set();
    for (const a of crm.activities) {
      if (a.type !== "System" || !CLOSED.test(a.text || "")) continue;
      const l = crm.leadById.get(a.leadId);
      const t = ms(a.createdAt);
      if (l && l.owner === userId && l.disposition === "Won" && t >= month.from && t < month.to) wonIds.add(l.id);
    }
    const won = [...wonIds].map((id) => crm.leadById.get(id));
    const pipe = PIPE.map(([label, test, tone]) => ({ label, tone, n: open.filter(test).length }));

    const todos = [
      ...missedByPhone.slice(0, 2).map((c) => ({ key: c.id, tone: "red", label: `MISSED CALL · ${clock(c.startedAt)}`, text: `Call back ${crm.leadById.get(c.leadId)?.name || "+" + c.phone}`, phone: c.phone })),
      ...waiting.slice(0, 2).map((l) => ({ key: l.id, tone: "amber", label: `NEW LEAD · WAITING ${since(ms(l.createdAt)).toUpperCase()}`, text: `First call to ${l.name}`, phone: l.phone, lead: l.id })),
    ];
    return { r, spoke, real, hours, late, dueToday, lateNames, open, waiting, fresh, missed: missedByPhone, won, pipe, todos };
  }, [crm?.state, crm?.calls, crm?.tasks, crm?.leads, crm?.activities, userId, period]);

  const name = meta.users.find((u) => u.id === userId)?.name || "";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  if (error) return <p className="error">{error.message}</p>;
  if (!d) return <p className="muted">{loading ? "Loading your day…" : ""}</p>;

  // Calls, answered and quotations for the chosen period, and the goal for the days worked so far
  const row = period === "today" ? d.today : (board.data || []).find((x) => x.userId === userId) || { calls: 0, answered: 0, quotations: 0 };
  const days = period === "today" ? 1 : workDays(periodRange(period));
  const callGoal = d.goal.calls * days, quoteGoal = d.goal.quotations * days;
  const lastSaid = w && d.next?.id ? latestNote(crm.activities, d.next.id) : "";
  const nextLead = d.next?.id && crm?.leadById?.get(d.next.id);
  const top = w ? Math.max(1, ...w.pipe.map((p) => p.n)) : 1;
  const best = w ? peakHour(w.hours) : null;
  const dash = "—";

  return (
    <div className="rd-page rd-myday">
      <div className="rd-head">
        <div className="rd-head-text">
          <p className="rd-date">{dateLine()}</p>
          <h1 className="rd-title">{greeting}{name ? `, ${name.split(/\s+/)[0]}` : ""}</h1>
        </div>
        {d.streak > 0 && <span className="rd-streak" title="Working days in a row the calls goal was met">{plural(d.streak, "day")} in a row on goal</span>}
        <Seg value={period} onChange={setPeriod} />
      </div>

      <div className="rd-kpis">
        <Kpi label="Calls" value={row.calls} of={callGoal || null} bar={callGoal ? row.calls / callGoal : null} barTone={row.calls >= callGoal ? "green" : "blue"} />
        <Kpi label="Connected" value={row.answered} tone="green" note={row.calls ? `${share(row.answered, row.calls)}% of calls` : "no calls yet"} />
        <Kpi label="Talk time" value={w ? talk(w.spoke) : dash} note={w && w.real ? `avg ${shortTalk(w.spoke / w.real)}` : "no talk yet"} />
        <Kpi label="Follow-ups due" value={w ? w.late.length + w.dueToday.length : dash} tone={w?.late.length ? "red" : ""} note={w ? (w.late.length ? `${w.late.length} late` : "none late") : ""} noteTone={w?.late.length ? "red" : ""} />
        <Kpi label="Quotations" value={row.quotations} of={quoteGoal || null} bar={quoteGoal ? row.quotations / quoteGoal : null} barTone={row.quotations >= quoteGoal ? "green" : "amber"} />
        <Kpi accent label="New leads to me" value={w ? w.fresh.length : dash} note={w ? `${w.fresh.filter((l) => !l.firstTouchAt).length} not called yet` : ""} noteTone="light-blue" />
      </div>

      {w && (
        <section className="rd-tiles" aria-label="My work queue">
          <Tile tone="red" label="LATE FOLLOW-UPS" count={w.late.length} note={w.lateNames.length ? w.lateNames.slice(0, 2).join(", ") + (w.lateNames.length > 2 ? ` and ${w.lateNames.length - 2} more` : "") : "nothing late"} href={hashFor("/todo")} />
          <Tile tone="blue" label="DUE TODAY" count={w.dueToday.length} note={w.dueToday.length ? `Next at ${clock(ms(w.dueToday[0].due))}` : "nothing else today"} href={hashFor("/todo")} />
          <Tile tone="amber" label="NEW, NOT CALLED" count={w.waiting.length} note={w.waiting.length ? `oldest waiting ${since(ms(w.waiting[0].createdAt))}` : "all called"} href={hashFor("/leads", { queue: "untouched" })} />
          <Tile tone="plain" label="MISSED, NOT RETURNED" count={w.missed.length} note={w.missed.length ? "call them back" : "none waiting"} href={hashFor("/calls")} />
        </section>
      )}

      <div className="rd-split">
        <div className="rd-main">
          <section className="rd-next" aria-label="Next call">
            {d.next ? (
              <>
                <span className="rd-next-av" aria-hidden="true">{initials(d.next.name)}</span>
                <div className="rd-next-text">
                  <p className="rd-next-label">NEXT CALL · <span className={/late/i.test(d.next.reason) ? "late" : ""}>{d.next.reason}</span></p>
                  <p className="rd-next-name">{d.next.name} <span>· {nextLead ? stageText(nextLead) : d.next.stage}</span></p>
                  <p className="rd-next-meta">{lastSaid ? `Last said: ${lastSaid}` : [d.next.company, d.next.city, d.next.product].filter(Boolean).join(" · ") || "No notes yet."}</p>
                </div>
                <a className="rd-call big" href={`tel:${String(d.next.phone || "").replace(/[^\d+]/g, "")}`}><TIcon name="phone" />Call on my phone</a>
                {d.next.id && <a className="rd-next-open" href={hashFor("/leads", { lead: d.next.id })}>Open lead</a>}
              </>
            ) : (
              <div className="rd-next-text">
                <p className="rd-next-label">NEXT CALL</p>
                <p className="rd-next-name">You are all caught up</p>
                <p className="rd-next-meta">No late follow-ups and no uncalled leads. New enquiries will appear here.</p>
              </div>
            )}
          </section>

          {w && (
            <section className="r-card rd-panel roomy" aria-label="My calls by hour">
              <div className="rd-card-head"><h2>My calls by hour</h2>{best !== null && <span className="rd-hint">best hour: {hourName(best)}</span>}</div>
              <HourChart counts={w.hours} tall today={period === "today"} />
            </section>
          )}
        </div>

        {w && (
          <div className="rd-side">
            <section className="r-card rd-panel" aria-label="My pipeline">
              <div className="rd-card-head"><h2>My pipeline</h2><span className="rd-hint">{plural(w.open.length, "lead")}</span></div>
              <div className="rd-pipe">
                {w.pipe.map((p) => (
                  <div key={p.label}>
                    <div className="rd-pipe-row"><span>{p.label}</span><b>{p.n}</b></div>
                    <div className="rd-bar"><i className={p.tone} style={width(p.n, top)} /></div>
                  </div>
                ))}
                <div className="rd-pipe-row"><span>Won this month</span><b className="green">{w.won.length} · {money(w.won.reduce((s, l) => s + (Number(l.value) || 0), 0))}</b></div>
              </div>
            </section>
            <section className="r-card rd-panel" aria-label="To-dos">
              <div className="rd-card-head"><h2>To-dos</h2>{w.todos.length > 0 && <span className="rd-count">{w.todos.length}</span>}</div>
              {w.todos.length ? w.todos.map((t) => (
                <div key={t.key} className="rd-todo">
                  <div>
                    <p className={`rd-todo-label ${t.tone}`}>{t.label}</p>
                    <p className="rd-todo-text">{t.lead ? <a href={hashFor("/leads", { lead: t.lead })}>{t.text}</a> : t.text}</p>
                  </div>
                  {t.phone && <a className="rd-call" href={`tel:${String(t.phone).replace(/[^\d+]/g, "")}`}>Call</a>}
                </div>
              )) : <p className="rd-empty">Nothing waiting. Missed calls and new leads will show here.</p>}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

// The newest note written on a lead, cut short, for "Last said".
function latestNote(activities, leadId) {
  let best = null;
  for (const a of activities || []) if (a.leadId === leadId && a.type === "Note" && a.text && (!best || ms(a.createdAt) > ms(best.createdAt))) best = a;
  if (!best) return "";
  const t = best.text.replace(/\s+/g, " ").trim();
  return t.length > 140 ? t.slice(0, 137) + "…" : t;
}

// Used by the Team page.
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
