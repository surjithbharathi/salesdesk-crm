import React, { useMemo, useRef, useState } from "react";
import { v2, localDay } from "../api.js";
import { useCrm } from "../crm.jsx";
import { useLoad } from "../hooks.js";
import { avClass, hashFor, initials } from "../format.js";
import DashPanels from "./DashPanels.jsx";
import { DAY, MIN_TALK, ms, periodRange, workDays, dateLine, since, talk, money, share, width, change, peakHour, hourName, Seg, Kpi, Tile, HourChart } from "./DashParts.jsx";

// The owner's dashboard ("Business overview"): the day's numbers, what needs attention, how each caller is doing, and the shape of the
// pipeline and lead sources. Everything is counted from the CRM's own records (leads, phone calls, follow-ups, stage changes).
// The older detailed panels (SIM permission, follow ups per person, status report, WhatsApp sync, My Dashboard) are kept below.

const QUOTE = /(?:^Lead stage changed: .* → Quotation given|^Pipeline step changed: .* → Quotation Shared)$/;
const CLOSED = /(?:^Lead stage changed: .* → Closed|^Pipeline step changed: .* → Won)$/;
const OPEN_TASK = (t) => !["Done", "Cancelled"].includes(t.status);
const FUNNEL = [
  ["New", (l) => l.stage === "New", "f1"],
  ["Interested", (l) => l.stage === "Opportunity" || l.stage === "Prospecting", "f2"],
  ["Quotation", (l) => l.stage === "Quotation given" && !["Advance Received", "Machine Dispatched", "Machine Delivered - Need to Start"].includes(l.deal), "f3"],
  ["Advance received", (l) => l.stage === "Quotation given" && ["Advance Received", "Machine Dispatched", "Machine Delivered - Need to Start"].includes(l.deal), "f4"],
];
const interested = (l) => ["Opportunity", "Quotation given"].includes(l.stage) || (l.stage === "Closed" && l.disposition === "Won");

