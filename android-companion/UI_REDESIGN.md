# Salesdesk mobile UI 0.9.0

Native Android redesign of the existing app, with the existing account, lead, task, call-sync and recording workflows retained.

## Design

- Soft violet brand accent, neutral surfaces, fine card borders and green positive-state chips.
- Consistent Lucide line icons for five-tab navigation, contacts, calls, tasks, search and refresh. Upstream license is included in the APK.
- Home includes a personal greeting, two summary tiles, add-lead/new-task shortcuts and activity rows.
- Leads use labeled search, paired search/add actions and clear contact identity rows with stage chips.
- Calls keep direction filters and recording controls, with an empty-state message that respects existing sync state.
- Settings groups advanced calling and recording preferences into expandable sections. Account, sync status and manual recording review remain accessible.
- Forms use scrollable dialog bodies. Screen, search, filter and expanded-section state are restored after activity recreation.
- Server audio playback is labeled correctly; an inactive calling badge no longer uses the positive green state.

## Verification on 22 October 2026

- Preview and online-origin debug builds both assemble and lint successfully (0 errors, 29 warnings).
- Installed `ai.salesdesk.companion.preview`, version 0.9.0-preview / code 6, alongside the existing app. Used a separate local sample database and preview account; no production accounts or customer records were copied into the preview.
- Verified preview sign-in, navigation and Home/Leads on the physical phone, and inspected Calls/Tasks and expanded recording settings through UI hierarchy. Home/Leads captures were compared against the earlier UI at the same physical resolution, with different account data explicitly identified.
- Some later screenshot attempts failed, and concurrent phone interaction invalidated the large-font capture sequence. Do not treat the full five-screen, large-font, landscape or form-interaction acceptance gate as passed. Font scale was restored to 1.0. No production call or recording test was performed for this UI revision.

## Installation boundary

The installed production app remains 0.8.3 / code 5. Its signing certificate differs from this computer's debug certificate. The existing app was not uninstalled or replaced. Securely obtain the original signing keystore outside Git before making an in-place update; do not uninstall to bypass signature checks.

For an isolated local preview:

```sh
gradle :app:assembleDebug :app:lintDebug -PcrmPreview=true -PcrmApiOrigin=http://127.0.0.1:3311
adb reverse tcp:3311 tcp:3311
```

The preview requires a local CRM server and a separate test account. The preview flag changes the package id and launcher label, not authentication or consent requirements. Its call sync and calling remain off unless explicitly enabled.

For the online app, omit `crmPreview` and build with `-PcrmApiOrigin=https://salesdesk-crm.srv1696974.hstgr.cloud`, using the correct original signing identity for distribution. Generated APKs, local databases, credentials and private screenshots remain excluded from Git.
