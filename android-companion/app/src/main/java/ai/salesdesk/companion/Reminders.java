package ai.salesdesk.companion;

import android.app.*;
import android.content.*;
import android.os.Build;
import java.util.*;
import org.json.*;

/**
 * Follow-up reminders on the phone. One alarm is kept for the next thing that needs a nudge: a follow-up's reminder time
 * (its due time less the "remind me" choice, or a snooze), the morning plan at 9:30, or the hourly check for late follow-ups
 * during working hours. When it fires, the notifications go out and the next alarm is set. Everything is read from the
 * workspace saved at the last sync, so it works without a connection; only "Done" needs the CRM.
 */
final class Reminders {
    static final String CHANNEL = "followups";
    private static final long MINUTE = 60000, HOUR = 3600000;
    private static final int MORNING_H = 9, MORNING_M = 30, LATE_FROM = 9, LATE_TO = 20;

    private Reminders() {}

    // ---- per follow-up choices kept on this phone ----

    static void setOffset(Context c, String taskId, int minutes) { if (taskId != null && !taskId.isEmpty()) SecureConfig.prefs(c).edit().putInt("remind:" + taskId, minutes).apply(); }
    static int offset(Context c, String taskId) { return SecureConfig.prefs(c).getInt("remind:" + taskId, 0); }
    static void snooze(Context c, String taskId, long until) { SecureConfig.prefs(c).edit().putLong("snooze:" + taskId, until).apply(); schedule(c); }

    /** When this follow-up should ring, or 0 for never. */
    static long fireAt(Context c, JSONObject t) {
        String id = t.optString("id");
        long snoozed = SecureConfig.prefs(c).getLong("snooze:" + id, 0);
        if (snoozed > 0) return snoozed;
        int off = offset(c, id);
        long due = Ui.ms(t.optString("due"));
        return off < 0 || due == 0 ? 0 : due - off * MINUTE;
    }

    static JSONObject workspace(Context c) { try { return new JSONObject(SecureConfig.prefs(c).getString("workspace", "{}")); } catch (Exception e) { return new JSONObject(); } }

    static List<JSONObject> open(JSONObject ws, String me) {
        List<JSONObject> list = new ArrayList<>();
        JSONArray t = ws.optJSONArray("tasks");
        if (t != null) for (int i = 0; i < t.length(); i++) { JSONObject x = t.optJSONObject(i); if (x != null && !"Done".equals(x.optString("status")) && !"Cancelled".equals(x.optString("status")) && (me.isEmpty() || x.optString("owner", me).equals(me))) list.add(x); }
        return list;
    }

    static JSONObject lead(JSONObject ws, String id) {
        JSONArray l = ws.optJSONArray("leads");
        if (l != null) for (int i = 0; i < l.length(); i++) { JSONObject x = l.optJSONObject(i); if (x != null && x.optString("id").equals(id)) return x; }
        return null;
    }

    // ---- the one alarm ----

