import React, { useMemo, useState } from "react";
import { useCrm } from "../crm.jsx";
import { hashFor } from "../format.js";
import Icon from "../icons.jsx";
import { DAY, HOUR, STAGES, ago, buildModel, hms, initials, money, smoothPath, startOfDay } from "./model.js";

// The "Dashboards" screen in the Salesmax style, laid out like the reference web app and filled from this CRM's own records.

const STAGE_KEY = { New: "new", Prospecting: "pro", Opportunity: "opp", Closed: "closed" };
const LEGEND = [["New", "new"], ["Prospecting", "pro"], ["Opportunity", "opp"], ["Closed", "closed"]];
const W = (n) => `cw-w-${Math.max(0, Math.min(100, Math.round(n)))}`;
const SOURCES = ["IndiaMART", "JustDial", "Facebook Ads", "Google Ads", "Website", "WhatsApp", "Referral", "Walk-in"];
const SHOW = {
  default: ["kpi", "plan", "overall", "users", "trend", "pulse", "sources", "owners", "donuts"],
  activity: ["overall", "users", "trend", "pulse"],
  sources: ["sources", "donuts"],
  users: ["owners", "users"],
  attendance: ["attendance"],
};
const go = (to, params) => { location.hash = hashFor(to, params); };

function Seg({ value, options, onChange, small, label }) {
  return (
    <div className={`seg ${small ? "seg--sm" : ""}`} role="group" aria-label={label}>
      {options.map(([key, text]) => <button key={key} type="button" className={value === key ? "on" : ""} onClick={() => onChange(key)}>{text}</button>)}
    </div>
  );
}

function stack(leads) {
  const bucket = (l) => (l.stage === "Won" || l.stage === "Lost" ? "Closed" : l.stage);
  const parts = ["New", "Prospecting", "Opportunity", "Closed"].map((s) => ({ s, n: leads.filter((l) => bucket(l) === s).length })).filter((x) => x.n);
  const total = parts.reduce((s, p) => s + p.n, 0) || 1;
  return parts.map((p) => ({ ...p, pct: (p.n / total) * 100 }));
}

function Bars({ rows, owner }) {
  return rows.map((r) => (
    <div key={r.key} className={`bar ${owner ? "bar--owner" : ""}`}>
      <span className="bar__label">{r.key}</span>
      <span className="bar__track"><span className={`bar__fill ${W(r.w)}`}>{r.stack.map((x) => <i key={x.s} className={`cw-sw-${STAGE_KEY[x.s]} ${W(x.pct)}`} title={`${x.s}: ${x.n}`} />)}</span></span>
      <b className="bar__n">{r.n}</b>
      {!owner && <small className={`bar__d ${r.delta >= 0 ? "good" : "bad"}`}>{r.delta >= 0 ? "+" : ""}{r.delta}%</small>}
    </div>
  ));
}

function arcs(segs) {
  const total = segs.reduce((s, x) => s + x.value, 0);
  if (!total) return [];
  const live = segs.filter((s) => s.value);
  const gap = live.length > 1 ? 0.035 : 0;
  const R = 104, r = 62, c = 110;
  const p = (rad, ang) => `${(c + rad * Math.cos(ang)).toFixed(2)},${(c + rad * Math.sin(ang)).toFixed(2)}`;
  let a0 = -Math.PI / 2;
  return live.map((s) => {
    const sweep = (s.value / total) * Math.PI * 2;
    const from = a0 + gap / 2;
    let to = a0 + sweep - gap / 2;
    a0 += sweep;
    to = Math.max(from + 0.001, to);
    if (to - from >= Math.PI * 2 - 0.01) to = from + Math.PI * 2 - 0.01;
    const large = to - from > Math.PI ? 1 : 0;
    return { d: `M${p(R, from)} A${R},${R} 0 ${large} 1 ${p(R, to)} L${p(r, to)} A${r},${r} 0 ${large} 0 ${p(r, from)} Z`, color: s.color, label: s.label, value: s.value };
  });
}

