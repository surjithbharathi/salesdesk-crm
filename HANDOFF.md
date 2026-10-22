# Continue Salesdesk CRM on another computer

Updated 22 October 2026. Repository: https://github.com/surjithbharathi/salesdesk-crm, branch `main`.

## Current checkpoint

### Latest GitHub handoff — mobile UI and filename-independent recording matching

Source checkpoint: this handoff commit on `main` (use `git log -1` for its exact SHA). New matching is compiled and installed in the isolated preview only. Production web deployment remains the verified `bcc38be` image; pushing this handoff does not update Hostinger or the original phone app. No production database, recordings, tokens, signing keys or private screenshots are included.

### Mobile UI redesign source completed — 0.9.0

Modern native UI source, Lucide icons, theme, compact identity cards, Home shortcuts, grouped Settings and scrollable dialogs are implemented. Preview and online-origin debug builds assemble/lint successfully. A separate `Salesdesk Preview` app is installed on the physical phone with local sample data. The existing online app remains v0.8.3 because the original signing key is not on this computer. Do not uninstall it to bypass signing. Full device acceptance is incomplete; see `android-companion/UI_REDESIGN.md` for the exact evidence, build instructions and remaining gates.

### Latest: pending web deployment completed — 22 October 2026, about 9:14 PM IST

- Repaired the corrupted shared Hostinger npx package cache. The earlier warm-up only checked package resolution and did not prove dependencies were complete. A clean installation now passes both the VPS binary startup and a diagnostic MCP initialize/tools-list handshake. No account-authenticated connector action was performed; this running chat still had the old failed tool catalog.
- Used the already signed-in Hostinger hPanel browser session to inspect VPS `1696974` and select **salesdesk-crm → Actions → Update** only. Existing OpenClaw, Traefik and WAHA projects were Running before and after the update. No Compose, database, credential, permission or other-project changes were made.
- Verified image build run `39798710184` succeeded for `bcc38be1832007578908e44ecdef38a840b45c24`. After the Hostinger update, the HTTPS-served `app.js` contains `refreshSyncedCalls` and exactly matches repository `public/app.js` after newline normalization.
- HTTPS root and app script return 200; unauthenticated `/api/state` and `/v1/targets` still return 401. Reloading the existing signed-in browser session preserved login and showed the existing 12 leads.
- Online Calls showed the user's 60-second test call and its recording. Browser audio loaded for 60.224 seconds total duration, reached over 7 seconds playback with `readyState=4` and no media error, then was paused. No new call or CRM record was created for this deployment check.
- Deployment is no longer pending. Remaining acceptance work is exact new-call latency, live acceptance of the new time/duration matcher, remaining layout/font/device/privacy scenarios and Android release signing. Diagnostic evidence screenshots remain outside Git in the private local SalesdeskQA folder.

### Continuation on the Windows computer (22 October 2026)

The entries below preserve earlier observations; the latest checkpoint above supersedes their pending deployment/connection status.

- Repository checked out in the CRM workspace; dependencies installed. Node 24.19.0 syntax checks pass. Local tests: 41/42 pass; the remaining assertion expects Unix key-file mode `0600`, which Windows reports as `0666`. This is not verification of Windows ACL protection.
- GitHub image build run `39798710184` and CRM checks run `39798710271` completed successfully for `bcc38be1832007578908e44ecdef38a840b45c24`.
- Public HTTPS returned 200, protected `/api/state` and `/v1/targets` returned 401, but served `/app.js` did not contain `refreshSyncedCalls`. Hostinger update remains pending; other Docker project state has not been inspected on this computer.
- Hostinger MCP servers were registered, but startup failed after restart. Logs showed concurrent npm installation failure (`ENOENT` in the shared npx cache). A single subsequent package warm-up completed successfully. The failed connections are still unavailable in this session; no Hostinger tool authenticated and no deployment was performed. Retry the registered connections when the host reloads them; do not substitute direct API calls.
- USB initially showed the phone connected, with installed `ai.salesdesk.companion` version 0.8.3 / code 5. It was locked; unlock was requested. The phone subsequently disconnected. No final UI interaction, actual call, recording playback, permission or consent change was performed.
- Later reconnected/unlocked: completed portrait five-screen navigation, lower Settings scroll, search keyboard/no-match state, task date/time pickers with cancellation, call filters and Home/Settings at font scale 1.3. Restored original font/rotation settings. See `design-qa.md` for remaining layout checks and a minor misleading empty-filter message.
- The user made an assigned-lead test call: a new 1:00 outgoing call at 8:58 PM appeared as synced; Settings reported 1 new call / 0 recordings at 8:59 PM. Refresh showed no additional visible duplicate. The user confirmed a recording exists. The newest file in the selected recording folder has a contact-name/timestamp filename without the phone number, so the conservative automatic matcher correctly leaves it unattached. Exact file identity and approval for the existing manual match/upload flow were requested; the phone auto-locked again. Exact sync latency and recording playback are not verified. Hostinger deployment is still pending.
- Subsequently the user unlocked the phone, confirmed the exact file and explicitly approved manual attachment. Completed the existing manual-match flow for the 20:58:07 / 60 sec test call. Recording uploaded, server refresh exposed `Play CRM recording`, and selecting it successfully downloaded server audio and started MediaPlayer playback for the Salesdesk process; stopped it via Stop. Audible quality and automatic filename matching remain unverified. Hostinger update, exact latency and remaining layout/privacy/device scenarios are still pending. See `design-qa.md` for evidence and minor copy findings.

