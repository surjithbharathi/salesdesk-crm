-- AI layer. See docs/AI_ARCHITECTURE.md.

CREATE TABLE ai_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','cancelled')),
  priority INTEGER NOT NULL DEFAULT 5,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_cost_usd REAL,
  cost_usd REAL,
  input TEXT CHECK (input IS NULL OR json_valid(input)),
  output TEXT CHECK (output IS NULL OR json_valid(output)),
  error TEXT,
  run_after TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ai_jobs_queue ON ai_jobs(status, priority, run_after);
CREATE INDEX ai_jobs_entity ON ai_jobs(entity, entity_id);

CREATE TABLE transcripts (
  id TEXT PRIMARY KEY,
  call_id TEXT UNIQUE REFERENCES calls(id),
  language TEXT,
  provider TEXT,
  segments TEXT NOT NULL CHECK (json_valid(segments)),
  full_text TEXT NOT NULL,
  confidence REAL,
  created_at TEXT NOT NULL
);
-- Tamil vowel signs are combining marks (Mn/Mc); keep them inside words so Tamil text is searchable.
CREATE VIRTUAL TABLE transcripts_fts USING fts5(
  full_text,
  content = 'transcripts',
  content_rowid = 'rowid',
  tokenize = "unicode61 remove_diacritics 0 categories 'L* N* Co Mn Mc'"
);
CREATE TRIGGER transcripts_ai AFTER INSERT ON transcripts BEGIN
  INSERT INTO transcripts_fts(rowid, full_text) VALUES (new.rowid, new.full_text);
END;
CREATE TRIGGER transcripts_ad AFTER DELETE ON transcripts BEGIN
  INSERT INTO transcripts_fts(transcripts_fts, rowid, full_text) VALUES ('delete', old.rowid, old.full_text);
END;
CREATE TRIGGER transcripts_au AFTER UPDATE ON transcripts BEGIN
  INSERT INTO transcripts_fts(transcripts_fts, rowid, full_text) VALUES ('delete', old.rowid, old.full_text);
  INSERT INTO transcripts_fts(rowid, full_text) VALUES (new.rowid, new.full_text);
END;

CREATE TABLE insights (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  evidence TEXT CHECK (evidence IS NULL OR json_valid(evidence)),
  model TEXT,
  prompt_version TEXT,
  confidence REAL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  created_at TEXT NOT NULL
);
CREATE INDEX insights_lead ON insights(lead_id, kind, created_at DESC);
CREATE INDEX insights_source ON insights(source_type, source_id);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  autonomy INTEGER NOT NULL DEFAULT 1 CHECK (autonomy BETWEEN 1 AND 4),
  tools TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tools)),
  knowledge_scope TEXT,
  prompt_version TEXT,
  daily_budget_usd REAL,
  working_hours TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  reason TEXT,
  evidence TEXT CHECK (evidence IS NULL OR json_valid(evidence)),
  risk TEXT NOT NULL CHECK (risk IN ('low','needs_approval','blocked')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','edited','rejected','auto_applied','expired')),
  decided_by TEXT,
  decided_at TEXT,
  edited_payload TEXT CHECK (edited_payload IS NULL OR json_valid(edited_payload)),
  outcome TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX proposals_pending ON proposals(status, created_at) WHERE status = 'pending';
CREATE INDEX proposals_lead ON proposals(lead_id, created_at DESC);

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES agents(id),
  trigger_event TEXT,
  model TEXT,
  prompt_version TEXT,
  input_ref TEXT,
  output TEXT,
  tool_calls TEXT CHECK (tool_calls IS NULL OR json_valid(tool_calls)),
  cost_usd REAL,
  latency_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX agent_runs_agent ON agent_runs(agent_id, created_at DESC);

CREATE TABLE knowledge_docs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  language TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE TABLE ai_feedback (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  user_id TEXT,
  verdict TEXT,
  correction TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ai_feedback_target ON ai_feedback(target_type, target_id);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  data TEXT CHECK (data IS NULL OR json_valid(data)),
  created_at TEXT NOT NULL,
  processed_at TEXT
);
CREATE INDEX events_unprocessed ON events(id) WHERE processed_at IS NULL;

CREATE TABLE policy (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
