# AI-first architecture

Goal: the company's customer relations, sales and conversion work is carried out by AI agents working on top of one CRM data model; people supervise, correct and handle exceptions. Every conversation (call, WhatsApp, form, email) becomes structured knowledge, and that knowledge drives the next action.

## 1. The core loop
```
 capture ──► understand ──► decide ──► act ──► learn
 (call, chat,   (transcribe,   (next best   (draft/send,   (outcome,
  form, email)   summarise,     action,       task, update   human edits,
                 extract)       priority)     fields)        results)
```

### Call pipeline (first thing built)
1. **Record** — the phone app uploads the recording (existing matcher + streaming upload).
2. **Transcribe** — speech-to-text job (Tamil, Hindi, English, code-switching), word timestamps and speaker turns (rep / customer).
3. **Summarise and extract** — one structured result per call: summary, customer language, machine/application, capacity and power, budget, timeline, quotation asked/promised, objections, sentiment, decision stage, closure likelihood, commitments made by the rep, next action with date.
4. **Apply** — fields on the lead are filled as *suggestions with confidence*; high-confidence, low-risk fields are written automatically (requirement, capacity, language), everything else waits for one-tap approval.
5. **Decide the next step** — the Sales agent turns the extraction into a task, a WhatsApp/quotation draft or a status change proposal.
6. **Learn** — rep corrections are stored and used as examples/evaluation for the next calls.

The same pipeline runs for WhatsApp threads, voice notes, emails and form enquiries (text in, same structured output).

## 2. Agents
Each agent = a role prompt + allowed tools + autonomy level + knowledge scope. All share one runtime.

| Agent | Trigger events | Tools (CRM API) | Default autonomy |
|---|---|---|---|
| Lead Qualifier | lead created, inbound message, missed call | read/update lead, ask questions on WhatsApp, assign, create task | L3 for FAQ/data entry; L2 for assignment changes |
| Sales | call summarised, quotation viewed, no reply for N days | draft message, schedule follow-up, create quotation draft, update status proposal | L2 (drafts, human sends) |
| Customer Relations / Service | ticket opened, delivery done, spare request | ticket CRUD, schedule service, message customer | L2 |
| Conversion Manager | nightly, stage stalls, lost lead | pipeline analysis, reassign proposals, coaching notes | L1 (suggest) |
| Ops | payment/dispatch/loan events | payment follow-up drafts, document checklist, ERP sync | L2 |
| Owner Assistant | owner question, morning schedule | read-only queries, report generation | L1 |
| Voice (later) | scheduled outbound campaign | place call via telephony provider | L1 until proven |

Autonomy levels: **L1** suggest · **L2** draft, human approves · **L3** act automatically inside rules and limits · **L4** full autonomy (not offered at launch).

**Always human-approved regardless of level:** prices and discounts, delivery dates, payment amounts or terms, deleting data, changing a lead's owner against Lead Protection, bulk sends.

## 3. Runtime components
- **Event bus** (table `events` + in-process dispatcher): every write emits `{type, entity, id, at}`; agents subscribe; retries and dead-letter handling.
- **Job queue** (`ai_jobs`): transcription, summarisation, embedding, agent runs; priorities, attempts, timeouts, per-job cost cap.
- **Agent runner:** builds context (lead timeline, latest summaries, knowledge snippets, playbook) → calls the model with a fixed toolset → validates tool calls against permissions → writes results as *proposals* or direct actions per autonomy level.
- **Knowledge base:** products, specs, prices (read-only source of truth), FAQs, the sales playbook (voice, ideal customer, objection handling, competitors), past won/lost conversations. Retrieval = full-text first, embeddings (`sqlite-vec` or a small vector store) when needed.
- **Provider abstraction:** one interface for speech-to-text, chat/reasoning and embeddings; models configurable per task (small model for classification, larger for conversations); fallback provider; no vendor lock-in.
- **Approval inbox:** every proposal shows what, why, evidence (call excerpt/timestamp) and cost; approve, edit, reject.
- **Controls:** per-agent on/off, global kill switch, daily/monthly budget, rate limits, working hours, per-customer opt-outs (Do-Not-Track, WhatsApp opt-out) always honoured.
- **Audit and evaluation:** each action stores prompt version, model, inputs used, output, who approved, cost, and the eventual outcome; a weekly accuracy report (summary correctness, field accuracy, approval rate, edit rate, conversion impact).

