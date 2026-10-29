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
