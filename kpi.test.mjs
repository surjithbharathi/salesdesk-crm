import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createKpi, dailyEvents, POINTS } from "./kpi.mjs";

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
