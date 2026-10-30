# KPI scorecard and role dashboards

New screens under `/next/` (My day, Team, Business, Daily goals). They read from `/api/kpi/*`, which counts everything from the CRM's existing records: `mobileCalls`, `activities`, `tasks`, `leads`. The only thing stored is the daily goals (`kpi_targets` table, created on first use). No existing table or route is changed.

## Who sees what

| Role (workspace role) | My day | Team | Business | Daily goals |
|---|---|---|---|---|
| Caller (`member`) | own only | no | no | no |
| Manager | any person | yes | yes | read |
| Admin, Owner | any person | yes | yes | change |

A caller who asks for someone else's day gets their own. The server decides; the screen only hides what the server would refuse.

## Points

Call made 1, answered +1, follow-up done on time 3, quotation given 10, order won 50. A call counts when it was answered for 10 seconds or more, or is one of the first two unanswered tries on the same lead that day. Quotation and won come from the stage-change entries the CRM already writes to the timeline ("Lead stage changed: X → Quotation given", "→ Closed" with disposition Won). Calls are credited to the person whose phone logged them.

## Running it

`npm run web:build` builds the screens into `web/dist` (the Dockerfile does this). `node scripts/demo-kpi.mjs` starts the CRM on invented data with a week of activity.

## Not included

Leads, lead panel and source report from the earlier prototype (they depended on the separate Phase 1 data layer and stay in the classic screens). The Phase 1 schema, importer and `/api/v2` live on branch `phase1/schema` and are not part of this build.

## New front door (0.19.0)

The React app is now served at `/`: Business, My day, Leads (with the lead panel: log a call, follow-ups, notes, stage, owner), Calls, To-do, Team, Daily goals. It uses the CRM's own record API (`/api/state`, `/api/leads`, `/api/activities`, `/api/tasks`), so every permission check is the same as before; nothing about roles or data changed.

The earlier screens remain at `/classic/` only for what is not rebuilt yet: Messages (WhatsApp), Users and permissions, Integrations, Call-AI and email settings, import and export, reports. The sidebar link "Settings and messages" opens them. Rebuild those next, then remove `/classic/`.

## Settings (0.19.1)

Settings is rebuilt in the new app: People and access (invite, change role and permissions, setup links), Email (SMTP and test message), Add leads from a file (CSV), Merge duplicates, Archived leads, Download data, Your account. They call the same server routes as the earlier screens, so the permission checks are unchanged.

Still only in `/classic/`: WhatsApp, other integrations, MCP connections, API key vault, call transcription settings, n8n, lead assignment rules, and workspace management for the Ultra Admin.

## Gamification (0.20.0)

Everything below is counted from the same records as points, so none of it can be earned by tapping buttons, and nothing new is stored.

- **Levels** come from lifetime points and only rise: Starter 0, Dialer 100, Connector 300, Negotiator 700, Quote Maker 1,500, Deal Closer 3,000, Senior Closer 6,000, Champion 10,000, Legend 20,000.
- **Milestones** are lasting badges from lifetime counts: first call, 100/500/1,000 calls, first/10/50 quotations, first/5/25 orders won, and 7 or 30 working days in a row meeting the calls goal (best run, kept after a break).
- **Weekly challenges** are derived from the daily goals: calls = 5 × the daily calls goal, customers reached = 5 × the answered goal, quotations = 3 × the quotation goal, and win one order. Change the daily goals and the challenges follow.
- **Rank** this week and this month among active people, a **team goal** for today (team calls against the sum of everyone's goal), and the **stars of the week**: the top scorer of each of the last four finished weeks, shown only when they scored.
- A short "Well done" message appears when a badge, milestone, challenge or level is newly earned since the last refresh.
- The phone app's Home shows the same: level, rank, goals, team goal, challenges and the leaderboard, from `GET /v1/kpi/day/<tz minutes>/<day start ms>/<day end ms>` (path parameters, because the app refuses query strings). `GET /api/kpi/leaderboard?period=month` gives the monthly board.

## Leaving a number out of call sync (0.28.0)

A lead can be marked **Do not sync phone calls with this lead** (lead panel, Update tab). The phone is then not offered that number and its call uploads for it are refused (HTTP 403, which the phone app already treats as "skip this call"), so new calls and recordings with it never reach the CRM. Calls already synced stay. The mark is the lead field `noCallSync`, and a lead showing it carries a "Calls not synced" note.
