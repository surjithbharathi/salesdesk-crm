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
 * Leads: a search box that filters as you type, the view picker (the same views as the web: All Active, New Lead, Assigned
 * Today, Never Picked, Need Discussion, Interested, Is Customer, Follow-up Due, Unassigned, every pipeline stage and a few
 * other lists, each with its count), then one white list where every lead shows its initials, company and place (or a late
 * follow-up in red), its stage and a call button. "New lead" floats at the bottom.
 */
final class LeadsView {
    static String view = "active", sort = "active";
    private static int limit = 100;
    private static final String[][] SORTS = {{"active", "Recently active"}, {"newest", "Newest first"}, {"oldest", "Oldest first"}, {"name", "Name A–Z"}};
    private static final int PAGE = 100;

    // the same views and rules as the web's lead views (web/src/cwt/Views.jsx)
    private static final String[][] WORK = {{"active", "All Active"}, {"fresh", "New Lead"}, {"today", "Assigned Today"}, {"neverPicked", "Never Picked"}, {"discussion", "Need Discussion"}, {"interested", "Interested"}, {"customer", "Is Customer"}, {"due", "Follow-up Due"}, {"unassigned", "Unassigned"}};
    private static final String[] PIPELINE = {"Interested Customer", "Requirement Discussion", "Quotation Shared", "Loan Document Collected", "Loan in Process", "Advance Received", "Machine Dispatched", "Machine Delivered - Need to Start", "Won", "Later Purchase", "Lost"};
    private static final String[][] OTHER = {{"all", "All Leads"}, {"mine", "My Leads"}, {"untouched", "Not called yet"}};
    private static final List<String> CUSTOMER = Arrays.asList("Advance Received", "Machine Dispatched", "Machine Delivered - Need to Start", "Won");

    private LeadsView() {}

    /** The pipeline step a lead is at, as the web shows it. */
    static String statusOf(JSONObject l) {
        String stage = l.optString("stage", "New");
        if (stage.isEmpty() || stage.equals("New")) return "New";
        String deal = l.optString("deal");
        if (Arrays.asList(PIPELINE).contains(deal)) return deal;
        if (stage.equals("Closed")) return "Won".equals(l.optString("disposition")) ? "Won" : "Lost".equals(l.optString("disposition")) ? "Lost" : "New";
        switch (stage) { case "Prospecting": return "Requirement Discussion"; case "Opportunity": return "Interested Customer"; case "Quotation given": return "Quotation Shared"; default: return "New"; }
    }

    /** What the views need about each lead: calls made and answered, assigned today, and the next follow-up. */
    private static final class Facts {
        final Map<String, int[]> calls = new HashMap<>();
        final Set<String> assignedToday = new HashSet<>();
        final Map<String, Long> nextDue = new HashMap<>();
        final String me; final long endOfDay;
        Facts(MainActivity a) {
            me = SecureConfig.prefs(a).getString("userId", "");
            java.time.ZoneId z = java.time.ZoneId.systemDefault();
            java.time.LocalDate today = java.time.LocalDate.now(z);
            endOfDay = today.plusDays(1).atStartOfDay(z).toInstant().toEpochMilli() - 1;
            JSONArray acts = a.rows("activities");
            for (int i = 0; i < acts.length(); i++) {
                JSONObject x = acts.optJSONObject(i); if (x == null) continue;
                String id = x.optString("leadId");
                if ("Call".equals(x.optString("type"))) { int[] c = calls.computeIfAbsent(id, k -> new int[2]); c[0]++; if (x.optLong("duration", 0) > 0) c[1]++; }
                else if ("System".equals(x.optString("type")) && x.optString("text").toLowerCase(Locale.ROOT).contains("assign") && sameDay(a.activityTime(x), today, z)) assignedToday.add(id);
            }
            JSONArray leads = a.rows("leads");
            for (int i = 0; i < leads.length(); i++) { JSONObject l = leads.optJSONObject(i); if (l != null && !l.optString("owner").isEmpty() && sameDay(Ui.ms(l.optString("createdAt")), today, z)) assignedToday.add(l.optString("id")); }
            for (JSONObject t : MyDayView.openTasks(a)) { long d = Ui.ms(t.optString("due")); if (d > 0) nextDue.merge(t.optString("leadId"), d, Math::min); }
        }
        private static boolean sameDay(long t, java.time.LocalDate d, java.time.ZoneId z) { return t > 0 && java.time.Instant.ofEpochMilli(t).atZone(z).toLocalDate().equals(d); }
    }

