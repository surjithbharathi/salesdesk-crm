# Salesmax reconstruction ledger

Updated 22 October 2026. This is an independent local implementation, not a claim of complete Salesmax parity.

## Evidence boundary

The REA `reverse-engineer-anything` skill guided target selection, staged inspection, and the separation of observations from inferences. The installed REA 6.7.0 CLI runs, but its diagnostic reports that REA MCP registration is missing for this agent. The signed-in browser is available through the application's browser-control interface; it supplies the UI observations below. No REA runtime captures, decompiled source, server implementation, API contracts, or native-provider evidence were obtained. The identifiers below are this project's observation labels, not REA Evidence IDs.

No Salesmax records were edited, exported, sent, or copied into the reconstructed database. Source screenshots containing customer data are not committed.

## Observations

| ID    | Source screen                                     | Directly observed                                                                                                                            |
| ----- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| UI-01 | `/home/dashboard`                                 | Work queues, All/My scope, calls/durations/outcomes, source mix, assignment load, stage panels                                               |
| UI-02 | `/leads/all-leads`                                | Paginated lead grid, owner/stage/first-touch columns, selection, row actions, column chart controls                                          |
| UI-03 | `/conversations/tickets`                          | Ticket board: Open, Payment Pending, Service Scheduled, Inprogress, Spare Paid, Issue Solved, Spare Sent, Closed; search and My/All scope    |
| UI-04 | Ticket creation dialog                            | Title, description, status, priority, assignee, contact, category and stage; dialog closed without submission                                |
| UI-05 | `/conversations/reply`                            | Event categories for lead/deal/call/visit/task/quote/payment/chat; campaign status and sent/read/replied counters; setup controls            |
| UI-06 | `/conversations/inbox`                            | Lead-oriented inbox grid, last message and WhatsApp-number columns, conversation action                                                      |
| UI-07 | `/conversations/team-inbox`                       | Internal channel grid with channel name, last message/time/author; loaded content was limited                                                |
| UI-08 | `/metrics/custom-report` and chart-library dialog | Leads/deals/calls/payments template categories, time windows, Chart/Table toggle, Save Chart and export controls; no chart saved in Salesmax |

## Implementation status

“Local” means working with the local SQLite database. It does not imply external service delivery or verified equivalence to Salesmax's hidden business rules.

| Area                                     | Status        | Scope and remaining difference                                                                                            |
| ---------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Lead CRUD/search/filter/paging           | Local         | Independent implementation based on UI-02                                                                                 |
| Owner assignment and archive/restore     | Local         | Explicit bulk changes; archived differs from Salesmax's complete already-worked lifecycle                                 |
| First touch, repeat enquiries, timelines | Local         | Recorded activities determine local state                                                                                 |
| Dashboard queues                         | Partial       | Local totals and drill-down; exact rolling periods/progress and customisable panels not reproduced                        |
| Call/note/message/visit logs             | Local         | Manual records; no automatic call acquisition                                                                             |
| Follow-ups and task board                | Local         | User tasks plus system-origin tasks created by source-rule execution                                                      |
| Deals, lead-state updates, payments      | Local         | Multi-deal stage aggregation and payment ledger; no payment collection                                                    |
| Products, businesses and lists           | Local         | Simple catalogue/directory; sales quoting and stock fulfilment unimplemented                                              |
| CSV/JSON bulk import                     | Local         | Validated 500-row batches, quoted CSV, Unicode, deduplication and rollback; no full workspace restore                     |
| Source distribution rules                | Partial       | Enabled rules run explicitly; not attached to external lead ingestion                                                     |
| Customer/lead inbox                      | Partial       | Conversations, received-message records, drafts and resolution; no delivery, read receipts or syncing                     |
| Internal team inbox                      | Partial       | Persistent channels and membership-validated message records; no authentication or staff notifications                    |
| Mailbox                                  | Partial       | Email conversation records only; no mailbox connection                                                                    |
| Tickets                                  | Local         | Observed service stages, priority/category/owner/contact fields and board search                                          |
| Broadcast campaigns                      | Partial       | List-based, deduplicated draft preparation; no scheduling or broadcast delivery                                           |
| Event auto replies                       | Partial       | Enabled rules generate local drafts on implemented events; no messages dispatched or quote/payment-failure trigger parity |
| Documents                                | Partial       | Plain text preview/download up to 100 KiB; binary uploads/PDF generation unimplemented                                    |
| Attendance                               | Partial       | Manual check-in/out and duplicate-day validation; no device/GPS verification                                              |
| Custom reports                           | Partial       | Five chart presets, saved grouping definitions, Chart/Table and CSV; smaller template library than UI-08                  |
| Activity/user/source metrics             | Local         | Computed from local records; historic attribution/time windows differ from Salesmax                                       |
| Exports                                  | Local         | Workspace JSON, safe lead CSV and report CSV                                                                              |
| AI chatbot/copilot/transcription         | Unimplemented | Needs a selected model service and defined workflows                                                                      |
| SIM/cloud calling and recording          | Unimplemented | Needs supported device/telephony integration                                                                              |
| WhatsApp/email/SMS transport             | Unimplemented | Needs authorized providers, verified webhooks and delivery processing                                                     |
| GPS/location/device attendance           | Unimplemented | Needs device app and explicit location permissions                                                                        |
| Authentication/permissions/workspaces    | Unimplemented | Team roles are metadata; app is single-operator and bound to loopback                                                     |
| Production deployment                    | Unimplemented | Repository published; local server only                                                                                   |

## Verification

Version 0.4 adds independent saved lead views and sorting informed by Twenty's public view/filter architecture. See [TWENTY_REFERENCE.md](TWENTY_REFERENCE.md). Twenty API synchronization remains unconnected.

`npm test` covers server HTTP workflows, SQLite restart persistence, transactional import rollback, draft event generation, channel membership, campaign/rule idempotence, text documents, report joins/date windows, CSV quoting/Unicode and invalid inputs. Browser checks supplement the tests for user-facing forms and navigation. The suite does not establish Salesmax provider behavior or production readiness.
