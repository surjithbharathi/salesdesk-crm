package ai.salesdesk.companion;

import android.app.NotificationManager;
import android.content.*;
import org.json.JSONObject;

/** The reminder alarm, and the Snooze and Done buttons on a reminder notification. */
public class ReminderReceiver extends BroadcastReceiver {
    static final String TICK = "ai.salesdesk.companion.REMINDER_TICK", SNOOZE = "ai.salesdesk.companion.REMINDER_SNOOZE", DONE = "ai.salesdesk.companion.REMINDER_DONE";

    @Override public void onReceive(Context c, Intent intent) {
        String action = intent.getAction(), task = intent.getStringExtra("task");
        if (TICK.equals(action)) { Reminders.tick(c); return; }
        if (task == null || task.isEmpty()) return;
        c.getSystemService(NotificationManager.class).cancel(Reminders.idOf(task));
        if (SNOOZE.equals(action)) { Reminders.snooze(c, task, System.currentTimeMillis() + 15 * 60000L); return; }
        if (DONE.equals(action)) {
            PendingResult pending = goAsync();
            new Thread(() -> {
                try {
                    SyncEngine.requestApi(c, "/v1/tasks/" + task, "PATCH", new JSONObject().put("status", "Done"));
                    // mark it done in the saved workspace too, so it stops ringing before the next sync
                    JSONObject ws = Reminders.workspace(c);
                    org.json.JSONArray t = ws.optJSONArray("tasks");
                    if (t != null) for (int i = 0; i < t.length(); i++) { JSONObject x = t.optJSONObject(i); if (x != null && task.equals(x.optString("id"))) x.put("status", "Done"); }
                    SecureConfig.prefs(c).edit().putString("workspace", ws.toString()).apply();
                } catch (Exception e) {
                    // offline: ring again in 15 minutes rather than lose it
                    Reminders.snooze(c, task, System.currentTimeMillis() + 15 * 60000L);
                } finally { Reminders.schedule(c); pending.finish(); }
            }).start();
        }
    }
}
