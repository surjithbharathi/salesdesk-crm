package ai.salesdesk.companion;

import android.content.*;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.os.*;
import android.telephony.TelephonyManager;
import android.text.TextUtils;
import android.view.*;
import android.widget.*;
import org.json.*;

/**
 * The card shown over the call screen while a call rings, in the spirit of a caller-ID app: who it is in Salesdesk, where the
 * lead stands, who owns it, what was done last and what is due next. A number that is not in Salesdesk gets its probable state
 * and an "Add as lead" button. It can be dragged up or down, closes with the call, and never answers, blocks or records anything.
 */
final class CallerCard {
    private static View current;
    private static WindowManager manager;
    private static WindowManager.LayoutParams params;
    private static String shownFor = "";

    static void dismiss() {
        if (current != null) try { manager.removeView(current); } catch (Exception ignored) {}
        current = null; manager = null; params = null; shownFor = "";
    }

    /** Shows the card for this number; a later call for the same number (the server's fuller answer) replaces it in place. */
    static void show(Context c, String number, JSONObject card) {
        if (!SecureConfig.loggedIn(c) || !android.provider.Settings.canDrawOverlays(c)) return;
        if (((android.app.KeyguardManager) c.getSystemService(Context.KEYGUARD_SERVICE)).isKeyguardLocked()) return;
        new Handler(Looper.getMainLooper()).post(() -> {
            if (current != null && !number.equals(shownFor)) dismiss();
            Theme.load(c);
            View view = build(c, number, card);
            try {
                if (current != null) {
                    manager.removeView(current);
                    manager.addView(view, params);
                } else {
                    manager = c.getSystemService(WindowManager.class);
                    params = new WindowManager.LayoutParams(-1, -2, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS, PixelFormat.TRANSLUCENT);
                    params.gravity = Gravity.TOP;
                    params.y = dp(c, 90);
                    manager.addView(view, params);
                    watchCall(c, view);
                }
                current = view; shownFor = number;
            } catch (Exception e) { current = null; manager = null; params = null; }
        });
    }

