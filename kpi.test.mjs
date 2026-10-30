import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createKpi, dailyEvents, levelFor, streaks, POINTS } from "./kpi.mjs";

// Monday 26 Oct 2026, 10:00 India (04:30 UTC). Day starts at 00:00 India = 18:30 UTC the day before.
const NOW = Date.parse("2026-10-26T08:00:00.000Z");
const DAY_START = Date.parse("2026-10-25T18:30:00.000Z");
const DAY_END = DAY_START + 86400000 - 1;
const at = (minutes) => Date.parse("2026-10-26T04:30:00.000Z") + minutes * 60000;

function fixture(t, store = {}) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const data = {
    users: [{ id: "u1", name: "Asha", active: true }, { id: "u2", name: "Ravi", active: true }],
    leads: [], mobileCalls: [], activities: [], tasks: [], ...store,
  };
  const kpi = createKpi({ db, all: (kind) => data[kind] || [], get: (kind, id) => (data[kind] || []).find((r) => r.id === id), deviceOwners: () => new Map([["d1", "u1"], ["d2", "u2"]]) });
  return { db, data, kpi };
}
const lead = (id, owner, over = {}) => ({ id, name: "Lead " + id, phone: "9840011111", owner, stage: "New", createdAt: "2026-10-20T10:00:00.000Z", ...over });
const call = (id, leadId, deviceId, minutes, duration, direction = "Outgoing") => ({ id, leadId, deviceId, startedAt: at(minutes), duration, direction });
const stage = (leadId, to, minutes, from = "Opportunity") => ({ id: "a" + leadId + to, leadId, type: "System", text: `Lead stage changed: ${from} → ${to}`, createdAt: new Date(at(minutes)).toISOString() });

test("points come from stored events; accidental pick-ups and repeated dial-and-hang-up score nothing", (t) => {
  const { kpi } = fixture(t, {
    leads: [lead("L1", "u1", { stage: "Closed", disposition: "Won" })],
    mobileCalls: [call("c1", "L1", "d1", 0, 120), call("c2", "L1", "d1", 5, 4), call("c3", "L1", "d1", 8, 0), call("c4", "L1", "d1", 9, 0), call("c5", "L1", "d1", 10, 0), call("c6", "L1", "d1", 11, 80, "Incoming")],
    activities: [stage("L1", "Quotation given", 20), stage("L1", "Closed", 30, "Quotation given")],
  });
  const day = kpi.myDay({ userId: "u1", now: NOW, dayStart: DAY_START, dayEnd: DAY_END });
  // answered 120s (1 call, answered), 4s pick-up ignored, two unanswered tries count, the third does not, incoming ignored
  assert.deepEqual([day.today.calls, day.today.answered, day.today.quotations, day.today.won], [3, 1, 1, 1]);
  assert.equal(day.today.points, 3 * POINTS.call + POINTS.answered + POINTS.quotation + POINTS.won);
  assert.equal(kpi.myDay({ userId: "u2", now: NOW, dayStart: DAY_START, dayEnd: DAY_END }).today.points, 0);
});

test("goals, streak, badges, late follow-ups and the next lead to call", (t) => {
  const { kpi, data } = fixture(t, {
    leads: [lead("L1", "u1", { firstTouchAt: "2026-10-21T10:00:00Z", stage: "Prospecting" }), lead("L2", "u1")],
    tasks: [{ id: "T1", leadId: "L1", owner: "u1", title: "Call again", due: "2026-10-20T05:00:00.000Z", status: "Open" }],
    mobileCalls: [call("c1", "L1", "d1", -30, 60), call("c2", "L1", "d1", 20, 60)],
  });
  kpi.setTarget({ metric: "calls", value: 2 });
  const day = kpi.myDay({ userId: "u1", now: NOW, dayStart: DAY_START, dayEnd: DAY_END });
  assert.equal(day.goal.calls, 2);
  assert.equal(day.streak, 1);
  assert.ok(day.badges.find((b) => b.id === "goal").earned);
  assert.ok(day.badges.find((b) => b.id === "early").earned); // 09:30 India
  assert.equal(day.lateLeft, 1);
  assert.equal(day.next.id, "L1");
  assert.equal(day.next.reason, "Follow-up is late");
  data.tasks[0].status = "Done"; // clearing it leaves the uncalled lead next
  const after = kpi.myDay({ userId: "u1", now: NOW, dayStart: DAY_START, dayEnd: DAY_END });
  assert.deepEqual([after.lateLeft, after.next.id, after.next.reason], [0, "L2", "Nobody has called yet"]);
});

