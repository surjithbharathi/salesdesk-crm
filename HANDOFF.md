# Salesdesk CRM — development handoff

Updated 22 October 2026. Repository: https://github.com/surjithbharathi/salesdesk-crm, branch main.

## Latest checkpoint

- Latest application source before this documentation update: 7c74fc4e115c87f6a78db0cf8eb617e21e45ca83.
- Android v0.9.0 / versionCode 6 includes the native UI redesign, Lucide icons and filename-independent recording matcher. Source is synchronized to the original Mac workspace.
- Online-origin debug APK assemble/lint pass on the Mac. All 42 CRM regression tests and 12 standalone RecordingMatcher tests pass. Warnings remain; build success is not a complete physical-device acceptance pass.
- The original Mac debug signing setup is available locally. The phone is disconnected, so certificate compatibility with its installed app and an in-place upgrade remain unverified. Do not uninstall the existing app to bypass a signing mismatch.
- The approved Salesdesk-only Hostinger image update completed. Container workflow 39798710184 succeeded for implementation bcc38be1832007578908e44ecdef38a840b45c24. hPanel confirmed Application updated. Live app.js includes refreshSyncedCalls; auth status returns 200 and unauthenticated protected web/device APIs return 401. Other Docker projects stayed running.
- Later Android-only commits do not require a web redeployment. Check the current image/source before future updates.
- Private runtime data, credentials, call examples, recording details, screenshots, signing keys and APKs are intentionally excluded from this public handoff.

## Local setup

Use Node.js 22.13+ (22.22.x tested on the Mac).

```sh
git clone https://github.com/surjithbharathi/salesdesk-crm.git
cd salesdesk-crm
npm ci
npm run check
npm test
npm start
```

Local web is http://localhost:3100; the device API uses port 3101. A fresh checkout creates its own local demo workspace, not production data. Never overwrite the production database with a fresh or stale local copy.

Read README.md, FEATURE_PARITY.md, MOBILE_SYNC.md, CLICK_TO_CALL.md, WHATSAPP.md, DEPLOYMENT.md, android-companion/UI_REDESIGN.md and design-qa.md. Historical notes are evidence-qualified; this is not complete Salesmax/Twenty/Frappe feature parity.

## Android build and signing

Install JDK 17, Gradle 9.1.0, Android SDK 36 and platform-tools. AGP 9.0.1 is configured by the project. No Gradle wrapper binary is committed.

```sh
cd android-companion
gradle :app:assembleDebug :app:lintDebug -PcrmApiOrigin=https://salesdesk-crm.srv1696974.hstgr.cloud
adb devices
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Verify the phone is idle and the signing certificate matches before installation. A different computer usually creates a different debug key and cannot update the installed package. Keep the original signing key private; never commit it or uninstall the app without explicit approval. Uninstalling loses the private queue/session and may require permissions/folder access again.

The separate crmPreview=true build uses a distinct preview package and does not upgrade the original app. A preview build/installation is not production acceptance. The online origin must be supplied at build time; ordinary users sign in with their CRM account, not an IP/origin field. Changing origin invalidates the old endpoint's login/consent.

## Implemented areas

- Web CRM: leads, Kanban, tasks, activity, reports, internal collaboration and draft-only automation. Consult FEATURE_PARITY.md for precise scope and unconnected integrations.
- Shared authenticated web/mobile user identity, scoped APIs, encrypted recording storage, user-managed permissions and explicit sync/background-call opt-ins.
- Android Home, Leads, Calls, Tasks and grouped Settings, scrollable forms, native due-date/time selection and consistent Lucide navigation.
- Foreground notification-backed web-to-SIM calling. No unconditional always-on guarantee: reboot, force stop, OEM battery restrictions, expired sessions or connectivity can stop availability.
- Call-log observer uses a 20-second settling delay, 45/90-second recording retries and a minute fallback while the app or opted-in bridge runs. The periodic Android job remains a fallback when those stop. Metadata uploads before audio scanning.
- Recording matching uses call timing and duration rather than filenames, requires unique one-to-one candidates and fails closed on ambiguity/scan bounds. Nearby non-business calls block ambiguous matches without persisting their details. Existing attachments cannot be reused automatically.
- Web call views poll changed synced-call data every three seconds without interrupting active forms, modals or audio.
- WhatsApp is Baileys sync-only for matched incoming and manually outgoing individual text. Manual drafts open WhatsApp Web; no CRM bulk/auto-send. Unofficial-client account restriction risk remains.
- Operator-issued password recovery is implemented and tested. Do not issue a reset or revoke sessions simply because old task notes mention recovery.

## Deployment

Online CRM: https://salesdesk-crm.srv1696974.hstgr.cloud. Existing Hostinger project: salesdesk-crm. Keep all other VPS projects unchanged.

1. Wait for Build Salesdesk deployment image to succeed for the desired implementation.
2. Inspect current Hostinger Docker projects, then update only salesdesk-crm via Actions → Update.
3. Verify live source and authenticated behavior; protected APIs must still reject unauthenticated access.
4. Reuse the existing private data volume. Never recreate projects or overwrite production storage during an ordinary code update.

The source-only image is ghcr.io/surjithbharathi/salesdesk-crm:latest, also tagged by commit. Database, keys, uploads and sessions stay outside GitHub/images. Local and production databases are not live replicas. Android binary updates are separate from server deployments.

## Remaining acceptance work

1. Reconnect/unlock the phone, verify signing compatibility and perform a non-destructive in-place v0.9.0 upgrade.
2. Complete five-screen, form/keyboard, filtering, large-font, landscape and scroll checks. Earlier partial evidence is not a full visual acceptance pass.
3. With a user-authorized, consenting assigned-lead call, measure actual call-end → CRM delay, check duplicate prevention and automatic recording attachment/playback. No new real call should be placed without an approved number.
4. Verify personal-call exclusion, ambiguity handling, offline retries and recording-folder compatibility without weakening consent or scope checks.
5. Verify live Baileys round-trip behavior with an authorized account. Synthetic tests are not live-provider verification.
6. Plan release signing, secure distribution and device compatibility. No app-store release or automatic Android update pipeline is provisioned.

## Suggested continuation prompt

## New work: source-based internal automation

The requested feature must use the n8n source editor and engine inside Salesdesk. An external-instance connector or a separate employee portal does not meet the request. Use the Community source only for internal employees under its terms. Do not bypass paid feature gates or remove required notices.

The official source is pinned to `n8n@2.44.6`, commit `b58d9e89d60e9a3485bb511c5091d8be0d9511e4`. The original Mac has a separate source checkout with dependencies installed using isolated Node 24.22.1 and pnpm 12.4.2. The CRM Node runtime and live deployment were not changed. `automation/source.lock.json` and `scripts/n8n-source.mjs` reproduce source setup on another computer. See `automation/README.md`.

This is source/build preparation, **not a working inbuilt editor**. Editor integration, an original CRM identity adapter, per-employee workflow/credential ownership, Salesdesk nodes, engine isolation, execution tests and deployment are still required. Do not replace the requested source integration with a configured n8n URL. Do not report it as finished from a successful dependency install.

Read HANDOFF.md, android-companion/UI_REDESIGN.md and MOBILE_SYNC.md. Continue from main. The web call-refresh update is deployed; v0.9.0 builds on the original Mac. Preserve all runtime data and the installed app. With the phone connected, verify signing compatibility, perform an in-place update and finish UI, automatic matching and latency acceptance. Ask before real calls, credential changes or destructive actions.
