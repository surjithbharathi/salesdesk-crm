# Salesdesk CRM

v0.5.1 adds drag-and-drop to the shared-filter lead Kanban board, with highlighted target lanes, cancellation, guarded saves, accessible stage selectors and stage-change timeline entries. Drag cards by their body (not their buttons or selectors). See [FRAPPE_REFERENCE.md](FRAPPE_REFERENCE.md) for the combined Salesmax/Twenty/Frappe direction and remaining integration boundaries.

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

The 13 tests use isolated fixtures plus a temporary SQLite database and port 3199. They cover saved lead views, lead creation, call logging, task completion, multi-deal closure, payments, tickets, channels, documents, attendance, event drafts, report joins/date windows, CSV parsing, validation, cross-origin write rejection, import rollback, deduplication, and persistence after restart.

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
- Local lead/email conversation records, received messages, outgoing drafts and conversation resolution.
- Internal team channels and membership-validated message histories.
- Service ticket board with category, priority, contact, assignee and eight observed service stages (plus a generic Resolved state).
- List campaigns prepared into deduplicated local drafts; event rules generate drafts for implemented lead/call/task/deal/payment/conversation events.
- Plain-text documents with preview/download; manual attendance check-in/out.
- Source assignment rules with system follow-ups; five report chart presets, saved grouping definitions, chart/table views and report CSV.
- CSV paste/file loading, JSON file loading and a downloadable import template.
- Saved lead views with persisted search, filters, archive scope and sorting, independently inspired by Twenty. See [TWENTY_REFERENCE.md](TWENTY_REFERENCE.md) for reviewed sources and the integration design.

## Storage and migration

The database is `data/crm.sqlite`, with SQLite WAL files alongside it. This directory is ignored by Git. Export records from the Data exports page; stop the server before copying the entire database directory as a backup. JSON lead import imports lead records only and is not a full workspace restore mechanism.

First startup creates fictional sample records. Browser verification adds clearly named demo lead, CSV and service-ticket records to the local database. Existing v0.1 browser localStorage (`salesdesk.v1`) is left intact; it is not automatically migrated into the SQLite database. No real Salesmax records are imported.

## Boundaries

This is a single-operator local application, not a production Salesmax replacement. Team roles organize records but do not enforce access controls. Authentication, multiple isolated workspaces, real-time collaboration, phone/SIM calling, automatic call capture/recording, live WhatsApp/email/SMS delivery, provider webhooks, AI processing, GPS, binary document uploads and campaign dispatch are not implemented. Attendance is manual, source rules execute on request, and all outgoing messages remain drafts. The Feature status and Integrations screens state these boundaries explicitly.

Read [FEATURE_PARITY.md](FEATURE_PARITY.md) for the current evidence ledger, verification and every remaining gap. [RESEARCH.md](RESEARCH.md) preserves the initial inspection. Subsequent read-only browser inspection covered ticket forms, auto-messaging categories, lead/team inbox grids and the report chart library; internal implementation remains unknown.
