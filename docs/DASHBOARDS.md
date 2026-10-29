# Role dashboards plan

One dashboard per role. Same data (all numbers from SQL), different question answered.

| Role | Who | Question it answers | Scope |
|---|---|---|---|
| Owner (`admin`) | Surjith | Is the business healthy, which sources and people earn money, what needs my decision? | Everything |
| Manager (new role `manager`) | Team lead | Who needs help right now, what is stuck, is the team on target? | Own team |
| Caller (`member`) | Sales person | What do I do next, how am I doing today? | Own leads only |

Today `user-auth.mjs` has only `admin` and `member`. Adding `manager` is a small change (role value plus scope rules), to be done with the first manager screen.

## Caller dashboard: "My day" (game-like)

- **Next up**: one big card, the single next lead to call (late follow-up first, then new, then due today). One button: Call. After the call the next lead slides in. This is the main loop.
- **Day goal ring**: calls made vs target (owner sets target, e.g. 40 calls, 6 connected, 3 quotations). Ring fills, small burst when complete.
- **Streak**: days in a row the goal was met. Resets honestly, no fake points.
- **Points** (simple, explainable, shown on hover):
  - call made 1, call answered 2, follow-up done on time 3, quotation sent 10, order won 50.
  - Points only from recorded events in the database, so they cannot be gamed by tapping buttons.
  - Quality guard: an answered call under 10 seconds scores 0; only the first 2 unanswered tries per lead per day count.
- **Badges**: First call of the day before 10am, Zero late follow-ups, Quotation sent within 1 hour of the ask, Order won. Few and meaningful.
- **Leaderboard**: weekly, friendly. Shows rank by points, not rupees, so juniors are not demoralised. Owner can switch it off. Never shows lost-lead blame.
- **Late follow-ups** list, kept short and in red only when truly late.

## Manager dashboard: "My team"

- Team goal bar for today and this week.
- One row per caller: calls, answered, quotations, orders, late follow-ups, first-call delay. Sorted so the person who needs help is on top.
- **Stuck leads**: not called yet over N hours, quotation shared but no follow-up for 3 days.
- **Needs review**: answered calls with no outcome, drafted quotations waiting.
- Reassign button with Lead Protection rules already in `store.mjs`.
- Call quality list (later, from AI call summaries): calls to listen to.

## Owner dashboard: "Business"

- Press line (already built) plus revenue this month vs last month.
- Source report summary: best and weakest source with the SQL numbers and the AI reason (AI explains, never calculates).
- Team table: orders and order value per person, response time.
- **Needs your decision**: AI proposals waiting for approval, unassigned leads, big quotations.
- Daily and weekly report preview (what goes to WhatsApp or email).
- Targets and points settings live here.

## Data and API needed (all SQL, read-only first)

1. `GET /api/v2/me/day`: today's calls, answered, quotations, orders, goal, streak, points, next lead.
2. `GET /api/v2/team/day`: per-caller table for managers.
3. `GET /api/v2/leaderboard?period=week`.
4. New tables: `targets` (role or user, metric, value) and `points_events` computed from `calls`, `activities`, `tasks` (or a view, so points are always reproducible).
5. Tests: points are derived only from stored events; a member never sees another member's leads; leaderboard excludes junk calls.

## Design notes

- Keep the "press line" idea: for callers the press is their own day (calls pressed into answers into quotations).
- Motion only when something is earned (ring fill, streak flame, badge). No confetti on every click.
- Tamil and English labels; large numbers; works on a phone first for callers.
- Honest by design: no invented numbers, small samples are marked, and points rules are visible.

## Order of work

1. Caller "My day" (largest daily impact, needs `me/day` and goals).
2. Owner "Business" (reuse existing report plus team table).
3. Manager "My team" (needs the new role).
4. Badges and leaderboard polish.
