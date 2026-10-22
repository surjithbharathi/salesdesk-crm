# Salesdesk Android UI polish — 2026-10-22

final result: blocked (final-device interaction gate only)

## Deliverable and evidence

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

Reconnect/unlock the phone for final screenshots and interaction/font-scale checks. Use a user-initiated assigned-lead call to measure actual online latency. Android/network/file-write delays prevent an unconditional real-time guarantee.
