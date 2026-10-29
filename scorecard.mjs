// Scorecard numbers for callers, managers and the owner. Every figure is counted from stored events
// (calls, status changes, tasks), so points can always be reproduced and cannot be earned by tapping buttons.
export const POINTS = { call: 1, answered: 1, onTimeFollowUp: 3, quotation: 10, won: 50 };
export const MIN_CALL_SECONDS = 10; // an answered call shorter than this is an accidental pick-up and scores nothing
const DAY = 86400000;
const addMinutes = (iso, minutes) => new Date(Date.parse(iso) + minutes * 60000);
const KEYS = ["calls", "answered", "quotations", "won", "onTime", "points"];
const blank = () => ({ calls: 0, answered: 0, quotations: 0, won: 0, onTime: 0, points: 0 });
const sum = (list) => list.reduce((t, r) => { for (const k of KEYS) t[k] += r[k]; return t; }, blank());

export function createScorecard(db) {
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const ACTIVE = "l.archived_at IS NULL AND st.stage_group IN ('FRESH','ACTIVE')";

  function goals(userId) {
    const out = {};
    for (const row of all("SELECT metric,value FROM targets WHERE scope='default'")) out[row.metric] = row.value;
    for (const row of all("SELECT metric,value FROM targets WHERE scope=?", userId || "")) out[row.metric] = row.value;
    return out;
  }

  // Counts per user and local day in [from, to). `tz` is minutes ahead of UTC (India: 330).
  function events({ from, to, tz = 330, userId }) {
    const local = (col) => `date(${col}, '${tz >= 0 ? "+" : "-"}${Math.abs(tz)} minutes')`;
    const args = userId ? [userId] : [];
    const rows = new Map();
    const bucket = (user, day) => {
      const key = `${user}|${day}`;
      if (!rows.has(key)) rows.set(key, { userId: user, day, ...blank() });
      return rows.get(key);
    };
    // A call counts when it was answered for MIN_CALL_SECONDS or more, or is one of the first two unanswered
    // tries on the same lead that day. Accidental pick-ups and repeated dial-and-hang-up do not count.
    for (const r of all(
      `WITH c AS (
         SELECT user_id, connected, duration_seconds, ${local("started_at")} d,
                row_number() OVER (PARTITION BY user_id, lead_id, ${local("started_at")}, connected ORDER BY started_at) rn
           FROM calls
          WHERE user_id IS NOT NULL AND direction='Outgoing' AND started_at>=? AND started_at<?${userId ? " AND user_id=?" : ""})
       SELECT user_id u, d, count(*) n, sum(connected) a FROM c
        WHERE (connected=1 AND duration_seconds>=${MIN_CALL_SECONDS}) OR (connected=0 AND rn<=2) GROUP BY 1,2`, from, to, ...args)) {
      const b = bucket(r.u, r.d);
      b.calls = r.n;
      b.answered = r.a;
    }
    for (const r of all(
      `SELECT a.user_id u, ${local("a.occurred_at")} d,
              sum(json_extract(a.data,'$.to')='st_quotation') q,
              sum(json_extract(a.data,'$.to') IN (SELECT id FROM statuses WHERE stage_group='WON')) w
         FROM activities a WHERE a.type='status_change' AND a.user_id IS NOT NULL
          AND a.occurred_at>=? AND a.occurred_at<?${userId ? " AND a.user_id=?" : ""} GROUP BY 1,2`, from, to, ...args)) {
      const b = bucket(r.u, r.d);
      b.quotations = r.q || 0;
      b.won = r.w || 0;
    }
    for (const r of all(
      `SELECT owner_id u, ${local("completed_at")} d, count(*) n FROM tasks
        WHERE status='Done' AND owner_id IS NOT NULL AND completed_at<=due_at AND completed_at>=? AND completed_at<?${userId ? " AND owner_id=?" : ""}
        GROUP BY 1,2`, from, to, ...args))
      bucket(r.u, r.d).onTime = r.n;
    for (const b of rows.values())
      b.points = b.calls * POINTS.call + b.answered * POINTS.answered + b.onTime * POINTS.onTimeFollowUp + b.quotations * POINTS.quotation + b.won * POINTS.won;
    return [...rows.values()];
  }

  const localDate = (instant, tz) => addMinutes(instant, tz).toISOString().slice(0, 10);

  // Consecutive working days (days when anyone on the team called) on which this person met the calls goal.
  function streak(userId, now, tz, goal) {
    const from = new Date(Date.parse(now) - 61 * DAY).toISOString();
    const to = new Date(Date.parse(now) + DAY).toISOString();
    const mine = new Map(events({ from, to, tz, userId }).map((r) => [r.day, r]));
    const team = new Set(events({ from, to, tz }).filter((r) => r.calls > 0).map((r) => r.day));
    const today = localDate(now, tz);
    let count = 0;
    for (let i = 0; i < 60; i++) {
      const day = localDate(new Date(Date.parse(now) - i * DAY).toISOString(), tz);
      if (!team.has(day)) continue; // not a working day: neither breaks nor adds
      if (goal > 0 && (mine.get(day)?.calls || 0) >= goal) count++;
      else if (day !== today) break; // today is still in progress
    }
    return count;
  }

  function nextUp(userId, { dayStart, dayEnd }) {
    const pick = (where, args, order, reason) => {
      const lead = one(
        `SELECT l.id,l.name,l.company,l.city,l.phone_e164,l.product_interested,l.next_followup_at,st.label status
           FROM leads l JOIN statuses st ON st.id=l.status_id
          WHERE ${ACTIVE} AND l.owner_id=? AND l.phone_e164 IS NOT NULL AND ${where}
          ORDER BY ${order} LIMIT 1`, userId, ...args);
      return lead ? { ...lead, reason } : null;
    };
    return (
      pick("l.next_followup_at < ?", [dayStart], "l.next_followup_at", "Follow-up is late") ||
      pick("l.first_touch_at IS NULL", [], "l.captured_at", "Nobody has called yet") ||
      pick("l.next_followup_at >= ? AND l.next_followup_at <= ?", [dayStart, dayEnd], "l.next_followup_at", "Follow-up due today") ||
      null
    );
  }

  function weekRange(now, tz) {
    const local = addMinutes(now, tz);
    const monday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - ((local.getUTCDay() + 6) % 7)));
    const from = addMinutes(monday.toISOString(), -tz).toISOString();
    return { from, to: new Date(Date.parse(from) + 7 * DAY).toISOString() };
  }

  const lateCount = (userId, dayStart) =>
    one(`SELECT count(*) c FROM leads l JOIN statuses st ON st.id=l.status_id WHERE l.owner_id=? AND ${ACTIVE} AND l.next_followup_at < ?`, userId, dayStart).c;

  function myDay({ userId, now = new Date().toISOString(), dayStart, dayEnd, tz = 330 }) {
    dayStart ??= now.slice(0, 10) + "T00:00:00.000Z";
    dayEnd ??= now.slice(0, 10) + "T23:59:59.999Z";
    const goal = goals(userId);
    const today = sum(events({ from: dayStart, to: new Date(Date.parse(dayEnd) + 1).toISOString(), tz, userId }));
    const first = one(
      "SELECT min(started_at) t FROM calls WHERE user_id=? AND direction='Outgoing' AND started_at>=? AND started_at<=?",
      userId, dayStart, dayEnd);
    const firstHour = first.t ? addMinutes(first.t, tz).getUTCHours() : null;
    const lateLeft = lateCount(userId, dayStart);
    const week = weekRange(now, tz);
    const badges = [
      { id: "goal", label: "Daily goal reached", earned: goal.calls > 0 && today.calls >= goal.calls, hint: `Make ${goal.calls} calls today.` },
      { id: "early", label: "First call before 10 am", earned: firstHour !== null && firstHour < 10, hint: "Start your first call before 10 in the morning." },
      { id: "clear", label: "No late follow-ups", earned: lateLeft === 0, hint: "Clear every follow-up that is past due." },
      { id: "quote", label: "Quotation sent today", earned: today.quotations > 0, hint: "Move a lead to Quotation Shared." },
      { id: "won", label: "Order won today", earned: today.won > 0, hint: "Close an order." },
    ];
    return {
      goal, today, pointRules: POINTS, minCallSeconds: MIN_CALL_SECONDS,
      streak: streak(userId, now, tz, goal.calls),
      weekPoints: sum(events({ from: week.from, to: week.to, tz, userId })).points,
      lateLeft, next: nextUp(userId, { dayStart, dayEnd }), badges,
    };
  }

  // Weekly points by person. Points only, never rupees, so juniors are not compared on deal size.
  function leaderboard({ now = new Date().toISOString(), tz = 330 } = {}) {
    const { from, to } = weekRange(now, tz);
    const events_ = events({ from, to, tz });
    const rows = all("SELECT id,name FROM users WHERE active=1").map((u) => ({
      userId: u.id, name: u.name, ...sum(events_.filter((e) => e.userId === u.id)),
    }));
    rows.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    return rows.map((r, i) => ({ rank: i + 1, ...r }));
  }

  // One row per person for the manager, the person who needs the most help first.
  function team({ now = new Date().toISOString(), dayStart, dayEnd, tz = 330 } = {}) {
    dayStart ??= now.slice(0, 10) + "T00:00:00.000Z";
    dayEnd ??= now.slice(0, 10) + "T23:59:59.999Z";
    const today = events({ from: dayStart, to: new Date(Date.parse(dayEnd) + 1).toISOString(), tz });
    const rows = all("SELECT id,name FROM users WHERE active=1").map((u) => {
      const t = sum(today.filter((e) => e.userId === u.id));
      const goalCalls = goals(u.id).calls;
      const untouched = one(`SELECT count(*) c FROM leads l JOIN statuses st ON st.id=l.status_id WHERE l.owner_id=? AND ${ACTIVE} AND l.first_touch_at IS NULL`, u.id).c;
      return { userId: u.id, name: u.name, goalCalls, ...t, late: lateCount(u.id, dayStart), untouched, goalShare: goalCalls ? Math.min(1, t.calls / goalCalls) : null };
    });
    rows.sort((a, b) => (a.goalShare ?? 1) - (b.goalShare ?? 1) || b.late - a.late);
    return rows;
  }

  const allTargets = () => all("SELECT scope,metric,value FROM targets ORDER BY scope,metric");

  return { goals, events, myDay, leaderboard, team, allTargets };
}
