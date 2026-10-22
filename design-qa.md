# Salesdesk Android UI polish — 2026-10-22

final result: blocked (final-device interaction gate only)

## Windows continuation — 22 October, approximately 8:51–8:55 PM IST

- Reconnected the unlocked physical phone and confirmed installed v0.8.3 / versionCode 5.
- Captured Home, Leads, Calls, Tasks and Settings at the normal font scale. Selected navigation labels are centered; no primary control overlap observed in the captured portrait screens.
- Verified lower Settings scrolling, existing sync/background-calling opt-ins, granted permission indicators and selected recording-folder status without changing permissions or consent.
- Opened the search keyboard and submitted a unique no-match query with the IME search action. The keyboard dismissed and the readable empty state appeared.
- Opened the new-task form and native date/time pickers, then cancelled without saving a task. Incoming/Missed filters showed empty results; Outgoing showed existing synced entries without recordings.
- Temporarily tested font scale 1.3 on Home and upper Settings; text wrapped and navigation remained readable. Restored font scale 1.0 and rotation settings (accelerometer_rotation=0, user_rotation=0). Other large-font screens remain unverified. Landscape tree/capture timing was inconsistent, so landscape visual QA remains unverified.
- Found a minor copy issue: an empty Incoming/Missed filter tells an already-enabled user to enable sync. No installed-binary fix is claimed.
- Private captures are outside the repository in the local SalesdeskQA folder. No customer records, screenshots, APK or signing material were added to Git.
- The user subsequently confirmed completing the consenting assigned-lead test call. Settings reported `Updated 8:59 PM · 1 new calls · 0 recordings`. Calls showed one new outgoing 1:00 entry starting at 8:58 PM, marked `Synced to CRM · No recording attached`. A subsequent workspace refresh retained one new entry alongside the two prior 0:00 entries. This is observed successful metadata sync and no visible duplicate for this call; exhaustive replay/privacy checks remain pending. Exact call-end-to-upload latency was not measured. No call was placed by the agent.
- The user confirmed the exact recording file identity and explicitly approved matching/uploading it to the 60-second test call. Its contact-name/timestamp filename has no phone number, so the automatic matcher's refusal is expected. Used Settings → Review unmatched recording → the 20:58:07 / 60 sec call → Android file picker → confirmed file → Confirm match. The existing background sync uploaded it. A server workspace refresh exposed `Recording uploaded` and `Play CRM recording`.
- Selected `Play CRM recording`; the server download completed, the playback dialog opened, and Android reported a MediaPlayer in `state:started` for the Salesdesk PID. Stopped playback with the dialog's Stop control. This verifies server retrieval and playback startup on this device; audible content/quality was not independently assessed. No recording bytes were copied into the repository. Automatic matching of a contact-name-only filename remains unsupported.
- Additional minor copy issue: server playback reuses the dialog text `Playing selected local recording.` after downloading the server file. No installed-binary fix is claimed.

## Prior-computer deliverable and evidence

The sections below preserve the earlier checkpoint; the Windows continuation above supersedes its completed-interaction boundaries.

Native Android v0.8.3, versionCode 5, installed over the existing app with account and opt-ins preserved. Final build/install and launch succeeded before USB disconnected.

Private before/after captures of Home, Leads, Calls, Tasks and Settings were compared together at 1260 × 2772 pixels on the same physical phone. No screenshots or customer data are included in GitHub. Clean Tasks/Settings baselines replaced earlier incoming-call-overlay captures. This is an intentional redesign of the existing native app, not a claim of exact vendor fidelity or proprietary-code reuse. Workspace data changed during the session; no synthetic UI fixtures were substituted.

## Comparison

- Typography: separate brand/screen hierarchy, consistent sans-serif medium headings and readable local dates instead of ISO/Java date strings.
- Layout: consistent padding, 48dp actions, labeled outlined inputs, IME search, selected navigation pills and semantic stage/direction badges. Invisible refresh icon fixed with purple tint.
- Palette/assets: retained purple/light-neutral tokens, white primary labels and dark body text. Existing native Android icons retained; no raster or custom illustration assets needed.
- Home: real lead/open-task counts with shortcuts, refresh time and recent activity.
- Leads: search field, primary add action, stage chips, empty separators removed, focusable cards.
- Calls: scrollable selected filters, m:ss duration, readable dates and clear sync/recording states.
- Tasks: readable due dates/status; date and time pickers replace raw ISO typing.
- Settings: grouped account, sync state/actions, background calling, recording permissions/consent, matching help and sign-out.

## Findings and tests

- Five tabs exercised with foreground-package checks and selected-tab assertions; mismatched-state captures replaced.
- No primary content overlap/clipping observed at the current phone/font scale. Call-filter overflow is intentionally scrollable.
- P2: navigation labels left-aligned under centered icons. Fixed in final installed build; post-fix capture blocked by USB disconnect.
- Final keyboard/forms/date-picker, search/filter edge states, lower Settings scroll, landscape and enlarged-font checks remain unverified.
- No new call, CRM mutation, permission grant, consent toggle or recording playback was performed for QA.
- Automatic sync succeeded after installation; existing calling/sync opt-ins remained unchanged. A new-call latency test is not yet verified.
- Android assemble/lint passed with warnings, no errors. All 42 CRM tests passed, including five safe web-refresh tests. They do not replace Android interaction tests.

## Delay fix

The previous background schedule was a 15-minute Android job. A call-log ContentObserver now schedules sync after 20 seconds, retries at 45/90 seconds for late recordings, and checks every 60 seconds while the app or user-enabled foreground bridge runs. The periodic job remains a fallback after both stop. Sync avoids active calls when phone-state permission is available. Consent, assigned-lead filtering, authentication and idempotency remain enforced.

Call metadata uploads before recording-folder scanning. Web call views and the Integrations call panel poll every three seconds, preserving active forms, modals and audio playback.

## Remaining gate

Complete landscape and remaining enlarged-font screens. Exact automatic call-end-to-upload latency, automatic recording matching for supported filenames, audible quality and broader replay/privacy/device scenarios remain unverified. The observed manual recording upload/server-playback result is documented above. Android/network/file-write delays prevent an unconditional real-time guarantee.
