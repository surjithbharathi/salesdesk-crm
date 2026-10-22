# Android mobile CRM · v0.8

## Shared company login (current flow)

Open the web CRM and choose **Set up shared login**. Select your existing CRM user, enter company name, username and a password of at least 12 characters. The first account is the administrator. **Manage accounts** lets that administrator create member logins for other existing CRM users. Do not send passwords through chat.

The Android app uses the same username and password, not a separate owner selection or manually entered device token. The stable CRM user ID scopes leads, tasks, activities, calls and recordings. Mobile includes Home, Leads, Calls, Tasks and Settings; lead creation/stage updates/notes and task creation/completion use authenticated APIs. Cached workspace and pending queues are isolated by endpoint/user. Logout removes the local session/workspace and attempts server revocation; offline logout cannot revoke an unreachable server session until expiry. Sessions expire after 12 hours.

Web sessions use HttpOnly SameSite=Strict cookies; device sessions use encrypted local bearer credentials. Passwords use salted scrypt, server sessions store only token hashes, and inactive users lose access. Company setup disables legacy device-token login. Administrators can view the company; members see assigned records and cannot manage integrations/accounts. This is one local company workspace, not multi-tenant SaaS.

For USB debugging use `adb reverse tcp:3101 tcp:3101`, then the mobile endpoint `http://127.0.0.1:3101`. Debug HTTP is loopback-only; release requires HTTPS with a private proxy exposing only the device API. Never expose desktop/admin port 3100. The following legacy enrollment instructions apply only before company login is enabled, and are not the recommended mobile CRM workflow.

The original Android companion reads existing call logs and recordings; it never records microphone/call audio itself. No private Salesmax/TeleCRM source, call logs, recordings, account databases or tokens are copied into this project.

## Build

Open `android-companion/` in Android Studio or use JDK 17, Android SDK 36, and Gradle 9.1.0:

```sh
gradle :app:assembleDebug :app:lintDebug
```

AGP 9.0.1 is pinned. The debug APK is `android-companion/app/build/outputs/apk/debug/app-debug.apk`. Android 8/API 26+ is the code minimum, NOT a guarantee of call-log/recording compatibility. Release distribution requires your signing key; build output and signing keys are gitignored. No proprietary APK is a dependency.

## Safe first connection over USB

The web/admin CRM remains bound to 127.0.0.1:3100. A **separate** device-only API listens on 127.0.0.1:3101 (`MOBILE_PORT`, default `PORT+1`). It never serves the web app, WhatsApp pairing, device issuance, workspace export, or other unauthenticated admin endpoints.

1. Start the CRM with `npm ci && npm start`.
2. In Integrations → Android call & recording sync, create a labelled device for an active CRM owner. Acknowledge business sync authorization. Copy its one-time token directly to the phone; do not send it through chat.
3. Install the debug APK yourself or explicitly authorize installation. Do not grant permissions on someone else's behalf.
4. With your intended phone selected, forward only the device port:

```sh
adb -s YOUR_PHONE_SERIAL reverse tcp:3101 tcp:3101
```

5. Enter `http://127.0.0.1:3101` in the debug app, enter the token and country calling code, enable the business-sync acknowledgement and Save configuration. Token is encrypted with Android Keystore; screenshots and OS backup/device transfer are disabled for the companion.
6. Grant call-log permission through the Android permission screen. `READ_CALL_LOG` is restricted: installer/OS policy and distribution method matter. We never force-grant, change your default dialer, enable accessibility, or bypass restrictions. If Android denies it, this device is not compatible until an authorized installation/distribution approach is established.
7. Choose the exact accessible recording folder through Android's system picker. Only its direct audio files are scanned, not the whole phone. App-private dialer folders cannot be bypassed. Grant persists only for the selected URI.
8. Make a consented test business call to a lead assigned to the selected CRM owner. Sync starts with NEW calls after configuration, not your whole prior history. Wait until recording is finalized (at least 15 seconds), then use Sync now / compatibility check.
9. Verify lead, time, direction, duration, matched file and playback in CRM. Test missed calls, duplicate retries, offline/reconnect, ambiguous matches, permission revocation and reboot on the actual device before relying on automation.

Pairing, permissions, real-phone syncing, background timing and genuine call playback have NOT been verified on the user's phone. No companion installation, permission grant, real call, recording read/upload or customer-data transfer was performed during development. Build, lint and synthetic API tests are separate from those hardware checks.

## HTTPS deployment

Release builds accept HTTPS only. Debug accepts plain HTTP only for `127.0.0.1` or `localhost` over USB reverse. Redirects are disabled so bearer tokens cannot be forwarded to another destination. Do NOT use a public HTTP URL or expose port 3100. Deployment requires an operator-controlled HTTPS reverse proxy to the device API only, a valid certificate, request/body/time limits and appropriate network access controls. No public server, tunnel, DNS, firewall or certificate configuration was changed in this task.

## Scope, privacy and matching

