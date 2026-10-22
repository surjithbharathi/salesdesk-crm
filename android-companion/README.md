# Salesdesk Android companion

Build with JDK 17, Gradle 9.1.0, Android SDK 36 and AGP 9.0.1:

```sh
gradle :app:assembleDebug :app:lintDebug
```

Open this folder directly in Android Studio if Gradle is not on PATH. The project does not contain a Gradle wrapper binary. Debug output: `app/build/outputs/apk/debug/app-debug.apk`. Release requires operator signing and HTTPS.

Read [../MOBILE_SYNC.md](../MOBILE_SYNC.md) before installation or pairing. Only the user grants call-log/folder access and business sync consent. No recording, default-dialer replacement, accessibility service, forced permissions or private app-storage access. JobScheduler requests periodic sync, not guaranteed instant sync.

Build and lint pass (remaining warnings concern synchronous durable preference commits and hardcoded prototype strings). No physical-device end-to-end sync test has been performed.
