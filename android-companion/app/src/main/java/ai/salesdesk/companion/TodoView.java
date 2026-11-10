package ai.salesdesk.companion;

import android.database.Cursor;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.*;
import org.json.*;

/**
 * To-do, in two lists behind one switch.
 * AI to-dos: what Salesdesk spots in the calls and leads on this phone, each with the reason: a missed call nobody returned,
 * a new lead nobody has called, an interested customer or a quotation gone quiet. Accepting one calls or plans a follow-up.
 * Follow-ups: the follow-ups people planned, grouped Late, Today, Tomorrow and Later, with a circle to tick and a call button.
 */
final class TodoView {
    static String tab = "";
    private static final long HOUR = 3600000L, DAY = 24 * HOUR;

    private TodoView() {}

    static void draw(MainActivity a) {
        List<Item> ai = aiTodos(a);
        List<JSONObject> open = MyDayView.openTasks(a);
        long now = System.currentTimeMillis();
        int late = 0; for (JSONObject t : open) { long d = Ui.ms(t.optString("due")); if (d > 0 && d < now) late++; }
        if (tab.isEmpty()) tab = ai.isEmpty() ? "followups" : "ai";

        // the switch between the two lists
        LinearLayout seg = a.horizontal(); seg.setPadding(a.dp(4), a.dp(4), a.dp(4), a.dp(4)); seg.setBackground(a.surface(0xffe9e8ef, 22));
        segment(a, seg, "AI to-dos", ai.size() > 0 ? String.valueOf(ai.size()) : "", false, "ai");
        segment(a, seg, "Follow-ups", late > 0 ? late + " late" : open.isEmpty() ? "" : String.valueOf(open.size()), late > 0, "followups");
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(-1, a.dp(44)); sp.setMargins(0, a.dp(4), 0, a.dp(6)); a.content.addView(seg, sp);

        if (tab.equals("ai")) drawAi(a, ai); else drawFollowUps(a, open);
    }

    private static void segment(MainActivity a, LinearLayout seg, String label, String count, boolean red, String key) {
        boolean on = tab.equals(key);
        LinearLayout cell = a.horizontal(); cell.setGravity(Gravity.CENTER);
        if (on) { cell.setBackground(a.surface(Color.WHITE, 18)); cell.setElevation(a.dp(1)); }
        TextView t = Ui.text(a, label, 14, true, on ? MainActivity.INK : MainActivity.MUTED); cell.addView(t);
        if (!count.isEmpty()) {
            TextView c = Ui.text(a, count, 11, true, red ? MainActivity.RED : Color.WHITE);
            if (!red) { c.setBackground(a.surface(MainActivity.ACCENT, 10)); c.setPadding(a.dp(6), a.dp(1), a.dp(6), a.dp(1)); }
            LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(-2, -2); cp.setMarginStart(a.dp(6)); cell.addView(c, cp);
        }
        cell.setFocusable(true); cell.setSelected(on); cell.setContentDescription(label + (count.isEmpty() ? "" : ", " + count) + (on ? ", selected" : ""));
        cell.setOnClickListener(v -> { tab = key; a.render(); });
        seg.addView(cell, new LinearLayout.LayoutParams(0, -1, 1));
    }

    // ---- AI to-dos ----

    static final class Item {
        String key, why, title, sub, quote, phone, leadId, leadName, action; int whyColor, icon;
    }

