# Salesdesk CRM

**Continuing on another computer? Start with [HANDOFF.md](HANDOFF.md).** It contains setup, deployment state, Android signing caveats, completed work and outstanding acceptance checks. No runtime database, private screenshots or secrets are included in this public repository.

Android 0.9.0 UI source now includes a modern violet/neutral theme, Lucide icons, Home shortcuts, contact rows and expandable Settings. A separate sample-data preview is installed and both preview/online builds assemble and lint. The existing phone app remains 0.8.3 until its original signing key is available. See [UI_REDESIGN.md](android-companion/UI_REDESIGN.md) for verification limits and build instructions.

Recording auto-match source now uses call end time and actual audio duration, independent of filenames, with unique-match and personal-call ambiguity checks. Twelve matcher regression cases pass. This requires the updated signed Android app; the original installed app has not received it.

Latest Android v0.8.3 improves the five native screens and introduces event-triggered business call sync (20-second settle delay, recording retries, minute fallback while active). Web call views now refresh changed synced-call data every three seconds without interrupting forms/audio. All 42 CRM tests and Android assemble/lint pass. The APK was installed; final device UI/latency checks remain incomplete after USB disconnected. See [design-qa.md](design-qa.md). The user confirmed actual mobile login/background SIM calling before this UI pass; this is not verification of every call/recording/device scenario.

The paragraphs below preserve feature history. Current status/limitations in HANDOFF.md, WHATSAPP.md, CLICK_TO_CALL.md and design-qa.md supersede older test counts or earlier unverified/no-dialing boundaries.

v0.8.1 adds an opt-in Android background SIM call bridge with a **Salesdesk is running** notification. Lead → Call on my phone routes an authenticated, expiring, non-retried request to the same user's ready phone. App screen need not stay visible, but service/network/permissions are required; actual background dialing remains unverified. See [CLICK_TO_CALL.md](CLICK_TO_CALL.md). Older boundaries below claiming no dialing are superseded by this opt-in bridge, not by a guarantee of always-on calling.

v0.8 adds native Android Home, Leads, Calls, Tasks and Settings, with the same company/user login as web CRM. Shared sessions enforce user-scoped data and automatic call ownership; administrators create logins for existing CRM users. Call sync remains opt-in. The 30 automated tests pass; real-user login, live-phone recording sync and visual parity are not yet verified. See [MOBILE_SYNC.md](MOBILE_SYNC.md) and [MOBILE_REFERENCE.md](MOBILE_REFERENCE.md).

WhatsApp now uses **Baileys sync-only**: matched incoming text and manually sent phone/Web text sync to CRM. Direct CRM sending is disabled (old send API returns 405); the manual-draft button opens WhatsApp Web for you to press Send. No bulk sending or auto-send. Read [WHATSAPP.md](WHATSAPP.md) before pairing; unofficial-client risks remain and live round-trip sync is not yet verified. Older feature ledgers describing direct sending are superseded by this change.

v0.5.1 adds drag-and-drop to the shared-filter lead Kanban board, with highlighted target lanes, cancellation, guarded saves, accessible stage selectors and stage-change timeline entries. Drag cards by their body (not their buttons or selectors). See [FRAPPE_REFERENCE.md](FRAPPE_REFERENCE.md) for the combined Salesmax/Twenty/Frappe direction and remaining integration boundaries.

A working local CRM modeled on the Salesmax workflows observed in the user's signed-in dashboard and lead grid. Original implementation and branding; no proprietary source or customer records copied.

## Run

Requires Node.js 22.13 or newer with `node:sqlite` (verified on 22.22.2). Install the pinned WhatsApp dependencies first.

```sh
npm ci
npm start
```

Open http://localhost:3100. The server binds only to 127.0.0.1. Use `PORT=3200 npm start` for another port.

```sh
npm run check
npm test
```

The 25 tests use isolated fixtures and temporary databases/ports. They cover the core CRM, WhatsApp mock transport, device-token scope/revocation, call replay conflicts, encrypted recording storage/tamper rejection, ambiguous matching and a synthetic HTTP audio upload/playback/timeline roundtrip. No personal phone data or real messages are used by tests.

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

This is a local single-company application, not a production Salesmax replacement. Shared login is opt-in: before account setup, local demo access remains open; after setup, API sessions and administrator/member ownership checks apply. Members currently edit web leads/tasks/activities; other web administration routes are restricted. Multiple isolated company workspaces, real-time collaboration, phone/SIM dialing, native call-audio recording, live email/SMS delivery, provider webhooks, AI processing, GPS, binary document uploads and campaign dispatch are not implemented. Android reads existing call logs/audio only after user opt-in; live-device compatibility is unverified. Offline CRM changes are not queued (only call sync has a retry queue). Attendance is manual and source rules execute on request. Campaigns, auto replies and inbox composition remain drafts. The opt-in Baileys adapter handles matched incoming individual texts and explicit single-message sends; it is not the official Business API. See [WHATSAPP.md](WHATSAPP.md). No WhatsApp number was linked during development.

Read [FEATURE_PARITY.md](FEATURE_PARITY.md) for the current evidence ledger, verification and every remaining gap. [RESEARCH.md](RESEARCH.md) preserves the initial inspection. Subsequent read-only browser inspection covered ticket forms, auto-messaging categories, lead/team inbox grids and the report chart library; internal implementation remains unknown.
