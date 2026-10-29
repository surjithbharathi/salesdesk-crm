# Phase 1 proposal — data layer and lead model

Status: **proposal for review, no code changed.** Based on the SalesMax and TeleCRM studies, the Phase 0 findings (duplicates, phone matching, call metrics, full-table scans) and the current JSON `records(kind,id,body)` store.

## 1. Goals
1. One lead = one **canonical phone** (E.164 digits), unique, with alternate numbers also unique.
2. Real columns and indexes so list pages, dashboards and call matching never parse every record.
3. TeleCRM-style **status → stage group**, lost reasons, tags and custom fields; SalesMax-style **lifecycle** derived from status.
4. Call and activity data that feed the work queue (first touch, attempts, last worked, next follow-up).
5. Recordings as encrypted files, not database blobs.
6. A safe, repeatable migration from the current JSON data, with a dry run and a rollback.

Keep: SQLite (`node:sqlite`, WAL), UUID text ids (the Android app already stores them), the existing `auth_*`, `mobile_devices`, `call_receiver`, `call_commands`, `automation_*` and WhatsApp auth tables unchanged.

## 2. Conventions
- `id TEXT PRIMARY KEY` (UUID). `legacy_id TEXT` on migrated tables for traceability and idempotent re-runs.
- Timestamps: ISO-8601 UTC text (`2026-10-29T15:04:05.000Z`) as today; sortable and readable. `created_at`, `updated_at` on every table.
- Money: integer paise would be safest; current code stores rupees as numbers. Proposal: `INTEGER` rupees for now (no fractions used anywhere), revisit with Phase 7 quotes/GST.
- Soft delete via `archived_at` (leads) / `deleted_at` where needed; no hard deletes from the UI.
- Foreign keys ON, `PRAGMA user_version` for schema version, numbered SQL migration files (`migrations/001_*.sql`).

## 3. Reference tables

```sql
CREATE TABLE statuses (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  stage_group TEXT NOT NULL CHECK (stage_group IN ('FRESH','ACTIVE','WON','LOST')),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('new','prospecting','opportunity','customer','closed')),
  sort INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE status_aliases (alias TEXT PRIMARY KEY, status_id TEXT NOT NULL REFERENCES statuses(id));

CREATE TABLE lost_reasons (
  id TEXT PRIMARY KEY, label TEXT NOT NULL UNIQUE,
  is_default INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL
);
CREATE TABLE lost_reason_aliases (alias TEXT PRIMARY KEY, lost_reason_id TEXT NOT NULL REFERENCES lost_reasons(id));

CREATE TABLE lead_sources (id TEXT PRIMARY KEY, label TEXT NOT NULL UNIQUE, kind TEXT, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE tags (id TEXT PRIMARY KEY, label TEXT NOT NULL UNIQUE, color TEXT);
CREATE TABLE call_outcomes (
  id TEXT PRIMARY KEY, label TEXT NOT NULL UNIQUE,
  polarity TEXT NOT NULL CHECK (polarity IN ('positive','negative','neutral')),
  effect TEXT NOT NULL CHECK (effect IN ('none','open_opportunity','close_lead','keep_prospecting')),
  sort INTEGER NOT NULL
);
CREATE TABLE roles (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, permissions TEXT NOT NULL); -- JSON permission tree
```

### Seed: statuses (17, TeleCRM order; "Intrested" corrected, old spelling kept as alias)
| Status | Group | Lifecycle |
|---|---|---|
| New Lead | FRESH | new |
| Contact Attempted | ACTIVE | prospecting |
| Interested Customer *(alias "Intrested Customer")* | ACTIVE | opportunity |
| Requirement Discussion *(alias "Need Discussion")* | ACTIVE | prospecting |
| Quotation Shared | ACTIVE | opportunity |
| Follow-up / Negotiation | ACTIVE | opportunity |
| Later Purchase | ACTIVE | prospecting |
| Loan Document Collected | ACTIVE | opportunity |
| Loan In Process | ACTIVE | opportunity |
| Advance Pending | ACTIVE | opportunity |
| Advance Received | ACTIVE | opportunity |
| Payment Received | ACTIVE | opportunity |
| Machine Dispatched | ACTIVE | customer |
| Machine Delivered - Need To Start | ACTIVE | customer |
| Regular Customer | ACTIVE | customer |
| Won | WON | closed |
| Lost | LOST | closed |