    private static void drawAi(MainActivity a, List<Item> items) {
        TextView intro = Ui.text(a, "Picked up from your calls and leads. Act on one, or dismiss it.", 13, false, MainActivity.MUTED); intro.setPadding(a.dp(4), a.dp(6), a.dp(4), a.dp(8)); a.content.addView(intro);
        if (items.isEmpty()) { empty(a, "Nothing to pick up right now", "Missed calls you have not returned, new leads nobody has called and customers gone quiet will show here."); return; }
        for (Item it : items) {
            LinearLayout card = a.column(); card.setPadding(a.dp(14), a.dp(12), a.dp(14), a.dp(10));
            GradientDrawable bg = a.surface(Color.WHITE, 16); bg.setStroke(a.dp(1), MainActivity.LINE); card.setBackground(bg);
            LinearLayout why = a.horizontal();
            ImageView ic = a.glyph(it.icon, it.whyColor); why.addView(ic, new LinearLayout.LayoutParams(a.dp(15), a.dp(15)));
            TextView w = Ui.text(a, it.why, 12, true, it.whyColor); w.setPadding(a.dp(6), 0, 0, 0); why.addView(w);
            card.addView(why);
            TextView title = Ui.text(a, it.title, 16, true, MainActivity.INK); title.setTypeface(android.graphics.Typeface.DEFAULT_BOLD); title.setPadding(0, a.dp(6), 0, 0); card.addView(title);
            if (it.sub != null && !it.sub.isEmpty()) { TextView s = Ui.text(a, it.sub, 13, false, MainActivity.MUTED); s.setPadding(0, a.dp(3), 0, 0); card.addView(s); }
            LinearLayout acts = a.horizontal(); acts.setPadding(0, a.dp(10), 0, 0);
            TextView main;
            if ("call".equals(it.action)) {
                main = Ui.pill(a, it.leadId == null ? "Call back" : "Call now", true, Ui.CALL, () -> Ui.dial(a, it.phone));
                main.setCompoundDrawablesRelativeWithIntrinsicBounds(MyDayView.tinted(a, R.drawable.ic_phone, Color.WHITE), null, null, null); main.setCompoundDrawablePadding(a.dp(6));
            } else main = Ui.pill(a, "Add follow-up", true, MainActivity.ACCENT, () -> FollowUpSheet.open(a, it.leadId, it.leadName, it.title.startsWith("Follow up on") ? "Follow up on the quotation" : "Check in", () -> { dismiss(a, it.key, 30 * DAY); a.render(); }));
            main.setTextSize(13); main.setMinHeight(a.dp(40));
            acts.addView(main, new LinearLayout.LayoutParams(-2, a.dp(40)));
            if (it.leadId == null && it.phone != null) { TextView add = Ui.pill(a, "Add as lead", false, MainActivity.ACCENT, () -> a.leadForm(it.phone)); add.setTextSize(13); LinearLayout.LayoutParams ap = new LinearLayout.LayoutParams(-2, a.dp(40)); ap.setMarginStart(a.dp(8)); acts.addView(add, ap); }
            acts.addView(new View(a), new LinearLayout.LayoutParams(0, 1, 1));
            boolean later = it.key.startsWith("new:");
            TextView ghost = Ui.text(a, later ? "Later" : "Dismiss", 13, true, MainActivity.MUTED); ghost.setGravity(Gravity.CENTER); ghost.setPadding(a.dp(12), 0, a.dp(8), 0); ghost.setMinHeight(a.dp(40));
            ghost.setFocusable(true); ghost.setOnClickListener(v -> { dismiss(a, it.key, later ? 3 * HOUR : 30 * DAY); a.render(); });
            acts.addView(ghost);
            card.addView(acts);
            if (it.leadId != null) { card.setFocusable(true); card.setOnClickListener(v -> LeadScreen.open(a, it.leadId, MyDayView.leadsById(a).get(it.leadId))); }
            LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(-1, -2); cp.setMargins(0, 0, 0, a.dp(10)); a.content.addView(card, cp);
        }
    }