test("leaderboard ranks by weekly points; the team view puts the person furthest from goal first; business counts orders by month", (t) => {
  const { kpi } = fixture(t, {
    leads: [lead("L1", "u1", { value: 100000, stage: "Closed", disposition: "Won" }), lead("L2", "u2", { value: 70000, stage: "Closed", disposition: "Won" })],
    mobileCalls: [call("c1", "L1", "d1", 0, 100), call("c2", "L1", "d1", 30, 100), call("c3", "L2", "d2", 0, 100)],
    activities: [
      { id: "w1", leadId: "L1", type: "System", text: "Lead stage changed: Quotation given → Closed", createdAt: "2026-10-05T05:00:00.000Z" },
      { id: "w2", leadId: "L2", type: "System", text: "Lead stage changed: Quotation given → Closed", createdAt: "2026-09-10T05:00:00.000Z" },
    ],
  });
  assert.deepEqual(kpi.leaderboard({ now: NOW }).map((r) => [r.name, r.rank, r.points]), [["Asha", 1, 4], ["Ravi", 2, 2]]);
  const team = kpi.team({ now: NOW, dayStart: DAY_START, dayEnd: DAY_END });
  assert.equal(team[0].name, "Ravi");
  const month = kpi.business({ monthStart: Date.parse("2026-10-01T00:00:00Z"), prevStart: Date.parse("2026-09-01T00:00:00Z"), nextStart: Date.parse("2026-11-01T00:00:00Z") });
  assert.deepEqual([month.thisMonth.n, month.thisMonth.value, month.lastMonth.n, month.lastMonth.value], [1, 100000, 1, 70000]);
  assert.equal(month.people[0].name, "Asha");
});

test("goals are whole numbers, per-person overrides can be removed, and dailyEvents buckets by local day", (t) => {
  const { kpi } = fixture(t);
  assert.throws(() => kpi.setTarget({ metric: "calls", value: -1 }), /whole number/);
  assert.throws(() => kpi.setTarget({ metric: "sales", value: 5 }), /Unknown goal/);
  assert.throws(() => kpi.setTarget({ scope: "nobody", metric: "calls", value: 5 }), /Unknown person/);
  kpi.setTarget({ metric: "calls", value: 50 });
  kpi.setTarget({ scope: "u1", metric: "calls", value: 25 });
  assert.deepEqual([kpi.goals("u1").calls, kpi.goals("u2").calls], [25, 50]);
  kpi.setTarget({ scope: "u1", metric: "calls", value: "" });
  assert.equal(kpi.goals("u1").calls, 50);
  // 23:30 India on the 25th and 00:30 India on the 26th are different local days
  const rows = dailyEvents({ leads: [lead("L1", "u1")], calls: [call("a", "L1", "d1", -630, 60), call("b", "L1", "d1", -570, 60)], activities: [], tasks: [], devices: new Map([["d1", "u1"]]) },
    { from: DAY_START - 86400000, to: DAY_END, tz: 330 });
  assert.deepEqual(rows.map((r) => r.day).sort(), ["2026-10-25", "2026-10-26"]);
});

test("levels rise with lifetime points and never fall", () => {
  assert.deepEqual([levelFor(0).name, levelFor(99).name, levelFor(100).name, levelFor(750).name], ["Starter", "Starter", "Dialer", "Negotiator"]);
  assert.equal(levelFor(100).toNext, 200); // 300 for Connector
  const top = levelFor(999999);
  assert.deepEqual([top.name, top.next, top.toNext], ["Legend", null, 0]);
});

