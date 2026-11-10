package ai.salesdesk.companion;

import android.content.*;
import android.telephony.TelephonyManager;
import org.json.JSONObject;

/**
 * Shows the caller card when the phone starts ringing, and when an outgoing call starts. Android's caller-ID service
 * (LeadScreeningService) is often not asked about numbers saved in the phone's contacts, and most lead numbers are saved
 * there, so the call state is watched too. The number is only given to apps allowed to read the call log. Registered in the
 * manifest and, for newer Androids that hold such broadcasts back, by the always-on call monitor service.
 */
public class CallerWatch extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent intent) {
        if (!TelephonyManager.ACTION_PHONE_STATE_CHANGED.equals(intent.getAction())) return;
        String state = intent.getStringExtra(TelephonyManager.EXTRA_STATE);
        if (state == null) return;
        // an outgoing call goes straight from idle to off-hook; an answered incoming call passes through ringing first.
        // Each change arrives more than once (with and without the number, and to both registrations), so a repeat keeps the
        // state it came from.
        android.content.SharedPreferences p = SecureConfig.prefs(c);
        String now = p.getString("callState", TelephonyManager.EXTRA_STATE_IDLE), before = p.getString("callStateBefore", TelephonyManager.EXTRA_STATE_IDLE);
        if (!state.equals(now)) { before = now; p.edit().putString("callState", state).putString("callStateBefore", before).apply(); }
        boolean ringing = TelephonyManager.EXTRA_STATE_RINGING.equals(state);
        boolean outgoing = TelephonyManager.EXTRA_STATE_OFFHOOK.equals(state) && TelephonyManager.EXTRA_STATE_IDLE.equals(before);
        if (!ringing && !outgoing) return;
        @SuppressWarnings("deprecation") String number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER);
        if (number == null || number.trim().isEmpty()) return; // the first broadcast comes without the number
        if (!SecureConfig.loggedIn(c) || !p.getBoolean("screenPop", false) || !anySimOn(c)) return;
        LeadScreeningService.lookup(c.getApplicationContext(), number, outgoing);
    }

    // the broadcast does not say which SIM is used: the card shows unless every SIM is set to Off
    static boolean anySimOn(Context c) {
        JSONObject sims = SimTracking.policy(c).optJSONObject("sims");
        if (sims == null || sims.length() == 0) return true;
        for (java.util.Iterator<String> k = sims.keys(); k.hasNext(); ) if (!"off".equals(sims.optString(k.next()))) return true;
        return false;
    }
}