    /** The rules behind AI to-dos. Each item has a stable key, so a dismissed one stays away until something new happens. */
    static List<Item> aiTodos(MainActivity a) {
        List<Item> out = new ArrayList<>();
        long now = System.currentTimeMillis();
        Map<String, JSONObject> leads = MyDayView.leadsById(a);
        String country = SecureConfig.prefs(a).getString("country", "91");

        // 1. missed calls nobody returned: the newest call with a number was a missed or rejected incoming one
        Map<String, JSONObject> latest = new HashMap<>(); Map<String, Integer> missedCount = new HashMap<>();
        for (JSONObject c : calls(a)) {
            String n = SyncEngine.normalize(c.optString("phone"), country); if (n.length() < 6) continue;
            JSONObject before = latest.get(n);
            if (before == null || c.optLong("at") > before.optLong("at")) latest.put(n, c);
        }
        for (JSONObject c : calls(a)) {
            String n = SyncEngine.normalize(c.optString("phone"), country); JSONObject l = latest.get(n);
            if (l != null && missed(c) && c.optLong("at") > lastConnected(a, n, country)) missedCount.merge(n, 1, Integer::sum);
        }
        for (Map.Entry<String, JSONObject> e : latest.entrySet()) {
            JSONObject c = e.getValue();
            if (!missed(c) || now - c.optLong("at") > 3 * DAY) continue;
            Item it = new Item(); it.key = "missed:" + e.getKey() + ":" + c.optLong("at");
            JSONObject lead = leadOf(a, c, leads, country);
            int times = missedCount.getOrDefault(e.getKey(), 1);
            it.icon = R.drawable.ic_phone; it.whyColor = MainActivity.RED; it.action = "call"; it.phone = c.optString("phone");
            it.why = "Missed call not returned · " + (Ui.dayLabel(c.optLong("at")).equals("Today") ? Ui.clock(c.optLong("at")) : Ui.dayLabel(c.optLong("at")));
            if (lead != null) { it.leadId = lead.optString("id"); it.leadName = lead.optString("name"); it.title = "Call back " + lead.optString("name"); it.sub = a.joined(Ui.stageLabel(lead), lead.optString("city")) + (times > 1 ? " · called " + times + " times" : ""); }
            else { it.title = "Call back " + MainActivity.prettyNumber(c.optString("phone")); it.sub = (times > 1 ? "Called " + times + " times. " : "") + "Not a lead yet."; }
            out.add(it);
        }

        // 2. new leads nobody has called yet (oldest first, so nobody waits too long)
        Set<String> touched = new HashSet<>();
        JSONArray acts = a.rows("activities");
        for (int i = 0; i < acts.length(); i++) { JSONObject x = acts.optJSONObject(i); if (x != null && "Call".equals(x.optString("type"))) touched.add(x.optString("leadId")); }
        for (JSONObject c : calls(a)) { JSONObject l = leadOf(a, c, leads, country); if (l != null) touched.add(l.optString("id")); }
        List<JSONObject> fresh = new ArrayList<>();
        for (JSONObject l : leads.values()) {
            long made = Ui.ms(l.optString("createdAt"));
            if (!"New".equals(l.optString("stage", "New")) || made == 0 || now - made > 7 * DAY || now - made < 30 * 60000L) continue;
            if (touched.contains(l.optString("id")) || !l.optString("firstTouchAt").isEmpty() || l.optString("phone").isEmpty()) continue;
            fresh.add(l);
        }
        fresh.sort((x, y) -> Long.compare(Ui.ms(x.optString("createdAt")), Ui.ms(y.optString("createdAt"))));
        for (JSONObject l : fresh) {
            long made = Ui.ms(l.optString("createdAt")), h = (now - made) / HOUR;
            Item it = new Item(); it.key = "new:" + l.optString("id");
            it.icon = R.drawable.ic_clock; it.whyColor = 0xff8a5200; it.action = "call";
            it.why = "New lead waiting " + (h < 1 ? "under an hour" : h < 24 ? h + (h == 1 ? " hour" : " hours") : (h / 24) + (h / 24 == 1 ? " day" : " days"));
            it.title = "First call to " + l.optString("name"); it.sub = a.joined(l.optString("source"), a.joined(l.optString("product"), l.optString("city")));
            it.phone = l.optString("phone"); it.leadId = l.optString("id"); it.leadName = l.optString("name");
            out.add(it);
        }

        // 3. interested customers and quotations gone quiet, with no follow-up planned
        Set<String> planned = new HashSet<>();
        for (JSONObject t : MyDayView.openTasks(a)) planned.add(t.optString("leadId"));
        for (JSONObject l : leads.values()) {
            String label = Ui.stageLabel(l).toLowerCase(Locale.ROOT);
            boolean quote = label.contains("quot"), keen = label.contains("interest") || "Opportunity".equals(l.optString("stage"));
            if ((!quote && !keen) || planned.contains(l.optString("id"))) continue;
            long last = lastTouch(a, l);
            long quiet = (now - last) / DAY;
            if (last == 0 || quiet < (quote ? 3 : 14)) continue;
            Item it = new Item(); it.key = "quiet:" + l.optString("id") + ":" + last;
            it.icon = R.drawable.ic_sparkle; it.whyColor = 0xff45525c; it.action = "plan";
            it.why = (quote ? "Quotation given" : "Interested") + ", no contact in " + quiet + " days";
            it.title = (quote ? "Follow up on the quotation to " : "Check in with ") + l.optString("name");
            it.sub = a.joined(l.optString("company"), l.optString("city"));
            it.phone = l.optString("phone"); it.leadId = l.optString("id"); it.leadName = l.optString("name");
            out.add(it);
        }

        // drop what was dismissed (until its time is up)
        JSONObject gone = dismissed(a);
        out.removeIf(it -> gone.optLong(it.key, 0) > now);
        return out;
    }

