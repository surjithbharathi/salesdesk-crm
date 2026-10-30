// KPI scorecard for callers, managers and the owner, counted from the CRM's existing records
// (leads, mobileCalls, activities, tasks). Nothing here is stored except the daily goals, so every number can be
// reproduced from the data, and points cannot be earned by tapping buttons.
export const POINTS = { call: 1, answered: 1, onTimeFollowUp: 3, quotation: 10, won: 50 };
export const MIN_CALL_SECONDS = 10;
const DAY = 86400000;
const OPEN_STAGES = (lead) => lead.stage !== "Closed" && !lead.archived;
const DEFAULT_GOALS = { calls: 40, answered: 12, quotations: 3 };
const GOAL_KEYS = Object.keys(DEFAULT_GOALS);
const KEYS = ["calls", "answered", "quotations", "won", "onTime", "points"];
const blank = () => ({ calls: 0, answered: 0, quotations: 0, won: 0, onTime: 0, points: 0 });
const sum = (rows) => rows.reduce((t, r) => { for (const k of KEYS) t[k] += r[k]; return t; }, blank());
const ms = (value) => (typeof value === "number" ? value : Date.parse(value));
const localDay = (time, tz) => new Date(time + tz * 60000).toISOString().slice(0, 10);

// Pure: turns raw records into per-person, per-local-day counts between `from` and `to` (milliseconds, to exclusive).
export function dailyEvents({ leads, calls, activities, tasks, devices = new Map() }, { from, to, tz = 330 }) {
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const rows = new Map();
  const bucket = (userId, time) => {
    const day = localDay(time, tz);
    const key = `${userId}|${day}`;
    if (!rows.has(key)) rows.set(key, { userId, day, ...blank() });
    return rows.get(key);
  };
  // Who made a call: the person whose phone logged it, else the lead's owner.
  const callerOf = (call, lead) => devices.get(call.deviceId) || lead?.owner || call.owner;
  const tries = new Map();
  for (const call of [...calls].sort((a, b) => ms(a.startedAt) - ms(b.startedAt))) {
    const at = ms(call.startedAt);
    if (!(at >= from && at < to) || call.direction !== "Outgoing") continue;
    const lead = leadById.get(call.leadId);
    const userId = callerOf(call, lead);
    if (!userId) continue;
    const answered = call.duration > 0;
    if (answered) {
      if (call.duration < MIN_CALL_SECONDS) continue; // accidental pick-up
      const b = bucket(userId, at);
      b.calls++;
      b.answered++;
    } else {
      const key = `${userId}|${call.leadId}|${localDay(at, tz)}`;
      tries.set(key, (tries.get(key) || 0) + 1);
      if (tries.get(key) <= 2) bucket(userId, at).calls++; // only the first two unanswered tries on a lead per day
    }
  }
  for (const a of activities) {
    const at = ms(a.createdAt);
    if (!(at >= from && at < to) || a.type !== "System") continue;
    const change = /^Lead stage changed: .* → (.+)$/.exec(a.text || "");
    if (!change) continue;
    const lead = leadById.get(a.leadId);
    const userId = a.userId || lead?.owner;
    if (!userId) continue;
    if (change[1] === "Quotation given") bucket(userId, at).quotations++;
    else if (change[1] === "Closed" && lead?.disposition === "Won") bucket(userId, at).won++;
  }
  for (const t of tasks) {
    if (t.status !== "Done" || !t.owner) continue;
    const doneAt = ms(t.completedAt || t.updatedAt);
    if (!(doneAt >= from && doneAt < to) || !(doneAt <= ms(t.due))) continue;
    bucket(t.owner, doneAt).onTime++;
  }
  for (const b of rows.values())
    b.points = b.calls * POINTS.call + b.answered * POINTS.answered + b.onTime * POINTS.onTimeFollowUp + b.quotations * POINTS.quotation + b.won * POINTS.won;
  return [...rows.values()];
}

