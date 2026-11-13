# Salesdesk Android companion

Build with JDK 17, Gradle 9.1.0, Android SDK 36 and AGP 9.0.1:

```sh
gradle :app:assembleDebug :app:lintDebug -PcrmApiOrigin=https://crm.example.com
```

Open this folder directly in Android Studio if Gradle is not on PATH. The project does not contain a Gradle wrapper binary. Debug output: `app/build/outputs/apk/debug/app-debug.apk`. Release requires operator signing and HTTPS.

Read [../MOBILE_SYNC.md](../MOBILE_SYNC.md) before installation or pairing. Only the user grants call-log/folder access and business sync consent. No recording, default-dialer replacement, accessibility service, forced permissions or private app-storage access. JobScheduler requests periodic sync, not guaranteed instant sync.

v0.8.3 / code 5 was built, linted and installed on the authorized phone. Login/background calling were confirmed by the user; new-call timing and complete recording/UI acceptance remain unverified. Event-triggered sync now runs while the app or opted-in background bridge is active, with the Android periodic job as fallback. See [../HANDOFF.md](../HANDOFF.md) and [../design-qa.md](../design-qa.md) for exact verification boundaries.

On a new computer, a different debug signing key cannot update the installed app. Securely transfer the original key outside GitHub or plan release signing; do not uninstall/delete the user's private queue just to bypass a signature mismatch. Signing keys and APKs are intentionally ignored.

## 0.13.0: My day

The first tab is now **My day**: level and progress, the next lead to call, goal rings (calls, answered, quotations), team goal, weekly challenges, badges, milestones, the week/month leaderboard and the stars of the week, all from the CRM's own records (`GET /v1/kpi/day/<tz>/<day start>/<day end>` and `GET /v1/kpi/leaderboard/<week|month>/<tz>`). The earlier workspace overview moved to the top-right menu as **Overview**. Call sync, recordings, click-to-call, screen pop and feedback are unchanged.

To try it next to the installed app without replacing it, build the preview variant, which has its own package id (`ai.salesdesk.companion.preview`) and data:

```sh
gradle :app:assembleDebug -PcrmPreview=true -PcrmApiOrigin=https://crm.example.com
```

Production CRM is `crm.example.com`. The old `the old host` host is not the live CRM.

## 0.16.0: lead names from the phone

When a lead has only its number as a name, the app sends the name this phone shows for that number: the saved contact first (Contacts permission), then the name the phone's call log holds. A name already in the CRM is never replaced. Names of numbers that are not leads stay on the phone (in "all calls" mode a new lead is made from the call and takes its name). Turn it off in Preferences with "Fill lead names from the phone". Truecaller has no way for other apps to read its names, so a Truecaller name arrives only when Truecaller has put it in the call log or the number is saved as a contact.

## 0.15.0: choose the look

Settings starts with **Appearance**: Salesdesk (our own), Salesmax style and TeleCRM style. The colours of the last two were read from the colour resources (Salesmax) and the style sheet (TeleCRM) of the apps installed on the owner's phone; no artwork, icon, layout file or code was copied. Only palette, corner radius and typeface weight change; the screens and navigation are the same in every skin. The same three skins exist in the web app (Settings, Your account).
