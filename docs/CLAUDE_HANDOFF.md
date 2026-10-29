# Continue this project in Claude Code

## Checkout and verification

```sh
git clone --branch codex/crm-release-20261029 https://github.com/surjithbharathi/salesdesk-crm.git
cd salesdesk-crm
npm ci
npm run check
npm test
```

The branch has the deployed web application source at the root, current native Android source in `android-companion/`, the external n8n custom node in `integrations/n8n/`, and tests. The original GitHub main was older; PR #1 holds the checkpoint. Some older repository docs/workflows inherited from main describe embedded n8n and are historical. These current handoff docs override that obsolete product direction.

## First local run (empty, synthetic development database)

The server's bootstrap UI expects an existing CRM user record. A completely empty checkout therefore needs one local user record before account setup:

```sh
node scripts/init-local.mjs
. ./.env.local
node server.mjs
```

Open http://localhost:3100 and create your own development administrator password in the setup UI. Mobile API is http://localhost:3101. This HTTP mode tests one workspace; the global workspace gateway is a separate HTTPS/Host-routing setup. Do not reuse production passwords. Do not use init-local against downloaded production data. It refuses existing database files and production environment settings.

`npm start` runs `workspace-gateway.mjs`, which requires an HTTPS `PUBLIC_ORIGIN`; it will not run with a plain localhost origin. It also needs an existing initialized database and an explicitly approved global owner ID to expose global management. For Host-routing examples see `workspace-http-smoke.mjs` and `workspace-seed-smoke.mjs`; those use synthetic identities and must only run in isolated data directories/containers.

## Current product decisions

- Surjith Bharathi is the global Ultra Admin; login username is case-insensitively `Surjith`. Password is not provided here. His stable internal ID is a private runtime setting, not source configuration.
- Hierarchy: Ultra Admin > Super Admin > Admin > Manager > Caller. Internal compatibility role codes differ; see architecture docs.
- The user explicitly requested clearing the old Demo workshop data. The control database was renamed Administration; at that checkpoint only the global account remained. A private backup exists. Do not restore demo records automatically or assume later live data is still empty.
- Workspace owners can add users, roles and permissions and issue setup links. No public signup/subscription billing exists.
- Hostinger SMTP settings have been built. Mailbox creation was deferred. SMTP was disabled/unconfigured at last verification. Save does not send mail. Test and reset/invitation emails are explicit actions. No OTP login/public forgot-password flow yet.
- Product naming is undecided. Tamil names were being explored; none was approved.
- Keep UI lean and follow-up/calling focused. See CLAUDE.md for menu decisions and WhatsApp/n8n constraints.

## Suggested first message to Claude Code

“Read CLAUDE.md and docs/CLAUDE_HANDOFF.md. Verify the current branch and tests, summarize the architecture and pending features, then ask what feature I want next. Do not deploy, seed production, restore demo data, connect my phone or send messages unless I ask.”

## Verification and boundaries

The source-only checkpoint passed clean npm ci, syntax checks and 24 unit/regression tests. Separate temporary-container HTTP checks verified cross-workspace sessions, Viewer denial, owner lockout, suspension and SMTP setting isolation. SMTP sends were stubbed. No live mailbox delivery was tested. The newly assembled standalone Dockerfile was not rebuilt as part of the GitHub upload; production used incremental images. Verify a fresh Docker build before deployment.

Android source was uploaded but not rebuilt or phone-tested during this handoff. It is version 0.12.1/code 12, SDK 36, Java 17, AGP 9.0.1. A USB device and the correct signing certificate are needed for an in-place update. User's original Mac project/build cache is on an SSD; that local mount is not a portable dependency.
