# Salesdesk CRM — Claude Code project instructions

Read `docs/CLAUDE_HANDOFF.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/BACKLOG.md`, then `HANDOFF.md` before changing behavior. Current checkpoint: web 0.18.0, 29 October 2026; Android 0.12.1 / code 12. Brand name is not finalized: do not rename the product without the owner's chosen name.

## Working rules

- This is an existing web CRM + native Android companion, not a new project. Preserve functioning call sync, phone deduplication, role checks, tenant boundaries, encryption and MCP approval.
- Latest checkpoint is on `codex/crm-release-20261029`, PR #1. Do not start from old main and overwrite this source. Unrelated personal-assistant/OpenClaw work is not part of this release.
- Develop on a feature branch. Inspect diff and run `npm run check` and `npm test`. Runtime changes need a focused integration test too. Report what was actually tested; do not claim live delivery or phone verification from mocks.
- No real credentials/data are in GitHub. Never request passwords/API keys in chat or commit SQLite files, recordings, SMTP/AI/WhatsApp credentials, tokens, encryption keys, signing keys or local.properties. Keep data directories private and ignored.
- Production is on the NEW VPS only. Do not touch the old VPS. Deployment details and backup rules are in docs/DEPLOYMENT.md. Do not deploy merely because you committed; deploy when the user asks.
- Back up SQLite consistently plus all companion encryption keys and workspace directories before migration. Preserve account IDs/password hashes/lead ownership. Never replace production with a local/test database or run demo seed/reset scripts against it.
- Authenticated web/mobile share a user identity. Ultra Admin is the global control account; Super Admin is a workspace owner. Server permission checks are authoritative. A role label change alone does not implement authorization.
- WhatsApp is synchronization-oriented. Do not add bulk sending or background automatic messages. Keep call synchronization as a built-in CRM feature rather than an integration card.
- n8n stays external, configured per workspace and accessible to workspace admins. Do not reintroduce embedded n8n or per-user automation instances.
- UI should remain simple: Dashboard, Leads, Calls, Messages, To-do, Activity & reports; administrative/integration/import/export options under Settings. No unsolicited products, payments, campaigns or support ticket menus.
- Phone number identity must normalize country code and national number; the same number with/without +91 must not create duplicate leads. Keep country/mobile presentation separate and preserve calls/notes during merge.
- Do not use a connected phone while the user is using it. Ask for a quiet test window before UI navigation or test calls. Do not dial real numbers without authorization.

## Commands

Node >=22.13; `npm ci`; `npm run check`; `npm test` (24 checks at checkpoint). For first local setup, follow the handoff; `npm start` is the HTTPS-host gateway and needs PUBLIC_ORIGIN. For an individual local HTTP dev server use `node server.mjs` after local initialization. `ffmpeg` is required for audio conversion; source Dockerfile installs it.