- Per-device random 256-bit bearer token is stored hashed in a separate server table. Only the assigned active owner's active lead numbers are returned. Unknown/personal numbers are not uploaded. Ambiguous lead numbers are refused.
- Local call log IDs plus timestamps are idempotent per device. Calls sync without audio first. Call IDs cannot be rewritten with conflicting metadata. Only the owning device can attach audio, and it must still have access to that business lead.
- India-oriented default normalization prepends configured country code to 10-digit local numbers; explicit international/00 numbers are supported. This is not universal numbering-plan parsing: configure full international CRM numbers and verify matching for each country. No suffix-only matching is used for lead uploads.
- Automatic recording matching ignores filenames. It compares the file modification time with call end (within 120 seconds) and actual audio duration (within max(3 seconds, 15%)). Exactly one call and one file must match. Nearby personal and already uploaded calls block ambiguity using transient on-device timing only; only currently assigned business calls can upload. Previously attached URIs cannot be reused automatically. Missing metadata, incomplete scans (over 5,000 calls/files), copied files with changed timestamps and ambiguous candidates require manual review. Server retains its additional same-number ambiguity check.
- User-reviewed attachment selects a queued business call and an audio file through the picker, followed by explicit confirmation. No silent guess when file timestamps have been changed by copying.
- New calls since opt-in are scanned within a rolling 30-day window, bounded to 5,000 log rows per scan. Queue processing is bounded to 500 pending entries, folder scan to 1,000 immediate children. A cached assigned-number list lets business metadata queue offline after the first successful connection; the server rechecks assignment before accepting any upload.
- The app uses Android JobScheduler (15-minute periodic request) plus manual Sync now. This is NOT guaranteed immediate/per-call sync: battery management, force-stop, permissions, OEM policy and network affect scheduling. No always-on foreground service, accessibility hook, notification harvesting or battery-setting changes.
- SQLite queue retains call metadata and content URIs until matching/upload succeeds. Retries do not duplicate server records. A rejected/corrupt/oversized recording can stop that sync run; review/remove its selected attachment or reset the local queue after checking unsynced entries. Original recordings/logs are never deleted.
- Allowed audio containers are recognized by header: WAV, MP3, Ogg, AMR and MP4/M4A/3GP-family. Maximum 20 MiB/file. Header checks are not a complete malware/codec validation pipeline; use a hardened production media-processing service if required. No transcription/AI processing.
- Recording bytes are AES-256-GCM encrypted in a separate SQLite table; key is `<CRM_DB>.mobile-key`, mode 0600. Key and database are on the same host: this does not protect against compromise of that OS account or a backup containing both. Call metadata stays in ordinary CRM records/exports. Audio is excluded from JSON exports and played only through the local admin UI.
- Pause disables future local sync and cancels its job; an in-flight request may finish. Revoke the device in CRM to block future API requests. Neither action erases previously uploaded data. Reset local queue/token requires explicit user confirmation; it never deletes phone recordings or server records.

## API

Device listener: `GET /v1/targets`, `POST /v1/calls`, `PUT /v1/calls/:id/recording`. Every request requires `Authorization: Bearer <device-token>` and rejects browser Origin headers. Upload carries `X-Match-Mode` (`auto` / `manual`), `X-Audio-Duration` (seconds), `X-File-Modified` (epoch ms). Tokens never authorize local admin routes.

Local CRM: `GET/POST /api/mobile/devices`, `POST /api/mobile/devices/:id/revoke`, `GET /api/mobile/recordings/:id`. Issuance/revocation requires an exact local browser Origin. Device tokens are only returned at issuance, not state/device lists or exports. The local web UI still lacks production multi-user authentication and must not be exposed publicly.

## Verification

`npm test` includes token/owner scope, revocation, call validation and replay conflicts, encrypted audio roundtrip/tamper rejection, ambiguous matching, device isolation and synthetic full HTTP upload/playback/timeline tests. These tests use temporary fixtures, not the connected phone. See [MOBILE_REFERENCE.md](MOBILE_REFERENCE.md) for the actual installed-app observation boundary.

Android platform references: [shared-folder access](https://developer.android.com/training/data-storage/shared/documents-files), [call log fields](https://developer.android.com/reference/android/provider/CallLog.Calls), [restricted call-log permission](https://developer.android.com/reference/android/Manifest.permission#READ_CALL_LOG), [JobScheduler](https://developer.android.com/reference/android/app/job/JobScheduler).


### Filename-independent matcher regression checks

Compile `android-companion/app/src/main/java/ai/salesdesk/companion/RecordingMatcher.java` and `android-companion/tests/ai/salesdesk/companion/RecordingMatcherTest.java` with `javac -d <temporary-classes-directory>`, then run `java -cp <temporary-classes-directory> ai.salesdesk.companion.RecordingMatcherTest`. Twelve cases cover matching without a phone-number filename, personal-call exclusion/ambiguity, multiple files/calls, reuse, duration/time mismatch, missed calls and duplicate listings. These are synthetic checks; installed phones need the updated signed APK before this behavior is available.