    private interface Test { boolean ok(JSONObject l); }

    private static Test testOf(String id, Facts f) {
        if (id.startsWith("st:")) { String s = id.substring(3); return l -> statusOf(l).equals(s); }
        Test active = l -> !"Closed".equals(l.optString("stage"));
        switch (id) {
            case "all": return l -> true;
            case "mine": return l -> l.optString("owner").equals(f.me);
            case "fresh": return l -> "New".equals(l.optString("stage", "New")) || l.optString("stage").isEmpty();
            case "today": return l -> active.ok(l) && f.assignedToday.contains(l.optString("id"));
            case "neverPicked": return l -> { int[] c = f.calls.get(l.optString("id")); return active.ok(l) && c != null && c[0] > 0 && c[1] == 0; };
            case "discussion": return l -> "Prospecting".equals(l.optString("stage"));
            case "interested": return l -> "Opportunity".equals(l.optString("stage"));
            case "customer": return l -> l.optBoolean("repeat") || CUSTOMER.contains(statusOf(l));
            case "due": return l -> { Long d = f.nextDue.get(l.optString("id")); return active.ok(l) && d != null && d <= f.endOfDay; };
            case "unassigned": return l -> active.ok(l) && l.optString("owner").isEmpty();
            case "untouched": return l -> active.ok(l) && l.optString("firstTouchAt").isEmpty() && !f.calls.containsKey(l.optString("id"));
            default: return active;
        }
    }

    private static String labelOf(String id) {
        if (id.startsWith("st:")) return id.substring(3);
        for (String[] v : WORK) if (v[0].equals(id)) return v[1];
        for (String[] v : OTHER) if (v[0].equals(id)) return v[1];
        return "All Active";
    }

    private static String num(int n) { return java.text.NumberFormat.getIntegerInstance(new Locale("en", "IN")).format(n); }

    /** The view picker: a sheet with the work views, then every stage, then the other lists, each with its count. */
    private static void pickView(MainActivity a, JSONArray all, Facts f) {
        Sheet s = new Sheet(a, "Lead views", "Tap one to see its leads");
        List<String> ids = new ArrayList<>();
        for (String[] v : WORK) ids.add(v[0]);
        ids.add("st:New"); for (String p : PIPELINE) ids.add("st:" + p);
        for (String[] v : OTHER) ids.add(v[0]);
        Map<String, Test> tests = new LinkedHashMap<>(); for (String id : ids) tests.put(id, testOf(id, f));
        Map<String, Integer> counts = new HashMap<>();
        for (int i = 0; i < all.length(); i++) { JSONObject l = all.optJSONObject(i); if (l == null) continue; for (Map.Entry<String, Test> e : tests.entrySet()) if (e.getValue().ok(l)) counts.merge(e.getKey(), 1, Integer::sum); }
        LinearLayout g = null; String group = "";
        for (String id : ids) {
            String now = id.startsWith("st:") ? "By stage" : Arrays.stream(OTHER).anyMatch(v -> v[0].equals(id)) ? "Other lists" : "";
            if (g == null || !now.equals(group)) {
                group = now;
                if (!now.isEmpty()) s.label(now);
                g = Ui.group(a, s.body);
            } else Ui.hairline(a, g, 16);
            boolean on = id.equals(view);
            LinearLayout row = a.horizontal(); row.setPadding(a.dp(16), 0, a.dp(14), 0); row.setMinimumHeight(a.dp(48));
            if (on) row.setBackgroundColor(MainActivity.SOFT);
            TextView t = Ui.text(a, labelOf(id), 15, on, on ? MainActivity.ACCENT : MainActivity.INK); row.addView(t, new LinearLayout.LayoutParams(0, -2, 1));
            TextView c = Ui.text(a, num(counts.getOrDefault(id, 0)), 12, true, MainActivity.MUTED); c.setPadding(a.dp(8), a.dp(2), a.dp(8), a.dp(2)); c.setBackground(a.surface(on ? Color.WHITE : MainActivity.NEUTRAL, 10)); row.addView(c);
            row.setFocusable(true); row.setSelected(on); row.setContentDescription(labelOf(id) + ", " + counts.getOrDefault(id, 0) + " leads");
            row.setOnClickListener(v -> { view = id; limit = PAGE; s.close(); a.render(); });
            g.addView(row);
        }
        s.buttons(null, null, "Close", s::close);
        s.show();
    }