## 4. Language and quality
- Customer language is detected from the conversation, never from name, number or location. Unknown stays Unknown.
- Replies follow the customer's language and the owner's tone guide; Tamil, Hindi, English and mixed text are tested with a fixed evaluation set built from real (anonymised) calls.
- No invented facts: price, specification, availability, warranty and delivery come only from the knowledge base or an explicit human input; otherwise the agent says it will check.
- Every extracted fact keeps a pointer to its evidence (transcript time or message id) so a person can verify in one click.

## 5. Data (tables created in Phase 1, used from Phase 2)
```sql
CREATE TABLE ai_jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, entity TEXT, entity_id TEXT, status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 5, attempts INTEGER NOT NULL DEFAULT 0, max_cost_usd REAL, cost_usd REAL,
  input TEXT, output TEXT, error TEXT, run_after TEXT, started_at TEXT, finished_at TEXT, created_at TEXT NOT NULL);
CREATE INDEX ai_jobs_queue ON ai_jobs(status, priority, run_after);

CREATE TABLE transcripts (id TEXT PRIMARY KEY, call_id TEXT UNIQUE REFERENCES calls(id), language TEXT,
  provider TEXT, segments TEXT NOT NULL,           -- JSON [{start,end,speaker,text}]
  full_text TEXT NOT NULL, confidence REAL, created_at TEXT NOT NULL);
CREATE VIRTUAL TABLE transcripts_fts USING fts5(full_text, content='transcripts', content_rowid='rowid');

CREATE TABLE insights (id TEXT PRIMARY KEY, lead_id TEXT NOT NULL REFERENCES leads(id), source_type TEXT NOT NULL, source_id TEXT NOT NULL,
  kind TEXT NOT NULL,                                -- call_summary, thread_summary, lead_brief, score
  data TEXT NOT NULL,                                -- structured JSON (fields above)
  evidence TEXT, model TEXT, prompt_version TEXT, confidence REAL, created_at TEXT NOT NULL);

CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, role TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
  autonomy INTEGER NOT NULL DEFAULT 1 CHECK (autonomy BETWEEN 1 AND 4), tools TEXT NOT NULL, knowledge_scope TEXT,
  prompt_version TEXT, daily_budget_usd REAL, working_hours TEXT, updated_at TEXT NOT NULL);

CREATE TABLE proposals (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id), lead_id TEXT REFERENCES leads(id),
  action TEXT NOT NULL, payload TEXT NOT NULL, reason TEXT, evidence TEXT, risk TEXT NOT NULL,    -- low|needs_approval|blocked
  status TEXT NOT NULL DEFAULT 'pending',            -- pending|approved|edited|rejected|auto_applied|expired
  decided_by TEXT, decided_at TEXT, edited_payload TEXT, outcome TEXT, created_at TEXT NOT NULL);
CREATE INDEX proposals_pending ON proposals(status, created_at) WHERE status = 'pending';

CREATE TABLE agent_runs (id TEXT PRIMARY KEY, agent_id TEXT, trigger_event TEXT, model TEXT, prompt_version TEXT,
  input_ref TEXT, output TEXT, tool_calls TEXT, cost_usd REAL, latency_ms INTEGER, created_at TEXT NOT NULL);
CREATE TABLE knowledge_docs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  language TEXT, version INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);
CREATE TABLE ai_feedback (id TEXT PRIMARY KEY, target_type TEXT NOT NULL, target_id TEXT NOT NULL, user_id TEXT, verdict TEXT, correction TEXT, created_at TEXT NOT NULL);
CREATE TABLE policy (key TEXT PRIMARY KEY, value TEXT NOT NULL);   -- e.g. recording_notice, quiet_hours, kill_switch
```