    private static boolean missed(JSONObject c) {
        String d = c.optString("direction");
        return d.equals("Missed") || d.equals("Rejected") || (d.equals("Incoming") && c.optLong("duration", 0) == 0);
    }

    private static long lastConnected(MainActivity a, String n, String country) {
        long at = 0;
        for (JSONObject c : calls(a)) if (SyncEngine.normalize(c.optString("phone"), country).equals(n) && !missed(c) && (c.optLong("duration", 0) > 0 || "Outgoing".equals(c.optString("direction")))) at = Math.max(at, c.optLong("at"));
        return at;
    }

    private static JSONObject leadOf(MainActivity a, JSONObject c, Map<String, JSONObject> leads, String country) {
        JSONObject l = leads.get(c.optString("leadId"));
        if (l != null) return l;
        String n = SyncEngine.normalize(c.optString("phone"), country);
        for (JSONObject x : leads.values()) if (n.length() >= 6 && SyncEngine.normalize(x.optString("phone"), country).equals(n)) return x;
        return null;
    }

    private static long lastTouch(MainActivity a, JSONObject l) {
        long t = Ui.ms(l.optString("updatedAt", l.optString("createdAt")));
        for (JSONObject x : a.leadActivities(l.optString("id"))) { t = Math.max(t, a.activityTime(x)); break; }
        return t;
    }

    private static List<JSONObject> cache; private static long cachedAt;
    /** Calls on this phone and in the CRM, each with `at` in milliseconds. */
    static List<JSONObject> calls(MainActivity a) {
        if (cache != null && System.currentTimeMillis() - cachedAt < 2000) return cache;
        List<JSONObject> list = new ArrayList<>(); Set<String> ids = new HashSet<>();
        try (QueueDb db = new QueueDb(a); Cursor cur = db.getReadableDatabase().rawQuery("SELECT phone,direction,duration,started,remote_id FROM calls ORDER BY started DESC LIMIT 400", null)) {
            while (cur.moveToNext()) {
                list.add(new JSONObject().put("phone", cur.getString(0)).put("direction", cur.getString(1)).put("duration", cur.getLong(2)).put("at", cur.getLong(3)));
                if (cur.getString(4) != null) ids.add(cur.getString(4));
            }
        } catch (Exception ignored) { /* no local queue yet */ }
        JSONArray server = a.rows("mobileCalls");
        for (int i = 0; i < server.length(); i++) {
            JSONObject c = server.optJSONObject(i); if (c == null || ids.contains(c.optString("id"))) continue;
            long at = c.optLong("startedAt", 0); if (at == 0) at = Ui.ms(c.optString("startedAt"));
            try { list.add(new JSONObject().put("phone", c.optString("phone")).put("direction", c.optString("direction")).put("duration", c.optLong("duration", 0)).put("at", at).put("leadId", c.optString("leadId"))); } catch (Exception ignored) {}
        }
        cache = list; cachedAt = System.currentTimeMillis();
        return list;
    }

    private static JSONObject dismissed(MainActivity a) { try { return new JSONObject(SecureConfig.prefs(a).getString("aiDismissed", "{}")); } catch (Exception e) { return new JSONObject(); } }

    static void dismiss(MainActivity a, String key, long forMs) {
        JSONObject gone = dismissed(a); long now = System.currentTimeMillis();
        try {
            for (Iterator<String> k = gone.keys(); k.hasNext(); ) if (gone.optLong(k.next()) < now) k.remove();
            gone.put(key, now + forMs);
        } catch (Exception ignored) {}
        SecureConfig.prefs(a).edit().putString("aiDismissed", gone.toString()).apply();
    }

    // ---- follow-ups ----

