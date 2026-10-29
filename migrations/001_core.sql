-- Phase 1 core schema. See docs/PHASE1_SCHEMA.md.
-- Conventions: TEXT UUID ids, ISO-8601 UTC timestamps, legacy_id for migrated rows.

-- ---------------------------------------------------------------- reference data
CREATE TABLE statuses (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  stage_group TEXT NOT NULL CHECK (stage_group IN ('FRESH','ACTIVE','WON','LOST')),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('new','prospecting','opportunity','customer','closed')),
  sort INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE status_aliases (
  alias TEXT PRIMARY KEY COLLATE NOCASE,
  status_id TEXT NOT NULL REFERENCES statuses(id)
);

CREATE TABLE lost_reasons (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  is_default INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL
);
CREATE UNIQUE INDEX lost_reasons_one_default ON lost_reasons(is_default) WHERE is_default = 1;
CREATE TABLE lost_reason_aliases (
  alias TEXT PRIMARY KEY COLLATE NOCASE,
  lost_reason_id TEXT NOT NULL REFERENCES lost_reasons(id)
);

CREATE TABLE lead_sources (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kind TEXT,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT
);
CREATE TABLE call_outcomes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  polarity TEXT NOT NULL CHECK (polarity IN ('positive','negative','neutral')),
  effect TEXT NOT NULL CHECK (effect IN ('none','open_opportunity','close_lead','keep_prospecting')),
  sort INTEGER NOT NULL
);
CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  permissions TEXT NOT NULL CHECK (json_valid(permissions))
);
CREATE TABLE task_types (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE field_defs (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL DEFAULT 'lead',
  api_name TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text','number','date','dropdown','multi','phone','email','url','bool')),
  options TEXT CHECK (options IS NULL OR json_valid(options)),
  group_name TEXT NOT NULL DEFAULT 'Others',
  sort INTEGER NOT NULL DEFAULT 0,
  searchable INTEGER NOT NULL DEFAULT 0,
  required INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  UNIQUE (entity, api_name)
);

-- ---------------------------------------------------------------- people
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role_id TEXT REFERENCES roles(id),
  active INTEGER NOT NULL DEFAULT 1,
  calling_language TEXT,
  legacy_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  gstin TEXT,
  city TEXT,
  state TEXT,
  legacy_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ---------------------------------------------------------------- leads
CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- Canonical phone (digits with country code, see phone.mjs). NULL only for legacy leads without one.
  phone_e164 TEXT UNIQUE CHECK (
    phone_e164 IS NULL OR (
      length(phone_e164) BETWEEN 8 AND 15
      AND phone_e164 NOT GLOB '*[^0-9]*'
      AND substr(phone_e164, 1, 1) <> '0')),
  phone_display TEXT,
  email TEXT,
  company TEXT,
  city TEXT,
  state TEXT,
  place TEXT,
  business_id TEXT REFERENCES businesses(id),
  -- Source is captured once and never overwritten; repeat enquiries update latest_source_id only.
  first_source_id TEXT REFERENCES lead_sources(id),
  latest_source_id TEXT REFERENCES lead_sources(id),
  lead_type TEXT,
  owner_id TEXT REFERENCES users(id),
  status_id TEXT NOT NULL REFERENCES statuses(id),
  lost_reason_id TEXT REFERENCES lost_reasons(id),
  rating INTEGER CHECK (rating BETWEEN 0 AND 5),
  expected_value INTEGER CHECK (expected_value IS NULL OR expected_value >= 0),
  product_interested TEXT,
  product_name TEXT,
  required_capacity TEXT,
  purchase_timeline TEXT,
  customer_type TEXT,
  customer_language TEXT,
  preferred_language TEXT,
  lead_protection TEXT NOT NULL DEFAULT 'Normal' CHECK (lead_protection IN ('Normal','Protected')),
  do_not_call INTEGER NOT NULL DEFAULT 0,
  do_not_email INTEGER NOT NULL DEFAULT 0,
  do_not_track INTEGER NOT NULL DEFAULT 0,
  whatsapp_opt_out INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  custom TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(custom)),
  -- Work metrics: maintained by the write path, never edited by users.
  is_repeat INTEGER NOT NULL DEFAULT 0,
  repeat_count INTEGER NOT NULL DEFAULT 0,
  first_touch_at TEXT,
  last_activity_at TEXT,
  last_call_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  call_count INTEGER NOT NULL DEFAULT 0,
  connected_count INTEGER NOT NULL DEFAULT 0,
  total_call_seconds INTEGER NOT NULL DEFAULT 0,
  next_followup_at TEXT,
  assigned_at TEXT,
  assigned_by TEXT,
  previous_owner_id TEXT,
  status_changed_at TEXT,
  archived_at TEXT,
  captured_at TEXT,
  capture_count INTEGER NOT NULL DEFAULT 1,
  duplicate_of TEXT,
  legacy_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX leads_owner_status ON leads(owner_id, status_id) WHERE archived_at IS NULL;
CREATE INDEX leads_status_updated ON leads(status_id, updated_at DESC, id);
CREATE INDEX leads_followup ON leads(next_followup_at) WHERE next_followup_at IS NOT NULL;
CREATE INDEX leads_created ON leads(created_at DESC, id);
CREATE INDEX leads_untouched ON leads(owner_id) WHERE first_touch_at IS NULL AND archived_at IS NULL;
CREATE INDEX leads_first_source ON leads(first_source_id, created_at);
CREATE INDEX leads_legacy ON leads(legacy_id) WHERE legacy_id IS NOT NULL;

