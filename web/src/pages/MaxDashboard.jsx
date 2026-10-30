import React, { useMemo, useState } from "react";
import { useCrm } from "../crm.jsx";
import { hashFor, initials } from "../format.js";
import Icon from "../icons.jsx";
import { ms } from "./tele.js";

// The dashboard of the "Salesmax style" skin: four tiles for the week (new leads, and leads moved to Discussion, Interested and Closed),
// then a work pipeline of what needs doing, then who has been active. All counted from this CRM's own records.

const DAY = 86400000;
const startOfToday = () => new Date().setHours(0, 0, 0, 0);
const MOVE = /^Lead stage changed: .* → (.+)$/;

function change(now, before) {
  if (!before) return now ? { text: "New", up: true } : null;
  const pct = Math.round(((now - before) / before) * 100);
  return { text: `${pct > 0 ? "+" : ""}${pct}%`, up: pct >= 0 };
}

function Tile({ label, value, before, meter }) {
  const delta = change(value, before);
  const up = !delta || delta.up;
  return (
    <div className="max-tile">
      <div className="max-tile-top">
        <div className="max-tile-main">
          <span className={`max-tile-icon ${up ? "up" : ""}`}><Icon name={up ? "spark" : "again"} size={16} /></span>
          <span><b className="max-num num">{value}</b><small>{label}</small></span>
        </div>
        {delta && <span className={`max-chip ${delta.up ? "up" : ""}`} title="Compared with the 7 days before">{delta.text}</span>}
      </div>
      {meter ? (
        <div className="max-meter" role="img" aria-label={`${meter[0]} worked, ${meter[1]} not yet`}>
          {meter[0] > 0 && <span className={`seg-worked w-${Math.max(5, Math.min(95, Math.round((meter[0] / (meter[0] + meter[1])) * 20) * 5))}`}>{meter[0]}</span>}
          {meter[1] > 0 && <span className="seg-open">{meter[1]}</span>}
        </div>
      ) : null}
    </div>
  );
}

function Row({ icon, title, note, count, done, total, to, clear }) {
  const share = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <li>
      <a className="max-row" href={to}>
        <span className="max-row-icon"><Icon name={icon} size={14} /></span>
        <b>{title}</b>
        <span className="max-count num">{count}</span>
        {count === 0 && clear ? <span className="max-row-clear">All caught up</span> : <small>{note}</small>}
        {total > 0 && <span className="max-progress" role="img" aria-label={`${done} of ${total} worked`}><i className={`w-${Math.round(share / 5) * 5}`} /></span>}
      </a>
    </li>
  );
}