### Seed: lost reasons (13 → 11, duplicates merged, old labels kept as aliases)
No Need · No response after multiple attempts *(also "Unable to Connect")* · Price / budget issue *(also "Budget Issues")* · Product not suitable *(also "Product does not fit need")* · Lost to competitor · Purchase postponed · Finance not approved · Duplicate lead · Manually closed · Wrong number *(new, from SalesMax visit outcomes)* · Unknown reason *(default)*.

### Seed: call outcomes (SalesMax rules)
Interested (positive, `open_opportunity`) · Not interested (negative, `close_lead`, reason "No Need") · Call later (neutral, `keep_prospecting`) · Service ticket (neutral, `keep_prospecting`) · Wrong number (negative, `close_lead`). Admin-editable.

### Seed: roles
Admin (all) · Manager (assign, view team, no workspace settings) · Caller (own leads, no export/delete/assign) · Marketing (lists, campaigns, no call data). Current `admin`/`member` maps to Admin/Caller; permission JSON is the Phase 8 matrix, stored now so nothing is re-migrated later.

## 4. Core tables

```sql
CREATE TABLE users (               -- exists today as JSON kind "users"; becomes a table
  id TEXT PRIMARY KEY, name TEXT NOT NULL, role_id TEXT REFERENCES roles(id),
  active INTEGER NOT NULL DEFAULT 1, calling_language TEXT, legacy_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone_e164 TEXT UNIQUE,                         -- canonical key; NULL allowed for legacy no-phone leads
  phone_display TEXT,                             -- as entered, for display only
  email TEXT, company TEXT, city TEXT, state TEXT, place TEXT,
  business_id TEXT REFERENCES businesses(id),
  first_source_id TEXT REFERENCES lead_sources(id),   -- captured once, write-once (trigger)
  latest_source_id TEXT REFERENCES lead_sources(id),  -- updated by repeat enquiries
  lead_type TEXT,
  owner_id TEXT REFERENCES users(id),
  status_id TEXT NOT NULL REFERENCES statuses(id),
  lost_reason_id TEXT REFERENCES lost_reasons(id),
  rating INTEGER CHECK (rating BETWEEN 0 AND 5),
  expected_value INTEGER,
  product_interested TEXT, product_name TEXT, required_capacity TEXT, purchase_timeline TEXT,
  customer_type TEXT, customer_language TEXT, preferred_language TEXT,
  lead_protection TEXT NOT NULL DEFAULT 'Normal' CHECK (lead_protection IN ('Normal','Protected')),
  do_not_call INTEGER NOT NULL DEFAULT 0, do_not_email INTEGER NOT NULL DEFAULT 0,
  do_not_track INTEGER NOT NULL DEFAULT 0, whatsapp_opt_out INTEGER NOT NULL DEFAULT 0,
  summary TEXT,                                   -- latest AI/human summary
  custom TEXT NOT NULL DEFAULT '{}',              -- JSON: values for admin-defined custom fields
  -- computed work metrics (maintained in the write path, never edited by users)
  is_repeat INTEGER NOT NULL DEFAULT 0, repeat_count INTEGER NOT NULL DEFAULT 0,
  first_touch_at TEXT, last_activity_at TEXT, last_call_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, call_count INTEGER NOT NULL DEFAULT 0,
  connected_count INTEGER NOT NULL DEFAULT 0, total_call_seconds INTEGER NOT NULL DEFAULT 0,
  next_followup_at TEXT, assigned_at TEXT, assigned_by TEXT, previous_owner_id TEXT, status_changed_at TEXT,
  archived_at TEXT, captured_at TEXT, capture_count INTEGER NOT NULL DEFAULT 1,
  legacy_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX leads_owner_status ON leads(owner_id, status_id) WHERE archived_at IS NULL;
CREATE INDEX leads_status_updated ON leads(status_id, updated_at DESC, id);
CREATE INDEX leads_followup ON leads(next_followup_at) WHERE next_followup_at IS NOT NULL;
CREATE INDEX leads_created ON leads(created_at DESC, id);
CREATE INDEX leads_untouched ON leads(owner_id) WHERE first_touch_at IS NULL AND archived_at IS NULL;

CREATE TABLE lead_phones (          -- alternate numbers, also globally unique so calls/WhatsApp match any of them
  phone_e164 TEXT PRIMARY KEY, lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'alternate', created_at TEXT NOT NULL
);
CREATE TABLE lead_tags (lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE, tag_id TEXT REFERENCES tags(id), PRIMARY KEY(lead_id, tag_id));

CREATE TABLE field_defs (           -- admin-defined fields (SalesMax "Properties" / TeleCRM custom fields)
  id TEXT PRIMARY KEY, entity TEXT NOT NULL DEFAULT 'lead', api_name TEXT NOT NULL, label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text','number','date','dropdown','multi','phone','email','url','bool')),
  options TEXT, group_name TEXT NOT NULL DEFAULT 'Others', sort INTEGER NOT NULL DEFAULT 0,
  searchable INTEGER NOT NULL DEFAULT 0, required INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
  UNIQUE(entity, api_name)
);

CREATE TABLE businesses (id TEXT PRIMARY KEY, name TEXT NOT NULL, gstin TEXT, city TEXT, state TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE lists (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'static', owner_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE list_members (list_id TEXT REFERENCES lists(id) ON DELETE CASCADE, lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE, PRIMARY KEY(list_id, lead_id));
```

