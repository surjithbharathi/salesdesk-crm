package ai.salesdesk.companion;

import android.graphics.Color;
import android.graphics.Typeface;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.*;
import org.json.*;

/**
 * My day: today's numbers, then the open follow-ups with their own call buttons, then the one call to make next in a
 * large card (who, why, what they said last, a big Call button). Goals, badges and the leaderboard follow below.
 */
final class MyDayView {
    private MyDayView() {}

    static void draw(MainActivity a) {
        JSONObject d;
        try { d = new JSONObject(SecureConfig.prefs(a).getString("kpiDay", "{}")); } catch (Exception e) { d = new JSONObject(); }
        JSONObject today = d.optJSONObject("today");
        Map<String, JSONObject> leads = leadsById(a);
        List<JSONObject> open = openTasks(a);
        long dayEnd = java.time.LocalDate.now().plusDays(1).atStartOfDay(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli();
        int due = 0; for (JSONObject t : open) if (Ui.ms(t.optString("due")) < dayEnd) due++;

        // today's numbers
        LinearLayout stats = a.horizontal();
        stat(a, stats, today == null ? "–" : String.valueOf(today.optInt("calls")), "Calls made", MainActivity.INK);
        stat(a, stats, today == null ? "–" : String.valueOf(today.optInt("answered")), "Answered", MainActivity.INK);
        stat(a, stats, String.valueOf(due), "Follow-ups due", due > 0 ? MainActivity.RED : MainActivity.INK);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(-1, -2); sp.setMargins(0, a.dp(4), 0, a.dp(14));
        a.content.addView(stats, sp);

        // follow-ups first: every open one, soonest first, each with its own call button
        followups(a, open, leads);

        // then the next call: the CRM's pick (late follow-up, uncalled new lead, follow-up due today), else the earliest follow-up here
        JSONObject next = d.optJSONObject("next");
        String reason = next == null ? "" : next.optString("reason");
        if (next != null && next.optString("name").trim().isEmpty() && next.optString("phone").trim().isEmpty()) {
            // the pick came without a name or number; use the lead saved here, or leave the card out rather than show "?"
            JSONObject l = leads.get(next.optString("id"));
            next = l != null && !(l.optString("name").trim().isEmpty() && l.optString("phone").trim().isEmpty()) ? l : null;
        }
        if (next == null && !open.isEmpty()) {
            JSONObject t = open.get(0), l = leads.get(t.optString("leadId"));
            if (l != null) { next = l; reason = Ui.ms(t.optString("due")) < System.currentTimeMillis() ? "Follow-up is late" : "Follow-up " + Ui.dayLabel(Ui.ms(t.optString("due"))).toLowerCase(Locale.ROOT) + " at " + Ui.clock(Ui.ms(t.optString("due"))); }
        }
        if (next != null) {
            LinearLayout.LayoutParams gap = new LinearLayout.LayoutParams(-1, a.dp(14)); a.content.addView(new android.view.View(a), gap);
            nextCard(a, next, reason, leads.get(next.optString("id")));
        } else if (open.isEmpty()) {
            LinearLayout calm = a.column(); calm.setPadding(a.dp(18), a.dp(18), a.dp(18), a.dp(18)); calm.setBackground(a.surface(MainActivity.SOFT, 20));
            calm.addView(Ui.text(a, "You are all caught up", 18, true, MainActivity.INK));
            TextView s = Ui.text(a, "No late follow-ups and no uncalled leads. New enquiries will show here.", 14, false, MainActivity.MUTED); s.setPadding(0, a.dp(4), 0, 0); calm.addView(s);
            a.content.addView(calm, new LinearLayout.LayoutParams(-1, -2));
        }

        a.progress(d);
    }

    /** The open follow-ups (late ones in red), up to five, with "See all" opening the To-do list. */
    private static void followups(MainActivity a, List<JSONObject> open, Map<String, JSONObject> leads) {
        List<JSONObject> shown = new ArrayList<>();
        for (JSONObject t : open) if (leads.containsKey(t.optString("leadId"))) shown.add(t);
        if (shown.isEmpty()) return;
        TextView all = Ui.heading(a, a.content, "Follow-ups", shown.size() > 5 ? "See all " + shown.size() : "", MainActivity.MUTED);
        if (shown.size() > 5) { all.setTextColor(MainActivity.ACCENT); all.setFocusable(true); all.setOnClickListener(v -> { a.screen = "To-do"; TodoView.tab = "followups"; a.render(); }); }
        LinearLayout g = Ui.group(a, a.content);
        for (int i = 0; i < Math.min(5, shown.size()); i++) {
            JSONObject t = shown.get(i), l = leads.get(t.optString("leadId"));
            if (i > 0) Ui.hairline(a, g, 70);
            long when = Ui.ms(t.optString("due")); boolean late = when > 0 && when < System.currentTimeMillis();
            String time = when == 0 ? "No date" : late ? "Late since " + (Ui.dayLabel(when).equals("Today") ? Ui.clock(when) : Ui.dayLabel(when).toLowerCase(Locale.ROOT)) : Ui.dayLabel(when).equals("Today") ? "Today " + Ui.clock(when) : Ui.dayLabel(when) + " " + Ui.clock(when);
            String title = t.optString("title").trim(), name = l.optString("name").trim().isEmpty() ? l.optString("phone") : l.optString("name");
            LinearLayout row = Ui.row(a, g, Ui.avatar(a, name, true, 40), name, title.isEmpty() ? time : time + " · " + title, MainActivity.INK, late ? MainActivity.RED : MainActivity.MUTED);
            row.addView(Ui.callButton(a, l.optString("phone"), name));
            row.setFocusable(true); row.setOnClickListener(v -> LeadScreen.open(a, l.optString("id"), l));
        }
    }

    private static void stat(MainActivity a, LinearLayout row, String value, String label, int color) {
        LinearLayout tile = a.column(); tile.setPadding(a.dp(12), a.dp(10), a.dp(10), a.dp(10));
        android.graphics.drawable.GradientDrawable bg = a.surface(MainActivity.CARD, 14); bg.setStroke(a.dp(1), MainActivity.LINE); tile.setBackground(bg);
        TextView v = Ui.text(a, value, 24, true, color); v.setTypeface(Typeface.DEFAULT_BOLD); v.setFontFeatureSettings("tnum"); tile.addView(v);
        tile.addView(Ui.text(a, label, 12, false, MainActivity.MUTED));
        tile.setContentDescription(label + ", " + value);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, -2, 1); p.setMarginEnd(row.getChildCount() < 2 ? a.dp(8) : 0);
        row.addView(tile, p);
    }

