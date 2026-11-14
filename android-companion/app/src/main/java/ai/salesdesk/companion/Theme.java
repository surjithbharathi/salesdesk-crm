package ai.salesdesk.companion;

import android.content.Context;

/**
 * The look of the app. Three skins: our own, one that follows the Salesmax palette and one that follows the TeleCRM palette,
 * so people moving over find familiar colours. Colours were read from the colour resources and style sheet of the two apps
 * installed on the owner's phone; no artwork, icon, layout file or code was copied.
 */
final class Theme {
    static final String[][] SKINS = {
        {"royal", "Salesdesk blue", "Royal blue on white, with light bars. The standard look."},
        {"salesdesk", "Salesdesk classic", "Our first look: iron grey, oil yellow and paper."},
        {"salesmax", "Salesmax style", "Indigo and white, with the palette Salesmax uses."},
        {"telecrm", "TeleCRM style", "Deep purple and white, with the palette TeleCRM uses."},
    };
    /** Everyone uses Salesdesk blue for now; the other looks stay listed in Settings, greyed out. */
    static final String DEFAULT = "royal";
    static boolean available(String id) { return DEFAULT.equals(id); }
    static String current = DEFAULT;

    static void load(Context c) {
        String id = SecureConfig.prefs(c).getString("theme", DEFAULT); apply(available(id) ? id : DEFAULT);
        mode = mode(c); palette(mode.equals("dark") || (mode.equals("system") && phoneIsDark(c)));
    }
    /** Light, dark, or "system" (follows the phone's dark theme). Kept on this phone. */
    static final String[][] MODES = {{"system", "Same as the phone"}, {"light", "Light"}, {"dark", "Dark"}};
    static String mode = "system";