**Why a JSON `custom` column and not row-per-value:** admin-defined fields are read with the lead and rarely filtered; SQLite `json_extract` plus optional expression indexes covers the searchable ones. Row-per-value (EAV) would cost a join on every list page.

## 5. Activity, call and work tables

```sql
CREATE TABLE activities (
  id TEXT PRIMARY KEY, lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type TEXT NOT NULL,            -- call, note, whatsapp, sms, email, visit, payment, status_change, assignment, field_change, task, ai_summary, system, <custom action code>
  direction TEXT CHECK (direction IN ('Incoming','Outgoing')),
  source TEXT NOT NULL DEFAULT 'manual',   -- manual, phone, webhook, whatsapp, ai, system
  user_id TEXT REFERENCES users(id),
  occurred_at TEXT NOT NULL,     -- may be back-dated when the action definition allows it
  text TEXT, data TEXT NOT NULL DEFAULT '{}',   -- JSON payload for typed/custom actions
  call_id TEXT REFERENCES calls(id), created_at TEXT NOT NULL, legacy_id TEXT
);
CREATE INDEX activities_lead_time ON activities(lead_id, occurred_at DESC, id);
CREATE INDEX activities_user_time ON activities(user_id, occurred_at DESC);
CREATE INDEX activities_type_time ON activities(type, occurred_at DESC);

CREATE TABLE action_defs (        -- extension point: typed custom activities (website form, Call IQ, payment webhook…)
  code TEXT PRIMARY KEY, label TEXT NOT NULL, source_kind TEXT NOT NULL, fields TEXT NOT NULL DEFAULT '[]',
  allow_backdate INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE calls (
  id TEXT PRIMARY KEY, lead_id TEXT NOT NULL REFERENCES leads(id), user_id TEXT REFERENCES users(id),
  device_id TEXT, local_id TEXT, phone_e164 TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('Incoming','Outgoing','Missed','Rejected')),
  started_at TEXT NOT NULL, duration_seconds INTEGER NOT NULL, connected INTEGER NOT NULL,
  outcome_id TEXT REFERENCES call_outcomes(id), note TEXT, source TEXT NOT NULL DEFAULT 'phone',
  recording_id TEXT, match_mode TEXT, legacy_id TEXT, created_at TEXT NOT NULL,
  UNIQUE(device_id, local_id)
);
CREATE INDEX calls_lead_time ON calls(lead_id, started_at DESC);
CREATE INDEX calls_user_time ON calls(user_id, started_at DESC);
CREATE INDEX calls_no_outcome ON calls(user_id, started_at DESC) WHERE outcome_id IS NULL AND connected = 1;

CREATE TABLE recordings (
  id TEXT PRIMARY KEY, call_id TEXT NOT NULL UNIQUE REFERENCES calls(id), device_id TEXT, sha256 TEXT NOT NULL,
  mime TEXT NOT NULL, size_bytes INTEGER NOT NULL, storage_path TEXT NOT NULL,   -- data/recordings/ab/<id>.enc
  iv BLOB NOT NULL, tag BLOB NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(device_id, sha256)
);

CREATE TABLE task_types (id TEXT PRIMARY KEY, label TEXT NOT NULL UNIQUE, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE, owner_id TEXT REFERENCES users(id),
  type_id TEXT REFERENCES task_types(id), title TEXT NOT NULL, due_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Open','In progress','Done','Cancelled')),
  origin TEXT NOT NULL DEFAULT 'User', rule_id TEXT, completed_at TEXT, legacy_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX tasks_owner_due ON tasks(owner_id, due_at) WHERE status <> 'Done' AND status <> 'Cancelled';
```

