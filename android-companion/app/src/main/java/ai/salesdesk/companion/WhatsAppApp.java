package ai.salesdesk.companion;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

/**
 * Which WhatsApp the app opens for a chat: WhatsApp Business by default, or normal WhatsApp when the person picks it in
 * Settings. The choice is kept on this phone. If the chosen app is not installed the other one opens, then whatever the
 * phone offers for a wa.me link.
 */
final class WhatsAppApp {
    static final String BUSINESS = "com.whatsapp.w4b", NORMAL = "com.whatsapp";
    static final String[][] CHOICES = {{BUSINESS, "WhatsApp Business"}, {NORMAL, "WhatsApp"}};

    static String chosen(Context c) { return SecureConfig.prefs(c).getString("whatsAppApp", BUSINESS); }
    static void choose(Context c, String pkg) { SecureConfig.prefs(c).edit().putString("whatsAppApp", pkg).apply(); }

    /** Opens a chat with this number (country code added to a ten-digit number), with the text typed in when given. */
    static boolean open(Context c, String phone, String text) {
        String d = String.valueOf(phone).replaceAll("[^0-9]", "");
        if (d.isEmpty()) return false;
        if (d.length() == 10) d = SecureConfig.prefs(c).getString("country", "91") + d;
        Uri uri = Uri.parse("https://wa.me/" + d + (text == null || text.isEmpty() ? "" : "?text=" + Uri.encode(text)));
        String first = chosen(c), second = first.equals(BUSINESS) ? NORMAL : BUSINESS;
        for (String pkg : new String[]{first, second, null}) {
            Intent i = new Intent(Intent.ACTION_VIEW, uri);
            if (pkg != null) i.setPackage(pkg);
            if (!(c instanceof android.app.Activity)) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { c.startActivity(i); return true; } catch (Exception ignored) { }
        }
        return false;
    }
}
