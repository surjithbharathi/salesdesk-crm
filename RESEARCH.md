# Salesmax observed workflows

Observed read-only in the user's signed-in browser on 22 October 2026. No records were changed or exported. Customer data is deliberately excluded from this document.

## Dashboard

Route: `/home/dashboard`.

Observed work queues: ad-hoc tasks, new leads, newly assigned leads, repeat enquiries, user-scheduled follow-ups, system-scheduled follow-ups, overdue follow-ups, missed calls, and recently closed leads. All/My tabs provide work ownership scope.

Activity reporting separates connected/outgoing/incoming calls, durations, call outcomes, notes, and visits. Additional panels cover user activity, calling trends, lead sources, assignment balance, and pipeline stages.

## Active leads

Route: `/leads/all-leads`.

Observed paginated table with lead identity, owner, stage, and awaiting-first-touch state. Row controls include call, start conversation, voice note, preview, and more actions. Column chart controls advertise chart generation and bar-based drill-down. A distribution notice compares covered sources with all sources.

## Navigation inventory

Products/inventory; active and already-worked leads; businesses; documents; lists; bulk add; distribution; email leads; engagements; calls; messages; visits; tasks; To Do; deals; payments; activity/user/source/custom/attendance reports; activity feed; location; exports; lead/team inboxes; broadcasts; automatic messaging; chatbot; tickets; conversation statistics.

Only dashboard and active leads were inspected. Navigation labels establish visible modules, not verified implementations. No underlying backend, source code, automation, messaging, or telephony behavior was verified.

## Prototype gaps

Salesdesk v0.2 implements a work-queue dashboard, first-touch and repeat-enquiry state, separate deal/payment/task records, a paginated lead grid, archive/restore, source/owner reporting, manual activity logging, and local round-robin assignment. Records persist in SQLite. These are independently implemented behaviors informed by the observed UI; exact Salesmax business rules were not verified. Calling, shared inboxes, automated distribution rules, messaging delivery and other external integrations remain unimplemented.
