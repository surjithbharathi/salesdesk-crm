# Continue Salesdesk CRM on another computer

Updated 22 October 2026. Repository: https://github.com/surjithbharathi/salesdesk-crm, branch `main`.

## Current checkpoint

- Web CRM, native Android source, tests, Docker/Traefik deployment files and feature/reference documentation are in this repository.
- Latest implementation checkpoint: `bcc38be1832007578908e44ecdef38a840b45c24` (mobile UI polish + faster call sync + safe web call refresh). This handoff commit also includes the remaining password-recovery HTTP regression test and updated verification notes.
- Online workspace: https://salesdesk-crm.srv1696974.hstgr.cloud. Production runs in Hostinger Docker project `salesdesk-crm`, alongside independent OpenClaw/WAHA/Traefik projects. Do not stop or overwrite them.
- Android v0.8.3 / versionCode 5 was built, linted and installed successfully. The final install launched before USB disconnected. Existing login and sync/calling opt-ins were preserved. The user previously confirmed real background SIM calling works.
- All 42 local CRM tests pass. Android assemble/lint pass with warnings, no errors. Real new-call sync latency, recording end-to-end behavior and final form/font-scale visual checks are NOT yet verified.
- Deployment of the new web refresh is still pending the container build at this checkpoint. GitHub run: https://github.com/surjithbharathi/salesdesk-crm/actions/runs/39798710184. Do not treat a queued run as deployed. Follow the next section and inspect the latest workflow/run; a later handoff commit may trigger another identical-code image build.

## Start here

```sh
git clone https://github.com/surjithbharathi/salesdesk-crm.git
cd salesdesk-crm
npm ci
npm run check
npm test
npm start
```

Use Node.js 22.13+ (22.22.x tested). Local web: `http://localhost:3100`; authenticated mobile API: port 3101. A fresh clone creates its own local demo database, NOT the online users/data. Use the online URL for production records. Do not copy a fresh or stale local database over production.

Read `README.md`, `DEPLOYMENT.md`, `MOBILE_SYNC.md`, `CLICK_TO_CALL.md`, `WHATSAPP.md`, `FEATURE_PARITY.md` and `design-qa.md` before changing those areas. The parity ledger describes implemented, draft-only, unconnected and unverified features; this is not full Salesmax/Twenty/Frappe parity.

## Deploy the pending web change

1. Confirm **Build Salesdesk deployment image** completed successfully for the desired commit and published its image to `ghcr.io/surjithbharathi/salesdesk-crm`.
2. In Hostinger, inspect the existing VPS Docker applications. Choose **salesdesk-crm → Actions → Update** only. The user authorized this update, but reconfirm current state and any new scope before a later deployment.
3. Verify the CRM returns HTTPS login, unauthenticated protected endpoints still return 401, the served JavaScript includes `refreshSyncedCalls`, and all existing Docker projects remain running. A successful GitHub build alone does not deploy Hostinger.
4. If the desired run failed or remains queued, keep the previous live image and diagnose the workflow. Do not recreate projects, overwrite volumes or change other applications.

The database and encryption key remain in private VPS storage, mounted from `/opt/salesdesk-crm/data`. Code updates must reuse that storage. A previous approved snapshot migrated accounts/data; local and online databases are not live replicas. No passwords, keys, tokens, recordings or database files are stored in GitHub.

## Android setup on the next computer

Install JDK 17, Gradle 9.1.0 and Android SDK 36 / platform-tools (AGP 9.0.1 is declared by the project). Open `android-companion` in Android Studio or use a configured Gradle installation. No Gradle wrapper binary is committed.

```sh
cd android-companion
gradle :app:assembleDebug :app:lintDebug -PcrmApiOrigin=https://salesdesk-crm.srv1696974.hstgr.cloud
adb devices
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

IMPORTANT: the installed app is debug-signed. A new computer normally generates a different debug signing key, which cannot update that existing installation. Securely transfer the original debug keystore outside GitHub, or plan a proper release-signing migration. Never commit signing keys, bypass signing checks, or uninstall the existing app without approval: uninstalling loses its session/private pending-call queue and may require re-enabling permissions/recording-folder access. Merely using the online CRM on another computer does not require rebuilding the phone app.

The online origin must be passed at build time as shown; the default is debug loopback. Do not restore manual IP/origin entry for ordinary users. Changing origin invalidates the previous mobile login/consent by design. End users sign in with the same company CRM account, then explicitly grant permissions and authorize sync/background calls.

## What changed in the last task

- Native Home/Leads/Calls/Tasks/Settings now have consistent typography, purple primary actions, outlined labeled fields, stage/direction badges, selected navigation, readable dates and a visible refresh icon.
- Task creation uses native date/time pickers rather than requiring ISO text. Settings separates account, sync, background calling, recording permissions, help and sign-out.
- `CallSyncWatcher` observes call-log changes. It waits 20 seconds for Android to finalize the call, retries after 45/90 seconds for later recordings, and checks every minute while the app or opted-in foreground bridge runs. The existing 15-minute job remains a fallback after those stop. Force stop, reboot, network or OEM battery restrictions can delay it; no always-on guarantee is claimed.
- Metadata uploads before audio-folder scanning. Active calls are skipped when phone-state permission is available. Assigned-lead-only collection, consent, user scope, safe recording matching and idempotency remain enforced.
- Web call/history/dashboard views and the Integrations call panel poll changed call data every three seconds. Active forms, modals, audio playback, stale-view responses and overlapping requests are protected. Five synthetic tests cover this behavior.
- WhatsApp remains **Baileys sync-only** for matched incoming/manually outgoing individual text. Manual composition opens WhatsApp Web; there is no CRM bulk/auto-send. Unofficial-client restriction risk remains even without sending from CRM.
- Operator-issued password recovery is implemented and tested, but no recovery token was issued and no live password/session reset was performed after the user confirmed successful login/calling. Do not resume an old reset automatically.

## Next tasks / acceptance checks

1. Finish the pending Hostinger update and verify the deployed web refresh.
2. Reconnect/unlock the phone, complete final UI screenshots and test keyboard, search/filter, date picker, lower Settings scrolling and larger fonts. `design-qa.md` is honestly blocked on these final checks, not marked passed from compilation alone.
3. Have the user make a consenting test call to a currently assigned CRM lead. Measure call-end → local queue → online timeline delay, verify no duplicate entries and recording upload after the file settles. Do not place a real call without an explicitly approved number.
4. Confirm calls not matching assigned leads remain excluded. Do not loosen privacy filtering just because a personal call does not appear.
5. Verify live recording-folder matching/playback and Baileys round-trip sync with user-approved accounts. These have synthetic test coverage, not complete live verification.
6. Plan release signing/distribution and device compatibility before production rollout. No app-store release or automatic Android update pipeline exists yet.

Private screenshots, databases, credentials, APKs and signing files were intentionally excluded from this public source handoff. Obtain any necessary private runtime backup separately and securely; never paste secrets into a public issue or this document.

## Suggested continuation prompt

“Read HANDOFF.md and design-qa.md in this repository. Inspect GitHub Actions and the current Hostinger Salesdesk deployment before changing anything. Finish pending web deployment verification and then, with my phone connected, verify v0.8.3 UI and assigned-lead call sync latency. Preserve existing users/data and other VPS projects. Ask before real calls, credential changes or destructive actions.”
