# Private in-app updates (Android, no Play Store)

Salesdesk phones can update themselves from the CRM. When a newer APK is published, signed-in users see **Update available** with the version, size and notes. **Update now** downloads the APK, checks it, and opens Android's installer. There is no Play Store involved and nothing is public: the feed and the APK are only served to signed-in phones on the device API.

## How it works

- **Server.** `app-update.mjs` reads two files from one folder:
  - `salesdesk.apk`: the signed APK, between 64 KB and 80 MB.
  - `latest.json`: `{ "versionCode": 53, "versionName": "0.24.0", "notes": "…", "mandatory": false }`. `notes` (at most 600 characters) and `mandatory` are optional. Unknown fields or wrong types are an error (HTTP 503), never a guess.

  The server works out the SHA-256 of the APK itself and caches it until the file's size or modification time changes.
- **Folder.** `APP_UPDATE_DIR`, or `./data/app-update/` by default. In production this is `/opt/salesdesk-crm/data/app-update` on the VPS, which is the container's mounted `/app/data` volume, so files dropped there are live at once.
- **Device API** (port 3101; needs the phone's bearer token):
  - `GET /v1/app/update` returns `{available:false}` or `{available:true, versionCode, versionName, notes, mandatory, size, sha256}`.
  - `GET /v1/app/update/apk` streams the APK as `application/vnd.android.package-archive`, with an `X-Content-SHA256` header.
- **Phone** (`Updater.java`):
  - **When it checks.** On opening the app, at most once every 6 hours, and any time from Settings › Account & app › **Check for updates**. Preview builds (`.preview`) never self-update.
  - **What it checks.** The download is HTTPS only and is written to a `.part` file in the app's cache. The phone then checks:
    - size and SHA-256;
    - package name;
    - the versionCode equals the feed's and is newer than the installed app;
    - the signing certificates equal the installed app's.

    If any check fails, the phone shows a clear error and deletes the file.
  - **Installing.** If Android's "Install unknown apps" is off for Salesdesk, the phone asks once, opens that setting, and continues when the user comes back. The installer receives the file through `UpdateProvider`, a private, read-only content provider.
  - **Clean-up.** The downloaded APK is removed once the new version is installed.
- **Mandatory.** With `"mandatory": true` there is no **Later** button, and the prompt comes back every time the app is opened until the update is installed.

## Release steps

1. **Bump the version.** In `android-companion/app/build.gradle`, increase `versionCode` (and `versionName`). The phone only offers a versionCode higher than the installed one.
2. **Sign with the SAME key as the installed app.** The phones today run **debug-signed** builds. The debug key's SHA-256 starts `96b4b832…7b47`. Check before publishing:
   ```bash
   apksigner verify --print-certs Salesdesk-x.y.z.apk
   ```
   An APK signed with any other key (for example the Play upload key) is refused by the phone with "not signed with the same key". Android would refuse it anyway. Never commit a signing key or an APK.
3. **Run the publish script.** It reads the version from `build.gradle` and writes `salesdesk.apk` and `latest.json`:
   ```bash
   node scripts/publish-app-update.mjs path/to/signed.apk --notes "Faster call sync" [--mandatory] [--out ./data/app-update]
   ```
4. **Copy the files to the server folder:** first `salesdesk.apk`, then `latest.json`. Copy them into `/opt/salesdesk-crm/data/app-update/` on the VPS, for example with `scp`. No redeploy or restart is needed. Phones see the update within 6 hours, or at once with **Check for updates**.

To withdraw an update, delete `latest.json`; phones then see `{available:false}`.

## Notes

- The update feed needs the server routes from this change. A CRM without them answers 404, and the phone's manual check then says the CRM does not offer app updates yet.
- The very first build that contains the updater still has to be installed by hand (or with adb). Every build after it can arrive in the app.
- Android's own installer always asks the user to confirm. A silent install is not possible without device-owner rights.
