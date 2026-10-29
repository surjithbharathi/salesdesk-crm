# Open-source CRM review: what we take, what we avoid

Reviewed on 29 Oct 2026 from the public GitHub pages of the most-starred CRM repositories. **Licences decide what we may copy.** This repository is public and is the owner's own product, so copying copyleft code would force the whole project under that licence. Rule used below: *reuse code only from permissive licences; from copyleft projects take ideas and public behaviour only, never code; integrate with them over their APIs instead.*

| Repository | Stars | Licence (as shown by GitHub) | Use for us |
|---|---|---|---|
| twentyhq/twenty | ~60k | Custom (AGPL core, commercial `ee/` parts) | **Ideas only:** custom objects and fields, saved views, table + kanban on the same data, keyboard-first UX. No code. |
| frappe/erpnext | ~41k | GPL-3.0 | **Integrate by API** (the owner already runs ERPNext): won deal → customer/sales order, payments → payment entry. No code. |
| hcengineering/platform (Huly) | ~28k | EPL-2.0 | Skip (file-level copyleft, broad scope). |
| monicahq/monica | ~26k | AGPL-3.0 | Skip (personal CRM). |
| nocobase/nocobase | ~25k | Custom | Skip (low-code platform, different product). |
| **krayin/laravel-crm** | ~24k | **MIT** | **Reuse ideas and, if useful, code with notice:** lead pipeline with stages and win probability, quotes with products/tax/PDF, web-form lead capture, email templates, workflow rules, import/export module. |
| Dolibarr, SuiteCRM, Idurar, Gauzy | 6–10k | GPL / AGPL | Ideas only (quotation and ticket flows). No code. |
| **melgarafael/DeskcommCRM** | ~5k | **MIT** | **Closest match to our AI-first goal.** Reuse design (and code where it fits, with notice): see below. |
| macro-inc/macro | ~5.6k | AGPL-3.0 | Ideas only (AI memory shared across tools). |

## What we borrow from DeskcommCRM (MIT, AI sales OS built around WhatsApp)
Its public roadmap lists many pieces we already planned, which confirms the direction and gives tested patterns:
- **Agents with per-tenant knowledge (RAG), executable "skills", organisation memory, intent router, sentiment analysis, human hand-off, and a spending cap per organisation** → our `agents`, `knowledge_docs`, `proposals`, `policy` (docs/AI_ARCHITECTURE.md).
- **"Living follow-up":** resumes cooled conversations with adaptive timing, stage- and case-based triggers, a queue with round-robin, and a **radar of conversations about to die without a reply** → our Sales agent, daily work plan and "stalled deals" list.
- **WhatsApp protection:** throttle with jitter, working-hours window, daily cap, STOP/opt-out detection, visible reason when a message is held → our WhatsApp policy (`policy` table) and the official-API-first decision. (They also offer an unofficial QR engine; we keep that read-only.)
- **When / If / Then automation rules and webhook sources**, **append-only audit log**, **4-role RBAC enforced server-side**, **AI as a first-class assignee**, **customer 360 view**, **3-pane inbox**.
- **Product decisions to copy:** configurable pipeline vocabulary per niche, trial templates, and a self-update screen with automatic backup.
- **Cautions from its own docs:** keep the schema in one baseline, test tenant isolation, and make the installer idempotent.

## What we borrow from Krayin (MIT)
- Lead → opportunity model with **stage probabilities** (used for the forecast), **quotes** (items, tax, totals, PDF), **web forms** that create leads, **email templates**, **workflows**, and the **import/export** screen design. Module boundaries (`Lead`, `Quote`, `Product`, `Automation`, `WebForm`, `DataTransfer`) are a good checklist for our own folders.

## What we do not do
- No copy-paste from AGPL/GPL/EPL/custom-licence projects.
- No second CRM platform inside ours (Twenty, SuiteCRM): they would duplicate the data model we have just built and the owner would have two systems to maintain.
- No new framework that conflicts with the Node + SQLite deployment already running on the owner's VPS, until the data layer is proven.

## Concrete additions to the plan
1. **Radar of at-risk leads** (no reply, promised-but-unsent quotation, stalled stage) in Phase 2 dashboard; queries come from existing tables.
2. **Pipeline stage probability** column on `statuses` for forecasts (Phase 8).
3. **WhatsApp send protection** settings (window, pace, daily cap, STOP detection) in `policy` before any sending is enabled (Phase 5).
4. **Audit log** table appended by `store.mjs` for every write (Phase 1 follow-up).
5. **Agent spending cap and skills registry** wired to `agents` and `ai_jobs` (Phase 2–3).
6. **Web forms** as a lead source (Phase 3) following Krayin's design.