    private static void drawFollowUps(MainActivity a, List<JSONObject> open) {
        if (open.isEmpty()) { empty(a, "No follow-ups planned", "Plan one from a lead, or after a call. They show here and remind you when it is time."); return; }
        Map<String, JSONObject> leads = MyDayView.leadsById(a);
        long now = System.currentTimeMillis();
        java.time.ZoneId z = java.time.ZoneId.systemDefault();
        long dayStart = java.time.LocalDate.now().atStartOfDay(z).toInstant().toEpochMilli(), tomorrow = dayStart + DAY, after = tomorrow + DAY;
        String[] names = {"Late", "Today", "Tomorrow", "Later", "No date"};
        List<List<JSONObject>> groups = new ArrayList<>(); for (int i = 0; i < names.length; i++) groups.add(new ArrayList<>());
        for (JSONObject t : open) {
            long d = Ui.ms(t.optString("due"));
            groups.get(d == 0 ? 4 : d < now ? 0 : d < tomorrow ? 1 : d < after ? 2 : 3).add(t);
        }
        for (int g = 0; g < names.length; g++) {
            List<JSONObject> list = groups.get(g); if (list.isEmpty()) continue;
            boolean red = g == 0;
            Ui.heading(a, a.content, names[g], String.valueOf(list.size()), red ? MainActivity.RED : MainActivity.MUTED);
            LinearLayout box = Ui.group(a, a.content);
            if (red) { GradientDrawable bg = a.surface(Color.WHITE, 16); bg.setStroke(a.dp(1), 0xfff1c9c6); box.setBackground(bg); }
            for (int i = 0; i < list.size(); i++) {
                JSONObject t = list.get(i), l = leads.get(t.optString("leadId"));
                if (i > 0) Ui.hairline(a, box, 64);
                long d = Ui.ms(t.optString("due"));
                String when = d == 0 ? "" : g == 0 ? (Ui.dayLabel(d).equals("Today") ? "since " + Ui.clock(d) : Ui.dayLabel(d).toLowerCase(Locale.ROOT)) : g >= 3 ? Ui.dayLabel(d) + ", " + Ui.clock(d) : Ui.clock(d);
                // the circle that ticks it off
                ImageView tick = new ImageView(a); tick.setContentDescription("Mark " + t.optString("title") + " as done");
                GradientDrawable ring = new GradientDrawable(); ring.setShape(GradientDrawable.OVAL); ring.setStroke(a.dp(2), 0xffb6b4c6); ring.setSize(a.dp(22), a.dp(22));
                tick.setImageDrawable(ring); tick.setScaleType(ImageView.ScaleType.CENTER); tick.setLayoutParams(new LinearLayout.LayoutParams(a.dp(36), a.dp(44)));
                LinearLayout row = Ui.row(a, box, tick, t.optString("title"), a.joined(l == null ? "" : l.optString("name"), when), MainActivity.INK, red ? MainActivity.RED : MainActivity.MUTED);
                row.setPadding(a.dp(6), a.dp(10), a.dp(10), a.dp(10));
                tick.setOnClickListener(v -> { GradientDrawable done = new GradientDrawable(); done.setShape(GradientDrawable.OVAL); done.setColor(Ui.CALL_INK); done.setSize(a.dp(22), a.dp(22)); tick.setImageDrawable(done); Reminders.markDone(a, t.optString("id")); });
                if (l != null && !l.optString("phone").isEmpty()) row.addView(Ui.callButton(a, l.optString("phone"), l.optString("name")));
                if (l != null) { row.setFocusable(true); row.setOnClickListener(v -> LeadScreen.open(a, l.optString("id"), l)); }
            }
        }
    }

    private static void empty(MainActivity a, String title, String body) {
        LinearLayout box = a.column(); box.setPadding(a.dp(18), a.dp(18), a.dp(18), a.dp(18)); box.setBackground(a.surface(MainActivity.SOFT, 18));
        box.addView(Ui.text(a, title, 16, true, MainActivity.INK));
        TextView s = Ui.text(a, body, 13, false, MainActivity.MUTED); s.setPadding(0, a.dp(4), 0, 0); box.addView(s);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2); p.setMargins(0, a.dp(8), 0, 0); a.content.addView(box, p);
    }
}