    static void draw(MainActivity a) {
        JSONArray all = a.rows("leads");
        Facts facts = new Facts(a);
        Test test = testOf(view, facts);
        int inView = 0; for (int i = 0; i < all.length(); i++) { JSONObject l = all.optJSONObject(i); if (l != null && test.ok(l)) inView++; }

        // search, filtering as you type
        LinearLayout box = a.horizontal(); box.setPadding(a.dp(14), 0, a.dp(8), 0);
        GradientDrawable bg = a.surface(Color.WHITE, 24); bg.setStroke(a.dp(1), MainActivity.LINE); box.setBackground(bg);
        ImageView glass = a.glyph(R.drawable.ic_search, MainActivity.MUTED); box.addView(glass, new LinearLayout.LayoutParams(a.dp(20), a.dp(20)));
        EditText q = new EditText(a); q.setHint("Name, number, company or city"); q.setText(a.search); q.setSingleLine(); q.setTextSize(15); q.setTextColor(MainActivity.INK); q.setHintTextColor(MainActivity.MUTED);
        q.setBackground(null); q.setPadding(a.dp(10), 0, a.dp(4), 0); q.setContentDescription("Search leads"); q.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH);
        box.addView(q, new LinearLayout.LayoutParams(0, a.dp(48), 1));
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-1, a.dp(50)); bp.setMargins(0, a.dp(4), 0, a.dp(10)); a.content.addView(box, bp);

        // the view picker, like the web's: the view's name and its count, tap to change
        LinearLayout picker = a.horizontal(); picker.setPadding(a.dp(16), 0, a.dp(12), 0);
        GradientDrawable pb = a.surface(Color.WHITE, 14); pb.setStroke(a.dp(2), MainActivity.ACCENT); picker.setBackground(pb);
        TextView name = Ui.text(a, labelOf(view), 16, true, MainActivity.INK); name.setTypeface(android.graphics.Typeface.DEFAULT_BOLD); picker.addView(name);
        TextView n = Ui.text(a, num(inView), 12, true, MainActivity.MUTED); n.setPadding(a.dp(8), a.dp(2), a.dp(8), a.dp(2)); n.setBackground(a.surface(MainActivity.NEUTRAL, 10));
        LinearLayout.LayoutParams np = new LinearLayout.LayoutParams(-2, -2); np.setMarginStart(a.dp(10)); picker.addView(n, np);
        picker.addView(new View(a), new LinearLayout.LayoutParams(0, 1, 1));
        picker.addView(Ui.text(a, "▾", 16, false, MainActivity.MUTED));
        picker.setFocusable(true); picker.setContentDescription("Lead view " + labelOf(view) + ", " + inView + " leads. Change view");
        picker.setOnClickListener(v -> pickView(a, all, facts));
        a.content.addView(picker, new LinearLayout.LayoutParams(-1, a.dp(50)));

        // how many match, and the order
        LinearLayout meta = a.horizontal(); meta.setPadding(a.dp(4), a.dp(2), 0, a.dp(6));
        TextView count = Ui.text(a, "", 13, false, MainActivity.MUTED); meta.addView(count, new LinearLayout.LayoutParams(0, -2, 1));
        TextView order = Ui.text(a, "Sort: " + sortLabel() + "  ▾", 13, true, MainActivity.ACCENT); order.setPadding(a.dp(8), a.dp(10), a.dp(4), a.dp(10));
        order.setFocusable(true); order.setContentDescription("Sort leads, now " + sortLabel());
        order.setOnClickListener(v -> {
            PopupMenu m = new PopupMenu(a, order);
            for (int i = 0; i < SORTS.length; i++) m.getMenu().add(0, i, i, (SORTS[i][0].equals(sort) ? "✓  " : "     ") + SORTS[i][1]);
            m.setOnMenuItemClickListener(item -> { sort = SORTS[item.getItemId()][0]; limit = PAGE; a.render(); return true; });
            m.show();
        });
        meta.addView(order);
        a.content.addView(meta);

        LinearLayout list = a.column();
        a.content.addView(list, new LinearLayout.LayoutParams(-1, -2));
        a.content.setPadding(a.content.getPaddingLeft(), a.content.getPaddingTop(), a.content.getPaddingRight(), a.dp(96));
        Runnable fill = () -> count.setText(fill(a, list, all, test));
        fill.run();
        q.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int st, int c, int af) {}
            public void onTextChanged(CharSequence s, int st, int b, int c) {}
            public void afterTextChanged(Editable e) { a.search = e.toString().trim(); limit = PAGE; fill.run(); }
        });

        // the floating "New lead" button
        TextView fab = Ui.pill(a, "New lead", true, MainActivity.ACCENT, a::leadForm);
        fab.setCompoundDrawablesRelativeWithIntrinsicBounds(MyDayView.tinted(a, R.drawable.ic_plus, Color.WHITE), null, null, null); fab.setCompoundDrawablePadding(a.dp(8));
        fab.setPadding(a.dp(18), 0, a.dp(22), 0); fab.setTextSize(15); fab.setElevation(a.dp(6)); fab.setBackground(a.surface(MainActivity.ACCENT, 18));
        FrameLayout.LayoutParams fp = new FrameLayout.LayoutParams(-2, a.dp(56), Gravity.BOTTOM | Gravity.END); fp.setMargins(0, 0, a.dp(16), a.dp(16));
        a.overlay.addView(fab, fp);
    }

    private static String sortLabel() { for (String[] s : SORTS) if (s[0].equals(sort)) return s[1]; return SORTS[0][1]; }

    // when the lead was last worked on: its newest call, note or change, else when it came in
    private static Map<String, Long> lastActive(MainActivity a) {
        Map<String, Long> m = new HashMap<>();
        JSONArray acts = a.rows("activities");
        for (int i = 0; i < acts.length(); i++) { JSONObject x = acts.optJSONObject(i); if (x != null) m.merge(x.optString("leadId"), a.activityTime(x), Math::max); }
        JSONArray calls = a.rows("mobileCalls");
        for (int i = 0; i < calls.length(); i++) { JSONObject c = calls.optJSONObject(i); if (c == null) continue; long t = c.optLong("startedAt", 0); if (t == 0) t = Ui.ms(c.optString("startedAt")); m.merge(c.optString("leadId"), t, Math::max); }
        return m;
    }

    /** Fills the list and returns the count line. */
    private static String fill(MainActivity a, LinearLayout list, JSONArray all, Test test) {
        list.removeAllViews();
        String q = a.search.toLowerCase(Locale.ROOT), digits = a.search.replaceAll("[^0-9]", "");
        Map<String, Long> late = lateByLead(a);
        List<JSONObject> shown = new ArrayList<>();
        for (int i = 0; i < all.length(); i++) {
            JSONObject l = all.optJSONObject(i); if (l == null) continue;
            if (!test.ok(l)) continue;
            if (!q.isEmpty()) {
                String hay = (l.optString("name") + " " + l.optString("company") + " " + l.optString("city") + " " + l.optString("state")).toLowerCase(Locale.ROOT);
                boolean num = digits.length() >= 3 && l.optString("phone").replaceAll("[^0-9]", "").contains(digits);
                if (!hay.contains(q) && !num) continue;
            }
            shown.add(l);
        }
        // late follow-ups first, then the chosen order
        Map<String, Long> active = sort.equals("active") ? a.lastActive() : Collections.emptyMap();
        shown.sort((x, y) -> {
            boolean lx = late.containsKey(x.optString("id")), ly = late.containsKey(y.optString("id"));
            if (lx != ly) return lx ? -1 : 1;
            long cx = Ui.ms(x.optString("createdAt")), cy = Ui.ms(y.optString("createdAt"));
            switch (sort) {
                case "newest": return Long.compare(cy, cx);
                case "oldest": return Long.compare(cx, cy);
                case "name": return x.optString("name").compareToIgnoreCase(y.optString("name"));
                default: return Long.compare(active.getOrDefault(y.optString("id"), cy), active.getOrDefault(x.optString("id"), cx));
            }
        });
        if (shown.isEmpty()) {
            TextView t = Ui.text(a, q.isEmpty() ? "No leads here yet." : "No lead matches \"" + a.search + "\". Try a name, number or city.", 14, false, MainActivity.MUTED);
            t.setPadding(a.dp(4), a.dp(20), a.dp(4), 0); list.addView(t); return "0 leads";
        }
        LinearLayout g = Ui.group(a, list);
        for (int i = 0; i < Math.min(limit, shown.size()); i++) {
            JSONObject l = shown.get(i);
            if (i > 0) Ui.hairline(a, g, 72);
            Long lateAt = late.get(l.optString("id"));
            String sub = lateAt != null ? "Follow-up late since " + (Ui.dayLabel(lateAt).equals("Today") ? Ui.clock(lateAt) : Ui.dayLabel(lateAt).toLowerCase(Locale.ROOT))
                : a.joined(l.optString("company"), a.joined(l.optString("city"), a.isToday(l.optString("createdAt")) ? a.joined(l.optString("source"), Ui.ago(Ui.ms(l.optString("createdAt")))) : ""));
            if (sub.isEmpty()) sub = MainActivity.prettyNumber(l.optString("phone"));
            LinearLayout row = Ui.row(a, g, Ui.avatar(a, l.optString("name"), true, 44), l.optString("name"), sub, MainActivity.INK, lateAt != null ? MainActivity.RED : MainActivity.MUTED);
            LinearLayout middle = (LinearLayout) row.getChildAt(1);
            String status = statusOf(l); int[] sc = Ui.stageColours(status);
            TextView chip = Ui.chip(a, status, sc[0], sc[1]); LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(-2, -2); cp.setMargins(0, a.dp(5), 0, 0); middle.addView(chip, cp);
            row.addView(Ui.callButton(a, l.optString("phone"), l.optString("name")));
            row.setFocusable(true); row.setContentDescription("Open lead " + l.optString("name"));
            row.setOnClickListener(v -> LeadScreen.open(a, l.optString("id"), l));
        }
        int left = shown.size() - limit;
        if (left > 0) {
            TextView more = Ui.pill(a, "Show " + Math.min(PAGE, left) + " more  ·  " + left + " left", false, MainActivity.ACCENT, () -> { limit += PAGE; a.render(); });
            LinearLayout.LayoutParams mp = new LinearLayout.LayoutParams(-1, a.dp(48)); mp.setMargins(0, a.dp(4), 0, 0); list.addView(more, mp);
        }
        return shown.size() + (shown.size() == 1 ? " lead" : " leads") + (left > 0 ? " · showing " + limit : "");
    }

    // each lead's oldest late follow-up
    private static Map<String, Long> lateByLead(MainActivity a) {
        Map<String, Long> m = new HashMap<>();
        long now = System.currentTimeMillis();
        for (JSONObject t : MyDayView.openTasks(a)) { long d = Ui.ms(t.optString("due")); if (d > 0 && d < now) m.merge(t.optString("leadId"), d, Math::min); }
        return m;
    }
}
