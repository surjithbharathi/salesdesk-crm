package ai.salesdesk.companion;

import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.*;
import java.util.regex.*;
import org.json.*;

/**
 * A lead's activity history drawn the way the web lead page draws it: a WhatsApp-style conversation grouped by day, newest
 * first. What the customer did (a message, a call to us, an enquiry) sits on the left; what our side did (a message, a call, a
 * note) on the right, each with the team member's initials. Updates that belong to nobody (a stage moved, a phone-system
 * record) are a small label in the middle.
 */
final class HistoryView {
    private static final int IN = Color.WHITE, OUT = 0xFFD9FDD3, NOTE = 0xFFFFF6CC, SYS = 0xFFEEF2F4, EDGE = 0x14111B21;
    private static final int TEXT = 0xFF111B21, SUB = 0xFF667781, OUT_SUB = 0xFF4F7A5A, NOTE_SUB = 0xFF8A6D00, US = 0xFF1FA855, THEM = 0xFF8696A0, MISSED = 0xFFC0392B;

    private final MainActivity a;
    private final LinearLayout parent;
    private final String customer;
    private final int max;

    private HistoryView(MainActivity a, LinearLayout parent, String customer) {
        this.a = a; this.parent = parent; this.customer = customer;
        max = a.getResources().getDisplayMetrics().widthPixels - dp(96);
    }

    static void draw(MainActivity a, LinearLayout parent, JSONArray acts, String customer) {
        HistoryView h = new HistoryView(a, parent, customer);
        String day = null;
        Set<String> said = new HashSet<>();
        for (int i = 0; i < acts.length(); i++) { JSONObject x = acts.optJSONObject(i); if (x != null && "Message".equals(x.optString("type"))) said.add(norm(x.optString("text"))); }
        for (int i = 0; i < acts.length(); i++) {
            JSONObject item = acts.optJSONObject(i);
            if (item == null) continue;
            String when = item.optString("occurredAt", item.optString("createdAt"));
            String label = dayLabel(when);
            if (!label.equals(day)) { day = label; h.dayHeader(label); }
            try { h.entry(item, timeOnly(when), said); } catch (Exception ignored) { /* one odd record never hides the rest */ }
        }
    }

    // ---- one entry ----

    private void entry(JSONObject x, String at, Set<String> said) {
        String type = x.optString("type"), text = lines(x.optString("text")), by = x.optString("by");
        if (type.equals("Call")) { call(x, text, by, at); return; }
        if (type.equals("Message")) {
            boolean out = "Outgoing".equals(x.optString("direction"));
            LinearLayout b = bubble(out ? OUT : IN, out);
            body(b, text);
            String who = x.optString("sender", by); if (who.isEmpty()) who = out ? "Our team" : "Customer";
            foot(b, join(" · ", who, x.optString("via").isEmpty() ? "" : "via " + x.optString("via"), x.optString("numberLabel")) + (at.isEmpty() ? "" : ", " + at), out ? OUT_SUB : SUB);
            row(b, out, x, out && !x.optString("sender").isEmpty() ? x.optString("sender") : by);
            return;
        }
        String phoneEvent = superfone(text); if (phoneEvent.isEmpty()) phoneEvent = callStatus(text);
        if (!phoneEvent.isEmpty()) { system(phoneEvent + (at.isEmpty() ? "" : " · " + at)); return; }
        if (type.equals("System")) {
            JSONObject arrived = leadArrived(text);
            if (arrived != null && said.contains(norm(arrived.optString("intro")))) try { arrived.put("intro", ""); } catch (Exception ignored) {}
            if (arrived != null) buyLead(arrived, x, by, at);
            else if (!salesmax(text, at)) system(text + (at.isEmpty() ? "" : " · " + at));
            return;
        }
        JSONObject lead = buyLeadOf(x);
        if (lead != null) { buyLead(lead, x, by, at); return; }
        LinearLayout b = bubble(NOTE, true);
        body(b, text);
        if (!x.optString("voiceNoteId").isEmpty()) play(b, "▶  Play voice note", () -> a.playVoiceFeedback(x.optString("voiceNoteId")));
        foot(b, (type.equals("Visit") ? "Visit · " : "Note · ") + (by.isEmpty() ? "Our team" : by) + (at.isEmpty() ? "" : ", " + at), NOTE_SUB);
        row(b, true, x, by);
    }

