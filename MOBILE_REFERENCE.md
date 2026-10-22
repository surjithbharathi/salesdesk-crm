# Installed CRM app study · 22 October 2026

The user authorized studying their USB-connected phone's Salesmax and TeleCRM apps to inform an independent companion. No device serial, account credentials, customer lists, call logs, recordings, private databases or original screenshots are committed. Base APKs remain only in a private temporary analysis directory; split APKs were not copied, so artifact coverage is partial.

## Observed

- REA CLI 6.7.0, `inspect_adb_package`: Salesmax `ai.salesmax`, version 0.95/code 154. Evidence `ev_dcc024f60a89c0978538d77460937e001d8a4fd2bf1ae1281e0bd42a5d6b8d6f`.
- REA CLI 6.7.0, `inspect_adb_package`: TeleCRM `app.telecrm.enterprise3.in`, version 111.0/code 111. Evidence `ev_2bbc09c0aa9738848017bbee51f107a64b37305a7997c7205d5a96f35b1172cb`.
- These REA observations are fixed dumpsys projections, not APK identity or method/runtime evidence. Complete records are kept locally, not committed because they include device identifiers and installation times.
- Separate ADB permission inspection: both declare call-log, phone-state, recording/audio and foreground-service-related permissions. In the inspected primary-user section, call-log access is granted; microphone access is not. This does NOT prove recording sync works or that microphone permission is never used. Other user/profile sections have different grants.
- Android SDK `aapt2 dump xmltree` of the copied base manifests declares Salesmax `ai.salesmax.ui.service.JobService`, `ai.salesmax.ui.service.CallStateManagerService`, `ai.salesmax.call.screening.SalesmaxScreeningService` and a boot receiver. TeleCRM declares `nativeplugin.app.telecrm.callsync.service.CallSyncService`, call receivers and WorkManager's SystemJobService. Class names/declarations are static observations, not proof of their algorithms or scheduled execution.
- Base APK SHA-256: Salesmax `3e1e9c7c9248292714f40a544d126a627424c161b65c0e3d6557b95be1b86474`; TeleCRM `80653ab683f57b28e56bed2ac455ad314cb685ba655581b3b538ebcf5d6c64db`.

## Partial / unknown

- REA MCP is not registered in the current client; the read-only diagnostic reports configuration drift. No client configuration or unrelated engine was installed/changed. Explicit CLI ADB calls work with the existing SDK binary selected by `REA_ADB_PATH`.
- REA's JADX headless provider is unavailable, so no method decompilation, match-tolerance extraction, queue-schema recovery or private endpoint reconstruction was performed. No hidden auth material was sought.
- Salesmax was brought to foreground via REA (`ev_89e1b61c7820608be59de89b4d3127170f506f819ef736da10e66e9e2f7e716b`). A later focus observation showed another app in use, so runtime UI inspection stopped without capturing that unrelated screen. No CRM settings changed, records edited or calls placed. No claim of full UI/behavioral parity.

## Independent implementation choices

### Follow-up visual observations

Read-only phone inspection captured Salesmax Home (dashboard tabs, team pulse, pipeline counts, work plan, bottom navigation), its activity feed (call direction/duration, recording availability and transcript cards), and TeleCRM My Calls (lead/number, status chip, owner badge, direction/duration and recent time). Local REA evidence: `ev_69e041d23b7fd97fd05c85d40ff62c3ba69d67bbe15e50c71a3d6356ecce167e`, `ev_7f789dc19118ea878313428214e149aa2b2e8a431c4ceaed902ad185fa7be2ab`, `ev_bf71eba3ae5b374596f7c21dbb81a738588f7a59fbb1306103429ba3cd3ce0ba`. Screenshots remain private; no customer names, numbers or transcripts are used as fixtures. Settings was not reliably captured. No calls/messages/settings mutations were performed. These observations inform original layouts, not a claim of recovered vendor code or exact parity.

v0.8 replaces the main manual-token setup experience with shared web/mobile user accounts, authenticated workspace CRUD and automatic per-user device binding. The older per-device-token design below describes v0.7; legacy tokens work only before company login is enabled.

An opt-in native Android companion uses CallLog and a user-selected SAF folder, a local SQLite retry queue and periodic JobScheduler, rather than importing proprietary services. Per-device scoped tokens, a separate device-only listener, AES-GCM recording storage, explicit manual review and no automatic permission grants are our design decisions. Number/time/duration tolerances are documented in MOBILE_SYNC.md, not presented as recovered vendor logic. CallSync was only a repository reference; no code from its MSSQL/FTP implementation was copied.
