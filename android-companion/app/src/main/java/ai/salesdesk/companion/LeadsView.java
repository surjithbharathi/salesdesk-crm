package ai.salesdesk.companion;

import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.widget.*;
import java.util.*;
import org.json.*;

/**
 * Leads: a search box that filters as you type, stage chips with their counts, then one white list where every lead shows
 * its initials, company and place (or a late follow-up in red), its stage and a call button. "New lead" floats at the bottom.
 */
final class LeadsView {
    static String stage = "All";
    private static final String[][] STAGES = {{"All", "All"}, {"New", "New"}, {"Prospecting", "Discussion"}, {"Opportunity", "Interested"}, {"Quotation given", "Quotation"}, {"Closed", "Closed"}};
    private static final int LIMIT = 150;

    private LeadsView() {}

    static void draw(MainActivity a) {
        JSONArray all = a.rows("leads");
        Map<String, Integer> counts = new HashMap<>();
        for (int i = 0; i < all.length(); i++) { JSONObject l = all.optJSONObject(i); if (l != null) counts.merge(key(l), 1, Integer::sum); }

        // search, filtering as you type
        LinearLayout box = a.horizontal(); box.setPadding(a.dp(14), 0, a.dp(8), 0);
        GradientDrawable bg = a.surface(Color.WHITE, 24); bg.setStroke(a.dp(1), MainActivity.LINE); box.setBackground(bg);
        ImageView glass = a.glyph(R.drawable.ic_search, MainActivity.MUTED); box.addView(glass, new LinearLayout.LayoutParams(a.dp(20), a.dp(20)));
        EditText q = new EditText(a); q.setHint("Name, number, company or city"); q.setText(a.search); q.setSingleLine(); q.setTextSize(15); q.setTextColor(MainActivity.INK); q.setHintTextColor(MainActivity.MUTED);
        q.setBackground(null); q.setPadding(a.dp(10), 0, a.dp(4), 0); q.setContentDescription("Search leads"); q.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH);
        box.addView(q, new LinearLayout.LayoutParams(0, a.dp(48), 1));
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-1, a.dp(50)); bp.setMargins(0, a.dp(4), 0, a.dp(10)); a.content.addView(box, bp);

        // stage chips with counts
        LinearLayout chips = Ui.chipRow(a, a.content);
        for (String[] s : STAGES) {
            int n = s[0].equals("All") ? all.length() : counts.getOrDefault(s[0], 0);
            if (n == 0 && !s[0].equals("All") && !s[0].equals(stage)) continue;
            chips.addView(Ui.choice(a, s[0].equals("All") ? "All " + n : s[1] + " " + n, stage.equals(s[0]), () -> { stage = s[0]; a.render(); }));
        }
        chips.addView(Ui.choice(a, "New today " + a.todayLeads(), a.leadsToday, () -> { a.leadsToday = !a.leadsToday; a.render(); }));

        LinearLayout list = a.column();
        a.content.addView(list, new LinearLayout.LayoutParams(-1, -2));
        a.content.setPadding(a.content.getPaddingLeft(), a.content.getPaddingTop(), a.content.getPaddingRight(), a.dp(96));
        Runnable fill = () -> fill(a, list, all);
        fill.run();
        q.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int st, int c, int af) {}
            public void onTextChanged(CharSequence s, int st, int b, int c) {}
            public void afterTextChanged(Editable e) { a.search = e.toString().trim(); fill.run(); }
        });

        // the floating "New lead" button
        TextView fab = Ui.pill(a, "New lead", true, MainActivity.ACCENT, a::leadForm);
        fab.setCompoundDrawablesRelativeWithIntrinsicBounds(MyDayView.tinted(a, R.drawable.ic_plus, Color.WHITE), null, null, null); fab.setCompoundDrawablePadding(a.dp(8));
        fab.setPadding(a.dp(18), 0, a.dp(22), 0); fab.setTextSize(15); fab.setElevation(a.dp(6)); fab.setBackground(a.surface(MainActivity.ACCENT, 18));
        FrameLayout.LayoutParams fp = new FrameLayout.LayoutParams(-2, a.dp(56), Gravity.BOTTOM | Gravity.END); fp.setMargins(0, 0, a.dp(16), a.dp(16));
        a.overlay.addView(fab, fp);
    }

    private static String key(JSONObject l) {
        if (!l.optString("deal").isEmpty() && l.optString("deal").toLowerCase(Locale.ROOT).contains("quot")) return "Quotation given";
        String s = l.optString("stage", "New"); return s.isEmpty() ? "New" : s;
    }

    private static void fill(MainActivity a, LinearLayout list, JSONArray all) {
        list.removeAllViews();
        String q = a.search.toLowerCase(Locale.ROOT), digits = a.search.replaceAll("[^0-9]", "");
        Map<String, Long> late = lateByLead(a);
        List<JSONObject> shown = new ArrayList<>();
        for (int i = 0; i < all.length(); i++) {
            JSONObject l = all.optJSONObject(i); if (l == null) continue;
            if (!stage.equals("All") && !key(l).equals(stage)) continue;
            if (a.leadsToday && !a.isToday(l.optString("createdAt"))) continue;
            if (!q.isEmpty()) {
                String hay = (l.optString("name") + " " + l.optString("company") + " " + l.optString("city") + " " + l.optString("state")).toLowerCase(Locale.ROOT);
                boolean num = digits.length() >= 3 && l.optString("phone").replaceAll("[^0-9]", "").contains(digits);
                if (!hay.contains(q) && !num) continue;
            }
            shown.add(l);
        }
        // late follow-ups first, then the most recently touched
        shown.sort((x, y) -> {
            boolean lx = late.containsKey(x.optString("id")), ly = late.containsKey(y.optString("id"));
            if (lx != ly) return lx ? -1 : 1;
            return Long.compare(Ui.ms(y.optString("updatedAt", y.optString("createdAt"))), Ui.ms(x.optString("updatedAt", x.optString("createdAt"))));
        });
        if (shown.isEmpty()) {
            TextView t = Ui.text(a, q.isEmpty() ? "No leads here yet." : "No lead matches \"" + a.search + "\". Try a name, number or city.", 14, false, MainActivity.MUTED);
            t.setPadding(a.dp(4), a.dp(20), a.dp(4), 0); list.addView(t); return;
        }
        LinearLayout g = Ui.group(a, list);
        for (int i = 0; i < Math.min(LIMIT, shown.size()); i++) {
            JSONObject l = shown.get(i);
            if (i > 0) Ui.hairline(a, g, 72);
            Long lateAt = late.get(l.optString("id"));
            String sub = lateAt != null ? "Follow-up late since " + (Ui.dayLabel(lateAt).equals("Today") ? Ui.clock(lateAt) : Ui.dayLabel(lateAt).toLowerCase(Locale.ROOT))
                : a.joined(l.optString("company"), a.joined(l.optString("city"), a.isToday(l.optString("createdAt")) ? a.joined(l.optString("source"), Ui.ago(Ui.ms(l.optString("createdAt")))) : ""));
            if (sub.isEmpty()) sub = MainActivity.prettyNumber(l.optString("phone"));
            LinearLayout row = Ui.row(a, g, Ui.avatar(a, l.optString("name"), true, 44), l.optString("name"), sub, MainActivity.INK, lateAt != null ? MainActivity.RED : MainActivity.MUTED);
            LinearLayout middle = (LinearLayout) row.getChildAt(1);
            TextView chip = Ui.stageChip(a, l); LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(-2, -2); cp.setMargins(0, a.dp(5), 0, 0); middle.addView(chip, cp);
            row.addView(Ui.callButton(a, l.optString("phone"), l.optString("name")));
            row.setFocusable(true); row.setContentDescription("Open lead " + l.optString("name"));
            row.setOnClickListener(v -> LeadScreen.open(a, l.optString("id"), l));
        }
        if (shown.size() > LIMIT) { TextView more = Ui.text(a, "Showing " + LIMIT + " of " + shown.size() + ". Search to find the rest.", 12, false, MainActivity.MUTED); more.setPadding(a.dp(4), a.dp(4), 0, 0); list.addView(more); }
    }

    // each lead's oldest late follow-up
    private static Map<String, Long> lateByLead(MainActivity a) {
        Map<String, Long> m = new HashMap<>();
        long now = System.currentTimeMillis();
        for (JSONObject t : MyDayView.openTasks(a)) { long d = Ui.ms(t.optString("due")); if (d > 0 && d < now) m.merge(t.optString("leadId"), d, Math::min); }
        return m;
    }
}
