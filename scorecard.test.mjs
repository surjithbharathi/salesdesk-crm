import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { migrate } from "./db-migrate.mjs";
import { createStore } from "./store.mjs";
import { createScorecard, POINTS } from "./scorecard.mjs";

const migrations = fileURLToPath(new URL("./migrations/", import.meta.url));
// Monday 2026-10-26, 10:00 India time is 04:30 UTC.
const MONDAY = "2026-10-26T04:30:00.000Z";
const DAY_START = "2026-10-25T18:30:00.000Z"; // 00:00 India on Monday
const DAY_END = "2026-10-26T18:29:59.999Z";
let n = 0;

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  t.after(() => db.close());
  migrate(db, migrations);
  let clock = Date.parse(MONDAY);
  const store = createStore(db, { now: () => new Date((clock += 1000)).toISOString() });
  for (const [id, name] of [["u1", "Asha"], ["u2", "Ravi"]])
    db.prepare("INSERT INTO users(id,name,role_id,created_at,updated_at) VALUES(?,?,?,?,?)").run(id, name, "role_caller", "x", "x");
  const lead = (owner) => store.createLead({ name: "Lead " + ++n, phone: String(9200000000 + n), source: "IndiaMart", owner });
  const call = (l, userId, minutesAfter, seconds) =>
    store.logCall({ phone: l.phone_e164, direction: "Outgoing", startedAt: new Date(Date.parse(MONDAY) + minutesAfter * 60000).toISOString(), duration: seconds, deviceId: "d", localId: "c" + ++n, userId });
  return { db, store, lead, call, card: createScorecard(db), at: (iso) => (clock = Date.parse(iso)) };
}
const day = { dayStart: DAY_START, dayEnd: DAY_END, now: "2026-10-26T08:00:00.000Z" };

test("points come only from stored events; accidental pick-ups and repeated dial-and-hang-up score nothing", (t) => {
  const { store, lead, call, card } = fixture(t);
  const l = lead("u1");
  call(l, "u1", 0, 120); // call + answered = 2
  call(l, "u1", 5, 4); // too short: nothing
  call(l, "u1", 8, 0); // not answered: counts as a try = 1 call, no answer point
  store.setStatus(l.id, "Quotation Shared", { userId: "u1" }); // 10
  store.setStatus(l.id, "Won", { userId: "u1" }); // 50
  const mine = card.myDay({ userId: "u1", ...day });
  assert.deepEqual(
    { calls: mine.today.calls, answered: mine.today.answered, quotations: mine.today.quotations, won: mine.today.won },
    { calls: 2, answered: 1, quotations: 1, won: 1 },
  );
  assert.equal(mine.today.points, 2 * POINTS.call + POINTS.answered + POINTS.quotation + POINTS.won);
  call(l, "u1", 9, 0);
  call(l, "u1", 10, 0); // third unanswered try on the same lead the same day: nothing
  assert.equal(card.myDay({ userId: "u1", ...day }).today.calls, 2 + 1);
  assert.equal(card.myDay({ userId: "u2", ...day }).today.points, 0); // nobody else gets them
});

test("goal, streak and badges follow the stored goal, and non-working days do not break a streak", (t) => {
  const { db, lead, call, card } = fixture(t);
  db.prepare("UPDATE targets SET value=2 WHERE scope='default' AND metric='calls'").run();
  const l = lead("u1");
  call(l, "u1", 0, 60);
  assert.equal(card.myDay({ userId: "u1", ...day }).streak, 0); // 1 of 2: today still in progress
  call(l, "u1", 20, 60);
  const done = card.myDay({ userId: "u1", ...day });
  assert.equal(done.streak, 1);
  assert.ok(done.badges.find((b) => b.id === "goal").earned);
  assert.equal(done.badges.find((b) => b.id === "early").earned, false); // first call at 10:00 India is not before 10
  call(l, "u1", -30, 60); // 09:30 India
  assert.ok(card.myDay({ userId: "u1", ...day }).badges.find((b) => b.id === "early").earned);
});

test("leaderboard ranks by weekly points and lists everyone, and next-up puts late follow-ups first", (t) => {
  const { store, lead, call, card } = fixture(t);
  const a = lead("u1"), b = lead("u2");
  call(a, "u1", 0, 100);
  call(a, "u1", 30, 100);
  call(b, "u2", 0, 100);
  const board = card.leaderboard({ now: day.now });
  assert.deepEqual(board.map((r) => [r.name, r.rank, r.points]), [["Asha", 1, 4], ["Ravi", 2, 2]]);
  store.addTask({ leadId: b.id, ownerId: "u2", title: "Call again", dueAt: "2026-10-20T05:00:00.000Z" });
  const next = card.myDay({ userId: "u2", ...day }).next;
  assert.equal(next.id, b.id);
  assert.equal(next.reason, "Follow-up is late");
});

test("team view puts the person furthest from the goal first", (t) => {
  const { lead, call, card } = fixture(t);
  call(lead("u1"), "u1", 0, 90);
  const rows = card.team(day);
  assert.equal(rows[0].name, "Ravi");
  assert.equal(rows.length, 2);
});