## 5a. Policies are settings, not hard-coded
Whether a notice is played or sent about call recording, quiet hours, opt-out handling and similar rules live in `policy` so the owner controls them. The software records the active policy with every recording and AI action, so any later review can see what was in force. Privacy law (for example India's DPDP Act, 2023) applies to recordings and AI processing of personal data; ask a lawyer which notice and retention rules your business needs before relying on any default.

## 6. Build order (replaces the earlier phase order)
0. **Stabilise** (done on `phase0/stabilize`).
1. **Data layer + lead model + AI tables** (docs/PHASE1_SCHEMA.md plus §5 here).
2. **Call intelligence:** streaming recording upload → transcription job → structured summary → suggested fields and tasks; approval inbox UI; evaluation set from 50 real calls.
3. **Lead Qualifier + WhatsApp (official API):** new chat → lead, media and voice notes understood, FAQ answers from the knowledge base, hand-off rules.
4. **Sales agent:** follow-up sequences, quotation drafts, objection handling, stalled-deal nudges; daily work plan per rep.
5. **Owner Assistant + Conversion Manager:** natural-language questions over CRM data, morning brief, pipeline and lost-reason analysis, rep coaching.
6. **Service/Customer Relations + Ops agents:** tickets, spares, delivery follow-up, payment and loan documents, ERPNext sync.
7. **Voice agent** (outbound/inbound calls in Tamil) only after the text agents meet agreed accuracy targets.
8. **Autonomy review:** per agent, raise L2→L3 only where the weekly report shows low edit/reject rates.

## 6a. Post-call workflow (owner requirement)
1. **Call ends** → the phone app records the call and immediately shows a *disposition sheet* (outcome, one-line feedback, next follow-up). A connected call stays in "needs disposition" until answered, so no call finishes without the rep's own verdict.
2. **Transcript + summary arrive** (minutes later). The Sales agent reads them and proposes, in one card for the rep:
   - **Machines the customer asked about**, matched to the product catalogue (model, capacity, power) with the exact words and call timestamp as evidence;
   - **Quotation needed?** If yes, a task "Prepare quotation for <machines>" assigned to the rep, with a pre-filled quotation draft whose prices come only from the price list (never invented);
   - Next action and date, status-change proposal, objections and commitments the rep made.
3. **Rep confirms or edits in one tap.** Differences between the rep's disposition and what the AI inferred are flagged for review and counted as a data-quality metric.
4. When the quotation is shared, the status moves to *Quotation Shared* and a follow-up is scheduled automatically.

## 6b. Scheduled intelligence: lead-source performance (daily / weekly)
Numbers are computed by SQL from the CRM tables; the AI never produces a number. The AI receives the computed facts plus sampled transcripts and writes the explanation.
- **Per source, per period:** leads received, share unique vs repeat vs duplicate, junk %, time to first call, contact rate, connected-call rate, average talk time, qualified %, quotation rate, order rate, revenue, average cycle time, lost-reason mix, and (when cost data is entered) cost per lead / per qualified lead / per order.
- **Verdict:** good / average / weak against the owner's targets or the trailing average, with the sample size and a confidence note ("12 leads: too few to judge").
- **Why a source underperforms:** the AI compares weak sources with strong ones and answers with evidence: lost reasons, objections and wrong-product requests quoted from transcripts, slow first response, wrong region or customer type, repeated no-answer, price complaints. Every reason links to the calls/leads it came from, and is labelled *observed* (data shows it) or *hypothesis* (plausible, not proven).
- **Suggested actions:** pause or fix the source, change routing, adjust the first message, train the team on a recurring objection.
- Delivered as an in-app report plus a short message to the owner at a chosen time; history is kept so trends are comparable.

## 6c. Data accuracy rules (the foundation for all of the above)
- Source is captured once at the moment of capture (`first_source`, never overwritten) plus `latest_source` for repeat enquiries; "Other/Unknown" must be explicit, not blank.
- One canonical phone per lead; duplicates become repeat-enquiry events, so source counts are not inflated.
- Every connected call needs a disposition; every Lost lead needs a reason; AI-filled fields store confidence and evidence, and unconfirmed values are marked as such in reports.
- Reports state their definitions and data coverage (for example "calls from 6 of 8 phones synced") so gaps are visible rather than hidden.
- Report totals are reconciled nightly (sum of source counts = total leads; call minutes = sum of calls) and discrepancies raise an alert.
- Corrections by people always win over AI values and are kept in the audit trail.

## 7. Success measures
First-response time to a new lead; share of leads contacted within 5 minutes; call summaries accepted without edit; fields auto-filled correctly; follow-ups completed on time; stalled-deal recovery; enquiry→quotation and quotation→order conversion; cost per lead handled; human hours saved per week.

## 8. Risks and mitigations
- **Wrong or invented information to customers** → knowledge-base-only facts, approval for money/commitments, evidence links, evaluation set.
- **Tamil/mixed-language accuracy** → measure first on real calls, choose the speech and language models by results, keep human review for low confidence.
- **Cost growth** → job-level caps, small models for routine work, summarise once and reuse, budget alerts.
- **Customer privacy and consent** → policy settings, retention limits, access control to recordings and transcripts, deletion on request.
- **Messaging platform rules** → official WhatsApp API, templates, opt-out, 24-hour window; unofficial clients only for read-only sync.
- **Over-trust** → autonomy raised per agent from measured results, global kill switch, full audit trail.