-- Alternate numbers; globally unique so calls and messages match any number of a lead.
CREATE TABLE lead_phones (
  phone_e164 TEXT PRIMARY KEY CHECK (
    length(phone_e164) BETWEEN 8 AND 15
    AND phone_e164 NOT GLOB '*[^0-9]*'
    AND substr(phone_e164, 1, 1) <> '0'),
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'alternate',
  created_at TEXT NOT NULL
);
CREATE INDEX lead_phones_lead ON lead_phones(lead_id);

-- A number may not belong to two different leads, across both tables.
CREATE TRIGGER lead_phones_no_clash BEFORE INSERT ON lead_phones
WHEN EXISTS (SELECT 1 FROM leads WHERE phone_e164 = NEW.phone_e164 AND id <> NEW.lead_id)
BEGIN SELECT RAISE(ABORT, 'phone number already belongs to another lead'); END;
CREATE TRIGGER leads_phone_no_clash_insert BEFORE INSERT ON leads
WHEN NEW.phone_e164 IS NOT NULL AND EXISTS (SELECT 1 FROM lead_phones WHERE phone_e164 = NEW.phone_e164 AND lead_id <> NEW.id)
BEGIN SELECT RAISE(ABORT, 'phone number already belongs to another lead'); END;
CREATE TRIGGER leads_phone_no_clash_update BEFORE UPDATE OF phone_e164 ON leads
WHEN NEW.phone_e164 IS NOT NULL AND EXISTS (SELECT 1 FROM lead_phones WHERE phone_e164 = NEW.phone_e164 AND lead_id <> NEW.id)
BEGIN SELECT RAISE(ABORT, 'phone number already belongs to another lead'); END;

-- first_source_id is write-once.
CREATE TRIGGER leads_first_source_locked BEFORE UPDATE OF first_source_id ON leads
WHEN OLD.first_source_id IS NOT NULL AND NEW.first_source_id IS NOT OLD.first_source_id
BEGIN SELECT RAISE(ABORT, 'first_source_id cannot be changed'); END;

CREATE TABLE lead_tags (
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id),
  PRIMARY KEY (lead_id, tag_id)
);
CREATE TABLE lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'static',
  owner_id TEXT,
  legacy_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE list_members (
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  PRIMARY KEY (list_id, lead_id)
);

-- ---------------------------------------------------------------- calls, activity, tasks
CREATE TABLE calls (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  user_id TEXT REFERENCES users(id),
  device_id TEXT,
  local_id TEXT,
  phone_e164 TEXT NOT NULL CHECK (
    length(phone_e164) BETWEEN 8 AND 15 AND phone_e164 NOT GLOB '*[^0-9]*' AND substr(phone_e164, 1, 1) <> '0'),
  direction TEXT NOT NULL CHECK (direction IN ('Incoming','Outgoing','Missed','Rejected')),
  started_at TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds BETWEEN 0 AND 86400),
  connected INTEGER NOT NULL CHECK (connected IN (0,1)),
  outcome_id TEXT REFERENCES call_outcomes(id),
  note TEXT,
  source TEXT NOT NULL DEFAULT 'phone',
  recording_id TEXT,
  match_mode TEXT,
  legacy_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (device_id, local_id)
);
CREATE INDEX calls_lead_time ON calls(lead_id, started_at DESC);
CREATE INDEX calls_user_time ON calls(user_id, started_at DESC);
CREATE INDEX calls_needs_outcome ON calls(user_id, started_at DESC) WHERE outcome_id IS NULL AND connected = 1;

CREATE TABLE recordings (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL UNIQUE REFERENCES calls(id),
  device_id TEXT,
  sha256 TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  storage_path TEXT NOT NULL,
  iv BLOB NOT NULL,
  tag BLOB NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (device_id, sha256)
);

CREATE TABLE action_defs (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(fields)),
  allow_backdate INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  direction TEXT CHECK (direction IN ('Incoming','Outgoing')),
  source TEXT NOT NULL DEFAULT 'manual',
  user_id TEXT REFERENCES users(id),
  occurred_at TEXT NOT NULL,
  text TEXT,
  data TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data)),
  call_id TEXT REFERENCES calls(id),
  legacy_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX activities_lead_time ON activities(lead_id, occurred_at DESC, id);
CREATE INDEX activities_user_time ON activities(user_id, occurred_at DESC);
CREATE INDEX activities_type_time ON activities(type, occurred_at DESC);
CREATE INDEX activities_call ON activities(call_id) WHERE call_id IS NOT NULL;

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE,
  owner_id TEXT REFERENCES users(id),
  type_id TEXT REFERENCES task_types(id),
  title TEXT NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Open','In progress','Done','Cancelled')),
  origin TEXT NOT NULL DEFAULT 'User',
  rule_id TEXT,
  completed_at TEXT,
  legacy_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX tasks_owner_due ON tasks(owner_id, due_at) WHERE status NOT IN ('Done','Cancelled');
CREATE INDEX tasks_lead ON tasks(lead_id);

CREATE TABLE views (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT,
  shared INTEGER NOT NULL DEFAULT 0,
  filter TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(filter)),
  columns TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(columns)),
  sort TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(sort)),
  sort_order INTEGER NOT NULL DEFAULT 0
);