export default function Dashboard({ meta }) {
  const crm = useCrm();
  const [period, setPeriod] = useState("today");
  const [member, setMember] = useState("");
  const [more, setMore] = useState(false);
  const teamRef = useRef(null);
  // Daily calls goal of each person, as set on the Goals page
  const team = useLoad(() => (meta?.lead ? v2("/team", { ...localDay(), tz: -new Date().getTimezoneOffset() }) : Promise.resolve([])), [meta?.lead]);

  const d = useMemo(() => {
    if (!crm?.state) return null;
    const now = Date.now();
    const r = periodRange(period, now);
    const users = [...crm.users.values()].filter((u) => u.active !== false);
    const inTeam = (owner) => !member || owner === member;
    const ownerOfCall = (c) => c.owner || crm.leadById.get(c.leadId)?.owner || "";
    const out = crm.calls.filter((c) => c.direction === "Outgoing");
    const callsIn = (from, to) => out.filter((c) => c.startedAt >= from && c.startedAt < to && inTeam(ownerOfCall(c)));
    const cur = callsIn(r.from, r.to), before = callsIn(r.prevFrom, r.prevTo);
    const conn = (list) => list.filter((c) => c.duration >= MIN_TALK).length;

    const leadsIn = (from, to) => crm.leads.filter((l) => { const t = ms(l.createdAt); return t >= from && t < to && inTeam(l.owner); });
    const newNow = leadsIn(r.from, r.to), newBefore = leadsIn(r.prevFrom, r.prevTo);

    const changed = (re, from, to, keep = () => true) => {
      const ids = new Set();
      for (const a of crm.activities) {
        if (a.type !== "System" || !re.test(a.text || "")) continue;
        const t = ms(a.createdAt);
        const lead = crm.leadById.get(a.leadId);
        if (t >= from && t < to && lead && inTeam(lead.owner) && keep(lead)) ids.add(lead.id);
      }
      return [...ids].map((id) => crm.leadById.get(id));
    };
    const won = (l) => l.disposition === "Won";
    const quotes = changed(QUOTE, r.from, r.to).length, quotesBefore = changed(QUOTE, r.prevFrom, r.prevTo).length;
    const orders = changed(CLOSED, r.from, r.to, won);

    // Follow-ups past their time, now and at this time yesterday
    const doneAt = (t) => ms(t.completedAt || t.updatedAt);
    const lateAt = (at) => crm.tasks.filter((t) => t.status !== "Cancelled" && inTeam(t.owner) && ms(t.due) < at && (OPEN_TASK(t) || doneAt(t) > at));
    const late = crm.tasks.filter((t) => OPEN_TASK(t) && inTeam(t.owner) && ms(t.due) < now);
    const lateYesterday = lateAt(now - DAY).length;
    const lateBy = new Map();
    for (const t of late) lateBy.set(t.owner, (lateBy.get(t.owner) || 0) + 1);
    const worst = [...lateBy.entries()].filter(([id]) => id).sort((a, b) => b[1] - a[1])[0];

    const open = crm.leads.filter((l) => !l.archived && l.stage !== "Closed");
    const unassigned = open.filter((l) => !l.owner).length;
    // only the last 7 days: older uncalled leads are old stock, not a lead going cold now
    const waiting = open.filter((l) => !l.firstTouchAt && inTeam(l.owner) && l.owner && ms(l.createdAt) < now - 2 * 3600000 && ms(l.createdAt) > now - 7 * DAY).length;

    // The last call of each person (any direction), for "now" and idle
    const lastCall = new Map();
    for (const c of crm.calls) { const o = ownerOfCall(c); if (o) lastCall.set(o, Math.max(lastCall.get(o) || 0, c.startedAt)); }
    const recentCaller = (id) => (lastCall.get(id) || 0) > now - 14 * DAY;
    const today0 = periodRange("today", now).from;
    const working = users.filter((u) => out.some((c) => c.startedAt >= today0 && ownerOfCall(c) === u.id)).length;
    const idle = users.filter((u) => recentCaller(u.id) && inTeam(u.id) && (lastCall.get(u.id) || 0) < now - 2 * 3600000);

    const goals = new Map((Array.isArray(team.data) ? team.data : []).map((x) => [x.userId, x.goalCalls]));
    const days = period === "today" ? 1 : workDays(r, now);
    const rows = users.filter((u) => inTeam(u.id)).map((u) => {
      const mine = cur.filter((c) => ownerOfCall(c) === u.id);
      const spoke = crm.calls.filter((c) => c.startedAt >= r.from && c.startedAt < r.to && c.duration > 0 && ownerOfCall(c) === u.id).reduce((s, c) => s + c.duration, 0);
      const goal = (goals.get(u.id) ?? 0) * days;
      return { u, calls: mine.length, conn: conn(mine), talk: spoke, late: lateBy.get(u.id) || 0, goal, last: lastCall.get(u.id) || 0 };
    }).filter((x) => x.calls || x.late || recentCaller(x.u.id) || member).sort((a, b) => b.calls - a.calls || a.u.name.localeCompare(b.u.name));

    const hours = {};
    for (const c of cur) { const h = new Date(c.startedAt).getHours(); hours[h] = (hours[h] || 0) + 1; }

    const scope = open.filter((l) => inTeam(l.owner));
    const funnel = FUNNEL.map(([label, test, tone]) => ({ label, tone, n: scope.filter(test).length }));

    const bySource = new Map();
    for (const l of newNow) { const s = (l.source || "Other").trim() || "Other"; const x = bySource.get(s) || { name: s, n: 0, hot: 0 }; x.n++; if (interested(l)) x.hot++; bySource.set(s, x); }
    let sources = [...bySource.values()].sort((a, b) => b.n - a.n);
    if (sources.length > 4) {
      const rest = sources.slice(3).reduce((t, x) => ({ name: "Other", n: t.n + x.n, hot: t.hot + x.hot }), { name: "Other", n: 0, hot: 0 });
      sources = [...sources.slice(0, 3), rest];
    }

    return {
      r, working, rows, hours, funnel, sources, newTotal: newNow.length,
      kpi: {
        leads: [newNow.length, newBefore.length], calls: [cur.length, before.length],
        rate: [share(conn(cur), cur.length), share(conn(before), before.length)], quotes: [quotes, quotesBefore],
        late: [late.length, lateYesterday], orders: { n: orders.length, value: orders.reduce((s, l) => s + (Number(l.value) || 0), 0) },
      },
      attention: { unassigned, late: late.length, worst: worst ? [crm.users.get(worst[0])?.name || "No owner", worst[1]] : null, waiting, idle },
    };
  }, [crm?.state, crm?.users, crm?.calls, crm?.tasks, crm?.leads, crm?.activities, period, member, team.data]);

  if (!crm) return <p className="muted">Loading the dashboard…</p>;
  if (!d) return <p className="muted">{crm.error || "Loading the dashboard…"}</p>;
  const users = [...crm.users.values()].filter((u) => u.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const k = d.kpi;
  const leadsChange = change(k.leads[0], k.leads[1], { cmp: d.r.cmp });
  const callsChange = change(k.calls[0], k.calls[1], { cmp: d.r.cmp });
  const rateChange = k.calls[0] ? change(k.rate[0], k.rate[1], { unit: "pts" }) : { text: "no calls yet", tone: "" };
  const quoteChange = change(k.quotes[0], k.quotes[1], { unit: "n", cmp: d.r.cmp });
  const lateDiff = k.late[0] - k.late[1];
  const top = Math.max(1, ...d.funnel.map((f) => f.n));
  const idleNames = d.attention.idle.map((u) => u.name);
  const memberName = member ? crm.users.get(member)?.name : "";

  return (
    <div className="rd-page">
      <div className="rd-head">
        <div className="rd-head-text">
          <p className="rd-date">{dateLine()} · {memberName || `${d.working} ${d.working === 1 ? "caller" : "callers"} working`}</p>
          <h1 className="rd-title">Business overview</h1>
        </div>
        <Seg value={period} onChange={setPeriod} />
        <label className="rd-select">
          <span className="rd-sr">Show</span>
          <select value={member} onChange={(e) => setMember(e.target.value)} aria-label="Whose numbers">
            <option value="">All team</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      </div>

      <div className="rd-kpis">
        <Kpi label="New leads" value={k.leads[0]} note={leadsChange.text} noteTone={leadsChange.tone} />
        <Kpi label="Calls made" value={k.calls[0]} note={callsChange.text} noteTone={callsChange.tone} />
        <Kpi label="Connected" value={`${k.rate[0]}%`} note={rateChange.text} noteTone={rateChange.tone} />
        <Kpi label="Quotations" value={k.quotes[0]} note={quoteChange.text} noteTone={quoteChange.tone} />
        <Kpi label="Late follow-ups" value={k.late[0]} tone={k.late[0] ? "red" : ""} noteTone={lateDiff > 0 ? "down" : lateDiff < 0 ? "up" : ""}
          note={lateDiff === 0 ? "same as yesterday" : `${Math.abs(lateDiff)} ${lateDiff > 0 ? "more" : "fewer"} than yesterday`} />
        <Kpi accent label="Orders won" value={money(k.orders.value)} note={`${k.orders.n} ${k.orders.n === 1 ? "order" : "orders"}`} noteTone="light" />
      </div>

      <section className="rd-tiles" aria-label="Needs your attention">
        <Tile tone="amber" label="UNASSIGNED LEADS" count={d.attention.unassigned} note={d.attention.unassigned ? "share them out" : "all leads have an owner"} href={hashFor("/leads", { queue: "unassigned" })} />
        <Tile tone="red" label="LATE FOLLOW-UPS" count={d.attention.late} note={d.attention.worst ? `most with ${d.attention.worst[0]} (${d.attention.worst[1]})` : "none late"} href={hashFor("/todo")} />
        <Tile tone="blue" label="NEW, NOT CALLED IN 2 H" count={d.attention.waiting} note="last 7 days · see the list" href={hashFor("/leads", { queue: "waiting" })} />
        <Tile tone="plain" label="IDLE CALLERS" count={idleNames.length}
          note={idleNames.length ? `${idleNames.slice(0, 2).join(", ")}${idleNames.length > 2 ? ` and ${idleNames.length - 2} more` : ""}, no call in 2 h` : "everyone called in the last 2 h"}
          onClick={() => teamRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} />
      </section>

      <section className="r-card rd-team" aria-label="Team now" ref={teamRef}>
        <div className="rd-card-head"><h2>Team now</h2><a href={hashFor("/reports", { tab: "calls" })}>Full call report →</a></div>
        <div className="rd-table-wrap">
          <table className="rd-table">
            <thead><tr><th>CALLER</th><th>NOW</th><th>CALLS</th><th>CONNECTED</th><th>TALK TIME</th><th>LATE</th><th>CALLS GOAL</th><th><span className="rd-sr">Action</span></th></tr></thead>
            <tbody>
              {d.rows.map((x) => <TeamRow key={x.u.id} x={x} />)}
              {!d.rows.length && <tr><td colSpan={8} className="rd-empty">No calls in this period yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <div className="rd-three">
        <section className="r-card rd-panel" aria-label="Team calls by hour">
          <div className="rd-card-head small"><h2>{member ? "Calls by hour" : "Team calls by hour"}</h2>{peakHour(d.hours) !== null && <span className="rd-hint">peak {hourName(peakHour(d.hours))}</span>}</div>
          <HourChart counts={d.hours} today={period === "today"} />
        </section>
        <section className="r-card rd-panel rd-funnel" aria-label="Pipeline">
          <div className="rd-card-head small"><h2>Pipeline</h2><a className="rd-hint" href={hashFor("/leads")}>open leads</a></div>
          {d.funnel.map((f) => (
            <div key={f.label} className="rd-fun-row">
              <div className="rd-fun"><i className={f.tone} style={{ width: `${Math.max(14, (f.n / top) * 100)}%` }}>{f.n.toLocaleString("en-IN")}</i></div>
              <span>{f.label}</span>
            </div>
          ))}
        </section>
        <section className="r-card rd-panel rd-sources" aria-label="Lead sources">
          <div className="rd-card-head small"><h2>Lead sources {period === "today" ? "today" : period === "week" ? "this week" : "this month"}</h2></div>
          {d.sources.length ? (
            <>
              <div className="rd-stack" aria-hidden="true">{d.sources.map((s, i) => <i key={s.name} className={`s${i}`} style={width(s.n, d.newTotal)} />)}</div>
              {d.sources.map((s, i) => (
                <div key={s.name} className="rd-src"><span><i className={`dot s${i}`} />{s.name}</span><span><b>{s.n}</b> <em>· {share(s.hot, s.n)}%{i === 0 ? " interested" : ""}</em></span></div>
              ))}
            </>
          ) : <p className="rd-empty">No new leads in this period.</p>}
        </section>
      </div>

      <details className="r-card rd-more" open={more} onToggle={(e) => setMore(e.currentTarget.open)}>
        <summary>Phones, follow-ups by person, status report and My Dashboard</summary>
        {more && <DashPanels meta={meta} />}
      </details>
    </div>
  );
}

// One caller in "Team now". There is no live call status, so "now" is told from the time of the last synced call.
function TeamRow({ x }) {
  const now = Date.now();
  const gap = x.last ? now - x.last : Infinity;
  const state = !x.last || gap > DAY ? ["grey", "No calls today"] : gap <= 10 * 60000 ? ["green", `Active · last call ${since(x.last)} ago`] : gap <= 2 * 3600000 ? ["blue", `Last call ${since(x.last)} ago`] : ["amber", `Idle ${since(x.last)}`];
  const goalShare = x.goal > 0 ? x.calls / x.goal : null;
  const barTone = goalShare === null ? "" : goalShare >= 1 ? "green" : goalShare < 0.4 ? "amber" : "blue";
  const phone = x.u.phone || x.u.mobile;
  const idle = state[0] === "amber" || state[0] === "grey";
  return (
    <tr>
      <td><div className="rd-who"><span className={`av rd-av ${avClass(x.u.name)}`} aria-hidden="true">{initials(x.u.name)}<em className={state[0]} /></span><b>{x.u.name}</b></div></td>
      <td><span className={`rd-state ${state[0]}`}>{state[1]}</span></td>
      <td><b>{x.calls}</b></td>
      <td>{x.conn} · {share(x.conn, x.calls)}%</td>
      <td>{talk(x.talk)}</td>
      <td className={x.late ? "rd-late" : "rd-ok"}>{x.late}</td>
      <td>{goalShare === null ? <span className="rd-muted">No goal</span> : <div className="rd-gtrack" title={`${x.calls} of ${x.goal} calls`}><i className={barTone} style={width(x.calls, x.goal)} /></div>}</td>
      <td>{idle && phone ? <a className="rd-mini" href={`tel:${String(phone).replace(/[^\d+]/g, "")}`}>Call {x.u.name.split(/\s+/)[0]}</a> : <a className="rd-mini" href={hashFor("/leads", { queue: "unassigned" })}>Assign leads</a>}</td>
    </tr>
  );
}