    private static View build(Context c, String number, JSONObject d) {
        boolean found = d.optBoolean("found"), own = d.optBoolean("own", true), blocked = d.optBoolean("blocked");
        FrameLayout outer = new FrameLayout(c);
        outer.setPadding(dp(c, 12), 0, dp(c, 12), 0);
        LinearLayout box = new LinearLayout(c);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(c, 16), dp(c, 14), dp(c, 16), dp(c, 12));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE); bg.setCornerRadius(dp(c, 18)); bg.setStroke(dp(c, 1), MainActivity.LINE);
        box.setBackground(bg);
        box.setElevation(dp(c, 10));
        outer.addView(box, new FrameLayout.LayoutParams(-1, -2));

        // header: initials, name, place, close
        LinearLayout head = new LinearLayout(c);
        head.setGravity(Gravity.CENTER_VERTICAL);
        String name = found ? d.optString("name") : blocked ? "Blocked number" : "New number";
        TextView avatar = new TextView(c);
        avatar.setText(found ? initials(name) : "?");
        avatar.setTextColor(MainActivity.ONACCENT); avatar.setTextSize(16); avatar.setTypeface(Typeface.DEFAULT_BOLD); avatar.setGravity(Gravity.CENTER);
        GradientDrawable circle = new GradientDrawable(); circle.setShape(GradientDrawable.OVAL);
        circle.setColor(blocked ? MainActivity.RED : found ? MainActivity.ACCENT : MainActivity.MUTED);
        avatar.setBackground(circle);
        head.addView(avatar, new LinearLayout.LayoutParams(dp(c, 44), dp(c, 44)));
        LinearLayout titles = new LinearLayout(c); titles.setOrientation(LinearLayout.VERTICAL); titles.setPadding(dp(c, 12), 0, dp(c, 8), 0);
        TextView title = new TextView(c); title.setText(name); title.setTextSize(18); title.setTypeface(Typeface.DEFAULT_BOLD); title.setTextColor(MainActivity.INK);
        title.setSingleLine(true); title.setEllipsize(TextUtils.TruncateAt.END);
        titles.addView(title);
        String sub = found && own ? join(" · ", d.optString("company"), place(d)) : found ? "Lead of " + d.optString("owner") : pretty(d.optString("number", number));
        if (!sub.isEmpty()) { TextView s = line(c, sub, 13, MainActivity.MUTED); s.setSingleLine(true); s.setEllipsize(TextUtils.TruncateAt.END); titles.addView(s); }
        head.addView(titles, new LinearLayout.LayoutParams(0, -2, 1));
        TextView close = new TextView(c); close.setText("✕"); close.setTextSize(18); close.setTextColor(MainActivity.MUTED); close.setPadding(dp(c, 10), dp(c, 4), dp(c, 4), dp(c, 4));
        close.setContentDescription("Close"); close.setOnClickListener(v -> dismiss());
        head.addView(close);
        box.addView(head);

        if (found) {
            // stage, owner and language as small chips
            LinearLayout chips = new LinearLayout(c); chips.setPadding(0, dp(c, 10), 0, dp(c, 2));
            chips.addView(chip(c, d.optString("stage"), MainActivity.SOFT, MainActivity.PURPLE));
            if (own && !d.optString("owner").isEmpty()) chips.addView(chip(c, d.optString("owner"), MainActivity.NEUTRAL, MainActivity.INK));
            if (own && !d.optString("language").isEmpty()) chips.addView(chip(c, d.optString("language"), MainActivity.GOODSOFT, MainActivity.LEAF));
            box.addView(chips);
        }
        if (found && own) {
            JSONObject last = d.optJSONObject("last"), next = d.optJSONObject("next");
            if (last != null) box.addView(fact(c, "Last", last.optString("text") + " · " + ago(last.optString("at")) + (last.optString("by").isEmpty() ? "" : " · " + last.optString("by"))));
            if (next != null) box.addView(fact(c, "Next", next.optString("title") + " · " + when(next.optString("due"))));
            int calls = d.optInt("calls");
            if (d.has("calls")) {
            String work = join(" · ", calls > 0 ? calls + " call" + (calls == 1 ? "" : "s") + ", " + d.optInt("answered") + " answered" : "No calls yet", d.optString("source"), d.optLong("value") > 0 ? "₹" + String.format(java.util.Locale.ENGLISH, "%,d", d.optLong("value")) : "");
            box.addView(fact(c, "Work", work));
            }
        } else if (found) {
            box.addView(line(c, "This customer is " + d.optString("owner") + "’s lead. Ask them before following up.", 13, MainActivity.MUTED));
        } else if (!blocked) {
            String probable = d.optString("probableState");
            box.addView(line(c, probable.isEmpty() ? "Not in Salesdesk yet." : "Not in Salesdesk yet · probably from " + probable, 13, MainActivity.MUTED));
        }

        // actions
        LinearLayout actions = new LinearLayout(c); actions.setGravity(Gravity.END | Gravity.CENTER_VERTICAL); actions.setPadding(0, dp(c, 10), 0, 0);
        TextView brand = line(c, "Salesdesk", 11, MainActivity.MUTED);
        actions.addView(brand, new LinearLayout.LayoutParams(0, -2, 1));
        if (found && own) actions.addView(action(c, "Open lead", () -> open(c, new Intent(c, MainActivity.class).putExtra("openLeadId", d.optString("id")))));
        else if (!found && !blocked) actions.addView(action(c, "Add as lead", () -> open(c, new Intent(c, MainActivity.class).putExtra("newLeadPhone", d.optString("number", number)))));
        box.addView(actions);

        drag(outer);
        return outer;
    }

    // ---- small builders ----
    private static int dp(Context c, int v) { return Math.round(v * c.getResources().getDisplayMetrics().density); }
    private static TextView line(Context c, String text, int size, int color) { TextView t = new TextView(c); t.setText(text); t.setTextSize(size); t.setTextColor(color); return t; }
    private static TextView chip(Context c, String text, int bg, int fg) {
        TextView t = line(c, text, 12, fg); t.setTypeface(Typeface.DEFAULT_BOLD); t.setPadding(dp(c, 9), dp(c, 3), dp(c, 9), dp(c, 3));
        GradientDrawable g = new GradientDrawable(); g.setColor(bg); g.setCornerRadius(dp(c, 12)); t.setBackground(g);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2, -2); p.setMarginEnd(dp(c, 6)); t.setLayoutParams(p);
        t.setSingleLine(true); t.setEllipsize(TextUtils.TruncateAt.END); t.setMaxWidth(dp(c, 170));
        return t;
    }
    private static View fact(Context c, String label, String text) {
        LinearLayout row = new LinearLayout(c); row.setPadding(0, dp(c, 6), 0, 0);
        TextView l = line(c, label, 12, MainActivity.MUTED); l.setTypeface(Typeface.DEFAULT_BOLD);
        row.addView(l, new LinearLayout.LayoutParams(dp(c, 44), -2));
        TextView v = line(c, text, 13, MainActivity.INK); v.setMaxLines(2); v.setEllipsize(TextUtils.TruncateAt.END);
        row.addView(v, new LinearLayout.LayoutParams(0, -2, 1));
        return row;
    }
    private static Button action(Context c, String text, Runnable run) {
        Button b = new Button(c); b.setText(text); b.setAllCaps(false); b.setTextColor(MainActivity.ONACCENT); b.setTextSize(14);
        GradientDrawable g = new GradientDrawable(); g.setColor(MainActivity.ACCENT); g.setCornerRadius(dp(c, 10)); b.setBackground(g);
        b.setPadding(dp(c, 16), 0, dp(c, 16), 0); b.setMinHeight(dp(c, 40)); b.setMinimumHeight(dp(c, 40));
        b.setOnClickListener(v -> run.run());
        return b;
    }
    private static void open(Context c, Intent i) { dismiss(); c.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)); }
    private static String initials(String name) {
        String[] w = name.trim().split("\\s+"); StringBuilder s = new StringBuilder();
        for (String x : w) if (!x.isEmpty() && Character.isLetterOrDigit(x.charAt(0)) && s.length() < 2) s.append(Character.toUpperCase(x.charAt(0)));
        return s.length() == 0 ? "?" : s.toString();
    }
    private static String join(String sep, String... parts) { StringBuilder s = new StringBuilder(); for (String p : parts) if (p != null && !p.trim().isEmpty()) { if (s.length() > 0) s.append(sep); s.append(p.trim()); } return s.toString(); }
    private static String place(JSONObject d) { String state = d.optString("state"); if (state.isEmpty() && !d.optString("probableState").isEmpty()) state = "probably " + d.optString("probableState"); return join(", ", d.optString("city"), state); }
    private static String pretty(String n) { String digits = n.replaceAll("[^0-9]", ""); return digits.length() == 12 && digits.startsWith("91") ? "+91 " + digits.substring(2, 7) + " " + digits.substring(7) : n; }
    private static long ms(String iso) { try { return java.time.Instant.parse(iso).toEpochMilli(); } catch (Exception e) { return 0; } }
    private static String ago(String iso) {
        long t = ms(iso); if (t == 0) return ""; long m = (System.currentTimeMillis() - t) / 60000;
        if (m < 60) return m <= 1 ? "just now" : m + " min ago"; long h = m / 60; if (h < 24) return h + " h ago"; long days = h / 24;
        return days == 1 ? "yesterday" : days < 31 ? days + " days ago" : (days / 30) + " months ago";
    }
    private static String when(String iso) {
        long t = ms(iso); if (t == 0) return "";
        java.text.SimpleDateFormat f = new java.text.SimpleDateFormat(t < System.currentTimeMillis() ? "d MMM, h:mm a" : "EEE d MMM, h:mm a", java.util.Locale.ENGLISH);
        return (t < System.currentTimeMillis() ? "late since " : "") + f.format(new java.util.Date(t));
    }

    // drag the card up or down by its empty parts
    private static void drag(View view) {
        final float[] start = new float[2];
        view.setOnTouchListener((v, e) -> {
            if (params == null || manager == null) return false;
            if (e.getAction() == MotionEvent.ACTION_DOWN) { start[0] = e.getRawY(); start[1] = params.y; return true; }
            if (e.getAction() == MotionEvent.ACTION_MOVE) { params.y = Math.max(0, (int) (start[1] + e.getRawY() - start[0])); try { manager.updateViewLayout(v, params); } catch (Exception ignored) {} return true; }
            return false;
        });
    }

    // closes with the call: watches the call state while shown (at most 10 minutes); without that permission, after 60 seconds
    private static void watchCall(Context c, View view) {
        Handler h = new Handler(Looper.getMainLooper());
        long until = System.currentTimeMillis() + 600000;
        int[] idle = {0};
        Runnable check = new Runnable() { public void run() {
            if (current != view) return;
            int state;
            try { state = c.getSystemService(TelephonyManager.class).getCallState(); }
            catch (Exception e) { h.postDelayed(() -> { if (current == view) dismiss(); }, 60000); return; }
            idle[0] = state == TelephonyManager.CALL_STATE_IDLE ? idle[0] + 1 : 0;
            if (idle[0] >= 2 || System.currentTimeMillis() > until) { dismiss(); return; }
            h.postDelayed(this, 1500);
        } };
        h.postDelayed(check, 3000);
    }
}