Deals, payments, products, documents, tickets, conversations, messages, team channels, campaigns, auto-replies, attendance and saved reports move to tables in later phases with the same conventions. In Phase 1 they stay in the JSON `records` store (accessed through the same data-access layer) so nothing else breaks.

**Saved views** (Phase 2 UI, table created now):
```sql
CREATE TABLE views (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT, shared INTEGER NOT NULL DEFAULT 0,
  filter TEXT NOT NULL DEFAULT '{}', columns TEXT NOT NULL DEFAULT '[]', sort TEXT NOT NULL DEFAULT '{}', sort_order INTEGER NOT NULL DEFAULT 0);
```

## 6. Rules the write path enforces (one module, one transaction)
1. **Phone:** `canonicalPhone()` (already in `phone.mjs`) on every write; unique across `leads.phone_e164` and `lead_phones`; a clash returns 409 with the existing lead. Repeat enquiry from an existing number adds an activity and `repeat_count`, not a lead.
2. **Status change:** records a `status_change` activity, updates `status_changed_at`; moving to a LOST status requires a lost reason (default "Unknown reason"); leaving LOST clears it. `lifecycle` is read from `statuses`, never stored per lead.
3. **Call insert:** creates the activity, updates `first_touch_at` (outgoing or connected), `attempts`, `call_count`, `connected_count`, `total_call_seconds`, `last_call_at`, `last_activity_at`; a connected call with no outcome appears in "needs disposition".
4. **Call outcome set:** applies the outcome's effect (open opportunity → move New/prospecting leads to *Interested Customer*; close → *Lost* with reason; keep prospecting → no change).
5. **Assignment:** sets `assigned_at`, `assigned_by`, `previous_owner_id`; blocked by `lead_protection = 'Protected'` for automatic rules (manual still allowed).
6. **Tasks/next follow-up:** `next_followup_at` = earliest open task due date, recomputed on task changes.

## 7. API shape (replaces `/api/state`)
- `GET /api/leads?view=&status=&owner=&q=&tag=&source=&cursor=&limit=` → `{items, nextCursor, total}`; keyset cursor on `(updated_at, id)`; `q` matches name/phone/company with prefix search.
- `GET /api/leads/:id` (lead + tags + alternate phones + custom values); `GET /api/leads/:id/activities?cursor=`.
- `PATCH /api/leads/bulk` — one transaction for assign/tag/status/archive over a filter or id list.
- `GET /api/dashboard?scope=` — counts computed in SQL (new, awaiting first touch, repeat, follow-ups today/overdue, missed calls, closed).
- `GET /api/meta` — statuses, lost reasons, sources, tags, field definitions, call outcomes, roles (cached by the browser).
- `GET /api/changes?since=<ts>` for polling replacement; SSE `/api/events` pushes `{type, ids}` hints.
- Device API (`/v1/*`): same contract, but `/v1/targets` becomes a **cursor-paged phone list** and `/v1/workspace` is replaced by paged leads/tasks.