export default function Dashboard({ tab = "default" }) {
  const crm = useCrm();
  const [now, setNow] = useState(Date.now());
  const [planScope, setPlanScope] = useState("all");
  const [trendMode, setTrendMode] = useState("hourly");
  const [userQuery, setUserQuery] = useState("");
  const [staleOnly, setStaleOnly] = useState(false);
  const [sourceRange, setSourceRange] = useState(30);
  const [ownerSource, setOwnerSource] = useState("");
  const m = useMemo(() => (crm.state ? buildModel(crm) : null), [crm.state, crm.leads, crm.activities, crm.users, crm.nextDue]);
  const show = (part) => (SHOW[tab] || SHOW.default).includes(part);

  const d = useMemo(() => {
    if (!m) return null;
    const today = startOfDay(now);
    const acts = m.allActivities.filter((a) => a.at <= now);
    const todayActs = acts.filter((a) => a.at >= today);
    const weekActs = acts.filter((a) => a.at >= today - 7 * DAY && a.at < today);
    const leads = m.leads;

    // top row: one card per stage
    const total = Math.max(leads.length, 1);
    const workedToday = (l) => l.activities.some((a) => a.at >= today);
    const newToday = leads.filter((l) => l.createdAt >= today);
    const uncontacted = newToday.filter((l) => !l.activities.some((a) => a.kind === "call" || a.kind === "whatsapp"));
    const pros = leads.filter((l) => l.stage === "Prospecting" && workedToday(l));
    const opp = leads.filter((l) => l.stage === "Opportunity" && workedToday(l));
    const closed = leads.filter((l) => (l.stage === "Won" || l.stage === "Lost") && l.activities.some((a) => a.kind === "stage" && a.at >= today));
    const card = (n, label, foot, stage) => ({ n, pct: ((n / total) * 100).toFixed(1).replace(/\.0$/, ""), label, foot, stage });
    const kpis = [
      card(newToday.length, "New Lead Added", `Remained Uncontacted ${uncontacted.length}`, "New"),
      card(pros.length, "Need Discussion Worked", `In Progress ${pros.length}`, "Prospecting"),
      card(opp.length, "Interested Worked", `In Progress ${opp.length}`, "Opportunity"),
      card(closed.length, "Closed", `Won ${closed.filter((l) => l.stage === "Won").length}`, "Closed"),
    ];

    // today's plan
    const mine = planScope === "my";
    const planLeads = leads.filter((l) => !mine || l.owner === m.me);
    const ids = new Set(planLeads.map((l) => l.id));
    const recent = acts.filter((a) => ids.has(a.lead.id) && a.at >= today - 7 * DAY);
    const missed = recent.filter((a) => a.kind === "call" && a.dir === "in" && !a.connected);
    const missedLeads = [...new Map(missed.map((a) => [a.lead.id, a])).values()];
    const calledBack = missedLeads.filter((x) => x.lead.activities.some((a) => a.kind === "call" && a.dir === "out" && a.at > x.at));
    const open = (l) => l.stage !== "Won" && l.stage !== "Lost";
    const overdue = planLeads.filter((l) => l.nextFollowUp !== null && l.nextFollowUp < today && open(l));
    const dueToday = planLeads.filter((l) => l.nextFollowUp !== null && l.nextFollowUp >= today && l.nextFollowUp < today + DAY);
    const dueDone = dueToday.filter((l) => l.activities.some((a) => a.at >= today));
    const fresh = planLeads.filter((l) => l.stage === "New" && l.createdAt >= today - 7 * DAY);
    const freshCalled = fresh.filter((l) => l.activities.some((a) => a.kind === "call"));
    const repeat = planLeads.filter((l) => l.repeat || l.activities.filter((a) => a.kind === "call" && a.dir === "in" && a.at >= today - 7 * DAY).length >= 2);
    const plan = [
      { icon: "missed", tone: "orange", title: "Calls you missed", sub: "Calls from leads that were not answered in the last 7 days", n: missedLeads.length, done: calledBack.length, color: "pk", to: ["/engagements"] },
      { icon: "alert", tone: "amber", title: "Overdue follow-ups", sub: "Follow-ups that passed their date in the last 30 days", n: overdue.length, done: 0, color: "pk", to: ["/todo"] },
      { icon: "calendar", tone: "plain", title: "Scheduled follow-ups today", sub: "Follow-ups a rep set for today", n: dueToday.length, done: dueDone.length, color: "gr", to: ["/todo"] },
      { icon: "userplus", tone: "plain", title: "New leads", sub: "Came in during the last 7 days, not called yet", n: fresh.length - freshCalled.length, done: freshCalled.length, total: fresh.length, color: "pk", to: ["/leads", { queue: "new" }] },
      { icon: "again", tone: "plain", title: "Repeat enquiries", sub: "Leads that came back in the last 7 days", n: repeat.length, done: 0, total: repeat.length, color: "pk", to: ["/leads"] },
    ].map((p) => ({ ...p, total: p.total ?? p.n, pct: (p.total ?? p.n) ? Math.round((p.done / (p.total ?? p.n)) * 100) : 0 }));

    // overall activities
    const calls = (xs) => xs.filter((a) => a.kind === "call");
    const rows = [
      ["phone", "Call with Lead Logged", calls], ["incoming", "Connected Calls Logged", (xs) => calls(xs).filter((a) => a.connected)],
      ["outgoing", "Outgoing Call Logged", (xs) => calls(xs).filter((a) => a.dir === "out")], ["outgoing", "Connected Outgoing", (xs) => calls(xs).filter((a) => a.dir === "out" && a.connected)],
      ["incoming", "Incoming Call Logged", (xs) => calls(xs).filter((a) => a.dir === "in")], ["incoming", "Connected Incoming", (xs) => calls(xs).filter((a) => a.dir === "in" && a.connected)],
      ["clock", "Total Call Duration", calls, true], ["clock", "Incoming Call Duration", (xs) => calls(xs).filter((a) => a.dir === "in"), true],
      ["clock", "Outgoing Call Duration", (xs) => calls(xs).filter((a) => a.dir === "out"), true],
      ["chat", "WhatsApp Messages Sent", (xs) => xs.filter((a) => a.kind === "whatsapp")], ["edit", "Notes Added", (xs) => xs.filter((a) => a.kind === "note")],
      ["trend", "Stage Changes", (xs) => xs.filter((a) => a.kind === "stage")],
    ];
    const secs = (xs) => xs.reduce((s, a) => s + (a.secs || 0), 0);
    const overall = rows.map(([icon, label, f, dur]) => {
      const day = f(todayActs), week = f(weekActs);
      return { icon, label, day: dur ? (secs(day) ? hms(secs(day)) : "0") : String(day.length), zero: dur ? !secs(day) : !day.length, week: dur ? hms(Math.round(secs(week) / 7)) : String(+(week.length / 7).toFixed(1)) };
    });

    // user activity
    const describe = (a) => {
      const at = new Date(a.at);
      const stamp = `${String(at.getDate()).padStart(2, "0")}/${String(at.getMonth() + 1).padStart(2, "0")}/${at.getFullYear()}, ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
      if (a.kind === "call") {
        const dur = hms(a.secs || 0, true);
        if (!a.connected) return a.dir === "in" ? `${a.by} missed a call from ${a.lead.name} at ${stamp}.` : `${a.by} called ${a.lead.name} at ${stamp}, not answered.`;
        return a.dir === "in" ? `${a.by} received a ${dur} duration call from ${a.lead.name} at ${stamp}.` : `${a.by} made a ${dur} duration call to ${a.lead.name} at ${stamp}.`;
      }
      if (a.kind === "whatsapp") return `${a.by} sent a WhatsApp message to ${a.lead.name}`;
      if (a.kind === "visit") return `${a.by} logged a visit to ${a.lead.name}`;
      if (a.kind === "note") return `${a.by} added a note for ${a.lead.name.split(" ")[0]}`;
      return `${a.by} moved ${a.lead.name}, ${a.text.replace("Stage changed ", "")}`;
    };
    const users = m.team.map((name) => {
      const last = acts.find((a) => a.by === name);
      return { name, last, active: !!last && last.at >= today, stale: !last || last.at < today - 2 * DAY, text: last ? describe(last) : "" };
    });

    // calling trend
    const callActs = acts.filter((a) => a.kind === "call");
    const TW = 1160, TH = 330, L = 50, R = 20, T = 14, B = 34;
    let buckets = [];
    if (trendMode === "hourly") {
      const endHour = Math.min(20, Math.max(13, new Date(now).getHours()));
      for (let h = 8; h <= endHour; h++) {
        const inHour = (a, day) => a.at >= day + h * HOUR && a.at < day + (h + 1) * HOUR;
        const cur = callActs.filter((a) => inHour(a, today));
        buckets.push({ label: `${String(h).padStart(2, "0")}:30`, con: cur.filter((a) => a.connected).length, un: cur.filter((a) => !a.connected).length, prev: callActs.filter((a) => inHour(a, today - DAY)).length });
      }
    } else {
      for (let k = 29; k >= 0; k--) {
        const day = today - k * DAY, dd = new Date(day);
        const cur = callActs.filter((a) => a.at >= day && a.at < day + DAY);
        buckets.push({ label: k % 5 === 0 ? `${dd.getDate()}/${dd.getMonth() + 1}` : "", con: cur.filter((a) => a.connected).length, un: cur.filter((a) => !a.connected).length, prev: callActs.filter((a) => a.at >= day - 30 * DAY && a.at < day - 29 * DAY).length });
      }
    }
    const max = Math.max(1, ...buckets.map((b) => Math.max(b.con + b.un, b.prev)));
    const step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : 10;
    const top = Math.ceil(max / step) * step;
    const cw = (TW - L - R) / buckets.length;
    const y = (v) => T + (TH - T - B) * (1 - v / top);
    const bw = Math.min(28, cw * 0.32);
    const bars = buckets.flatMap((b, i) => {
      const cx = L + cw * (i + 0.5), out = [];
      if (b.con) out.push({ x: cx - bw - 1, y: y(b.con), w: bw, h: y(0) - y(b.con), c: "#800080" });
      if (b.un) out.push({ x: cx + 1, y: y(b.un), w: bw, h: y(0) - y(b.un), c: "#94a3b8" });
      return out;
    });
    const tot = buckets.reduce((s, b) => s + b.con + b.un, 0), con = buckets.reduce((s, b) => s + b.con, 0);
    const prevAll = callActs.filter((a) => a.at >= today - DAY && a.at < today);
    const prevPick = prevAll.length ? (prevAll.filter((a) => a.connected).length / prevAll.length) * 100 : 0;
    const pick = tot ? (con / tot) * 100 : 0;
    const trend = {
      W: TW, H: TH, L, R, B, bars, ticks: Array.from({ length: top / step + 1 }, (_, i) => ({ v: i * step, y: y(i * step) })),
      labels: buckets.map((b, i) => ({ x: L + cw * (i + 0.5), t: b.label })), prev: smoothPath(buckets.map((b, i) => [L + cw * (i + 0.5), y(b.prev)])),
      pickup: pick.toFixed(1), delta: (pick - prevPick).toFixed(1), up: pick >= prevPick,
    };

    // team pulse
    const weekAgo = today - 7 * DAY;
    const work = acts.filter((a) => a.kind !== "stage");
    const PW = 1180, PH = 280, PT = 12, PB = 32;
    const hours = Array.from({ length: 13 }, (_, i) => 8 + i);
    const cum = (day, h) => work.filter((a) => a.at >= day && a.at < day + (h + 1) * HOUR).length;
    const nowHour = Math.min(20, new Date(now).getHours());
    const todayLine = hours.filter((h) => h <= nowHour).map((h) => ({ h, v: cum(today, h) }));
    const lastLine = hours.map((h) => ({ h, v: cum(weekAgo, h) }));
    const pmax = Math.max(5, ...todayLine.map((p) => p.v), ...lastLine.map((p) => p.v));
    const ptop = Math.ceil(pmax / 5) * 5;
    const px = (h) => L + ((PW - L - R) * (h - 8)) / 12;
    const py = (v) => PT + (PH - PT - PB) * (1 - v / ptop);
    const todayPts = todayLine.map((p) => [px(p.h), py(p.v)]);
    const line = smoothPath(todayPts);
    const done = todayActs.filter((a) => a.kind !== "stage").length;
    const sameNow = cum(weekAgo, nowHour);
    const callsT = todayActs.filter((a) => a.kind === "call").length;
    const callsW = work.filter((a) => a.kind === "call" && a.at >= weekAgo && a.at < weekAgo + (nowHour + 1) * HOUR).length;
    const hourLabel = (h) => (h === 12 ? "12p" : h > 12 ? `${h - 12}p` : `${h}a`);
    const pulse = {
      W: PW, H: PH, line, area: todayPts.length ? `${line} L${todayPts.at(-1)[0]},${py(0)} L${todayPts[0][0]},${py(0)} Z` : "", last: smoothPath(lastLine.map((p) => [px(p.h), py(p.v)])),
      ticks: Array.from({ length: ptop / 5 + 1 }, (_, i) => ({ v: i * 5, y: py(i * 5) })), hours: hours.filter((h) => h % 2 === 0).map((h) => ({ x: px(h), t: hourLabel(h) })),
      done, pct: sameNow ? Math.round(((done - sameNow) / sameNow) * 100) : 0, ahead: done >= sameNow, weekday: new Date(weekAgo).toLocaleDateString("en-IN", { weekday: "long" }),
      calls: callsT, callsPct: callsW ? Math.round(((callsT - callsW) / callsW) * 100) : 0, convos: todayActs.filter((a) => a.kind === "whatsapp").length,
      won: todayActs.filter((a) => a.kind === "stage" && a.lead.stage === "Won").length,
    };

    // where leads came from, and who got them
    const inRange = (l, back = 0) => {
      const end = today + DAY - back * sourceRange * DAY;
      return l.createdAt >= end - sourceRange * DAY && l.createdAt < end;
    };
    const cur = leads.filter((l) => inRange(l)), prev = leads.filter((l) => inRange(l, 1));
    const names = [...new Set([...SOURCES, ...leads.map((l) => l.source)])];
    const srcRows = names.map((src) => {
      const mineL = cur.filter((l) => l.source === src), before = prev.filter((l) => l.source === src).length;
      return { key: src, n: mineL.length, stack: stack(mineL), delta: before ? Math.round(((mineL.length - before) / before) * 100) : mineL.length ? 100 : 0 };
    }).filter((r) => r.n).sort((a, b) => b.n - a.n).slice(0, 10);
    const smax = Math.max(1, ...srcRows.map((r) => r.n));
    const sources = { rows: srcRows.map((r) => ({ ...r, w: (r.n / smax) * 100 })), total: cur.length, delta: prev.length ? Math.round(((cur.length - prev.length) / prev.length) * 100) : 0, fastest: [...srcRows].sort((a, b) => b.delta - a.delta)[0], names };
    const ownerLeads = leads.filter((l) => !ownerSource || l.source === ownerSource);
    const ownRows = m.team.map((name) => { const mineL = ownerLeads.filter((l) => l.owner === name); return { key: name, n: mineL.length, stack: stack(mineL) }; }).sort((a, b) => b.n - a.n);
    const omax = Math.max(1, ...ownRows.map((r) => r.n));
    const owners = { rows: ownRows.map((r) => ({ ...r, w: (r.n / omax) * 100 })), total: ownRows.reduce((s, r) => s + r.n, 0) };

    // stage donuts
    const age = (l) => (today - startOfDay(l.createdAt)) / DAY;
    const P = ["#800080", "#a64ca6", "#c785cf", "#64748b", "#94a3b8", "#cbd5e1"];
    const make = (title, stage, icon, tone, note, list, groups) => {
      const segs = groups.map(([label, f], i) => ({ label, value: list.filter(f).length, color: P[i % P.length], ix: i % P.length }));
      return { title, stage, total: list.length, icon, tone, note, segs, arcs: arcs(segs) };
    };
    const donuts = [
      make("In New Lead Stage", "New", "userplus", "violet", "All new leads as on today, with a break-up of when they came in.", leads.filter((l) => l.stage === "New"), [
        ["Unassigned", (l) => !l.owner], ["8-15 Days", (l) => !!l.owner && age(l) >= 8 && age(l) <= 15], [">30 Days", (l) => !!l.owner && age(l) > 30],
        ["2-7 Days", (l) => !!l.owner && age(l) >= 2 && age(l) < 8], ["15-30 Days", (l) => !!l.owner && age(l) > 15 && age(l) <= 30], ["<1 Day", (l) => !!l.owner && age(l) < 2]]),
      make("In Need Discussion Stage", "Prospecting", "funnel", "blue", "Leads in discussion as on today where reps are still understanding requirements.", leads.filter((l) => l.stage === "Prospecting"), [
        ["Follow-up overdue", (l) => l.nextFollowUp !== null && l.nextFollowUp < today], ["Follow-up scheduled", (l) => l.nextFollowUp !== null && l.nextFollowUp >= today], ["No outcome yet", (l) => l.nextFollowUp === null]]),
      make("In Interested Stage", "Opportunity", "rupee", "green", "Leads that are interested or have a quotation out, broken down by deal size.", leads.filter((l) => l.stage === "Opportunity"), [
        ["Above ₹5L", (l) => l.value > 500000], ["₹2L – ₹5L", (l) => l.value >= 200000 && l.value <= 500000], ["Under ₹2L", (l) => l.value < 200000]]),
      make("In Closed Stage", "Closed", "square", "slate", "Leads that exited the funnel as on today, broken down by outcome.", leads.filter((l) => l.stage === "Won" || l.stage === "Lost"), [
        ["Opportunity Lost", (l) => l.stage === "Lost"], ["Opportunity Won", (l) => l.stage === "Won"]]),
    ];

    const attendance = m.team.map((name) => {
      const mineA = todayActs.filter((a) => a.by === name);
      const first = mineA.length ? Math.min(...mineA.map((a) => a.at)) : null, last = mineA.length ? Math.max(...mineA.map((a) => a.at)) : null;
      return { name, first, last, count: mineA.length, present: mineA.length > 0, hours: first && last ? ((last - first) / HOUR).toFixed(1) : "—" };
    });
    return { kpis, plan, overall, users, trend, pulse, sources, owners, donuts, attendance };
  }, [m, now, planScope, trendMode, sourceRange, ownerSource]);

  if (!crm.state) return <p className="muted">{crm.error || "Loading the dashboard…"}</p>;
  const q = userQuery.trim().toLowerCase();
  const usersShown = d.users.filter((u) => !q || u.name.toLowerCase().includes(q));
  const activeCount = d.users.filter((u) => u.active).length, staleCount = d.users.filter((u) => u.stale).length;
  const time = (t) => (t === null ? "—" : new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
  const tr = d.trend, pl = d.pulse;
  return (
    <div className="cw-dash">
      {show("kpi") && (
        <section className="kpis">
          {d.kpis.map((k) => (
            <button key={k.label} type="button" className="card kpi" onClick={() => go("/leads", k.stage === "New" ? { queue: "new" } : {})}>
              <b className="kpi__n">{k.n}</b>
              <span className="kpi__label">{k.n ? <span>{k.pct}% · </span> : null}{k.label}</span>
              {k.n ? <><span className="kpi__bar"><span className="cw-w-100">{k.n}</span></span><span className="kpi__foot"><i />{k.foot}</span></> : null}
            </button>
          ))}
        </section>
      )}

      {(show("plan") || show("overall") || show("users")) && (
        <section className={`row3 ${!show("plan") ? "row3--two" : ""}`}>
          {show("plan") && (
            <div className="card plan">
              <header className="card__head"><h2>Today's plan <small className="tag">Customize</small></h2><Seg value={planScope} options={[["all", "All"], ["my", "My"]]} onChange={setPlanScope} label="Whose plan" /></header>
              <div className="card__scroll">
                <button type="button" className="adhoc" onClick={() => go("/todo")}>
                  <Icon name="task" size={16} />
                  <span className="adhoc__body"><b>Ad-hoc tasks</b><small><Icon name="check" size={14} /> No tasks for today</small></span>
                  <span className="adhoc__links"><b>Open tasks</b><span>Today</span></span>
                </button>
                {d.plan.map((p) => (
                  <button key={p.title} type="button" className="plan__item" onClick={() => go(...p.to)}>
                    <span className={`plan__ic plan__ic--${p.tone}`}><Icon name={p.icon} size={13} /></span>
                    <span className="plan__text"><b>{p.title}</b><small>{p.sub}</small></span>
                    <b className="plan__n">{p.n}</b>
                    {p.total ? <><span className="plan__track"><span className={`${W(p.pct)} cw-fill-${p.color}`} /></span><small className="plan__frac">{p.done}/{p.total}</small></> : null}
                  </button>
                ))}
              </div>
            </div>
          )}
          {show("overall") && (
            <div className="card overall">
              <header className="card__head"><h2>Overall Activities</h2></header>
              <div className="card__scroll">
                <table className="metrics">
                  <thead><tr><th>Metric</th><th>Day</th><th>Week Average</th></tr></thead>
                  <tbody>
                    {d.overall.map((r) => (
                      <tr key={r.label} onClick={() => go("/engagements")}>
                        <td><span className="metrics__ic"><Icon name={r.icon} size={15} /></span>{r.label}</td>
                        <td className={r.zero ? "zero" : ""}>{r.day}</td><td>{r.week}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {show("users") && (
            <div className="card users">
              <header className="card__head">
                <h2>User Activity <small className="muted-num"><b>{activeCount}/{m.team.length}</b> active · 0 yet to join</small></h2>
                <input className="users__search" type="search" placeholder="Search By Name" aria-label="Search by name" value={userQuery} onChange={(e) => setUserQuery(e.target.value)} />
              </header>
              {staleCount > 0 && <div className="users__warn"><span><b>{staleCount}</b> users inactive for over 2 days</span><button type="button" onClick={() => setStaleOnly(!staleOnly)}>{staleOnly ? "View all" : "View inactive"}</button></div>}
              <div className="card__scroll">
                {usersShown.filter((u) => !staleOnly || u.stale).map((u) => (
                  <div key={u.name} className="user">
                    <span className={`user__ava ${u.active ? "user__ava--on" : ""}`}>{initials(u.name)}</span>
                    <b className="user__name">{u.name}</b>
                    {u.last ? (
                      <>
                        <button type="button" className="user__what" onClick={() => go("/leads", { lead: u.last.lead.id })}><Icon name={u.last.kind === "call" ? "phone" : u.last.kind === "whatsapp" ? "chat" : "task"} size={14} /> <span>{u.text}</span></button>
                        <span className="user__when"><Icon name="clock" size={14} /> {ago(u.last.at, now)}</span>
                      </>
                    ) : <><span className="user__what"><span>--</span></span><span className="user__when">--</span></>}
                  </div>
                ))}
                {!usersShown.length && <p className="empty">No one matches that name.</p>}
              </div>
            </div>
          )}
        </section>
      )}

      {(show("trend") || show("pulse")) && (
        <section className="row2">
          {show("trend") && (
            <div className="card trend">
              <header className="card__head card__head--top">
                <div>
                  <h2><Icon name="phone" size={15} /> Calling Trend <span className="light">{trendMode === "hourly" ? "Today, hourly" : "Last 30 days"}</span></h2>
                  <p className="trend__pick">Pickup: {tr.pickup}% <span className={tr.up ? "good" : "bad"}>{tr.up ? "+" : ""}{tr.delta}pp</span></p>
                </div>
                <Seg small value={trendMode} options={[["hourly", "Hourly"], ["days", "30 Days"]]} onChange={setTrendMode} label="Range" />
              </header>
              <div className="legend legend--center"><span><i className="sw cw-sw-pk" />Connected Calls</span><span><i className="sw cw-sw-sl" />Unconnected Calls</span><span><i className="dash" />Previous Period</span></div>
              <div className="plot trend__plot">
                <svg className="chart" viewBox={`0 0 ${tr.W} ${tr.H}`} role="img" aria-label="Calls by hour">
                  {tr.ticks.map((t) => <g key={t.v}><line x1={tr.L} x2={tr.W - tr.R} y1={t.y} y2={t.y} className="grid" /><text x={tr.L - 8} y={t.y + 4} className="svgx svgx--y">{t.v}</text></g>)}
                  {tr.bars.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill={b.c} />)}
                  <path d={tr.prev} className="prev" />
                  <line x1={tr.L} x2={tr.W - tr.R} y1={tr.H - tr.B} y2={tr.H - tr.B} className="base" />
                  {tr.labels.filter((l) => l.t).map((l, i) => <text key={i} x={l.x} y={tr.H - tr.B + 18} className="svgx svgx--x">{l.t}</text>)}
                </svg>
              </div>
            </div>
          )}
          {show("pulse") && (
            <div className="card pulse">
              <header className="card__head card__head--top">
                <div>
                  <h2><Icon name="trend" size={15} /> Team pulse today</h2>
                  <p className="pulse__big"><b>{pl.done}</b> activities <span className={`badge ${pl.ahead ? "" : "badge--bad"}`}>{pl.ahead ? "Ahead of pace" : "Behind pace"}</span> <span className={pl.pct >= 0 ? "good" : "bad"}>{pl.pct >= 0 ? "+" : ""}{pl.pct}%</span></p>
                </div>
                <div className="pulse__meta"><span>vs Last {pl.weekday}</span><span className="legend"><span><i className="dot cw-sw-pk" />Today</span><span><i className="dot cw-sw-sl" />Previous</span></span></div>
              </header>
              <div className="pulse__plot">
                <svg className="chart" viewBox={`0 0 ${pl.W} ${pl.H}`} role="img" aria-label="Team activity through the day">
                  <defs><linearGradient id="pulseFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#800080" stopOpacity=".22" /><stop offset="1" stopColor="#800080" stopOpacity="0" /></linearGradient></defs>
                  {pl.ticks.map((t) => <g key={t.v}><line x1={tr.L} x2={pl.W - tr.R} y1={t.y} y2={t.y} className="grid" /><text x={tr.L - 8} y={t.y + 4} className="svgx svgx--y">{t.v}</text></g>)}
                  <path d={pl.area} fill="url(#pulseFill)" />
                  <path d={pl.last} className="prev prev--light" />
                  <path d={pl.line} className="today" />
                  {pl.hours.map((h) => <text key={h.t} x={h.x} y={pl.H - 10} className="svgx svgx--x">{h.t}</text>)}
                </svg>
              </div>
              <footer className="pulse__foot">
                <div><small>Calls</small><b>{pl.calls}</b>{pl.callsPct ? <em className={pl.callsPct > 0 ? "good" : "bad"}>{pl.callsPct > 0 ? "+" : ""}{pl.callsPct}%</em> : null}</div>
                <div><small>Conversations</small><b>{pl.convos}</b></div>
                <div><small>Deals Won</small><b>{pl.won}</b></div>
              </footer>
            </div>
          )}
        </section>
      )}

      {(show("sources") || show("owners")) && (
        <section className={`row2 ${!(show("sources") && show("owners")) ? "row2--one" : ""}`}>
          {show("sources") && (
            <div className="card bars">
              <header className="card__head card__head--top">
                <div><h2>Where leads came from</h2><p className="bars__total"><b>{d.sources.total}</b> <span className={d.sources.delta >= 0 ? "good" : "bad"}>{d.sources.delta >= 0 ? "+" : ""}{d.sources.delta}% vs last period</span></p></div>
                <div className="bars__tools">
                  <button type="button" className="link-strong" onClick={() => go("/leads")}>View Detailed</button>
                  <select className="plain-select" aria-label="Period" value={sourceRange} onChange={(e) => setSourceRange(+e.target.value)}><option value="1">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select>
                </div>
              </header>
              <div className="bars__list"><Bars rows={d.sources.rows} />{!d.sources.rows.length && <p className="empty">No leads came in during this period.</p>}</div>
              <footer className="card__foot">
                <span>{d.sources.fastest ? <>Fastest growing: <b>{d.sources.fastest.key} ({d.sources.fastest.delta >= 0 ? "+" : ""}{d.sources.fastest.delta}%)</b></> : null}</span>
                <span className="legend">{LEGEND.map(([l, k]) => <span key={l}><i className={`sq cw-sw-${k}`} />{l}</span>)}</span>
              </footer>
            </div>
          )}
          {show("owners") && (
            <div className="card bars">
              <header className="card__head card__head--top">
                <h2>Who got them <b className="bars__big">{d.owners.total}</b> <button type="button" className="link-strong" onClick={() => go("/leads", { queue: "unassigned" })}>Assign More Leads</button></h2>
                <select className="box-select" aria-label="Lead source" value={ownerSource} onChange={(e) => setOwnerSource(e.target.value)}><option value="">All sources</option>{d.sources.names.map((s) => <option key={s} value={s}>{s}</option>)}</select>
              </header>
              <div className="bars__list bars__list--owners"><Bars rows={d.owners.rows} owner /></div>
              <footer className="card__foot"><span>Team total: <b>{d.owners.total}</b></span><span className="legend">{LEGEND.map(([l, k]) => <span key={l}><i className={`sq cw-sw-${k}`} />{l}</span>)}</span></footer>
            </div>
          )}
        </section>
      )}

      {show("donuts") && (
        <section className="donuts">
          {d.donuts.map((x) => (
            <div key={x.title} className="card donut">
              <button type="button" className="donut__head" onClick={() => go(x.stage === "Opportunity" ? "/deals" : "/leads", x.stage === "New" ? { queue: "new" } : {})}>
                <span className={`donut__ic donut__ic--${x.tone}`}><Icon name={x.icon} size={16} /></span>
                <span><b className="donut__n">{x.total}</b><small> Leads</small><span className="donut__title">{x.title}</span></span>
              </button>
              <div className="donut__plot">
                <svg viewBox="0 0 220 220" role="img" aria-label={x.title}>
                  {x.arcs.map((a) => <path key={a.label} d={a.d} fill={a.color}><title>{a.label}: {a.value}</title></path>)}
                  {!x.arcs.length && <circle cx="110" cy="110" r="83" fill="none" stroke="#ece4ef" strokeWidth="42" />}
                </svg>
              </div>
              <div className="legend legend--wrap">{x.segs.map((sg) => <span key={sg.label} className={sg.value ? "" : "off"}><i className={`sw cw-p${sg.ix}`} />{sg.label}</span>)}</div>
              <p className="donut__note">{x.note}</p>
            </div>
          ))}
        </section>
      )}

      {show("attendance") && (
        <section className="card attendance">
          <header className="card__head"><h2>Attendance <small className="muted-num">Today · first and last activity logged by each teammate</small></h2></header>
          <table className="metrics metrics--att">
            <thead><tr><th>Teammate</th><th>Status</th><th>First activity</th><th>Last activity</th><th>Active hours</th><th>Activities</th></tr></thead>
            <tbody>
              {d.attendance.map((a) => (
                <tr key={a.name}>
                  <td><span className={`user__ava ${a.present ? "user__ava--on" : ""}`}>{initials(a.name)}</span>{a.name}</td>
                  <td><span className={`pill-s ${a.present ? "pill-s--on" : ""}`}>{a.present ? "Present" : "Absent"}</span></td>
                  <td>{time(a.first)}</td><td>{time(a.last)}</td><td>{a.hours}</td><td>{a.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
