import React, { useMemo } from "react";
import { crmSend } from "../api.js";
import { useCrm } from "../crm.jsx";
import { useToast } from "../toast.jsx";
import { avClass, hashFor, initials } from "../format.js";
import { PIPELINE } from "../pipeline.js";
import { TIcon } from "./icons.jsx";
import { addDays, ago, csvOf, dayStart, mondayOf, monthStart, saveCsv, statusOf, talkText } from "./PageUtil.js";

// Reports: leaderboard, call report, downloads, duplicate leads and deleted (archived) leads. The period in the corner
// counts calls made in it; leads and won are what each person holds now.

const R_TABS = [["leaderboard", "Leaderboard"], ["calls", "Call Report"], ["download", "Report Download"], ["duplicates", "Duplicate Leads"], ["deleted", "Deleted leads"]];
const HINTS = {
  leaderboard: (p) => `Who is closing the most leads. Calls ${p}; leads and won are what each person holds now.`,
  calls: (p) => `Calls made ${p} by each person, how many connected and for how long.`,
  download: () => "Download your data as spreadsheets.",
  duplicates: () => "Leads that share the same name and company.",
  deleted: () => "Leads that were archived. Restore them here.",
};
const PERIODS = [["today", "Today"], ["week", "This week"], ["7d", "Last 7 days"], ["month", "This month"], ["all", "All time"]];
function periodRange(k) {
  const t0 = dayStart(Date.now());
  if (k === "today") return [t0, addDays(t0, 1)];
  if (k === "week") { const mon = mondayOf(t0); return [mon, addDays(mon, 7)]; }
  if (k === "7d") return [addDays(t0, -6), addDays(t0, 1)];
  if (k === "month") { const m = monthStart(t0); const d = new Date(m); return [m, new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()]; }
  return [-Infinity, Infinity];
}
// the days the chart shows: the period's own days, or the last 7 (today) or 30 (all time) days
function chartDays(k) {
  const t0 = dayStart(Date.now());
  let from, to;
  if (k === "week" || k === "month" || k === "7d") [from, to] = periodRange(k);
  else { from = addDays(t0, k === "today" ? -6 : -29); to = addDays(t0, 1); }
  const out = [];
  for (let d = from; d < to; d = addDays(d, 1)) out.push(d);
  return out;
}
const callTime = (a) => Date.parse(a.occurredAt || a.createdAt || "") || 0;

function Podium({ rows, title, metric }) {
  const order = [rows[1], rows[0], rows[2]];
  return (
    <section className="r-card rp-podium" aria-label={title}>
      <h2>{title}</h2>
      {rows.length ? (
        <div className="rp-places">
          {order.map((r, i) => {
            if (!r) return <span key={i} className="rp-place empty" />;
            const place = i === 1 ? 1 : i === 0 ? 2 : 3;
            return (
              <div key={r.id} className={`rp-place p${place}`}>
                <span className={`av rp-av ${avClass(r.name)}`}>{initials(r.name)}</span>
                <b>{r.name.split(" ")[0]}</b>
                <small>{metric(r)}</small>
                <div className="rp-step">{place}</div>
              </div>
            );
          })}
        </div>
      ) : <p className="r-empty">No calls in this period.</p>}
    </section>
  );
}

