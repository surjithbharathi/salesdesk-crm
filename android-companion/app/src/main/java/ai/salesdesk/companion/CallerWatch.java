package ai.salesdesk.companion;

import android.content.*;
import android.telephony.TelephonyManager;
import org.json.JSONObject;

/**
 * Shows the caller card when the phone starts ringing. Android's caller-ID service (LeadScreeningService) is often not asked
 * about numbers saved in the phone's contacts, and most lead numbers are saved there, so the ringing state is watched too.
 * The incoming number is only given to apps allowed to read the call log. Registered in the manifest and, for newer Androids
 * that hold such broadcasts back, by the always-on call monitor service.
 */
public class CallerWatch extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent intent) {
        if (!TelephonyManager.ACTION_PHONE_STATE_CHANGED.equals(intent.getAction())) return;
        if (!TelephonyManager.EXTRA_STATE_RINGING.equals(intent.getStringExtra(TelephonyManager.EXTRA_STATE))) return;
        @SuppressWarnings("deprecation") String number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER);
        if (number == null || number.trim().isEmpty()) return; // the first broadcast comes without the number
        if (!SecureConfig.loggedIn(c) || !SecureConfig.prefs(c).getBoolean("screenPop", false) || !anySimOn(c)) return;
        LeadScreeningService.lookup(c.getApplicationContext(), number);
    }

    // the ringing broadcast does not say which SIM rang: the card shows unless every SIM is set to Off
    static boolean anySimOn(Context c) {
        JSONObject sims = SimTracking.policy(c).optJSONObject("sims");
        if (sims == null || sims.length() == 0) return true;
        for (java.util.Iterator<String> k = sims.keys(); k.hasNext(); ) if (!"off".equals(sims.optString(k.next()))) return true;
        return false;
    }
}
