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
import java.util.*;
import org.json.JSONObject;

/**
 * The Calls tab drawn like the phone's own call log: calls grouped by day, one compact row each with the person's initials,
 * their name (red when missed), an arrow for the direction with the talk time, the time on the right and a button to call
 * back. Tapping a row opens its details below it: open or add the lead, play the recording, call feedback and WhatsApp.
 */
final class CallLogView {
    private static final int[] AVATARS = {0xFF5B6CF0, 0xFF1FA855, 0xFFE67E22, 0xFF8E44AD, 0xFF16A085, 0xFFD35400, 0xFF2980B9, 0xFFC0392B};
    private static final int CALLBACK = 0xFF1FA855;
    static String expanded = "";

    /** One call as both lists keep it: a call on the phone's queue (local) or one the CRM already has. */
    static final class Entry {
        final JSONObject r; final boolean local; final long time;
        Entry(JSONObject r, boolean local, long time) { this.r = r; this.local = local; this.time = time; }
        String key() { return (local ? "l:" : "s:") + r.optString("id") + ":" + time; }
    }

    private final MainActivity a;
    private CallLogView(MainActivity a) { this.a = a; }

    static int limit = 80;
    // every call in the phone's own call log for the last 30 days that the sync queue does not hold (personal calls and
    // numbers that are no lead): shown on this phone only, never sent anywhere
    static List<Entry> deviceLog(MainActivity a, Set<String> queued) {
        List<Entry> out = new ArrayList<>();
        if (a.checkSelfPermission(android.Manifest.permission.READ_CALL_LOG) != android.content.pm.PackageManager.PERMISSION_GRANTED) return out;
        String country = SecureConfig.prefs(a).getString("country", "91");
        try (android.database.Cursor c = a.getContentResolver().query(android.provider.CallLog.Calls.CONTENT_URI,
                new String[]{android.provider.CallLog.Calls._ID, android.provider.CallLog.Calls.NUMBER, android.provider.CallLog.Calls.DATE, android.provider.CallLog.Calls.DURATION, android.provider.CallLog.Calls.TYPE, android.provider.CallLog.Calls.CACHED_NAME},
                android.provider.CallLog.Calls.DATE + ">=?", new String[]{String.valueOf(System.currentTimeMillis() - 30L * 86400000)}, android.provider.CallLog.Calls.DATE + " DESC")) {
            int n = 0;
            while (c != null && c.moveToNext() && n++ < 400) {
                long start = c.getLong(2);
                if (queued.contains(c.getString(0) + "-" + start)) continue;
                int type = c.getInt(4);
                String dir = type == android.provider.CallLog.Calls.INCOMING_TYPE ? "Incoming" : type == android.provider.CallLog.Calls.OUTGOING_TYPE ? "Outgoing" : type == android.provider.CallLog.Calls.MISSED_TYPE ? "Missed" : type == android.provider.CallLog.Calls.REJECTED_TYPE ? "Rejected" : "";
                if (dir.isEmpty()) continue;
                String raw = c.getString(1) == null ? "" : c.getString(1), phone = SyncEngine.normalize(raw, country);
                JSONObject r = new JSONObject();
                r.put("local_id", c.getString(0) + "-" + start); r.put("phone", phone.isEmpty() ? raw : phone); r.put("direction", dir);
                r.put("duration", c.getLong(3)); r.put("started", start); r.put("device", true);
                if (c.getString(5) != null) r.put("contact", c.getString(5).trim());
                out.add(new Entry(r, true, start));
            }
        } catch (Exception ignored) { }
        return out;
    }
    static void draw(MainActivity a, LinearLayout content, List<Entry> calls) {
        CallLogView v = new CallLogView(a);
        calls.sort((x, y) -> Long.compare(y.time, x.time));
        String day = null; LinearLayout group = null; int drawn = 0;
        for (Entry e : calls) {
            if (drawn++ >= limit) {
                int left = calls.size() - limit;
                content.addView(Ui.pill(a, "Show " + Math.min(80, left) + " more  ·  " + left + " left", false, MainActivity.ACCENT, () -> { limit += 80; a.render(); }));
                break;
            }
            String label = v.dayLabel(e.time);
            if (!label.equals(day)) {
                day = label;
                TextView h = new TextView(a); h.setText(label); h.setTextSize(13); h.setTypeface(Typeface.DEFAULT_BOLD); h.setTextColor(MainActivity.MUTED);
                h.setPadding(a.dp(6), a.dp(12), 0, a.dp(6));
                content.addView(h);
                group = a.column();
                GradientDrawable bg = a.surface(Color.WHITE, MainActivity.RADIUS + 4); bg.setStroke(a.dp(1), MainActivity.LINE);
                group.setBackground(bg);
                content.addView(group, new LinearLayout.LayoutParams(-1, -2));
            } else {
                View line = new View(a); line.setBackgroundColor(MainActivity.LINE);
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, 1); lp.setMarginStart(a.dp(72));
                group.addView(line, lp);
            }
            v.row(group, e);
        }
    }

    private void row(LinearLayout group, Entry e) {
        JSONObject r = e.r;
        String phone = r.optString("phone"), who = a.callName(r), dir = r.optString("direction");
        if (who.equals(MainActivity.prettyNumber(phone)) && !r.optString("contact").isEmpty()) who = r.optString("contact");
        long secs = r.optLong("duration", 0);
        boolean known = !who.equals(MainActivity.prettyNumber(phone));
        boolean missed = dir.equals("Missed") || dir.equals("Rejected") || (dir.equals("Incoming") && secs == 0);

        LinearLayout wrap = a.column();
        LinearLayout row = a.horizontal(); row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(a.dp(14), a.dp(10), a.dp(6), a.dp(10)); row.setMinimumHeight(a.dp(64));
        wrap.addView(row);

        // the person's initials in a circle of their own colour, or a plain figure for a number not in Salesdesk
        TextView av = new TextView(a); av.setGravity(Gravity.CENTER); av.setTextColor(Color.WHITE); av.setTypeface(Typeface.DEFAULT_BOLD);
        av.setText(known ? initials(who) : "👤"); av.setTextSize(known ? 16 : 18);
        GradientDrawable circle = new GradientDrawable(); circle.setShape(GradientDrawable.OVAL);
        circle.setColor(known ? AVATARS[Math.abs(who.hashCode()) % AVATARS.length] : 0xFFB0B8C4);
        av.setBackground(circle);
        row.addView(av, new LinearLayout.LayoutParams(a.dp(44), a.dp(44)));

        LinearLayout middle = a.column(); middle.setPadding(a.dp(14), 0, a.dp(8), 0);
        TextView name = new TextView(a); name.setText(who); name.setTextSize(16); name.setSingleLine(true); name.setEllipsize(TextUtils.TruncateAt.END);
        name.setTextColor(missed ? MainActivity.RED : MainActivity.INK);
        name.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        middle.addView(name);
        if (known) { TextView num = new TextView(a); num.setText(MainActivity.prettyNumber(phone)); num.setTextSize(13); num.setTextColor(MainActivity.MUTED); num.setSingleLine(true); middle.addView(num); }
        LinearLayout sub = a.horizontal(); sub.setGravity(Gravity.CENTER_VERTICAL);
        TextView arrow = new TextView(a); arrow.setTextSize(14); arrow.setTypeface(Typeface.DEFAULT_BOLD);
        arrow.setText(dir.equals("Outgoing") ? "↗" : dir.equals("Rejected") ? "⊘" : "↙");
        arrow.setTextColor(missed ? MainActivity.RED : dir.equals("Outgoing") ? 0xFF2980B9 : CALLBACK);
        sub.addView(arrow);
        String detail = dir.equals("Outgoing") && secs == 0 ? "Not answered" : missed ? (dir.equals("Rejected") ? "Rejected" : "Missed") : talk(secs);
        String owner = a.ownerOf(phone);
        detail += !leadIdFor(phone).isEmpty() || !owner.isEmpty() ? "  ·  Lead: " + (owner.isEmpty() ? "…" : owner) : "  ·  Not a lead";
        if (hasRecording(e)) detail += "  ·  🎙";
        TextView info = new TextView(a); info.setText("  " + detail); info.setTextSize(13); info.setTextColor(MainActivity.MUTED); info.setSingleLine(true); info.setEllipsize(TextUtils.TruncateAt.END);
        sub.addView(info);
        middle.addView(sub);
        row.addView(middle, new LinearLayout.LayoutParams(0, -2, 1));

        TextView time = new TextView(a); time.setText(clock(e.time)); time.setTextSize(12); time.setTextColor(MainActivity.MUTED);
        row.addView(time);

        // call back, as the phone's call log does
        ImageView call = new ImageView(a); call.setImageResource(R.drawable.ic_phone); call.setColorFilter(CALLBACK);
        call.setPadding(a.dp(12), a.dp(12), a.dp(12), a.dp(12)); call.setContentDescription("Call " + who);
        call.setBackground(a.surface(Color.TRANSPARENT, 24));
        call.setOnClickListener(x -> dial(phone));
        row.addView(call, new LinearLayout.LayoutParams(a.dp(48), a.dp(48)));

        boolean open = expanded.equals(e.key());
        row.setOnClickListener(x -> { expanded = open ? "" : e.key(); a.render(); });
        row.setContentDescription(who + ", " + detail + ", " + clock(e.time) + ". Tap for details.");
        if (open) details(wrap, e, who, known);
        group.addView(wrap);
    }

    // what tapping a row shows: where the call stands, then what can be done with it
    private void details(LinearLayout wrap, Entry e, String who, boolean known) {
        JSONObject r = e.r;
        LinearLayout box = a.column(); box.setPadding(a.dp(72), 0, a.dp(14), a.dp(12));
        String remote = e.local ? r.optString("remote_id") : r.optString("id");
        String recording = recordingOf(e);
        String phone = r.optString("phone");
        TextView status = new TextView(a); status.setTextSize(12); status.setTextColor(MainActivity.MUTED);
        status.setText(MainActivity.prettyNumber(phone) + "\n" + (r.optBoolean("device") ? "On this phone only" : remote.isEmpty() ? "Waiting to sync" : "Synced to CRM") + " · "
            + (!recording.isEmpty() || e.local && r.optInt("uploaded") == 1 ? "Recording uploaded" : !r.optString("uri").isEmpty() ? "Recording on this phone" : "No recording"));
        box.addView(status);
        LinearLayout actions = new LinearLayout(a); actions.setPadding(0, a.dp(8), 0, 0);
        android.widget.HorizontalScrollView scroll = new android.widget.HorizontalScrollView(a); scroll.setHorizontalScrollBarEnabled(false); scroll.addView(actions);
        String lead = r.optString("leadId").isEmpty() ? leadIdFor(phone) : r.optString("leadId");
        if (!lead.isEmpty()) pill(actions, "Open lead", () -> LeadScreen.open(a, lead, null));
        else if (!known) pill(actions, "Add as lead", () -> a.leadForm(phone));
        if (!recording.isEmpty()) pill(actions, "▶ Recording", () -> a.remotePlay(recording));
        else if (e.local && !r.optString("uri").isEmpty()) pill(actions, "▶ Recording", () -> a.play(Uri.parse(r.optString("uri")), false));
        pill(actions, "Log outcome", () -> AfterCallSheet.open(a, lead, who, phone, r.optLong("duration", 0)));
        if (!remote.isEmpty()) pill(actions, "Feedback", () -> a.startActivity(new Intent(a, FeedbackActivity.class).putExtra("callId", remote).putExtra("userId", SecureConfig.prefs(a).getString("userId", ""))));
        pill(actions, "WhatsApp", () -> whatsApp(phone));
        box.addView(scroll);
        wrap.addView(box);
    }

    private void pill(LinearLayout row, String label, Runnable run) {
        TextView t = new TextView(a); t.setText(label); t.setTextSize(13); t.setTypeface(Typeface.DEFAULT_BOLD); t.setTextColor(MainActivity.PURPLE);
        t.setGravity(Gravity.CENTER); t.setPadding(a.dp(14), a.dp(8), a.dp(14), a.dp(8)); t.setBackground(a.surface(MainActivity.SOFT, 18));
        t.setOnClickListener(v -> run.run());
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2, a.dp(38)); p.setMarginEnd(a.dp(8));
        row.addView(t, p);
    }

    private String recordingOf(Entry e) {
        String recording = e.r.optString("recordingId");
        if (e.local && recording.isEmpty()) {
            String remote = e.r.optString("remote_id");
            if (!remote.isEmpty()) recording = a.index().recordingByCall.getOrDefault(remote, "");
        }
        return recording;
    }
    private boolean hasRecording(Entry e) { return !recordingOf(e).isEmpty() || (e.local && (!e.r.optString("uri").isEmpty() || e.r.optInt("uploaded") == 1)); }

    // the lead with this number (last ten digits), from the index built once per workspace
    private String leadIdFor(String phone) { JSONObject l = a.index().lead(phone); return l == null ? a.cardLeadId(phone) : l.optString("id"); }

    private void dial(String phone) {
        String d = phone.replaceAll("[^0-9+]", ""); if (d.isEmpty()) return;
        if (!d.startsWith("+")) d = (d.length() == 10 ? "+" + SecureConfig.prefs(a).getString("country", "91") : "+") + d;
        CompanySim.dial(a, d);
    }
    private void whatsApp(String phone) {
        String d = phone.replaceAll("[^0-9]", ""); if (d.length() == 10) d = SecureConfig.prefs(a).getString("country", "91") + d;
        try { a.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/" + d))); } catch (Exception ignored) {}
    }

    private static String talk(long s) { return s >= 3600 ? s / 3600 + "h " + (s % 3600) / 60 + "m" : s >= 60 ? s / 60 + "m " + s % 60 + "s" : s + "s"; }
    private static String initials(String name) {
        StringBuilder s = new StringBuilder();
        for (String w : name.trim().split("\\s+")) if (!w.isEmpty() && Character.isLetterOrDigit(w.charAt(0)) && s.length() < 2) s.append(Character.toUpperCase(w.charAt(0)));
        return s.length() == 0 ? "?" : s.toString();
    }
    private String clock(long t) { return t == 0 ? "" : new java.text.SimpleDateFormat("h:mm a", Locale.ENGLISH).format(new Date(t)); }
    private String dayLabel(long t) {
        if (t == 0) return "Earlier";
        java.time.LocalDate d = java.time.Instant.ofEpochMilli(t).atZone(java.time.ZoneId.systemDefault()).toLocalDate(), today = java.time.LocalDate.now();
        if (d.equals(today)) return "Today";
        if (d.equals(today.minusDays(1))) return "Yesterday";
        return d.format(java.time.format.DateTimeFormatter.ofPattern(d.getYear() == today.getYear() ? "EEEE, d MMM" : "d MMM yyyy", Locale.ENGLISH));
    }
}
