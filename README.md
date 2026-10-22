# Salesdesk CRM

A working local CRM modeled on the Salesmax workflows observed in the user's signed-in dashboard and lead grid. Original implementation and branding; no proprietary source or customer records copied.

## Run

Requires Node.js 22.13 or newer with `node:sqlite` (verified on 22.22.2). No npm packages are needed.

```sh
npm start
```

Open http://localhost:3100. The server binds only to 127.0.0.1. Use `PORT=3200 npm start` for another port.

```sh
npm run check
npm test
```

Tests use a separate temporary SQLite database and port 3199. They cover lead creation, call logging, task completion, deal closure, payment recording, validation, cross-origin write rejection, atomic import rollback, duplicate detection, and persistence after restart.

## Implemented

- Dashboard with owner scope, new/prospecting/opportunity totals, work queues, first-touch state, repeat enquiries, due/overdue follow-ups, missed-call logs, revenue, source mix, workload and recent activities.
- Active lead grid with search, stage/source/owner filters, pagination, selection, bulk assignment, reversible archiving and restoration.
- Lead workspace with editable details, timeline, activity logging, follow-ups and linked deals.
- Manual call outcomes, direction and duration; note, message and visit logs. An interested or connected call advances a new lead to prospecting.
- Task kanban with editable dates, ownership and completion state.
- Deal kanban with five stages, values and close dates; won/lost deal transitions update linked lead stage/disposition.
- Payment ledger with deal references.
- Products and inventory catalogue; business directory and lead lists.
- JSON bulk lead import (up to 500), normalized phone deduplication and transactional validation.
- Round-robin assignment of unassigned leads to active team records.
- Team lead-position report, activity metrics and source performance reports.
- Full-workspace JSON and spreadsheet-safe lead CSV exports.
- Server-side SQLite persistence, validation, same-origin write checks and content security policy.

## Storage and migration

The database is `data/crm.sqlite`, with SQLite WAL files alongside it. This directory is ignored by Git. Export records from the Data exports page; stop the server before copying the entire database directory as a backup. JSON lead import imports lead records only and is not a full workspace restore mechanism.

First startup creates fictional sample records. The browser-verified sample named “Demo verification lead” and its demo note may be present in this local database. Existing v0.1 browser localStorage (`salesdesk.v1`) is left intact; it is not automatically migrated into the SQLite database. No real Salesmax records are imported.

## Boundaries

This is a single-operator local application, not a production Salesmax replacement. Team roles organize records but do not enforce access controls. Authentication, multiple isolated workspaces, real-time collaboration, phone/SIM calling, automatic call capture, recordings, WhatsApp delivery/shared inbox, provider webhooks, AI processing, live location, attendance, document uploads, automated source rules, and broadcast campaigns are not implemented. The Integrations page states these requirements explicitly and does not claim a connected service.

Read [RESEARCH.md](RESEARCH.md) for observed UI evidence and the limits of the research. Only the signed-in dashboard and active lead grid were inspected; other implemented flows use standard CRM behavior inferred from the public descriptions and navigation.