    private void call(JSONObject x, String text, String by, String at) {
        String dir = x.optString("direction", "Outgoing");
        int secs = x.optInt("duration", 0);
        boolean out = dir.equals("Outgoing");
        LinearLayout b = bubble(out ? OUT : IN, out);
        String title = out ? (secs > 0 ? "Outgoing call" : "Called, no answer")
            : dir.equals("Incoming") || dir.equals("Rejected") ? (secs > 0 ? "Incoming call" : dir.equals("Rejected") ? "Rejected call" : "Missed call")
            : secs > 0 ? dir + " call" : "Missed call";
        TextView head = text(b, "📞  " + title + (secs > 0 ? "  · " + seconds(secs) : ""), 14, secs > 0 ? TEXT : MISSED);
        head.setTypeface(Typeface.DEFAULT_BOLD);
        boolean generic = text.isEmpty() || Pattern.compile("^(Phone sync|Incoming|Outgoing|Missed|Rejected|Called)\\b", Pattern.CASE_INSENSITIVE).matcher(text).find();
        if (!generic) body(b, text);
        String rec = x.optString("recordingId");
        if (!rec.isEmpty()) play(b, "▶  Play recording", () -> a.remotePlay(rec));
        else if (secs > 0 && !dir.equals("Missed")) { TextView w = text(b, "No recording from the phone yet. Turn on Settings → \"Sync call recordings\".", 12, SUB); w.setPadding(0, dp(4), 0, dp(2)); }
        String outcome = x.optString("outcome");
        String how = outcome.equals("Recorded") ? (rec.isEmpty() ? "Answered" : "Recorded") : outcome;
        String who = by.isEmpty() ? (out ? "Our team" : "Customer") : by;
        foot(b, join(" · ", who, how, x.optString("importedFrom").isEmpty() ? "" : "from " + x.optString("importedFrom")) + (at.isEmpty() ? "" : ", " + at), out ? OUT_SUB : SUB);
        row(b, out, x, by);
    }

    private void buyLead(JSONObject l, JSONObject x, String by, String at) {
        LinearLayout b = bubble(IN, false);
        GradientDrawable g = (GradientDrawable) b.getBackground();
        g.setStroke(dp(1), 0x3D1FA855);
        TextView tag = text(b, join(" · ", l.optString("tag"), l.optString("kind")), 12, US); tag.setTypeface(Typeface.DEFAULT_BOLD);
        if (!l.optString("product").isEmpty()) { TextView p = text(b, l.optString("product"), 15, TEXT); p.setTypeface(Typeface.DEFAULT_BOLD); p.setPadding(0, dp(2), 0, dp(2)); }
        if (!l.optString("intro").isEmpty()) body(b, l.optString("intro"));
        JSONArray specs = l.optJSONArray("specs");
        if (specs != null) for (int i = 0; i < specs.length(); i++) {
            JSONArray s = specs.optJSONArray(i); if (s == null) continue;
            TextView t = text(b, s.optString(0) + ":  " + s.optString(1), 13, TEXT); t.setPadding(0, dp(1), 0, 0);
        }
        String place = join(" · ", l.optString("place"), l.optString("pin")), contact = join(" · ", MainActivity.prettyNumber(l.optString("mobile")).equals("Unknown number") ? "" : MainActivity.prettyNumber(l.optString("mobile")), l.optString("email"));
        if (!place.isEmpty()) text(b, place, 12, SUB);
        if (!contact.isEmpty()) text(b, contact, 12, SUB);
        String name = l.optString("name"); if (name.isEmpty()) name = customer.isEmpty() ? "Buyer" : customer;
        foot(b, name + (at.isEmpty() ? "" : ", " + at), SUB);
        row(b, false, x, by);
    }