    private static void nextCard(MainActivity a, JSONObject next, String reason, JSONObject lead) {
        String name = next.optString("name"), phone = next.optString("phone");
        LinearLayout card = a.column(); card.setPadding(a.dp(18), a.dp(16), a.dp(18), a.dp(18)); card.setBackground(a.surface(MainActivity.DARK ? 0xff2a49c2 : MainActivity.ACCENT, 20));
        int soft = 0xffd3defa;
        LinearLayout top = a.horizontal();
        TextView label = Ui.text(a, "Next call", 13, true, soft); top.addView(label, new LinearLayout.LayoutParams(0, -2, 1));
        boolean late = reason.toLowerCase(Locale.ROOT).contains("late");
        TextView why = Ui.text(a, reason, 12, late, late ? 0xffffc9c4 : soft); top.addView(why);
        card.addView(top);

        LinearLayout who = a.horizontal(); who.setPadding(0, a.dp(12), 0, a.dp(12));
        TextView av = Ui.avatar(a, name, true, 52);
        android.graphics.drawable.GradientDrawable white = new android.graphics.drawable.GradientDrawable(); white.setShape(android.graphics.drawable.GradientDrawable.OVAL); white.setColor(MainActivity.CARD);
        av.setBackground(white); av.setTextColor(MainActivity.ACCENT); who.addView(av);
        LinearLayout names = a.column(); names.setPadding(a.dp(12), 0, 0, 0);
        TextView n = Ui.text(a, name, 20, true, Color.WHITE); n.setTypeface(Typeface.DEFAULT_BOLD); names.addView(n);
        String place = a.joined(next.optString("company"), a.joined(next.optString("city"), lead == null ? "" : Ui.stageLabel(lead)));
        if (!place.isEmpty()) names.addView(Ui.text(a, place, 13, false, soft));
        who.addView(names, new LinearLayout.LayoutParams(0, -2, 1));
        card.addView(who);

        // what was said last, so the call starts where the last one ended
        JSONObject said = lastSaid(a, next.optString("id"));
        if (said != null) {
            LinearLayout box = a.column(); box.setPadding(a.dp(12), a.dp(10), a.dp(12), a.dp(10)); box.setBackground(a.surface(0x1fffffff, 12));
            box.addView(Ui.text(a, "Last said, " + Ui.dayLabel(a.activityTime(said)), 12, false, soft));
            TextView s = Ui.text(a, said.optString("text").replaceAll("(?i)<br\\s*/?>", " ").trim(), 14, false, Color.WHITE); s.setMaxLines(3); s.setEllipsize(android.text.TextUtils.TruncateAt.END); s.setPadding(0, a.dp(3), 0, 0); s.setLineSpacing(0, 1.15f);
            box.addView(s);
            LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-1, -2); bp.setMargins(0, 0, 0, a.dp(14)); card.addView(box, bp);
        }

