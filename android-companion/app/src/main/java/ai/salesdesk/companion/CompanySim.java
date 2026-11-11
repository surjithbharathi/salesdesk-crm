package ai.salesdesk.companion;

import android.Manifest;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.telecom.PhoneAccountHandle;
import android.telecom.TelecomManager;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import org.json.JSONObject;
import java.util.List;

/**
 * The company SIM: every CRM call (from the web, a lead, the call log) goes through it, so nobody picks a personal SIM
 * by mistake. The person chooses it once; after that only an admin can clear it from the web CRM. Calls dialled from the
 * phone's own dialler are not touched.
 */
final class CompanySim {
    enum Result { PLACED, MISSING, NOT_CHOSEN, FAILED }

    static String key(Context c) { return SecureConfig.prefs(c).getString("companySimKey", ""); }
    static String label(Context c) { return SecureConfig.prefs(c).getString("companySimLabel", ""); }

    /** The phone account of the company SIM, or null when it is not in this phone (or not readable). */
    static PhoneAccountHandle handle(Context c) {
        String key = key(c);
        if (key.isEmpty()) return null;
        for (PhoneAccountHandle account : SimTracking.accounts(c)) if (key.equals(SimTracking.key(account.getId()))) return account;
        return null;
    }

    /** Whether this phone has more than one SIM to call from, so a company SIM has to be chosen. */
    static boolean needed(Context c) { return SimTracking.accounts(c).size() > 1; }

    /** Places the call through the company SIM. With a single SIM and none chosen, that SIM is used as before. */
    static Result place(Context c, String number) {
        if (c.checkSelfPermission(Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) return Result.FAILED;
        Bundle extras = new Bundle();
        if (!key(c).isEmpty()) {
            PhoneAccountHandle account = handle(c);
            if (account == null) return Result.MISSING;
            extras.putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, account);
        } else if (needed(c)) return Result.NOT_CHOSEN;
        try { c.getSystemService(TelecomManager.class).placeCall(Uri.fromParts("tel", number, null), extras); return Result.PLACED; }
        catch (Exception e) { return Result.FAILED; }
    }

    /** A call started from the app's screens: company SIM when it can, a clear notice when it cannot. */
    static void dial(MainActivity a, String number) {
        if (a.checkSelfPermission(Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) {
            if (!key(a).isEmpty() || needed(a)) { a.notice("Allow Salesdesk to make phone calls, so CRM calls go through your company SIM. Turn on \"Call from web CRM\" in Preferences."); return; }
            try { a.startActivity(new Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", number, null))); } catch (Exception ignored) {}
            return;
        }
        switch (place(a, number)) {
            case PLACED: return;
            case MISSING: a.notice(label(a) + " isn't active on this phone, so the call wasn't placed. Put the company SIM back, or ask your admin to change it."); return;
            case NOT_CHOSEN: choose(a, () -> dial(a, number)); return;
            default: a.notice("The call could not be placed. Please try again.");
        }
    }

    /** Reads the company SIM from the CRM, so an admin's reset reaches this phone. Run off the main thread. */
    static void refresh(Context c) {
        try {
            JSONObject sim = SyncEngine.requestApi(c, "/v1/company-sim", "GET", null);
            store(c, sim);
        } catch (Exception ignored) { /* keep the last known SIM when offline */ }
    }

    static void store(Context c, JSONObject sim) {
        String key = sim.isNull("key") ? "" : sim.optString("key");
        SecureConfig.prefs(c).edit().putString("companySimKey", key).putString("companySimLabel", key.isEmpty() ? "" : sim.optString("label")).commit();
    }

    static String name(Context c, PhoneAccountHandle account, int index) {
        String label = SimTracking.label(c, account, index);
        return label.startsWith("SIM account") ? "SIM " + index : label + " · SIM " + index;
    }

    /** The one-time choice. `then` runs after a successful save. */
    static void choose(MainActivity a, Runnable then) {
        if (a.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
            a.notice("Allow phone-state access in Preferences first, so Salesdesk can see this phone's SIMs.");
            return;
        }
        List<PhoneAccountHandle> accounts = SimTracking.accounts(a);
        if (accounts.isEmpty()) { a.notice("No SIM found. Check that your SIM is active."); return; }
        LinearLayout body = a.column(); body.setPadding(a.dp(20), 0, a.dp(20), a.dp(12));
        a.caption(body, "CRM calls will always use it. Your personal calls are not touched.");
        RadioGroup group = new RadioGroup(a);
        for (int i = 0; i < accounts.size(); i++) {
            RadioButton option = new RadioButton(a);
            option.setId(i + 1);
            option.setText(name(a, accounts.get(i), i + 1));
            option.setTextSize(16);
            option.setMinHeight(a.dp(52));
            group.addView(option);
        }
        body.addView(group);
        a.caption(body, "After you save, only your admin can change this.");
        AlertDialog dialog = new AlertDialog.Builder(a).setTitle("Which is your company SIM?").setView(a.dialogBody(body))
            .setNegativeButton("Cancel", null).setPositiveButton("Save company SIM", null).create();
        dialog.setOnShowListener(v -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(w -> {
            int picked = group.getCheckedRadioButtonId();
            if (picked < 1) { a.notice("Choose the company SIM first."); return; }
            PhoneAccountHandle account = accounts.get(picked - 1);
            String key = SimTracking.key(account.getId()), label = name(a, account, picked);
            dialog.dismiss();
            final JSONObject[] saved = { null };
            final int[] refused = { 0 };
            a.work(() -> {
                try { saved[0] = SyncEngine.requestApi(a, "/v1/company-sim", "PUT", new JSONObject().put("key", key).put("label", label)); }
                catch (SyncEngine.HttpError e) { refused[0] = e.code; }
                catch (Exception e) { refused[0] = -1; }
            }, () -> {
                if (saved[0] != null) { store(a, saved[0]); a.render(); if (then != null) then.run(); }
                else if (refused[0] == 409) { a.notice("A company SIM is already set for you. Only your admin can change it."); a.work(() -> refresh(a), a::render); }
                else a.notice("Couldn't save the company SIM. Check the connection and try again.");
            });
        }));
        dialog.show();
    }
}
