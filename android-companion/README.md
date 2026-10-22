# Salesdesk Android companion

Build with JDK 17, Gradle 9.1.0, Android SDK 36 and AGP 9.0.1:

```sh
gradle :app:assembleDebug :app:lintDebug -PcrmApiOrigin=https://salesdesk-crm.srv1696974.hstgr.cloud
```

Open this folder directly in Android Studio if Gradle is not on PATH. The project does not contain a Gradle wrapper binary. Debug output: `app/build/outputs/apk/debug/app-debug.apk`. Release requires operator signing and HTTPS.

Read [../MOBILE_SYNC.md](../MOBILE_SYNC.md) before installation or pairing. Only the user grants call-log/folder access and business sync consent. No recording, default-dialer replacement, accessibility service, forced permissions or private app-storage access. JobScheduler requests periodic sync, not guaranteed instant sync.

v0.8.3 / code 5 was built, linted and installed on the authorized phone. Login/background calling were confirmed by the user; new-call timing and complete recording/UI acceptance remain unverified. Event-triggered sync now runs while the app or opted-in background bridge is active, with the Android periodic job as fallback. See [../HANDOFF.md](../HANDOFF.md) and [../design-qa.md](../design-qa.md) for exact verification boundaries.

On a new computer, a different debug signing key cannot update the installed app. Securely transfer the original key outside GitHub or plan release signing; do not uninstall/delete the user's private queue just to bypass a signature mismatch. Signing keys and APKs are intentionally ignored.
