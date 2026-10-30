package ai.salesdesk.companion;

import android.content.Context;

/**
 * The look of the app. Three skins: our own, one that follows the Salesmax palette and one that follows the TeleCRM palette,
 * so people moving over find familiar colours. Colours were read from the colour resources and style sheet of the two apps
 * installed on the owner's phone; no artwork, icon, layout file or code was copied.
 */
final class Theme {
    static final String[][] SKINS = {
        {"salesdesk", "Salesdesk", "Our own look: iron grey, oil yellow and paper."},
        {"salesmax", "Salesmax style", "Indigo and white, with the palette Salesmax uses."},
        {"telecrm", "TeleCRM style", "Deep purple and white, with the palette TeleCRM uses."},
    };
    static String current = "salesdesk";

    static void load(Context c) { apply(SecureConfig.prefs(c).getString("theme", "salesdesk")); }

    static void save(Context c, String id) {
        SecureConfig.prefs(c).edit().putString("theme", id).commit();
        apply(id);
    }

    static void apply(String id) {
        current = id;
        if (id.equals("salesmax")) {
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