    // the Salesmax record packed into one note by the Excel upload: one line that opens as a list
    private boolean salesmax(String text, String at) {
        if (!text.startsWith("Salesmax ")) return false;
        Matcher m = Pattern.compile("\\bSalesmax ([A-Z][\\w ]{1,40}?): ").matcher(text);
        List<int[]> keys = new ArrayList<>(); List<String> names = new ArrayList<>();
        while (m.find()) { keys.add(new int[]{m.start(), m.end()}); names.add(m.group(1)); }
        if (keys.size() < 4) return false;
        StringBuilder list = new StringBuilder();
        for (int i = 0; i < keys.size(); i++) {
            String v = text.substring(keys.get(i)[1], i + 1 < keys.size() ? keys.get(i + 1)[0] : text.length()).trim();
            if (!v.isEmpty()) list.append(names.get(i)).append(": ").append(v).append('\n');
        }
        TextView t = system("Salesmax details from the Excel upload" + (at.isEmpty() ? "" : " · " + at) + "  ▾");
        String full = list.toString().trim();
        t.setOnClickListener(v -> { boolean open = t.getTag() != null; t.setTag(open ? null : 1); t.setText(open ? "Salesmax details from the Excel upload" + (at.isEmpty() ? "" : " · " + at) + "  ▾" : full); t.setGravity(open ? Gravity.CENTER : Gravity.START); });
        return true;
    }

    // ---- layout pieces ----