export default function MaxDashboard({ meta }) {
  const crm = useCrm();
  const [scope, setScope] = useState("all");
  const me = meta.id;
  const view = useMemo(() => {
    if (!crm.state) return null;
    const now = Date.now();
    const week = now - 7 * DAY, before = now - 14 * DAY, today = startOfToday();
    const mine = (l) => scope === "all" || l.owner === me;
    const leads = crm.leads.filter((l) => !l.archived && mine(l));
    const created = (from, to) => leads.filter((l) => ms(l.createdAt) >= from && ms(l.createdAt) < to);
    const newNow = created(week, now + 1), newBefore = created(before, week);
    const moved = (to, from, until) => {
      const seen = new Set();
      for (const a of crm.activities) {
        const t = ms(a.createdAt);
        if (a.type !== "System" || !(t >= from && t < until)) continue;
        const m = MOVE.exec(a.text || "");
        const lead = crm.leadById.get(a.leadId);
        if (m && m[1] === to && lead && mine(lead)) seen.add(a.leadId);
      }
      return seen.size;
    };
    const tasksToday = crm.openTasks.filter((t) => (scope === "all" || t.owner === me) && ms(t.due) >= today && ms(t.due) < today + DAY);
    const yetNew = newNow.filter((l) => !l.firstTouchAt);
    const assigned = leads.filter((l) => l.owner && l.stage !== "New" && l.stage !== "Closed" && ms(l.createdAt) >= week && !l.firstTouchAt);
    const repeat = leads.filter((l) => l.repeat && ms(l.updatedAt || l.createdAt) >= week);
    return {
      tiles: [
        ["New lead added", newNow.length, newBefore.length, [newNow.length - yetNew.length, yetNew.length]],
        ["Need discussion worked", moved("Prospecting", week, now + 1), moved("Prospecting", before, week)],
        ["Interested worked", moved("Opportunity", week, now + 1), moved("Opportunity", before, week)],
        ["Closed", moved("Closed", week, now + 1), moved("Closed", before, week)],
      ],
      tasksToday, yetNew, newNow, assigned, repeat,
    };
  }, [crm.state, crm.leads, crm.activities, crm.openTasks, scope, me]);

  const today = startOfToday();
  const people = useMemo(() => {
    if (!crm.state) return [];
    return [...crm.users.values()].filter((u) => u.active !== false).map((u) => {
      const calls = crm.calls.filter((c) => crm.leadById.get(c.leadId)?.owner === u.id && ms(c.startedAt) >= today);
      return { id: u.id, name: u.name, calls: calls.length };
    }).sort((a, b) => b.calls - a.calls);
  }, [crm.state, crm.users, crm.calls, today]);
  const [find, setFind] = useState("");
  if (!view) return <p className="muted">{crm.error || "Loading the dashboard…"}</p>;
  const active = people.filter((p) => p.calls > 0).length;
  return (
    <>
      <div className="max-tiles">
        {view.tiles.map(([label, value, before, meter]) => <Tile key={label} label={label} value={value} before={before} meter={meter} />)}
      </div>

      <section className="max-card" aria-label="Work pipeline">
        <header className="max-card-head">
          <h2>Work pipeline <small>Customize</small></h2>
          {crm.me.lead && (
            <span className="max-toggle" role="group" aria-label="Whose work">
              {[["all", "All"], ["mine", "My"]].map(([key, label]) => <button key={key} aria-pressed={scope === key} onClick={() => setScope(key)}>{label}</button>)}
            </span>
          )}
        </header>
        <ul className="max-rows">
          <li className="max-adhoc">
            <a className="max-row" href={hashFor("/todo")}>
              <span className="max-row-icon"><Icon name="task" size={14} /></span>
              <b>Ad-hoc tasks</b>
              <span className="max-add">+ Add</span>
              {view.tasksToday.length === 0 ? <span className="max-row-clear">No tasks for today</span> : <small>{view.tasksToday.length} due today</small>}
            </a>
          </li>
          <Row icon="leads" title="New leads" note="New leads received within the last 7 days, yet to be worked" count={view.yetNew.length} done={view.newNow.length - view.yetNew.length} total={view.newNow.length} to={hashFor("/leads", { queue: "untouched" })} clear />
          <Row icon="people" title="Newly assigned leads" note="Other assigned leads from the last 7 days, yet to be worked" count={view.assigned.length} to={hashFor("/leads")} clear />
          <Row icon="again" title="Repeat enquiries" note="Leads that came back within the last 7 days" count={view.repeat.length} to={hashFor("/leads")} clear />
          <Row icon="task" title="Follow-ups for today" note="Calls and messages scheduled for today" count={view.tasksToday.length} to={hashFor("/todo")} clear />
        </ul>
      </section>

      <div className="max-split">
        <section className="max-card" aria-label="Overall activities">
          <header className="max-card-head"><h2>Overall activities</h2><span className="muted">Today</span></header>
          <ul className="max-activity">
            <li><Icon name="phone" size={16} /><span>Calls made</span><b className="num">{people.reduce((s, p) => s + p.calls, 0)}</b></li>
            <li><Icon name="people" size={16} /><span>People who called</span><b className="num">{active}</b></li>
            <li><Icon name="leads" size={16} /><span>Open leads</span><b className="num">{crm.leads.filter(crm.isOpen).length}</b></li>
          </ul>
        </section>
        <section className="max-card" aria-label="User activity">
          <header className="max-card-head">
            <h2>User activity <small>{active}/{people.length} active</small></h2>
            <input className="max-search" type="search" placeholder="Search by name" aria-label="Search by name" value={find} onChange={(e) => setFind(e.target.value)} />
          </header>
          <ul className="max-activity">
            {people.filter((p) => !find || p.name.toLowerCase().includes(find.toLowerCase())).map((p) => (
              <li key={p.id}><span className="avatar">{initials(p.name)}</span><span>{p.name}</span><b className="num">{p.calls} calls</b></li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