// Levels come from lifetime points, so they only ever rise. The names follow a machinery sale from first call to closing.
export const LEVELS = [[0, "Starter"], [100, "Dialer"], [300, "Connector"], [700, "Negotiator"], [1500, "Quote Maker"], [3000, "Deal Closer"], [6000, "Senior Closer"], [10000, "Champion"], [20000, "Legend"]];
export function levelFor(points) {
  let i = 0;
  LEVELS.forEach(([floor], k) => { if (points >= floor) i = k; });
  const next = LEVELS[i + 1];
  return { level: i + 1, name: LEVELS[i][1], points, floor: LEVELS[i][0], next: next ? next[0] : null, nextName: next ? next[1] : null, toNext: next ? next[0] - points : 0 };
}
// Lasting badges, earned once from lifetime counts (or the best streak) and kept.
const MILESTONES = [
  ["first-call", "First call", "calls", 1, "Make your first call."], ["calls-100", "100 calls", "calls", 100, "Make 100 calls."],
  ["calls-500", "500 calls", "calls", 500, "Make 500 calls."], ["calls-1000", "1,000 calls", "calls", 1000, "Make 1,000 calls."],
  ["first-quote", "First quotation", "quotations", 1, "Give your first quotation."], ["quotes-10", "10 quotations", "quotations", 10, "Give 10 quotations."],
  ["quotes-50", "50 quotations", "quotations", 50, "Give 50 quotations."], ["first-order", "First order won", "won", 1, "Win your first order."],
  ["orders-5", "5 orders won", "won", 5, "Win 5 orders."], ["orders-25", "25 orders won", "won", 25, "Win 25 orders."],
  ["streak-7", "7 days in a row", "best", 7, "Meet the calls goal 7 working days in a row."], ["streak-30", "30 days in a row", "best", 30, "Meet the calls goal 30 working days in a row."],
];
// Current and best run of working days (days anyone called) on which the person met the calls goal. Today may still be unfinished.
export function streaks(events, userId, goal, todayKey) {
  const mine = new Map();
  const team = new Set();
  for (const e of events) {
    if (e.calls > 0) team.add(e.day);
    if (e.userId === userId) mine.set(e.day, e);
  }
  let run = 0, best = 0;
  for (const day of [...team].sort()) {
    if (goal > 0 && (mine.get(day)?.calls || 0) >= goal) best = Math.max(best, ++run);
    else if (day !== todayKey) run = 0;
  }
  return { current: run, best };
}

function weekRange(now, tz) {
  const local = new Date(now + tz * 60000);
  const monday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - ((local.getUTCDay() + 6) % 7)) - tz * 60000;
  return { from: monday, to: monday + 7 * DAY };
}