    static String mode(Context c) { String m = SecureConfig.prefs(c).getString("darkMode", "system"); return m.equals("light") || m.equals("dark") ? m : "system"; }
    static void saveMode(Context c, String m) { SecureConfig.prefs(c).edit().putString("darkMode", m).commit(); load(c); }
    static boolean phoneIsDark(Context c) {
        return (c.getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES;
    }

    /** The colours every screen shares that are not part of a skin: cards, call buttons, the chat bubbles. */
    static void palette(boolean dark) {
        MainActivity.DARK = dark;
        MainActivity.CARD = dark ? 0xff181c2e : 0xffffffff;
        Ui.CALL_SOFT = dark ? 0xff173322 : 0xffe6f4ea; Ui.CALL_INK = dark ? 0xff5fd08c : 0xff17803d;
        HistoryView.IN = dark ? 0xff202c33 : 0xffffffff; HistoryView.SYS = dark ? 0xff1f2438 : 0xffeef2f4; HistoryView.OUT = dark ? 0xff0f4a3c : 0xffd9fdd3; HistoryView.NOTE = dark ? 0xff3a3214 : 0xfffff6cc;
        HistoryView.TEXT = dark ? 0xffe9edef : 0xff111b21; HistoryView.SUB = dark ? 0xff9aa6ae : 0xff667781;
        HistoryView.OUT_SUB = dark ? 0xff9fd8b7 : 0xff4f7a5a; HistoryView.NOTE_SUB = dark ? 0xfff2b75a : 0xff8a6d00;
        if (!dark) return;
        // dark: deep navy ground, lighter cards, and colours bright enough to read on them (text 4.5:1 and up)
        MainActivity.PURPLE = 0xff6584f7; MainActivity.ACCENT = 0xff6584f7; MainActivity.ONACCENT = 0xffffffff;
        MainActivity.BAR = 0xff181c2e; MainActivity.ONBAR = 0xffeceef7; MainActivity.BARMUTED = 0xff9a9db3; MainActivity.BARACCENT = 0xff7b97ff; MainActivity.BARCHIP = 0xff22305e;
        MainActivity.PANELTRACK = 0xff22305e; MainActivity.PANELGOOD = 0xff5fd08c; MainActivity.PANELBAD = 0xffff8a82;
        MainActivity.INK = 0xffeceef7; MainActivity.MUTED = 0xff9a9db3; MainActivity.BG = 0xff0f1220; MainActivity.LINE = 0xff2a3049;
        MainActivity.SOFT = 0xff22305e; MainActivity.NEUTRAL = 0xff1f2438; MainActivity.GOODSOFT = 0xff173322; MainActivity.LEAF = 0xff5fd08c; MainActivity.RED = 0xffff8a82;
        MainActivity.LIGHTBARS = false;
    }

    static void save(Context c, String id) {
        if (!available(id)) return;
        SecureConfig.prefs(c).edit().putString("theme", id).commit();
        load(c);
    }

    static void apply(String id) {
        current = id;
        if (id.equals("royal")) {
            // royal blue on white; green stays for calling, red for missed and late, so the brand colour never means either
            MainActivity.PURPLE = 0xff1f4fd1; MainActivity.ACCENT = 0xff1f4fd1; MainActivity.ONACCENT = 0xffffffff;
            MainActivity.BAR = 0xffffffff; MainActivity.ONBAR = 0xff16152b; MainActivity.BARMUTED = 0xff5e5c70; MainActivity.BARACCENT = 0xff1f4fd1; MainActivity.BARCHIP = 0xffe4eafb;
            MainActivity.PANELTRACK = 0xffe4eafb; MainActivity.PANELGOOD = 0xff17803d; MainActivity.PANELBAD = 0xffc0302b;
            MainActivity.INK = 0xff16152b; MainActivity.MUTED = 0xff5e5c70; MainActivity.BG = 0xfff5f5f8; MainActivity.LINE = 0xffe6e5ee;
            MainActivity.SOFT = 0xffe4eafb; MainActivity.NEUTRAL = 0xfff0f0f4; MainActivity.GOODSOFT = 0xffe6f4ea; MainActivity.LEAF = 0xff17803d; MainActivity.RED = 0xffc0302b;
            MainActivity.RADIUS = 14; MainActivity.CONDENSED = false; MainActivity.LIGHTBARS = true;
        } else if (id.equals("salesmax")) {
            MainActivity.PURPLE = 0xff4a52d8; MainActivity.ACCENT = 0xff5b63eb; MainActivity.ONACCENT = 0xffffffff;
            MainActivity.BAR = 0xffffffff; MainActivity.ONBAR = 0xff15161b; MainActivity.BARMUTED = 0xff8a8fa0; MainActivity.BARACCENT = 0xff5b63eb; MainActivity.BARCHIP = 0xffeef0fd;
            MainActivity.PANELTRACK = 0xffe8eafd; MainActivity.PANELGOOD = 0xff17845c; MainActivity.PANELBAD = 0xffc03d39;
            MainActivity.INK = 0xff15161b; MainActivity.MUTED = 0xff5a5e6b; MainActivity.BG = 0xfff4f5f8; MainActivity.LINE = 0xffe3e5ea;
            MainActivity.SOFT = 0xffeef0fd; MainActivity.NEUTRAL = 0xfff4f5f8; MainActivity.GOODSOFT = 0xffe6f7ef; MainActivity.LEAF = 0xff17845c; MainActivity.RED = 0xffe0524e;
            MainActivity.RADIUS = 16; MainActivity.CONDENSED = false; MainActivity.LIGHTBARS = true;
        } else if (id.equals("telecrm")) {
            MainActivity.PURPLE = 0xff4f38a2; MainActivity.ACCENT = 0xff4f38a2; MainActivity.ONACCENT = 0xffffffff;
            MainActivity.BAR = 0xff4f38a2; MainActivity.ONBAR = 0xffffffff; MainActivity.BARMUTED = 0xffcfc7f2; MainActivity.BARACCENT = 0xffffffff; MainActivity.BARCHIP = 0xff6452b3;
            MainActivity.PANELTRACK = 0xff7868ee; MainActivity.PANELGOOD = 0xffa8f0c8; MainActivity.PANELBAD = 0xffffc2b8;
            MainActivity.INK = 0xff1b1b1f; MainActivity.MUTED = 0xff707070; MainActivity.BG = 0xfff6f5fb; MainActivity.LINE = 0xffe5e5e5;
            MainActivity.SOFT = 0xffe8e4ff; MainActivity.NEUTRAL = 0xffefefef; MainActivity.GOODSOFT = 0xffe0f4ea; MainActivity.LEAF = 0xff1f8a5b; MainActivity.RED = 0xffd64545;
            MainActivity.RADIUS = 8; MainActivity.CONDENSED = false; MainActivity.LIGHTBARS = false;
        } else {
            current = "salesdesk";
            MainActivity.PURPLE = 0xff8a5a00; MainActivity.ACCENT = 0xffe9a800; MainActivity.ONACCENT = 0xff1e2629;
            MainActivity.BAR = 0xff1e2629; MainActivity.ONBAR = 0xffffffff; MainActivity.BARMUTED = 0xffa8b3b0; MainActivity.BARACCENT = 0xffe9a800; MainActivity.BARCHIP = 0xff2a3438;
            MainActivity.PANELTRACK = 0xff3a454a; MainActivity.PANELGOOD = 0xff4fc08e; MainActivity.PANELBAD = 0xffff8a7a;
            MainActivity.INK = 0xff22282a; MainActivity.MUTED = 0xff5f6965; MainActivity.BG = 0xfff2f3ef; MainActivity.LINE = 0xffd9ddd8;
            MainActivity.SOFT = 0xfffbeab8; MainActivity.NEUTRAL = 0xffeceee9; MainActivity.GOODSOFT = 0xffdcefe6; MainActivity.LEAF = 0xff2f7d5b; MainActivity.RED = 0xffbf3b2b;
            MainActivity.RADIUS = 10; MainActivity.CONDENSED = true; MainActivity.LIGHTBARS = false;
        }
    }
}