    private void dayHeader(String label) {
        TextView t = new TextView(a); t.setText(label); t.setTextSize(12); t.setTextColor(SUB); t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(dp(12), dp(4), dp(12), dp(4)); t.setBackground(round(SYS, 10, 0));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2, -2); p.gravity = Gravity.CENTER_HORIZONTAL; p.setMargins(0, dp(14), 0, dp(6));
        parent.addView(t, p);
    }

    private TextView system(String text) {
        TextView t = new TextView(a); t.setText(text); t.setTextSize(11.5f); t.setTextColor(SUB); t.setGravity(Gravity.CENTER);
        t.setPadding(dp(10), dp(4), dp(10), dp(4)); t.setBackground(round(SYS, 8, 0)); t.setMaxWidth(a.getResources().getDisplayMetrics().widthPixels - dp(64));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2, -2); p.gravity = Gravity.CENTER_HORIZONTAL; p.setMargins(0, dp(3), 0, dp(3));
        parent.addView(t, p);
        return t;
    }

    private LinearLayout bubble(int color, boolean out) {
        LinearLayout b = new LinearLayout(a); b.setOrientation(LinearLayout.VERTICAL); b.setPadding(dp(10), dp(6), dp(10), dp(5));
        GradientDrawable g = new GradientDrawable(); g.setColor(color); g.setStroke(dp(1), EDGE);
        float r = dp(10);
        g.setCornerRadii(out ? new float[]{r, r, 0, 0, r, r, r, r} : new float[]{0, 0, r, r, r, r, r, r});
        b.setBackground(g);
        return b;
    }

    // a bubble beside its avatar: the customer's things on the left, ours on the right
    private void row(LinearLayout bubble, boolean out, JSONObject x, String handler) {
        LinearLayout r = new LinearLayout(a); r.setGravity((out ? Gravity.END : Gravity.START) | Gravity.BOTTOM);
        String badge = x.optString("badge"); if (badge.isEmpty()) badge = initials(handler.isEmpty() ? "Our team" : handler);
        TextView av = new TextView(a); av.setText(badge.length() > 3 ? badge.substring(0, 3) : badge); av.setTextSize(10); av.setTypeface(Typeface.DEFAULT_BOLD);
        av.setTextColor(Color.WHITE); av.setGravity(Gravity.CENTER);
        GradientDrawable c = new GradientDrawable(); c.setShape(GradientDrawable.OVAL); c.setColor(out ? US : THEM); av.setBackground(c);
        LinearLayout.LayoutParams ap = new LinearLayout.LayoutParams(dp(30), dp(30));
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-2, -2);
        if (out) { bp.setMarginEnd(dp(8)); r.addView(bubble, bp); r.addView(av, ap); }
        else { bp.setMarginStart(dp(8)); r.addView(av, ap); r.addView(bubble, bp); }
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(-1, -2); rp.setMargins(0, dp(4), 0, dp(4));
        parent.addView(r, rp);
    }

    private TextView text(LinearLayout b, String s, float size, int color) {
        TextView t = new TextView(a); t.setText(s); t.setTextSize(size); t.setTextColor(color); t.setMaxWidth(max); t.setLineSpacing(0, 1.15f);
        b.addView(t);
        return t;
    }
    private void body(LinearLayout b, String s) { if (!s.trim().isEmpty()) { TextView t = text(b, s.trim(), 14, TEXT); t.setTextIsSelectable(true); } }
    private void foot(LinearLayout b, String s, int color) {
        TextView t = text(b, s, 11, color); t.setGravity(Gravity.END); t.setPadding(0, dp(3), 0, 0);
        t.setLayoutParams(new LinearLayout.LayoutParams(-1, -2));
    }
    private void play(LinearLayout b, String label, Runnable run) {
        TextView t = new TextView(a); t.setText(label); t.setTextSize(13); t.setTypeface(Typeface.DEFAULT_BOLD); t.setTextColor(MainActivity.PURPLE);
        t.setPadding(dp(14), dp(8), dp(14), dp(8)); t.setBackground(round(0x14000000 | (MainActivity.PURPLE & 0xFFFFFF), 18, 0));
        t.setOnClickListener(v -> run.run());
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2, -2); p.setMargins(0, dp(6), 0, dp(2));
        b.addView(t, p);
    }
    private GradientDrawable round(int color, int radius, int stroke) { GradientDrawable g = new GradientDrawable(); g.setColor(color); g.setCornerRadius(dp(radius)); if (stroke != 0) g.setStroke(dp(1), stroke); return g; }
    private int dp(int v) { return Math.round(v * a.getResources().getDisplayMetrics().density); }

    // ---- reading the records (the same rules as the web's ChatEntry) ----

    private static String lines(String t) { return t.replaceAll("(?i)<br\\s*/?>", "\n"); }
    private static String norm(String s) { return s.replaceAll("\\s+", " ").trim().toLowerCase(Locale.ROOT); }
    private static String seconds(int n) { return n >= 3600 ? n / 3600 + "h " + (n % 3600) / 60 + "m " + n % 60 + "s" : n >= 60 ? n / 60 + "m " + n % 60 + "s" : n + "s"; }
    private static String initials(String name) { String s = name.replaceAll("[^\\p{L}\\p{N}]", ""); return (s.isEmpty() ? "?" : s.substring(0, Math.min(2, s.length()))).toUpperCase(Locale.ROOT); }
    private static String join(String sep, String... parts) { StringBuilder s = new StringBuilder(); for (String p : parts) if (p != null && !p.trim().isEmpty()) { if (s.length() > 0) s.append(sep); s.append(p.trim()); } return s.toString(); }

    private static final Map<String, String> STATUS = new HashMap<>();
    static { String[] s = {"ANSWER", "answered", "ANSWERED", "answered", "ACTIVE", "ringing", "NOANSWER", "not answered", "NO_ANSWER", "not answered", "BUSY", "busy", "CANCEL", "cancelled", "CANCELLED", "cancelled", "FAILED", "failed", "MISSED", "missed", "CONGESTION", "network busy", "CHANUNAVAIL", "not reachable"}; for (int i = 0; i < s.length; i += 2) STATUS.put(s[i], s[i + 1]); }

    private static String field(String t, String k) {
        Matcher m = Pattern.compile("\"" + Pattern.quote(k) + "\"\\s*:\\s*(?:\"((?:[^\"\\\\]|\\\\.)*)\"|(-?\\d+(?:\\.\\d+)?))").matcher(t);
        return m.find() ? (m.group(1) != null ? m.group(1) : m.group(2)) : "";
    }
    // a raw Superfone webhook that TeleCRM kept as a note, read as one short line
    private static String superfone(String t) {
        if (!t.matches("(?s)^ACTION_\\d+:\\s*\\{.*") || !t.contains("\"body_event\"")) return "";
        String event = field(t, "body_event"), dir = field(t, "body_cdr call type"), status = field(t, "body_cdr disposition"), staff = field(t, "body_staff first name");
        int secs = 0; try { secs = (int) Double.parseDouble(field(t, "superfone_duration seconds")); } catch (Exception ignored) {}
        if (event.toUpperCase(Locale.ROOT).contains("CUSTOMER_CREATE")) return "Superfone saved this number as a contact";
        if (event.toUpperCase(Locale.ROOT).startsWith("CDR")) {
            String d = dir.toUpperCase(Locale.ROOT).contains("OUT") ? "Outgoing" : dir.toUpperCase(Locale.ROOT).contains("IN") ? "Incoming" : "A";
            String st = STATUS.containsKey(status.toUpperCase(Locale.ROOT)) ? STATUS.get(status.toUpperCase(Locale.ROOT)) : status.toLowerCase(Locale.ROOT);
            return "Superfone · " + join(" · ", d + " call", st, secs > 0 ? seconds(secs) : "", staff);
        }
        return "Superfone · " + event.replace('_', ' ').toLowerCase(Locale.ROOT);
    }
    private static String callStatus(String text) { String t = text.trim(); return STATUS.containsKey(t) ? "Call " + STATUS.get(t) : ""; }

    // an IndiaMART enquiry stored as `ACTION_105: {"type":"Buy-Lead","product_name":[...],"query":"..."}` (or as buyLead)
    private static JSONObject buyLeadOf(JSONObject x) {
        JSONObject f = x.optJSONObject("buyLead");
        if (f == null) {
            Matcher m = Pattern.compile("(?s)^ACTION_\\d+:\\s*(\\{.*)$").matcher(x.optString("text").trim());
            if (!m.find()) return null;
            try { f = new JSONObject(m.group(1)); } catch (Exception e) {
                f = new JSONObject(); String body = m.group(1);
                for (String k : new String[]{"type", "name", "mobile", "email", "address", "city", "state", "query", "call_duration"}) { String v = field(body, k); if (!v.isEmpty()) try { f.put(k, v.replaceAll("\\\\(.)", "$1")); } catch (Exception ignored) {} }
                Matcher p = Pattern.compile("\"product_name\"\\s*:\\s*\\[([^\\]]*)").matcher(body);
                if (p.find()) { JSONArray list = new JSONArray(); Matcher q = Pattern.compile("\"((?:[^\"\\\\]|\\\\.)*)\"").matcher(p.group(1)); while (q.find()) list.put(q.group(1)); try { f.put("product_name", list); } catch (Exception ignored) {} }
            }
        }
        List<String> products = new ArrayList<>();
        JSONArray pn = f.optJSONArray("product_name");
        if (pn != null) for (int i = 0; i < pn.length(); i++) products.add(clean(pn.optString(i)));
        else if (!f.optString("product_name").isEmpty()) products.add(clean(f.optString("product_name")));
        else if (!f.optString("product").isEmpty()) products.add(clean(f.optString("product")));
        String type = f.optString("type");
        if (products.isEmpty() && f.optString("query").isEmpty() && !type.toLowerCase(Locale.ROOT).contains("buy")) return null;
        try {
            JSONObject l = new JSONObject().put("tag", "IndiaMART").put("kind", indiaMartKind(type, f.optInt("call_duration")))
                .put("product", join(", ", products.toArray(new String[0]))).put("name", clean(f.optString("name"))).put("mobile", clean(f.optString("mobile")))
                .put("email", clean(f.optString("email"))).put("place", join(", ", clean(f.optString("city")), clean(f.optString("state"))));
            Matcher pin = Pattern.compile("\\b\\d{6}\\b").matcher(f.optString("address")); l.put("pin", pin.find() ? pin.group() : "");
            querySpecs(clean(f.optString("query")), l);
            return l;
        } catch (Exception e) { return null; }
    }
    private static String clean(String s) { return s == null ? "" : s.replaceAll("\\s+", " ").trim(); }
    private static String indiaMartKind(String type, int secs) {
        String t = type.trim();
        if (t.matches("(?i)^b$|.*buy.*")) return "Buy lead";
        if (t.matches("(?i)^w$|.*(direct|enq).*")) return "Direct enquiry";
        if (t.matches("(?i)^p$|.*(call|pns).*")) return secs > 0 ? "Call enquiry · " + seconds(secs) : "Call enquiry";
        return t.isEmpty() ? "Enquiry" : t.replace('-', ' ');
    }
    // "Buyer Searched for X Machine Type: Cold Press Motor Power: 5 HP" -> intro + specs
    private static void querySpecs(String q, JSONObject l) throws JSONException {
        Matcher m = Pattern.compile("(Probable(?: [A-Z][\\w/&().-]*){1,2}|[A-Z][\\w/&().-]*(?: [A-Z][\\w/&().-]*)?):\\s+").matcher(q);
        List<int[]> at = new ArrayList<>(); List<String> keys = new ArrayList<>();
        while (m.find()) { at.add(new int[]{m.start(), m.end()}); keys.add(m.group(1)); }
        JSONArray specs = new JSONArray();
        if (at.isEmpty()) { l.put("intro", q).put("specs", specs); return; }
        l.put("intro", q.substring(0, at.get(0)[0]).trim());
        for (int i = 0; i < at.size(); i++) { String v = q.substring(at.get(i)[1], i + 1 < at.size() ? at.get(i + 1)[0] : q.length()).trim(); if (!v.isEmpty()) specs.put(new JSONArray().put(keys.get(i)).put(v)); }
        l.put("specs", specs);
    }
    // TeleCRM's "Details updated: phone: 91…, name: X, lead_source: Whatsapp Cloud API, query: Hello" line: a new lead's enquiry
    private static JSONObject leadArrived(String text) {
        String t = text.trim();
        try {
            Matcher only = Pattern.compile("(?i)^(?:Lead Source:|Lead (?:captured|received|came) from)\\s*([^\\n,]{1,60})$").matcher(t);
            if (only.find()) return new JSONObject().put("tag", sourceLabel(only.group(1).trim())).put("kind", "New lead");
            if (!t.startsWith("Details updated:")) return null;
            Map<String, String> f = new HashMap<>();
            for (String part : t.substring("Details updated:".length()).split(",\\s*(?=[a-z][a-z0-9_]*:\\s)")) {
                Matcher kv = Pattern.compile("(?s)^([a-z][a-z0-9_]*):\\s*(.*)$").matcher(part.trim());
                if (kv.find()) f.put(kv.group(1), kv.group(2).trim());
            }
            if (!f.containsKey("lead_source")) return null;
            return new JSONObject().put("tag", sourceLabel(f.get("lead_source"))).put("kind", "New lead")
                .put("product", f.getOrDefault("product", f.getOrDefault("product_name", ""))).put("intro", f.getOrDefault("query", f.getOrDefault("message", "")))
                .put("name", f.getOrDefault("name", "")).put("mobile", f.getOrDefault("phone", f.getOrDefault("mobile", ""))).put("email", f.getOrDefault("email", ""))
                .put("place", join(", ", f.get("city"), f.get("state")));
        } catch (Exception e) { return null; }
    }
    private static String sourceLabel(String s) {
        String v = s.trim().toLowerCase(Locale.ROOT);
        if (v.matches(".*(whatsapp\\s*cloud|click.?to.?whatsapp|ctwa).*")) return "Meta ad · WhatsApp";
        if (v.matches(".*(facebook|instagram|meta).*")) return "Meta ad";
        if (v.contains("indiamart")) return "IndiaMART";
        if (v.matches(".*trade\\s*india.*")) return "TradeIndia";
        if (v.matches(".*just\\s*dial.*")) return "JustDial";
        return s.trim().isEmpty() ? "New lead" : s.trim();
    }

    // ---- dates ----

    private static long ms(String iso) { try { return java.time.Instant.parse(iso).toEpochMilli(); } catch (Exception e) { return 0; } }
    private static String dayLabel(String iso) {
        long t = ms(iso); if (t == 0) return "Earlier";
        java.time.LocalDate d = java.time.Instant.ofEpochMilli(t).atZone(java.time.ZoneId.systemDefault()).toLocalDate(), today = java.time.LocalDate.now();
        if (d.equals(today)) return "Today";
        if (d.equals(today.minusDays(1))) return "Yesterday";
        return d.format(java.time.format.DateTimeFormatter.ofPattern(d.getYear() == today.getYear() ? "EEE, d MMM" : "d MMM yyyy", Locale.ENGLISH));
    }
    private static String timeOnly(String iso) { long t = ms(iso); return t == 0 ? "" : new java.text.SimpleDateFormat("h:mm a", Locale.ENGLISH).format(new Date(t)); }
}