## 8. Migration from the current JSON store
1. **Backup:** copy `crm.sqlite*` and keys; abort if the copy fails. Run only against a copy first.
2. **Dry run** (`node scripts/migrate-phase1.mjs --dry-run <db>`): reads `records`, prints counts per kind, rows that would be skipped or merged, phone collisions, unmapped stages/dispositions, orphan references; writes nothing.
3. **Mapping:**
   | Current | New |
   |---|---|
   | stage New | *New Lead* |
   | stage Prospecting | *Contact Attempted* if no connected call, else *Requirement Discussion* |
   | stage Opportunity | *Interested Customer* |
   | stage Closed + disposition Won | *Won* |
   | stage Closed + disposition Lost/other | *Lost* + reason "Unknown reason" |
   | lead.owner / source / value / list / repeat / firstTouchAt | `owner_id` / `source_id` (created on the fly) / `expected_value` / `list_members` / `is_repeat` / `first_touch_at` |
   | activities (Call/Note/Message/Visit/System) | `activities` (+ `calls` rows for phone-synced calls) |
   | mobileCalls + mobile_audio BLOBs | `calls` + `recordings` (decrypt → re-encrypt to files with a new IV; hashes verified) |
   | tasks | `tasks` |
4. **Duplicates in existing data:** leads sharing a canonical phone are *not* auto-merged. The report lists them; the first (oldest) keeps `phone_e164`, the others keep the number in `phone_display` with `phone_e164 = NULL` and a `duplicate_of` note until you decide to merge.
5. **Idempotent:** `legacy_id` prevents double inserts; re-running resumes.
6. **Verification step:** per-table counts, sampled field-by-field comparison, sum of `total_call_seconds` equals the sum of calls, every recording hash matches. Failure → transaction rolled back, original untouched.
7. **Cutover:** stop server → backup → migrate → run tests → start; rollback = restore the backup (the JSON `records` table is left in place, read-only, for one release).

## 9. Performance targets (to prove in the acceptance run on a 25 k-lead copy)
List page ≤ 100 ms server time; dashboard counts ≤ 150 ms; call upload (`/v1/calls`) does one indexed lookup by `phone_e164` (no table scan); 5,000-row import in one transaction ≤ a few seconds.

## 10. Decisions I need from you
| # | Question | Recommendation |
|---|---|---|
| 1 | Is a phone number **required** for new leads? | Yes for new leads (TeleCRM does this); legacy no-phone leads may stay NULL. |
| 2 | Spelling "Intrested Customer" | Use "Interested Customer"; keep the old spelling as an import alias. |
| 3 | Lifecycle mapping (table in §3), especially *Later Purchase* = prospecting and the three post-sale statuses = customer | Accept as proposed; editable in settings later. |
| 4 | Merge duplicate lost reasons (13 → 10 incl. default) | Yes, with aliases. |
| 5 | Do you want **alternate numbers** that also match calls/WhatsApp? | Yes (`lead_phones`). |
| 6 | Custom fields as a JSON column | Yes. |
| 7 | Existing duplicate leads | Report only; you decide merges (never automatic). |
| 8 | Recordings location | Files under `data/recordings/` on the same volume (encrypted), backed up with the DB; object storage later. |
| 9 | Roles seeded as Admin / Manager / Caller / Marketing | Yes; map current admin → Admin, member → Caller. |

## 10a. AI tables (added after the product direction became "AI-first")
Phase 1 also creates `ai_jobs`, `transcripts` (+ FTS), `insights`, `agents`, `proposals`, `agent_runs`, `knowledge_docs`, `ai_feedback` and `policy`; definitions are in [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) §5. `calls` gains no extra columns: transcript and summary hang off `call_id` / `insights.source_id`. Recording notice, quiet hours and the kill switch are rows in `policy`, controlled by the owner.

## 11. Work breakdown once approved
1. Migration framework + `001_schema.sql` + seeds + tests (S).
2. Data-access layer (`store.mjs`) with the §6 rules; shim so existing screens keep working (M).
3. Paged APIs + `/api/meta` + `/api/dashboard` + changes/SSE (M).
4. Device API on the new tables (targets paging, calls, recordings as files) (S–M).
5. Migration script with dry run, verification and rollback; rehearsal on a copy of production data (M).
6. Performance run on 25 k leads; fix hot spots (S).