export default function CwtReports({ params }) {
  const crm = useCrm();
  const notify = useToast();
  const tab = params.tab || "leaderboard";
  const period = PERIODS.some(([k]) => k === params.period) ? params.period : "week";
  const periodLabel = PERIODS.find(([k]) => k === period)[1];

  const calls = useMemo(() => {
    if (!crm.state) return [];
    const [from, to] = periodRange(period);
    return crm.activities.filter((a) => a.type === "Call").filter((a) => { const t = callTime(a); return t >= from && t < to; });
  }, [crm.state, crm.activities, period]);

  const board = useMemo(() => {
    if (!crm.state) return [];
    const byUser = new Map();
    for (const a of calls) byUser.set(a.userId, [...(byUser.get(a.userId) || []), a]);
    return [...crm.users.values()].filter((u) => u.active !== false).map((u) => {
      const acts = byUser.get(u.id) || [];
      const mine = crm.leads.filter((l) => l.owner === u.id && !l.archived);
      return {
        id: u.id,
        name: u.name,
        leads: mine.length,
        won: mine.filter((l) => l.stage === "Closed" && l.disposition === "Won").length,
        calls: acts.length,
        connected: acts.filter((a) => (Number(a.duration) || 0) > 0).length,
        talk: acts.reduce((s, a) => s + (Number(a.duration) || 0), 0),
      };
    });
  }, [crm.state, crm.users, crm.leads, calls]);
  const byWon = useMemo(() => [...board].sort((a, b) => b.won - a.won || b.connected - a.connected), [board]);
  const byCalls = useMemo(() => [...board].sort((a, b) => b.connected - a.connected || b.calls - a.calls), [board]);

  const chart = useMemo(() => {
    const days = chartDays(period);
    const map = new Map(days.map((d) => [d, { made: 0, connected: 0 }]));
    if (crm.state) for (const a of crm.activities) {
      if (a.type !== "Call") continue;
      const slot = map.get(dayStart(callTime(a)));
      if (!slot) continue;
      slot.made++;
      if ((Number(a.duration) || 0) > 0) slot.connected++;
    }
    const max = Math.max(1, ...[...map.values()].map((v) => v.made));
    return { days: days.map((d) => ({ d, ...map.get(d) })), max };
  }, [crm.state, crm.activities, period]);

  const duplicates = useMemo(() => {
    const map = new Map();
    for (const l of crm.leads || []) { if (l.archived) continue; const key = `${String(l.name).trim().toLowerCase()}|${String(l.company || "").trim().toLowerCase()}`; map.set(key, [...(map.get(key) || []), l]); }
    return [...map.values()].filter((g) => g.length > 1);
  }, [crm.leads]);

  if (!crm.state) return <p className="muted">{crm.error || "Loading reports…"}</p>;
  const deleted = crm.leads.filter((l) => l.archived);
  const nameOf = (id) => crm.users.get(id)?.name || "";
  const tabs = [...R_TABS.map(([k, label]) => [hashFor("/reports", { tab: k, period: params.period }), label, tab === k]), ...(crm.me.lead ? [[hashFor("/team"), "Team today", false], [hashFor("/goals"), "Daily goals", false]] : [])];
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  const downloads = [
    ["leads", "All leads", "Every lead with its status, owner and source.", () => csvOf([["Name", "Phone", "Email", "Status", "Assignee", "Source", "Created On"], ...crm.leads.filter((l) => !l.archived).map((l) => [l.name, l.phone, l.email, statusOf(l), nameOf(l.owner), l.source, l.createdAt])])],
    ["calls", "Call log", "Every call the phones synced, with caller, direction and duration.", () => csvOf([["Lead", "Phone", "Caller", "Direction", "Duration (s)", "Started"], ...crm.calls.map((c) => [crm.leadById.get(c.leadId)?.name || "", c.phone, nameOf(c.owner), c.direction, c.duration, new Date(c.startedAt).toISOString()])])],
    ["status", "Status vs Assignee", "Lead counts per person and status.", () => { const steps = ["New", ...PIPELINE.map((d) => d.name)]; const rows = [...crm.users.values()].map((u) => [u.name, ...steps.map((s) => crm.leads.filter((l) => !l.archived && l.owner === u.id && statusOf(l) === s).length)]); return csvOf([["Assignee", ...steps], ...rows]); }],
  ];
  // the button next to the period downloads what the tab shows
  const current = {
    leaderboard: () => csvOf([["Rank", "Member", "Leads", "Won", `Calls (${periodLabel})`, "Connected", "Talk time (s)"], ...byWon.map((r, i) => [i + 1, r.name, r.leads, r.won, r.calls, r.connected, r.talk])]),
    calls: () => csvOf([["Rank", "Caller", "Leads", `Calls (${periodLabel})`, "Connected", "Connect rate %", "Talk time (s)", "Won"], ...byCalls.map((r, i) => [i + 1, r.name, r.leads, r.calls, r.connected, pct(r.connected, r.calls), r.talk, r.won])]),
    duplicates: () => csvOf([["Name", "Phones", "Assignees"], ...duplicates.map((g) => [g[0].name, g.map((l) => l.phone).join(" / "), [...new Set(g.map((l) => nameOf(l.owner) || "No owner"))].join(" / ")])]),
    deleted: () => csvOf([["Lead", "Phone", "Status", "Created"], ...deleted.map((l) => [l.name, l.phone, statusOf(l), l.createdAt])]),
  }[tab];
  async function restore(l) { try { await crmSend("PATCH", `leads/${l.id}`, { archived: false }); await crm.reload(); notify("Lead restored"); } catch (e) { notify(e.message); } }
  const periodLower = periodLabel.toLowerCase();
  const usesPeriod = tab === "leaderboard" || tab === "calls";

  return (
    <div className="r-page r-reports">
      <div className="r-head">
        <div className="r-title"><h1>Reports</h1><p>{HINTS[tab] ? HINTS[tab](periodLower) : ""}</p></div>
        {usesPeriod && (
          <label className="r-chip r-select lg">
            <select value={period} onChange={(e) => (location.hash = hashFor("/reports", { tab, period: e.target.value }))} aria-label="Period">
              {PERIODS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <TIcon name="chevronDown" />
          </label>
        )}
        {current && <button type="button" className="r-btn lg" onClick={() => saveCsv(`${tab}${usesPeriod ? `-${period}` : ""}.csv`, current())}><TIcon name="download" />Download CSV</button>}
      </div>
      <nav className="rp-tabs" aria-label="Reports">
        {tabs.map(([href, label, on]) => <a key={label} href={href} className={on ? "on" : ""} aria-current={on ? "page" : undefined}>{label}</a>)}
      </nav>

      {tab === "leaderboard" && (
        <>
          <Podium rows={byWon.filter((r) => r.won || r.connected).slice(0, 3)} title={`Top closers, calls ${periodLower}`} metric={(r) => `${r.won} won · ${r.connected} connected`} />
          <section className="r-card rp-table" aria-label="Leaderboard">
            <table>
              <thead><tr><th>#</th><th>MEMBER</th><th>LEADS</th><th>WON</th><th>CALLS</th><th>CONNECTED</th><th>TALK TIME</th></tr></thead>
              <tbody>{byWon.map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td><div className="rp-user"><span className={`av rp-av sm ${avClass(r.name)}`}>{initials(r.name)}</span><b>{r.name}</b></div></td>
                  <td>{r.leads}</td>
                  <td className={r.won ? "won" : "nil"}>{r.won}</td>
                  <td><b>{r.calls.toLocaleString("en-IN")}</b></td>
                  <td>{r.connected.toLocaleString("en-IN")} · {pct(r.connected, r.calls)}%</td>
                  <td>{talkText(r.talk)}</td>
                </tr>
              ))}{!byWon.length && <tr><td colSpan={7} className="r-empty">No team members yet.</td></tr>}</tbody>
            </table>
          </section>
        </>
      )}

      {tab === "calls" && (
        <>
          <div className="rp-top">
            <section className="r-card rp-chart" aria-label="Calls per day">
              <div className="rp-charthead">
                <h2>Calls per day</h2>
                <span className="rp-key made">Made</span>
                <span className="rp-key conn">Connected</span>
              </div>
              <div className={`rp-bars ${chart.days.length > 10 ? "dense" : ""}`}>
                {chart.days.map(({ d, made, connected }) => (
                  <div key={d} className={`rp-col ${d === dayStart(Date.now()) ? "today" : ""}`} title={`${new Date(d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}: ${made} made, ${connected} connected`}>
                    <div className="rp-pair">
                      <i className="made" style={{ height: `${(made / chart.max) * 100}%` }} />
                      <i className="conn" style={{ height: `${(connected / chart.max) * 100}%` }} />
                    </div>
                    {chart.days.length > 10 ? new Date(d).getDate() : new Date(d).toLocaleDateString("en-US", { weekday: "short" })}
                  </div>
                ))}
              </div>
            </section>
            <Podium rows={byCalls.filter((r) => r.connected).slice(0, 3)} title={`Top callers ${periodLower}`} metric={(r) => `${r.connected} connected`} />
          </div>
          <section className="r-card rp-table" aria-label="Call report by caller">
            <table>
              <thead><tr><th>#</th><th>CALLER</th><th>LEADS</th><th>CALLS</th><th>CONNECTED</th><th>TALK TIME</th><th>AVG CALL</th><th>WON</th></tr></thead>
              <tbody>{byCalls.map((r, i) => (
                <tr key={r.id}>
                  <td>{i + 1}</td>
                  <td><div className="rp-user"><span className={`av rp-av sm ${avClass(r.name)}`}>{initials(r.name)}</span><b>{r.name}</b></div></td>
                  <td>{r.leads}</td>
                  <td><b>{r.calls.toLocaleString("en-IN")}</b></td>
                  <td>{r.connected.toLocaleString("en-IN")} · {pct(r.connected, r.calls)}%</td>
                  <td>{talkText(r.talk)}</td>
                  <td>{talkText(r.connected ? Math.round(r.talk / r.connected) : 0)}</td>
                  <td className={r.won ? "won" : "nil"}>{r.won}</td>
                </tr>
              ))}{!byCalls.length && <tr><td colSpan={8} className="r-empty">No team members yet.</td></tr>}</tbody>
            </table>
          </section>
        </>
      )}

      {tab === "download" && (
        <div className="rp-downloads">
          {downloads.map(([id, name, desc, make]) => (
            <div key={id} className="r-card rp-dl">
              <span className="rp-dlic"><TIcon name="excel" /></span>
              <div><b>{name}</b><p>{desc}</p></div>
              <button type="button" className="r-btn ghost" onClick={() => saveCsv(`${id}.csv`, make())}><TIcon name="download" />Download CSV</button>
            </div>
          ))}
        </div>
      )}

      {tab === "duplicates" && (
        <section className="r-card rp-table" aria-label="Duplicate leads">
          <table>
            <thead><tr><th>NAME</th><th>PHONES</th><th>ASSIGNEES</th></tr></thead>
            <tbody>
              {duplicates.map((g) => <tr key={g[0].id}><td><b>{g[0].name}</b>{g[0].company ? <span className="rp-dim"> · {g[0].company}</span> : null}</td><td>{g.map((l) => l.phone).join(", ")}</td><td>{[...new Set(g.map((l) => nameOf(l.owner) || "No owner"))].join(", ")}</td></tr>)}
              {!duplicates.length && <tr><td colSpan={3} className="r-empty">No duplicate leads.</td></tr>}
            </tbody>
          </table>
        </section>
      )}

      {tab === "deleted" && (
        <section className="r-card rp-table" aria-label="Deleted leads">
          <table>
            <thead><tr><th>LEAD</th><th>PHONE</th><th>STATUS</th><th>CREATED</th><th /></tr></thead>
            <tbody>
              {deleted.map((l) => <tr key={l.id}><td><b>{l.name}</b></td><td>{l.phone}</td><td>{statusOf(l)}</td><td>{l.createdAt ? ago(Date.parse(l.createdAt)) : ""}</td><td className="r">{crm.me.lead && <button type="button" className="r-btn ghost sm" onClick={() => restore(l)}>Restore</button>}</td></tr>)}
              {!deleted.length && <tr><td colSpan={5} className="r-empty">No archived leads. Leads you archive show up here so you can restore them.</td></tr>}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
