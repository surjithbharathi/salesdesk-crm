package ai.salesdesk.companion;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.Locale;
import org.json.JSONObject;

/**
 * The small pieces every redesigned screen shares, so they look and behave the same everywhere: a person's initials in a
 * circle of their own colour, the green call button, a stage chip, a white list card with hairlines between rows, and the
 * rounded pill buttons. Green always means calling and red always means missed or late; the brand colour means neither.
 */
final class Ui {
    static final int CALL = 0xff22a052, CALL_SOFT = 0xffe6f4ea, CALL_INK = 0xff17803d;
    private static final int[] AVATARS = {0xff1f4fd1, 0xff8e5bb5, 0xff2f7fb8, 0xff16805f, 0xffd35400, 0xff7a2e73, 0xff0f6e6e, 0xffb7472a};

    private Ui() {}

    static int avatarColor(String name) { return AVATARS[Math.abs(String.valueOf(name).hashCode()) % AVATARS.length]; }

    static String initials(String name) {
        StringBuilder s = new StringBuilder();
        for (String w : String.valueOf(name).trim().split("\\s+")) if (!w.isEmpty() && Character.isLetterOrDigit(w.charAt(0)) && s.length() < 2) s.append(Character.toUpperCase(w.charAt(0)));
        return s.length() == 0 ? "?" : s.toString();
    }

    /** Initials in a coloured circle; a number with no name gets a plain grey figure. */
    static TextView avatar(MainActivity a, String name, boolean known, int size) {
        TextView t = new TextView(a);
        t.setGravity(Gravity.CENTER); t.setTextColor(Color.WHITE); t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setText(known ? initials(name) : "👤"); t.setTextSize(known ? Math.max(12, size / 3f) : size / 2.6f);
        t.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        GradientDrawable c = new GradientDrawable(); c.setShape(GradientDrawable.OVAL); c.setColor(known ? avatarColor(name) : 0xffb0b8c4);
        t.setBackground(c);
        t.setLayoutParams(new LinearLayout.LayoutParams(a.dp(size), a.dp(size)));
        return t;
    }

    /** The round green call button at the end of a row. */
    static ImageView callButton(MainActivity a, String phone, String who) {
        ImageView call = new ImageView(a);
        call.setImageResource(R.drawable.ic_phone); call.setColorFilter(CALL_INK);
        call.setPadding(a.dp(12), a.dp(12), a.dp(12), a.dp(12));
        GradientDrawable g = new GradientDrawable(); g.setShape(GradientDrawable.OVAL); g.setColor(CALL_SOFT); call.setBackground(g);
        call.setContentDescription("Call " + who);
        call.setOnClickListener(v -> dial(a, phone));
        call.setLayoutParams(new LinearLayout.LayoutParams(a.dp(44), a.dp(44)));
        return call;
    }

    /** Calls straight away when the phone allows it, else opens the dialler with the number in. */
    static void dial(MainActivity a, String phone) {
        String d = String.valueOf(phone).replaceAll("[^0-9+]", "");
        if (d.isEmpty()) { a.notice("This lead has no phone number."); return; }
        if (!d.startsWith("+")) d = (d.length() == 10 ? "+" + SecureConfig.prefs(a).getString("country", "91") : "+") + d;
        CompanySim.dial(a, d);
    }

    static void whatsApp(MainActivity a, String phone, String text) {
        String d = String.valueOf(phone).replaceAll("[^0-9]", "");
        if (d.length() == 10) d = SecureConfig.prefs(a).getString("country", "91") + d;
        try { a.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/" + d + (text == null || text.isEmpty() ? "" : "?text=" + Uri.encode(text))))); }
        catch (Exception e) { a.notice("WhatsApp is not installed on this phone."); }
    }

    // ---- stages ----

    static String stageLabel(JSONObject lead) {
        if (!lead.optString("deal").isEmpty()) return lead.optString("deal");
        String stage = lead.optString("stage", "New");
        if (stage.equals("Closed") && !lead.optString("disposition").isEmpty()) return lead.optString("disposition");
        switch (stage) { case "Prospecting": return "Discussion"; case "Opportunity": return "Interested customer"; default: return stage.isEmpty() ? "New" : stage; }
    }

    /** Background and text colour for a stage chip: new is brand blue, interested green, quotation amber, the rest grey. */
    static int[] stageColours(String label) {
        String l = label.toLowerCase(Locale.ROOT);
        if (l.equals("new")) return new int[]{MainActivity.SOFT, MainActivity.ACCENT};
        if (l.contains("interest") || l.contains("won") || l.contains("order")) return new int[]{CALL_SOFT, CALL_INK};
        if (l.contains("quot")) return new int[]{0xfffff3dc, 0xff8a5200};
        if (l.contains("lost") || l.contains("not interested")) return new int[]{0xfffde8e7, 0xffa52a24};
        return new int[]{0xffeef2f4, 0xff45525c};
    }

    static TextView chip(MainActivity a, String label, int bg, int fg) {
        TextView t = new TextView(a);
        t.setText(label); t.setTextSize(12); t.setTypeface(Typeface.DEFAULT_BOLD); t.setTextColor(fg);
        t.setPadding(a.dp(9), a.dp(3), a.dp(9), a.dp(3)); t.setSingleLine(true); t.setEllipsize(TextUtils.TruncateAt.END);
        t.setBackground(a.surface(bg, 12));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2, -2); p.setMarginEnd(a.dp(6)); t.setLayoutParams(p);
        return t;
    }