- Web CRM, native Android source, tests, Docker/Traefik deployment files and feature/reference documentation are in this repository.
- Latest implementation checkpoint: `bcc38be1832007578908e44ecdef38a840b45c24` (mobile UI polish + faster call sync + safe web call refresh). This handoff commit also includes the remaining password-recovery HTTP regression test and updated verification notes.
- Online workspace: https://salesdesk-crm.srv1696974.hstgr.cloud. Production runs in Hostinger Docker project `salesdesk-crm`, alongside independent OpenClaw/WAHA/Traefik projects. Do not stop or overwrite them.
- Android v0.8.3 / versionCode 5 was built, linted and installed successfully. The final install launched before USB disconnected. Existing login and sync/calling opt-ins were preserved. The user previously confirmed real background SIM calling works.
- All 42 local CRM tests pass. Android assemble/lint pass with warnings, no errors. Real new-call sync latency, recording end-to-end behavior and final form/font-scale visual checks are NOT yet verified.
- The earlier pending web refresh has now been deployed and verified; see the latest checkpoint above. GitHub image run: https://github.com/surjithbharathi/salesdesk-crm/actions/runs/39798710184.

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

## Web update procedure (pending change completed; retain for future updates)

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

1. Hostinger update and live web refresh verification are complete. Inspect GitHub Actions for this handoff commit; a successful image build does not itself update Hostinger. No new web deployment is required for the Android-only matching change.
2. Reconnect/unlock the phone, complete final UI screenshots and test keyboard, search/filter, date picker, lower Settings scrolling and larger fonts. `design-qa.md` is honestly blocked on these final checks, not marked passed from compilation alone.
3. Have the user make a consenting test call to a currently assigned CRM lead. Measure call-end → local queue → online timeline delay, verify no duplicate entries and recording upload after the file settles. Do not place a real call without an explicitly approved number.
4. Confirm calls not matching assigned leads remain excluded. Do not loosen privacy filtering just because a personal call does not appear.
5. Manual recording upload/server playback was verified for the first test call; the later 16-second recording also reported uploaded. After a correctly signed Android upgrade, verify automatic time/duration matching on a user-initiated consenting test call. Baileys round-trip verification remains pending.
6. Plan release signing/distribution and device compatibility before production rollout. No app-store release or automatic Android update pipeline exists yet.

Private screenshots, databases, credentials, APKs and signing files were intentionally excluded from this public source handoff. Obtain any necessary private runtime backup separately and securely; never paste secrets into a public issue or this document.

## Suggested continuation prompt

“Read HANDOFF.md, android-companion/UI_REDESIGN.md and MOBILE_SYNC.md. Continue from the latest GitHub handoff. Hostinger web update is complete; the original Android app remains v0.8.3 because its signing key is unavailable. Preserve that app and all users/data. Obtain the original key securely for an in-place update, then verify filename-independent recording matching, remaining UI/font/landscape checks and actual sync latency. Never commit keys, recordings or runtime databases.”


## 2026-10-22 recording matching continuation

- The user confirmed the 21:36 call (16 seconds) and its recording; manual attachment on the original phone app completed and the call card reported Recording uploaded.
- Android source now ignores recording filenames. It uses actual audio duration within max(3 seconds, 15%) and file modification time within 120 seconds of call end. Unique one-to-one matching only; nearby personal/previously uploaded calls block ambiguity without persisting personal call metadata. Only currently assigned business calls are eligible. Existing attachments, including alternate document URI forms, are excluded from automatic reuse. Scans exceeding 5,000 calls/files fail closed to manual review. Call metadata still uploads before audio scanning.
- RecordingMatcherTest has 12 standalone Java regression cases; all passed. Online-origin APK assemble and lint passed. Source/build verification does not establish live automatic matching on the original app.
- Original installed app still uses the earlier matcher: its signing key differs from this computer. Preserve it and its queue/session. Original debug.keystore is still required for an in-place update; the separate preview package can be updated with this computer's key. No new real test call was placed.