test("streaks: the best run is kept after a break, today may be unfinished, and non-working days are skipped", () => {
  const ev = (day, calls, userId = "u1") => ({ userId, day, calls });
  const events = [ev("2026-10-19", 5), ev("2026-10-20", 5), ev("2026-10-21", 5), ev("2026-10-22", 1), ev("2026-10-24", 5), ev("2026-10-26", 1)];
  // 23 Oct has no calls from anyone, so it is not a working day; 22 Oct is a miss; today (26th) is still unfinished
  assert.deepEqual(streaks(events, "u1", 5, "2026-10-26"), { current: 1, best: 3 });
  assert.deepEqual(streaks(events, "u1", 5, "2026-10-27"), { current: 0, best: 3 }); // once the day has passed unmet, the run is over
  assert.deepEqual(streaks(events, "u1", 0, "2026-10-26"), { current: 0, best: 0 }); // no goal, no streak
});

test("my day carries level, lasting badges, weekly challenges, rank, the weekly winners and the team goal", (t) => {
  const { kpi } = fixture(t, {
    leads: [lead("L1", "u1", { stage: "Closed", disposition: "Won", value: 50000 }), lead("L2", "u2")],
    mobileCalls: [call("c1", "L1", "d1", 0, 90), call("c2", "L1", "d1", 30, 90), call("c3", "L2", "d2", 0, 90),
      { id: "old", leadId: "L1", deviceId: "d2", startedAt: Date.parse("2026-10-14T05:00:00Z"), duration: 120, direction: "Outgoing" }], // last week, Ravi
    activities: [stage("L1", "Quotation given", 20), stage("L1", "Closed", 40, "Quotation given")],
  });
  kpi.setTarget({ metric: "calls", value: 2 });
  const asha = kpi.myDay({ userId: "u1", now: NOW, dayStart: DAY_START, dayEnd: DAY_END });
  assert.equal(asha.lifetime.calls, 2);
  assert.equal(asha.lifetime.points, 2 * POINTS.call + 2 * POINTS.answered + POINTS.quotation + POINTS.won);
  assert.deepEqual([asha.level.level, asha.level.name], [1, "Starter"]);
  const first = Object.fromEntries(asha.milestones.map((m) => [m.id, m]));
  assert.ok(first["first-call"].earned && first["first-quote"].earned && first["first-order"].earned);
  assert.ok(!first["calls-100"].earned && first["calls-100"].value === 2 && first["calls-100"].target === 100);
  assert.equal(asha.week.rank, 1);
  assert.equal(asha.week.of, 2);
  assert.equal(asha.month.rank, 1);
  assert.equal(asha.weekBoard[0].name, "Asha");
  assert.deepEqual(asha.teamToday, { calls: 3, goal: 4 }); // the default goal of 2 applies to both people
  const orders = asha.challenges.find((c) => c.id === "wk-order");
  assert.ok(orders.done);
  assert.equal(asha.challenges.find((c) => c.id === "wk-calls").target, 10); // five working days at a goal of 2
  // the winner of the week before (12 to 18 Oct) is Ravi, who made the only call then
  assert.deepEqual(asha.hallOfFame.map((w) => [w.name, w.weekStart]), [["Ravi", "2026-10-12"]]);
  const ravi = kpi.myDay({ userId: "u2", now: NOW, dayStart: DAY_START, dayEnd: DAY_END });
  assert.equal(ravi.week.rank, 2);
});

test("a monthly leaderboard counts the whole month", (t) => {
  const { kpi } = fixture(t, {
    leads: [lead("L1", "u1"), lead("L2", "u2")],
    mobileCalls: [call("c1", "L1", "d1", 0, 90), { id: "early", leadId: "L2", deviceId: "d2", startedAt: Date.parse("2026-10-03T05:00:00Z"), duration: 90, direction: "Outgoing" }, { id: "early2", leadId: "L2", deviceId: "d2", startedAt: Date.parse("2026-10-05T05:00:00Z"), duration: 90, direction: "Outgoing" }],
  });
  assert.equal(kpi.leaderboard({ now: NOW, period: "week" })[0].name, "Asha");
  assert.equal(kpi.leaderboard({ now: NOW, period: "month" })[0].name, "Ravi"); // two earlier calls this month beat one call
});