export function createKpi({ db, all, get, put, deviceOwners = () => new Map() }) {
  db.exec("CREATE TABLE IF NOT EXISTS kpi_targets(scope TEXT NOT NULL, metric TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY(scope, metric))");
  const data = () => ({ leads: all("leads"), calls: all("mobileCalls"), activities: all("activities"), tasks: all("tasks"), devices: deviceOwners() });
  const activeUsers = () => all("users").filter((u) => u.active !== false);

  function goals(userId) {
    const out = { ...DEFAULT_GOALS };
    for (const row of db.prepare("SELECT metric,value FROM kpi_targets WHERE scope='default'").all()) out[row.metric] = row.value;
    if (userId) for (const row of db.prepare("SELECT metric,value FROM kpi_targets WHERE scope=?").all(userId)) out[row.metric] = row.value;
    return out;
  }
  function allTargets() {
    return db.prepare("SELECT scope,metric,value FROM kpi_targets ORDER BY scope,metric").all();
  }
  function setTarget({ scope = "default", metric, value }) {
    if (!GOAL_KEYS.includes(metric)) throw Object.assign(new Error("Unknown goal"), { status: 400 });
    if (scope !== "default" && !get("users", scope)) throw Object.assign(new Error("Unknown person"), { status: 400 });
    if (scope !== "default" && (value === "" || value === null)) db.prepare("DELETE FROM kpi_targets WHERE scope=? AND metric=?").run(scope, metric);
    else {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > 1000) throw Object.assign(new Error("A goal is a whole number from 0 to 1000"), { status: 400 });
      db.prepare("INSERT INTO kpi_targets(scope,metric,value) VALUES(?,?,?) ON CONFLICT(scope,metric) DO UPDATE SET value=excluded.value").run(scope, metric, n);
    }
    return { targets: allTargets() };
  }

  function lateCount(d, userId, dayStart) {
    const open = new Set(d.leads.filter((l) => l.owner === userId && OPEN_STAGES(l)).map((l) => l.id));
    const late = new Set(d.tasks.filter((t) => t.owner === userId && !["Done", "Cancelled"].includes(t.status) && t.leadId && open.has(t.leadId) && ms(t.due) < dayStart).map((t) => t.leadId));
    return late.size;
  }

  function nextUp(d, userId, dayStart, dayEnd) {
    const mine = d.leads.filter((l) => l.owner === userId && OPEN_STAGES(l) && l.phone);
    const byId = new Map(mine.map((l) => [l.id, l]));
    const dueTasks = d.tasks.filter((t) => t.owner === userId && !["Done", "Cancelled"].includes(t.status) && byId.has(t.leadId)).sort((a, b) => ms(a.due) - ms(b.due));
    const pick = (lead, reason) => (lead ? { id: lead.id, name: lead.name, company: lead.company || "", city: lead.city || "", phone: lead.phone, product: lead.product || "", stage: lead.stage, reason } : null);
    const late = dueTasks.find((t) => ms(t.due) < dayStart);
    if (late) return pick(byId.get(late.leadId), "Follow-up is late");
    const fresh = mine.filter((l) => !l.firstTouchAt).sort((a, b) => ms(a.createdAt) - ms(b.createdAt))[0];
    if (fresh) return pick(fresh, "Nobody has called yet");
    const today = dueTasks.find((t) => ms(t.due) >= dayStart && ms(t.due) <= dayEnd);
    return today ? pick(byId.get(today.leadId), "Follow-up due today") : null;
  }

  // Everything that needs history: level, lasting badges, this week's challenges, the month and the weekly winners. One pass over the records.
  function progress(d, userId, now, tz, goal) {
    const all = dailyEvents(d, { from: 0, to: now + DAY, tz });
    const between = (from, to) => { const a = localDay(from, tz), b = localDay(to - 1, tz); return all.filter((e) => e.day >= a && e.day <= b); };
    const mineIn = (rows) => sum(rows.filter((e) => e.userId === userId));
    const life = mineIn(all);
    const { current, best } = streaks(all, userId, goal.calls, localDay(now, tz));
    const week = weekRange(now, tz);
    const wk = mineIn(between(week.from, week.to));
    const local = new Date(now + tz * 60000);
    const monthFrom = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - tz * 60000;
    const monthTo = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - tz * 60000;
    const people = activeUsers();
    const rank = (rows) => {
      const scored = people.map((u) => ({ userId: u.id, name: u.name, ...sum(rows.filter((e) => e.userId === u.id)) })).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
      return scored.map((r, i) => ({ rank: i + 1, ...r }));
    };
    const weekRows = rank(between(week.from, week.to)), monthRows = rank(between(monthFrom, monthTo));
    const place = (rows) => ({ rank: rows.find((r) => r.userId === userId)?.rank || null, of: rows.length, points: rows.find((r) => r.userId === userId)?.points || 0 });
    const challenges = [
      { id: "wk-calls", label: "Calls this week", value: wk.calls, target: goal.calls * 5, unit: "calls" },
      { id: "wk-answered", label: "Customers reached", value: wk.answered, target: goal.answered * 5, unit: "answered calls" },
      { id: "wk-quotes", label: "Quotations out", value: wk.quotations, target: goal.quotations * 3, unit: "quotations" },
      { id: "wk-order", label: "Win an order", value: wk.won, target: 1, unit: "orders" },
    ].filter((c) => c.target > 0).map((c) => ({ ...c, done: c.value >= c.target }));
    const counts = { calls: life.calls, quotations: life.quotations, won: life.won, best };
    const milestones = MILESTONES.map(([id, label, key, target, hint]) => ({ id, label, hint, target, value: Math.min(counts[key], target), earned: counts[key] >= target }));
    // The top scorer of each of the last four finished weeks, only when they scored.
    const hallOfFame = [1, 2, 3, 4].map((k) => {
      const from = week.from - k * 7 * DAY, rows = rank(between(from, from + 7 * DAY));
      return rows[0]?.points > 0 ? { weekStart: localDay(from, tz), userId: rows[0].userId, name: rows[0].name, points: rows[0].points } : null;
    }).filter(Boolean);
    return {
      level: levelFor(life.points), lifetime: { calls: life.calls, answered: life.answered, quotations: life.quotations, won: life.won, points: life.points },
      streak: current, bestStreak: best, weekPoints: wk.points,
      week: place(weekRows), month: place(monthRows), weekBoard: weekRows.slice(0, 10), challenges, milestones, hallOfFame,
    };
  }

  function myDay({ userId, now = Date.now(), dayStart, dayEnd, tz = 330 }) {
    const d = data();
    dayStart ??= Math.floor((now + tz * 60000) / DAY) * DAY - tz * 60000;
    dayEnd ??= dayStart + DAY - 1;
    const goal = goals(userId);
    const dayRows = dailyEvents(d, { from: dayStart, to: dayEnd + 1, tz });
    const today = sum(dayRows.filter((e) => e.userId === userId));
    const crew = activeUsers();
    const teamToday = { calls: sum(dayRows.filter((e) => crew.some((u) => u.id === e.userId))).calls, goal: crew.reduce((s, u) => s + goals(u.id).calls, 0) };
    const firstCall = d.calls
      .filter((c) => c.direction === "Outgoing" && ms(c.startedAt) >= dayStart && ms(c.startedAt) <= dayEnd && (d.devices.get(c.deviceId) || d.leads.find((l) => l.id === c.leadId)?.owner) === userId)
      .map((c) => ms(c.startedAt)).sort((a, b) => a - b)[0];
    const firstHour = firstCall === undefined ? null : new Date(firstCall + tz * 60000).getUTCHours();
    const lateLeft = lateCount(d, userId, dayStart);
    return {
      goal, today, pointRules: POINTS, minCallSeconds: MIN_CALL_SECONDS, teamToday,
      ...progress(d, userId, now, tz, goal),
      lateLeft, next: nextUp(d, userId, dayStart, dayEnd),
      badges: [
        { id: "goal", label: "Daily goal reached", earned: goal.calls > 0 && today.calls >= goal.calls, hint: `Make ${goal.calls} calls today.` },
        { id: "early", label: "First call before 10 am", earned: firstHour !== null && firstHour < 10, hint: "Start your first call before 10 in the morning." },
        { id: "clear", label: "No late follow-ups", earned: lateLeft === 0, hint: "Clear every follow-up that is past due." },
        { id: "quote", label: "Quotation given today", earned: today.quotations > 0, hint: "Move a lead to Quotation given." },
        { id: "won", label: "Order won today", earned: today.won > 0, hint: "Close an order." },
      ],
    };
  }

  function leaderboard({ now = Date.now(), tz = 330, period = "week" } = {}) {
    let range = weekRange(now, tz);
    if (period === "month") {
      const local = new Date(now + tz * 60000);
      range = { from: Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - tz * 60000, to: Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - tz * 60000 };
    }
    const events = dailyEvents(data(), { ...range, tz });
    const rows = activeUsers().map((u) => ({ userId: u.id, name: u.name, ...sum(events.filter((e) => e.userId === u.id)) }));
    rows.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    return rows.map((r, i) => ({ rank: i + 1, ...r }));
  }

  function team({ now = Date.now(), dayStart, dayEnd, tz = 330 } = {}) {
    const d = data();
    dayStart ??= Math.floor((now + tz * 60000) / DAY) * DAY - tz * 60000;
    dayEnd ??= dayStart + DAY - 1;
    const events = dailyEvents(d, { from: dayStart, to: dayEnd + 1, tz });
    const rows = activeUsers().map((u) => {
      const t = sum(events.filter((e) => e.userId === u.id));
      const goalCalls = goals(u.id).calls;
      const untouched = d.leads.filter((l) => l.owner === u.id && OPEN_STAGES(l) && !l.firstTouchAt).length;
      return { userId: u.id, name: u.name, goalCalls, ...t, late: lateCount(d, u.id, dayStart), untouched, goalShare: goalCalls ? Math.min(1, t.calls / goalCalls) : null };
    });
    rows.sort((a, b) => (a.goalShare ?? 1) - (b.goalShare ?? 1) || b.late - a.late);
    return rows;
  }

  // Orders won and their value this month and last, and per person this month. An order is counted in the month the lead was closed as Won.
  function business({ monthStart, prevStart, nextStart }) {
    const d = data();
    const won = d.activities
      .filter((a) => a.type === "System" && /^Lead stage changed: .* → Closed$/.test(a.text || ""))
      .map((a) => ({ lead: d.leads.find((l) => l.id === a.leadId), at: ms(a.createdAt) }))
      .filter((x) => x.lead?.disposition === "Won");
    const within = (from, to) => won.filter((x) => x.at >= from && x.at < to);
    const total = (list) => ({ n: new Set(list.map((x) => x.lead.id)).size, value: [...new Map(list.map((x) => [x.lead.id, x.lead])).values()].reduce((s, l) => s + (Number(l.value) || 0), 0) });
    const events = dailyEvents(d, { from: monthStart, to: nextStart, tz: 330 });
    const thisMonth = within(monthStart, nextStart);
    const people = activeUsers().map((u) => {
      const mine = thisMonth.filter((x) => x.lead.owner === u.id);
      const t = sum(events.filter((e) => e.userId === u.id));
      return { id: u.id, name: u.name, calls: t.calls, quotations: t.quotations, ...(({ n, value }) => ({ orders: n, value }))(total(mine)) };
    }).sort((a, b) => b.value - a.value || b.orders - a.orders || a.name.localeCompare(b.name));
    return { thisMonth: total(thisMonth), lastMonth: total(within(prevStart, monthStart)), people };
  }

  return { goals, allTargets, setTarget, myDay, leaderboard, team, business };
}