        LinearLayout actions = a.horizontal();
        TextView call = Ui.pill(a, "Call now", true, Ui.CALL, () -> Ui.dial(a, phone)); call.setTextSize(16); call.setMinHeight(a.dp(50));
        call.setCompoundDrawablesRelativeWithIntrinsicBounds(tinted(a, R.drawable.ic_phone, Color.WHITE), null, null, null); call.setCompoundDrawablePadding(a.dp(8));
        actions.addView(call, new LinearLayout.LayoutParams(0, a.dp(50), 1));
        TextView open = Ui.pill(a, "Open lead", false, Color.WHITE, () -> LeadScreen.open(a, next.optString("id"), lead));
        android.graphics.drawable.GradientDrawable ob = a.surface(Color.TRANSPARENT, 25); ob.setStroke(a.dp(1), 0x66ffffff); open.setBackground(ob); open.setTextColor(Color.WHITE);
        LinearLayout.LayoutParams op = new LinearLayout.LayoutParams(-2, a.dp(50)); op.setMarginStart(a.dp(8)); actions.addView(open, op);
        card.addView(actions);
        a.content.addView(card, new LinearLayout.LayoutParams(-1, -2));
    }

    static android.graphics.drawable.Drawable tinted(MainActivity a, int res, int color) {
        android.graphics.drawable.Drawable dr = a.getDrawable(res).mutate(); dr.setTint(color);
        int s = a.dp(18); dr.setBounds(0, 0, s, s); return dr;
    }

    // the newest note or call summary with words in it (phone-sync lines say nothing)
    static JSONObject lastSaid(MainActivity a, String leadId) {
        if (leadId.isEmpty()) return null;
        for (JSONObject x : a.leadActivities(leadId)) {
            String t = x.optString("text").trim();
            if (!t.isEmpty() && !t.startsWith("Phone sync") && !t.startsWith("ACTION_") && !t.startsWith("Lead ") && !"System".equals(x.optString("type"))) return x;
        }
        return null;
    }

    static Map<String, JSONObject> leadsById(MainActivity a) {
        return a.index().byId; // built once per workspace
    }

    /** Open follow-ups, soonest first; the ones with no date go last. */
    static List<JSONObject> openTasks(MainActivity a) {
        List<JSONObject> list = new ArrayList<>();
        JSONArray t = a.rows("tasks");
        for (int i = 0; i < t.length(); i++) { JSONObject x = t.optJSONObject(i); if (x != null && !"Done".equals(x.optString("status")) && !"Cancelled".equals(x.optString("status"))) list.add(x); }
        list.sort((x, y) -> { long p = Ui.ms(x.optString("due")), q = Ui.ms(y.optString("due")); return Long.compare(p == 0 ? Long.MAX_VALUE : p, q == 0 ? Long.MAX_VALUE : q); });
        return list;
    }
}
