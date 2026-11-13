package ai.salesdesk.companion;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import org.json.JSONObject;

/** Private self-update (no Play Store): asks the CRM for a newer APK, downloads it, checks it, and opens Android's installer.
 *  The APK must be signed with the same key as the installed app; anything else is refused and deleted. See APP_UPDATE.md. */
final class Updater {
    // the CRM is asked each time the app is opened (at most every 5 minutes), so a newly published update shows up at once;
    // an update the person put off with "Later" is offered again after 6 hours
    static final long CHECK_EVERY_MS = 5L * 60 * 1000, LATER_MS = 6L * 60 * 60 * 1000;
    static final long MIN_BYTES = 64L * 1024, MAX_BYTES = 80L * 1024 * 1024;
    private static volatile boolean checking, downloading, cancelled;
    private static java.lang.ref.WeakReference<AlertDialog> offered = new java.lang.ref.WeakReference<>(null); // the update popup on screen, if any
    private static boolean waitingForPermission; // set when we sent the user to "Install unknown apps"

    private Updater() {}

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("updates", Context.MODE_PRIVATE); }
    static boolean preview(Context c) { return c.getPackageName().endsWith(".preview"); }
    private static File dir(Context c) { return new File(c.getCacheDir(), "updates"); }
    private static File part(Context c) { return new File(dir(c), UpdateProvider.NAME + ".part"); }

    @SuppressWarnings("deprecation")
    static long installedCode(Context c) {
        try {
            PackageInfo info = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
        } catch (PackageManager.NameNotFoundException e) { return Long.MAX_VALUE; }
    }

    private static boolean alive(Activity a) { return !a.isFinishing() && !a.isDestroyed(); }
    private static void ui(Activity a, Runnable r) { a.runOnUiThread(() -> { if (alive(a)) r.run(); }); }
    private static void message(Activity a, String title, String text) {
        ui(a, () -> new AlertDialog.Builder(a).setTitle(title).setMessage(text).setPositiveButton("OK", null).show());
    }
    private static String mb(long bytes) { return String.format(Locale.ENGLISH, "%.1f MB", bytes / 1048576.0); }

    /** Removes a downloaded APK once it is installed (or older than what is installed), and any half-finished download. */
    static void cleanup(Context c) {
        long downloaded = prefs(c).getLong("downloadedCode", 0);
        File apk = UpdateProvider.file(c);
        if (!downloading) { File p = part(c); if (p.exists() && !p.delete()) p.deleteOnExit(); }
        if (apk.exists() && (downloaded == 0 || installedCode(c) >= downloaded)) {
            if (!apk.delete()) apk.deleteOnExit();
            prefs(c).edit().remove("downloadedCode").apply();
        }
    }

    /** From MainActivity.onResume: finish an install that was waiting for permission, then the regular (throttled) check. */
    static void resume(Activity a) {
        if (waitingForPermission) {
            waitingForPermission = false;
            if (a.getPackageManager().canRequestPackageInstalls() && UpdateProvider.file(a).isFile()) { install(a); return; }
            Toast.makeText(a, "Updates need \"Install unknown apps\" for Salesdesk. Tap Check for updates in Settings to try again.", Toast.LENGTH_LONG).show();
            return;
        }
        check(a, false);
    }

    /** Asks the CRM whether a newer app is published. Automatic checks run when the app opens, at most every 5 minutes; a manual one always runs
     *  and says what it found. A pending mandatory update is checked on every resume until it is installed. */
    static void check(Activity a, boolean manual) {
        if (preview(a)) { if (manual) message(a, "Updates", "Preview builds are not updated in the app. Install the new preview APK."); return; }
        if (!SecureConfig.loggedIn(a)) { if (manual) message(a, "Updates", "Sign in to Salesdesk first."); return; }
        if (checking || downloading) { if (manual) Toast.makeText(a, "Already checking for updates…", Toast.LENGTH_SHORT).show(); return; }
        long now = System.currentTimeMillis();
        boolean mandatoryPending = prefs(a).getLong("mandatoryCode", 0) > installedCode(a);
        if (!manual && !mandatoryPending && now - prefs(a).getLong("checkedAt", 0) < CHECK_EVERY_MS) return;
        prefs(a).edit().putLong("checkedAt", now).apply();
        checking = true;
        new Thread(() -> {
            try {
                JSONObject feed = SyncEngine.requestApi(a, "/v1/app/update", "GET", null);
                ui(a, () -> offer(a, feed, manual));
            } catch (Exception e) {
                if (manual) message(a, "Could not check for updates", SyncEngine.restarting(e) ? SyncEngine.RESTARTING
                        : e instanceof SyncEngine.HttpError && ((SyncEngine.HttpError) e).code == 404 ? "This CRM does not offer app updates yet."
                        : "Check your connection and try again. (" + e.getMessage() + ")");
            } finally { checking = false; }
        }, "app-update-check").start();
    }

    private static void offer(Activity a, JSONObject feed, boolean manual) {
        long installed = installedCode(a);
        long code = feed.optLong("versionCode", 0);
        if (!feed.optBoolean("available", false) || code <= installed) {
            prefs(a).edit().remove("mandatoryCode").apply();
            if (manual) message(a, "Updates", "Salesdesk " + BuildConfig.VERSION_NAME + " is up to date.");
            return;
        }
        String name = feed.optString("versionName", ""), sha = feed.optString("sha256", ""), notes = feed.optString("notes", "").trim();
        long size = feed.optLong("size", 0);
        boolean mandatory = feed.optBoolean("mandatory", false);
        if (!sha.matches("[0-9a-f]{64}") || size < MIN_BYTES || size > MAX_BYTES || name.isEmpty() || name.length() > 40) {
            if (manual) message(a, "Updates", "The CRM's update information is not valid. Ask your administrator.");
            return;
        }
        if (mandatory) prefs(a).edit().putLong("mandatoryCode", code).apply(); else prefs(a).edit().remove("mandatoryCode").apply();
        if (!manual && !mandatory && ((offered.get() != null && offered.get().isShowing()) || (prefs(a).getLong("laterCode", 0) == code && System.currentTimeMillis() - prefs(a).getLong("laterAt", 0) < LATER_MS))) return;
        String text = "Salesdesk " + name + " is ready (" + mb(size) + "). You have " + BuildConfig.VERSION_NAME + "."
                + (mandatory ? "\n\nThis update is required to keep using Salesdesk." : "")
                + (notes.isEmpty() ? "" : "\n\nWhat's new:\n" + (notes.length() > 600 ? notes.substring(0, 600) : notes));
        AlertDialog.Builder b = new AlertDialog.Builder(a).setTitle("Update available").setMessage(text)
                .setPositiveButton("Update now", (d, w) -> download(a, code, size, sha, mandatory));
        if (mandatory) b.setCancelable(false);
        else b.setNegativeButton("Later", (d, w) -> prefs(a).edit().putLong("laterCode", code).putLong("laterAt", System.currentTimeMillis()).apply());
        offered = new java.lang.ref.WeakReference<>(b.show());
    }

    @SuppressLint("SetTextI18n") // the app is English-only, like the rest of its screens
    private static void download(Activity a, long code, long size, String sha, boolean mandatory) {
        if (downloading) return;
        // already downloaded and checked (for example the installer was closed): install it again without downloading
        if (prefs(a).getLong("downloadedCode", 0) == code && UpdateProvider.file(a).length() == size && verify(a, UpdateProvider.file(a), code) == null) { install(a); return; }
        downloading = true; cancelled = false;
        int pad = (int) (20 * a.getResources().getDisplayMetrics().density);
        LinearLayout box = new LinearLayout(a); box.setOrientation(LinearLayout.VERTICAL); box.setPadding(pad, pad / 2, pad, 0);
        TextView label = new TextView(a); label.setText("Downloading… 0%");
        ProgressBar bar = new ProgressBar(a, null, android.R.attr.progressBarStyleHorizontal); bar.setMax(100);
        box.addView(label); box.addView(bar);
        AlertDialog.Builder b = new AlertDialog.Builder(a).setTitle("Updating Salesdesk").setView(box).setCancelable(false);
        if (!mandatory) b.setNegativeButton("Cancel", (d, w) -> cancelled = true);
        AlertDialog progress = b.show();
        new Thread(() -> {
            String error = null;
            try {
                fetch(a, code, size, sha, pct -> ui(a, () -> { bar.setProgress(pct); label.setText("Downloading… " + pct + "%"); }));
                String problem = verify(a, UpdateProvider.file(a), code);
                if (problem != null) { delete(a); error = problem; }
                else prefs(a).edit().putLong("downloadedCode", code).apply();
            } catch (Exception e) {
                delete(a);
                error = cancelled ? null : SyncEngine.restarting(e) ? SyncEngine.RESTARTING : e.getMessage() == null ? "The download failed." : e.getMessage();
            } finally { downloading = false; }
            String failed = error;
            ui(a, () -> {
                try { progress.dismiss(); } catch (Exception ignored) {}
                if (cancelled) return;
                if (failed == null) { install(a); return; }
                AlertDialog.Builder err = new AlertDialog.Builder(a).setTitle("Update not installed").setMessage(failed);
                if (mandatory) err.setCancelable(false).setPositiveButton("Try again", (d, w) -> check(a, true));
                else err.setPositiveButton("OK", null);
                err.show();
            });
        }, "app-update-download").start();
    }

    interface Progress { void at(int percent); }

    /** Streams the APK to a .part file (HTTPS only; debug USB loopback excepted), checking size and SHA-256 as it goes. */
    private static void fetch(Context c, long code, long size, String sha, Progress progress) throws Exception {
        URL url = new URL(SecureConfig.prefs(c).getString("endpoint", "") + "/v1/app/update/apk");
        boolean loopback = BuildConfig.DEBUG && url.getProtocol().equals("http") && (url.getHost().equals("127.0.0.1") || url.getHost().equals("localhost"));
        if (!url.getProtocol().equals("https") && !loopback) throw new Exception("Updates are only downloaded over HTTPS.");
        if (url.getUserInfo() != null || url.getQuery() != null || url.getRef() != null) throw new Exception("Invalid CRM address.");
        File folder = dir(c);
        if (!folder.isDirectory() && !folder.mkdirs()) throw new IOException("Could not prepare the download folder.");
        File part = part(c), apk = UpdateProvider.file(c);
        if (apk.exists() && !apk.delete()) throw new IOException("Could not replace the earlier download.");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Authorization", "Bearer " + SecureConfig.token(c));
        connection.setConnectTimeout(15000); connection.setReadTimeout(30000);
        try {
            int status = connection.getResponseCode();
            if (status != 200) throw new SyncEngine.HttpError(status);
            long length = connection.getContentLengthLong();
            if (length >= 0 && length != size) throw new Exception("The CRM is sending a different file than it announced. Try again in a minute.");
            String header = connection.getHeaderField("X-Content-SHA256");
            if (header != null && !header.equalsIgnoreCase(sha)) throw new Exception("The update changed on the CRM while downloading. Try again in a minute.");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long total = 0; int step = 0;
            try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                byte[] buf = new byte[65536]; int n;
                while ((n = in.read(buf)) != -1) {
                    if (cancelled) throw new IOException("Cancelled");
                    total += n;
                    if (total > size || total > MAX_BYTES) throw new Exception("The download is larger than announced; it was stopped.");
                    digest.update(buf, 0, n); out.write(buf, 0, n);
                    int pct = (int) (total * 100 / size);
                    if (pct / 5 > step) { step = pct / 5; progress.at(step * 5); }
                }
            }
            if (total != size) throw new Exception("The download was incomplete. Try again.");
            StringBuilder hex = new StringBuilder();
            for (byte x : digest.digest()) hex.append(String.format(Locale.ENGLISH, "%02x", x));
            if (!hex.toString().equals(sha)) throw new Exception("The downloaded file is damaged (checksum mismatch). Try again.");
            if (!part.renameTo(apk)) throw new IOException("Could not save the update.");
        } finally { connection.disconnect(); if (part.exists() && !part.delete()) part.deleteOnExit(); }
    }

    /** Returns null when the APK is this app, the announced version, newer than installed, and signed with the same key. */
    @SuppressWarnings("deprecation")
    @SuppressLint("PackageManagerGetSignatures") // every signer is compared, not just the first
    static String verify(Context c, File apk, long code) {
        PackageManager pm = c.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo archive = pm.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        if (archive == null) return "The downloaded file is not a valid Android app.";
        if (!c.getPackageName().equals(archive.packageName)) return "The update is for a different app (" + archive.packageName + "). It was not installed.";
        long archiveCode = Build.VERSION.SDK_INT >= 28 ? archive.getLongVersionCode() : archive.versionCode;
        if (archiveCode != code) return "The update's version (" + archiveCode + ") does not match what the CRM announced (" + code + ").";
        if (archiveCode <= installedCode(c)) return "The update is not newer than the installed app.";
        try {
            Set<String> mine = signers(pm.getPackageInfo(c.getPackageName(), flags)), theirs = signers(archive);
            if (theirs.isEmpty() && Build.VERSION.SDK_INT >= 28) theirs = signers(pm.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.GET_SIGNATURES));
            if (mine.isEmpty() || !mine.equals(theirs))
                return "The update is not signed with the same key as this app, so Android would refuse it. It was deleted. Ask your administrator to sign it with the original key.";
        } catch (Exception e) { return "Could not check the update's signature: " + e.getMessage(); }
        return null;
    }

    @SuppressWarnings("deprecation")
    private static Set<String> signers(PackageInfo info) throws Exception {
        Set<String> out = new HashSet<>();
        if (info == null) return out;
        Signature[] list = null;
        if (Build.VERSION.SDK_INT >= 28 && info.signingInfo != null) {
            SigningInfo s = info.signingInfo;
            list = s.hasMultipleSigners() ? s.getApkContentsSigners() : s.getSigningCertificateHistory();
            if (list != null && list.length > 0 && !s.hasMultipleSigners()) list = new Signature[] { list[list.length - 1] };
        }
        if (list == null || list.length == 0) list = info.signatures;
        if (list == null) return out;
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        for (Signature s : list) {
            StringBuilder hex = new StringBuilder();
            for (byte x : md.digest(s.toByteArray())) hex.append(String.format(Locale.ENGLISH, "%02x", x));
            out.add(hex.toString());
        }
        return out;
    }

    private static void delete(Context c) {
        File apk = UpdateProvider.file(c), p = part(c);
        if (apk.exists() && !apk.delete()) apk.deleteOnExit();
        if (p.exists() && !p.delete()) p.deleteOnExit();
        prefs(c).edit().remove("downloadedCode").apply();
    }

    /** Opens Android's installer for the verified APK, first asking once for "Install unknown apps" if it is off. */
    static void install(Activity a) {
        if (!UpdateProvider.file(a).isFile()) return;
        if (!a.getPackageManager().canRequestPackageInstalls()) {
            new AlertDialog.Builder(a).setTitle("Allow updates")
                    .setMessage("To install the update, Android needs you to allow Salesdesk to install apps. Turn on \"Allow from this source\", then come back.")
                    .setNegativeButton("Not now", null)
                    .setPositiveButton("Open settings", (d, w) -> {
                        waitingForPermission = true;
                        try { a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName()))); }
                        catch (ActivityNotFoundException e) { waitingForPermission = false; message(a, "Allow updates", "Open Android Settings › Apps › Salesdesk › Install unknown apps, and allow it."); }
                    }).show();
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(UpdateProvider.uri(a), UpdateProvider.MIME)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { a.startActivity(intent); }
        catch (ActivityNotFoundException e) { message(a, "Update not installed", "This phone has no app installer available."); }
    }
}