    static void schedule(Context c) {
        if (!SecureConfig.loggedIn(c)) return;
        long now = System.currentTimeMillis(), next = nextMorning(now);
        JSONObject ws = workspace(c);
        String me = SecureConfig.prefs(c).getString("userId", "");
        boolean anyLate = false;
        for (JSONObject t : open(ws, me)) {
            long f = fireAt(c, t);
            if (f > now && f < next && !fired(c, t, f)) next = f;
            long due = Ui.ms(t.optString("due"));
            if (due > 0 && due < now) anyLate = true;
        }
        if (anyLate) next = Math.min(next, nextLateCheck(c, now));
        AlarmManager am = c.getSystemService(AlarmManager.class);
        PendingIntent pi = PendingIntent.getBroadcast(c, 41, new Intent(c, ReminderReceiver.class).setAction(ReminderReceiver.TICK), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        try {
            if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi);
            else am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi);
        } catch (Exception e) { am.set(AlarmManager.RTC_WAKEUP, next, pi); }
    }

    private static boolean fired(Context c, JSONObject t, long at) { return SecureConfig.prefs(c).getLong("fired:" + t.optString("id"), 0) == at; }

    private static long nextMorning(long now) {
        Calendar k = Calendar.getInstance(); k.setTimeInMillis(now); k.set(Calendar.HOUR_OF_DAY, MORNING_H); k.set(Calendar.MINUTE, MORNING_M); k.set(Calendar.SECOND, 0); k.set(Calendar.MILLISECOND, 0);
        if (k.getTimeInMillis() <= now) k.add(Calendar.DAY_OF_YEAR, 1);
        return k.getTimeInMillis();
    }

    private static long nextLateCheck(Context c, long now) {
        long last = SecureConfig.prefs(c).getLong("lateNoticeAt", 0);
        long at = Math.max(now + MINUTE, last + HOUR);
        Calendar k = Calendar.getInstance(); k.setTimeInMillis(at);
        int h = k.get(Calendar.HOUR_OF_DAY);
        if (h < LATE_FROM) { k.set(Calendar.HOUR_OF_DAY, LATE_FROM); k.set(Calendar.MINUTE, 0); }
        else if (h >= LATE_TO) { k.add(Calendar.DAY_OF_YEAR, 1); k.set(Calendar.HOUR_OF_DAY, LATE_FROM); k.set(Calendar.MINUTE, 0); }
        return k.getTimeInMillis();
    }

    /** The alarm went off: send what is due, then set the next alarm. */
    static void tick(Context c) {
        if (!SecureConfig.loggedIn(c)) return;
        channel(c);
        long now = System.currentTimeMillis();
        JSONObject ws = workspace(c);
        String me = SecureConfig.prefs(c).getString("userId", "");
        List<JSONObject> open = open(ws, me);
        SharedPreferences p = SecureConfig.prefs(c);
        // follow-ups whose reminder time has come (up to two hours late, if the phone was off)
        for (JSONObject t : open) {
            long f = fireAt(c, t);
            if (f > 0 && f <= now + 30000 && f > now - 2 * HOUR && !fired(c, t, f)) {
                p.edit().putLong("fired:" + t.optString("id"), f).remove("snooze:" + t.optString("id")).apply();
                due(c, t, lead(ws, t.optString("leadId")));
            }
        }
        // the morning plan, once a day
        String today = java.time.LocalDate.now().toString();
        Calendar k = Calendar.getInstance(); int h = k.get(Calendar.HOUR_OF_DAY), m = k.get(Calendar.MINUTE);
        if ((h > MORNING_H || (h == MORNING_H && m >= MORNING_M)) && h < 12 && !today.equals(p.getString("morningSent", ""))) {
            p.edit().putString("morningSent", today).apply();
            morning(c, ws, open);
        }
        // late follow-ups, at most once an hour in working hours
        List<JSONObject> late = new ArrayList<>();
        for (JSONObject t : open) { long d = Ui.ms(t.optString("due")); if (d > 0 && d < now) late.add(t); }
        if (!late.isEmpty() && h >= LATE_FROM && h < LATE_TO && now - p.getLong("lateNoticeAt", 0) >= HOUR - MINUTE) {
            p.edit().putLong("lateNoticeAt", now).apply();
            late(c, ws, late);
        }
        schedule(c);
    }

    // ---- notifications ----

    static void channel(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Follow-up reminders", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("When a follow-up is due, late follow-ups, and the morning plan.");
            nm.createNotificationChannel(ch);
        }
    }

    private static PendingIntent open(Context c, int code, Intent extras) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        i.putExtras(extras);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static PendingIntent broadcast(Context c, int code, String action, String taskId) {
        return PendingIntent.getBroadcast(c, code, new Intent(c, ReminderReceiver.class).setAction(action).putExtra("task", taskId), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static int idOf(String taskId) { return 5000 + (taskId.hashCode() & 0xfffff); }

    private static void due(Context c, JSONObject t, JSONObject lead) {
        String id = t.optString("id"), name = lead == null ? "" : lead.optString("name");
        int n = idOf(id);
        String body = t.optString("title") + (lead == null ? "" : joined(lead.optString("company"), lead.optString("city")));
        Notification.Builder b = new Notification.Builder(c, CHANNEL)
            .setSmallIcon(R.drawable.ic_phone).setColor(MainActivity.ACCENT)
            .setContentTitle(name.isEmpty() ? t.optString("title") : "Call " + name)
            .setContentText(body).setStyle(new Notification.BigTextStyle().bigText(body))
            .setCategory(Notification.CATEGORY_REMINDER).setAutoCancel(true)
            .setContentIntent(open(c, n, intent("reminderTask", id)));
        if (lead != null && !lead.optString("phone").isEmpty())
            b.addAction(new Notification.Action.Builder(null, "Call now", open(c, n + 1, intent("callTask", id))).build());
        b.addAction(new Notification.Action.Builder(null, "Snooze 15 min", broadcast(c, n + 2, ReminderReceiver.SNOOZE, id)).build());
        b.addAction(new Notification.Action.Builder(null, "Done", broadcast(c, n + 3, ReminderReceiver.DONE, id)).build());
        post(c, n, b.build());
    }

    private static void late(Context c, JSONObject ws, List<JSONObject> late) {
        late.sort((x, y) -> Long.compare(Ui.ms(x.optString("due")), Ui.ms(y.optString("due"))));
        StringBuilder who = new StringBuilder();
        for (int i = 0; i < Math.min(3, late.size()); i++) {
            JSONObject l = lead(ws, late.get(i).optString("leadId"));
            if (who.length() > 0) who.append(", ");
            who.append(l == null ? late.get(i).optString("title") : l.optString("name")).append(" (").append(since(Ui.ms(late.get(i).optString("due")))).append(")");
        }
        if (late.size() > 3) who.append(" and ").append(late.size() - 3).append(" more");
        String title = late.size() == 1 ? "1 follow-up is late" : late.size() + " follow-ups are late";
        Notification.Builder b = new Notification.Builder(c, CHANNEL).setSmallIcon(R.drawable.ic_calendar_check).setColor(MainActivity.RED)
            .setContentTitle(title).setContentText(who).setStyle(new Notification.BigTextStyle().bigText(who)).setAutoCancel(true)
            .setContentIntent(open(c, 4101, intent("openScreen", "To-do")));
        JSONObject first = lead(ws, late.get(0).optString("leadId"));
        if (first != null && !first.optString("phone").isEmpty())
            b.addAction(new Notification.Action.Builder(null, "Call " + first.optString("name").split(" ")[0], open(c, 4102, intent("callTask", late.get(0).optString("id")))).build());
        b.addAction(new Notification.Action.Builder(null, "Open To-do", open(c, 4103, intent("openScreen", "To-do"))).build());
        post(c, 4100, b.build());
    }

    private static void morning(Context c, JSONObject ws, List<JSONObject> open) {
        long end = java.time.LocalDate.now().plusDays(1).atStartOfDay(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli(), start = end - 24 * HOUR;
        int today = 0, carried = 0; JSONObject first = null;
        for (JSONObject t : open) {
            long d = Ui.ms(t.optString("due")); if (d == 0 || d >= end) continue;
            today++; if (d < start) carried++;
            if (d >= start && (first == null || d < Ui.ms(first.optString("due")))) first = t;
        }
        int fresh = 0; JSONArray l = ws.optJSONArray("leads");
        if (l != null) for (int i = 0; i < l.length(); i++) { JSONObject x = l.optJSONObject(i); if (x != null && "New".equals(x.optString("stage")) && Ui.ms(x.optString("createdAt")) > start - 24 * HOUR) fresh++; }
        if (today == 0 && fresh == 0) return;
        String title = "Your day: " + today + (today == 1 ? " follow-up" : " follow-ups") + (fresh > 0 ? ", " + fresh + " new " + (fresh == 1 ? "lead" : "leads") : "");
        JSONObject fl = first == null ? null : lead(ws, first.optString("leadId"));
        String body = (fl == null ? "" : "First: " + fl.optString("name") + " at " + Ui.clock(Ui.ms(first.optString("due"))) + ". ") + (carried > 0 ? carried + " left over from before." : "");
        Notification n = new Notification.Builder(c, CHANNEL).setSmallIcon(R.drawable.ic_calendar_check).setColor(MainActivity.ACCENT)
            .setContentTitle(title).setContentText(body).setAutoCancel(true)
            .setContentIntent(open(c, 4201, intent("openScreen", "My day"))).build();
        post(c, 4200, n);
    }

    private static void post(Context c, int id, Notification n) {
        if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return;
        c.getSystemService(NotificationManager.class).notify(id, n);
    }

    private static Intent intent(String key, String value) { return new Intent().putExtra(key, value); }
    private static String joined(String a, String b) { String s = a.isEmpty() ? b : b.isEmpty() ? a : a + ", " + b; return s.isEmpty() ? "" : " · " + s; }
    private static String since(long t) { return Ui.dayLabel(t).equals("Today") ? "since " + Ui.clock(t) : Ui.dayLabel(t).toLowerCase(Locale.ROOT); }

    // ---- the reminder card inside the app (tapping the notification) ----

    static void showDue(MainActivity a, String taskId) {
        JSONObject t = null;
        for (JSONObject x : MyDayView.openTasks(a)) if (x.optString("id").equals(taskId)) t = x;
        if (t == null) { a.notice("This follow-up is already done or was removed."); return; }
        JSONObject lead = MyDayView.leadsById(a).get(t.optString("leadId"));
        long due = Ui.ms(t.optString("due"));
        boolean late = due > 0 && due < System.currentTimeMillis() - 5 * MINUTE;
        Sheet s = new Sheet(a, t.optString("title"), (late ? "Late since " : "Due ") + Ui.dayLabel(due).toLowerCase(Locale.ROOT) + " " + Ui.clock(due) + (lead == null ? "" : " · " + lead.optString("name")));
        if (lead != null) {
            JSONObject said = MyDayView.lastSaid(a, lead.optString("id"));
            if (said != null) {
                android.widget.TextView q = Ui.text(a, "Last said: " + said.optString("text").replaceAll("(?i)<br\\s*/?>", " ").trim(), 13, false, 0xff45444f);
                q.setPadding(a.dp(12), a.dp(10), a.dp(12), a.dp(10)); q.setBackground(a.surface(MainActivity.BG, 12)); q.setMaxLines(4);
                android.widget.LinearLayout.LayoutParams qp = new android.widget.LinearLayout.LayoutParams(-1, -2); qp.setMargins(0, a.dp(10), 0, 0); s.body.addView(q, qp);
            }
        }
        JSONObject task = t;
        s.label("Remind me again");
        android.widget.LinearLayout row = Ui.chipRow(a, s.body);
        row.addView(Ui.choice(a, "15 min", false, () -> { snooze(a, task.optString("id"), System.currentTimeMillis() + 15 * MINUTE); s.close(); toast(a, "Reminding you in 15 minutes"); }));
        row.addView(Ui.choice(a, "1 hour", false, () -> { snooze(a, task.optString("id"), System.currentTimeMillis() + HOUR); s.close(); toast(a, "Reminding you in an hour"); }));
        row.addView(Ui.choice(a, "Tomorrow", false, () -> { Calendar k = Calendar.getInstance(); k.add(Calendar.DAY_OF_YEAR, 1); k.set(Calendar.HOUR_OF_DAY, 10); k.set(Calendar.MINUTE, 0); snooze(a, task.optString("id"), k.getTimeInMillis()); s.close(); toast(a, "Reminding you tomorrow at 10 AM"); }));
        android.widget.LinearLayout links = a.horizontal(); links.setPadding(0, a.dp(8), 0, 0);
        if (lead != null) links.addView(Ui.pill(a, "Open lead", false, MainActivity.ACCENT, () -> { s.close(); LeadScreen.open(a, lead.optString("id"), lead); }), new android.widget.LinearLayout.LayoutParams(0, a.dp(44), 1));
        android.widget.TextView done = Ui.pill(a, "Mark done", false, MainActivity.MUTED, () -> { s.close(); markDone(a, task.optString("id")); });
        android.widget.LinearLayout.LayoutParams dp = new android.widget.LinearLayout.LayoutParams(0, a.dp(44), 1); dp.setMarginStart(a.dp(8)); links.addView(done, dp);
        s.body.addView(links);
        if (lead != null && !lead.optString("phone").isEmpty()) s.buttons(null, null, "Call now", () -> { s.close(); Ui.dial(a, lead.optString("phone")); });
        else s.buttons(null, null, "Close", s::close);
        s.foot.getChildAt(0).setBackground(a.surface(lead != null && !lead.optString("phone").isEmpty() ? Ui.CALL : MainActivity.ACCENT, 26));
        s.show();
    }

    static void markDone(MainActivity a, String taskId) {
        new Thread(() -> {
            try { SyncEngine.requestApi(a, "/v1/tasks/" + taskId, "PATCH", new JSONObject().put("status", "Done")); a.loadWorkspace(); schedule(a); a.runOnUiThread(() -> toast(a, "Follow-up done")); }
            catch (Exception e) { a.runOnUiThread(() -> a.notice("Could not mark it done. Check the connection and try again.")); }
        }).start();
    }

    private static void toast(MainActivity a, String s) { android.widget.Toast.makeText(a, s, android.widget.Toast.LENGTH_SHORT).show(); }
}