    static TextView stageChip(MainActivity a, JSONObject lead) { String l = stageLabel(lead); int[] c = stageColours(l); return chip(a, l, c[0], c[1]); }

    // ---- lists ----

    /** A white rounded card that holds rows separated by hairlines (call rows add their own). */
    static LinearLayout group(MainActivity a, LinearLayout parent) {
        LinearLayout g = a.column();
        GradientDrawable bg = a.surface(Color.WHITE, 16); bg.setStroke(a.dp(1), MainActivity.LINE); g.setBackground(bg);
        g.setClipToOutline(true);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2); p.setMargins(0, 0, 0, a.dp(8));
        parent.addView(g, p);
        return g;
    }

    static void hairline(MainActivity a, LinearLayout group, int inset) {
        View line = new View(a); line.setBackgroundColor(MainActivity.LINE);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, 1); p.setMarginStart(a.dp(inset));
        group.addView(line, p);
    }

    /** A grey heading above a group, with an optional count or link at the end. */
    static TextView heading(MainActivity a, LinearLayout parent, String title, String end, int color) {
        LinearLayout row = a.horizontal(); row.setPadding(a.dp(4), a.dp(16), a.dp(4), a.dp(8));
        TextView t = text(a, title, 13, true, color); row.addView(t, new LinearLayout.LayoutParams(0, -2, 1));
        TextView e = text(a, end == null ? "" : end, 13, true, color); row.addView(e);
        parent.addView(row);
        return e;
    }

    /** One list row: avatar, two lines of text, and optional trailing views. Returns the row so callers can add a click. */
    static LinearLayout row(MainActivity a, LinearLayout group, View lead, String title, String sub, int titleColor, int subColor) {
        LinearLayout row = a.horizontal();
        row.setPadding(a.dp(14), a.dp(10), a.dp(10), a.dp(10)); row.setMinimumHeight(a.dp(64));
        if (lead != null) row.addView(lead);
        LinearLayout middle = a.column(); middle.setPadding(a.dp(12), 0, a.dp(8), 0);
        TextView t = text(a, title, 15, true, titleColor); t.setSingleLine(true); t.setEllipsize(TextUtils.TruncateAt.END); middle.addView(t);
        if (sub != null && !sub.isEmpty()) { TextView s = text(a, sub, 13, false, subColor); s.setMaxLines(2); s.setEllipsize(TextUtils.TruncateAt.END); s.setPadding(0, a.dp(2), 0, 0); middle.addView(s); }
        row.addView(middle, new LinearLayout.LayoutParams(0, -2, 1));
        group.addView(row);
        return row;
    }

    static TextView text(MainActivity a, String s, float size, boolean bold, int color) {
        TextView t = new TextView(a); t.setText(s); t.setTextSize(size); t.setTextColor(color);
        t.setTypeface(Typeface.create(bold ? "sans-serif-medium" : "sans-serif", Typeface.NORMAL));
        return t;
    }

    /** A rounded pill: filled for the main action, soft for the others. */
    static TextView pill(MainActivity a, String label, boolean filled, int color, Runnable run) {
        TextView t = new TextView(a); t.setText(label); t.setTextSize(14); t.setTypeface(Typeface.DEFAULT_BOLD); t.setGravity(Gravity.CENTER);
        t.setTextColor(filled ? Color.WHITE : color); t.setPadding(a.dp(16), 0, a.dp(16), 0); t.setMinHeight(a.dp(44)); t.setMinimumHeight(a.dp(44));
        t.setBackground(a.surface(filled ? color : (color == MainActivity.ACCENT ? MainActivity.SOFT : 0x14000000 | (color & 0xffffff)), 22));
        t.setFocusable(true); t.setClickable(true);
        t.setOnClickListener(v -> run.run());
        return t;
    }

    /** A choice chip in a row of choices (filters, outcomes, times); the chosen one is filled. */
    static TextView choice(MainActivity a, String label, boolean on, Runnable run) {
        TextView t = new TextView(a); t.setText(label); t.setTextSize(13); t.setGravity(Gravity.CENTER); t.setSingleLine(true);
        t.setTypeface(Typeface.create(on ? "sans-serif-medium" : "sans-serif", Typeface.NORMAL));
        t.setTextColor(on ? Color.WHITE : MainActivity.INK); t.setPadding(a.dp(14), 0, a.dp(14), 0); t.setMinHeight(a.dp(38)); t.setMinimumHeight(a.dp(38));
        GradientDrawable g = a.surface(on ? MainActivity.ACCENT : Color.WHITE, 19); if (!on) g.setStroke(a.dp(1), MainActivity.LINE); t.setBackground(g);
        t.setSelected(on); t.setFocusable(true); t.setClickable(true);
        t.setOnClickListener(v -> run.run());
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2, a.dp(38)); p.setMargins(0, 0, a.dp(8), a.dp(8)); t.setLayoutParams(p);
        return t;
    }

    /** A sideways-scrolling row for chips, so long sets never squash. Returns the inner row to add chips to. */
    static LinearLayout chipRow(MainActivity a, LinearLayout parent) {
        android.widget.HorizontalScrollView s = new android.widget.HorizontalScrollView(a); s.setHorizontalScrollBarEnabled(false); s.setClipToPadding(false);
        LinearLayout row = new LinearLayout(a); s.addView(row);
        parent.addView(s, new LinearLayout.LayoutParams(-1, -2));
        return row;
    }

    /**
     * Newer Androids draw every window edge to edge, under the status bar and the gesture bar. This pads a window's root
     * by the bars' height, so nothing sits under the clock or the battery.
     */
    static void clearBars(View root, boolean top, boolean bottom) {
        int l = root.getPaddingLeft(), t = root.getPaddingTop(), r = root.getPaddingRight(), b = root.getPaddingBottom();
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int it, ib, il, ir;
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.ime());
                it = bars.top; ib = bars.bottom; il = bars.left; ir = bars.right;
            } else { it = insets.getSystemWindowInsetTop(); ib = insets.getSystemWindowInsetBottom(); il = insets.getSystemWindowInsetLeft(); ir = insets.getSystemWindowInsetRight(); }
            v.setPadding(l + il, t + (top ? it : 0), r + ir, b + (bottom ? ib : 0));
            return insets;
        });
        root.requestApplyInsets();
    }

    // ---- time ----

    static long ms(String iso) { try { return java.time.Instant.parse(iso).toEpochMilli(); } catch (Exception e) { return 0; } }
    static String clock(long t) { return t == 0 ? "" : new java.text.SimpleDateFormat("h:mm a", Locale.ENGLISH).format(new java.util.Date(t)); }
    static String dayLabel(long t) {
        if (t == 0) return "No date";
        java.time.LocalDate d = java.time.Instant.ofEpochMilli(t).atZone(java.time.ZoneId.systemDefault()).toLocalDate(), today = java.time.LocalDate.now();
        if (d.equals(today)) return "Today";
        if (d.equals(today.minusDays(1))) return "Yesterday";
        if (d.equals(today.plusDays(1))) return "Tomorrow";
        return d.format(java.time.format.DateTimeFormatter.ofPattern(d.getYear() == today.getYear() ? "EEE, d MMM" : "d MMM yyyy", Locale.ENGLISH));
    }
    static String ago(long t) {
        if (t == 0) return "";
        long m = (System.currentTimeMillis() - t) / 60000;
        if (m < 60) return m <= 1 ? "just now" : m + " min ago";
        long h = m / 60; if (h < 24) return h + " h ago";
        long d = h / 24; return d == 1 ? "yesterday" : d < 31 ? d + " days ago" : (d / 30) + " months ago";
    }
}
