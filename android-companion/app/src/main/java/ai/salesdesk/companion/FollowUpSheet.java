package ai.salesdesk.companion;

import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.text.InputType;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.Calendar;
import java.util.Locale;
import org.json.JSONObject;

/**
 * New follow-up: what to do (typed, or one tap on a common task), when (quick times or a picked date and time) and when to be
 * reminded. The reminder choice stays on this phone; the follow-up itself is saved in the CRM for the lead.
 */
final class FollowUpSheet {
    private static final String[] TASKS = {"Call back", "Send quotation", "Demo visit", "Payment follow-up"};
    private static final String[] REMIND = {"At the time", "10 min before", "1 hour before", "Don't remind"};
    private static final int[] REMIND_MIN = {0, 10, 60, -1};

    private final MainActivity a;
    private final Sheet s;
    private final String leadId;
    private final Runnable saved;
    private final Calendar due = Calendar.getInstance();
    private String whenKey = "tomorrow";
    private int remind = 1;
    private EditText what;
    private LinearLayout whenBox, remindBox;
    private TextView summary;

    static void open(MainActivity a, String leadId, String leadName, String title, Runnable saved) {
        new FollowUpSheet(a, leadId, leadName, title, saved).s.show();
    }

    private FollowUpSheet(MainActivity a, String leadId, String leadName, String title, Runnable saved) {
        this.a = a; this.leadId = leadId; this.saved = saved;
        s = new Sheet(a, "New follow-up", leadName);
        s.label("What to do");
        what = new EditText(a); what.setText(title == null || title.isEmpty() ? "Call back" : title); what.setSingleLine(); what.setTextSize(15); what.setTextColor(MainActivity.INK);
        what.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        android.graphics.drawable.GradientDrawable g = a.surface(android.graphics.Color.WHITE, 14); g.setStroke(a.dp(1), MainActivity.LINE); what.setBackground(g); what.setPadding(a.dp(12), 0, a.dp(12), 0);
        what.setContentDescription("What to do");
        s.body.addView(what, new LinearLayout.LayoutParams(-1, a.dp(48)));
        LinearLayout quick = Ui.chipRow(a, s.body); quick.setPadding(0, a.dp(8), 0, 0);
        for (String t : TASKS) quick.addView(Ui.choice(a, t, false, () -> { what.setText(t); what.setSelection(t.length()); }));

        s.label("When");
        whenBox = a.column(); s.body.addView(whenBox);
        summary = Ui.text(a, "", 14, true, MainActivity.ACCENT); summary.setPadding(0, a.dp(2), 0, 0); s.body.addView(summary);
        s.label("Remind me");
        remindBox = a.column(); s.body.addView(remindBox);
        setWhen("tomorrow");
        drawRemind();
        s.buttons("Cancel", null, "Save follow-up", this::save);
    }

    private void setWhen(String key) {
        whenKey = key;
        Calendar c = Calendar.getInstance(); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0);
        switch (key) {
            case "2h": c.add(Calendar.HOUR_OF_DAY, 2); c.set(Calendar.MINUTE, (c.get(Calendar.MINUTE) / 15) * 15); break;
            case "evening": c.set(Calendar.HOUR_OF_DAY, 18); c.set(Calendar.MINUTE, 30); break;
            case "tomorrow": c.add(Calendar.DAY_OF_YEAR, 1); c.set(Calendar.HOUR_OF_DAY, 10); c.set(Calendar.MINUTE, 0); break;
            case "monday": do c.add(Calendar.DAY_OF_YEAR, 1); while (c.get(Calendar.DAY_OF_WEEK) != Calendar.MONDAY); c.set(Calendar.HOUR_OF_DAY, 10); c.set(Calendar.MINUTE, 0); break;
            default: c.setTimeInMillis(due.getTimeInMillis());
        }
        due.setTimeInMillis(c.getTimeInMillis());
        drawWhen();
    }

    private void drawWhen() {
        whenBox.removeAllViews();
        LinearLayout row = Ui.chipRow(a, whenBox);
        row.addView(Ui.choice(a, "In 2 hours", whenKey.equals("2h"), () -> setWhen("2h")));
        if (Calendar.getInstance().get(Calendar.HOUR_OF_DAY) < 18) row.addView(Ui.choice(a, "Today 6:30 PM", whenKey.equals("evening"), () -> setWhen("evening")));
        row.addView(Ui.choice(a, "Tomorrow 10 AM", whenKey.equals("tomorrow"), () -> setWhen("tomorrow")));
        row.addView(Ui.choice(a, "Monday", whenKey.equals("monday"), () -> setWhen("monday")));
        row.addView(Ui.choice(a, "Pick date", whenKey.equals("pick"), this::pick));
        summary.setText(Ui.dayLabel(due.getTimeInMillis()) + " · " + Ui.clock(due.getTimeInMillis()));
    }

    private void pick() {
        new DatePickerDialog(a, (p, y, m, d) -> { due.set(y, m, d);
            new TimePickerDialog(a, (c, h, min) -> { due.set(Calendar.HOUR_OF_DAY, h); due.set(Calendar.MINUTE, min); whenKey = "pick"; drawWhen(); },
                due.get(Calendar.HOUR_OF_DAY), due.get(Calendar.MINUTE), android.text.format.DateFormat.is24HourFormat(a)).show();
        }, due.get(Calendar.YEAR), due.get(Calendar.MONTH), due.get(Calendar.DAY_OF_MONTH)).show();
    }

    private void drawRemind() {
        remindBox.removeAllViews();
        LinearLayout row = Ui.chipRow(a, remindBox);
        for (int i = 0; i < REMIND.length; i++) { int k = i; row.addView(Ui.choice(a, REMIND[i], remind == i, () -> { remind = k; drawRemind(); })); }
    }

    private void save() {
        String title = what.getText().toString().trim();
        if (title.isEmpty()) { what.setError("Write what to do"); return; }
        if (due.getTimeInMillis() < System.currentTimeMillis() - 60000) { a.notice("Pick a time that has not passed yet."); return; }
        String when = due.toInstant().toString();
        int minutes = REMIND_MIN[remind];
        s.close();
        new Thread(() -> {
            try {
                JSONObject r = SyncEngine.requestApi(a, "/v1/tasks", "POST", new JSONObject().put("leadId", leadId).put("title", title).put("due", when));
                Reminders.setOffset(a, r.optString("id"), minutes);
                a.runOnUiThread(() -> android.widget.Toast.makeText(a, "Follow-up saved for " + Ui.dayLabel(due.getTimeInMillis()).toLowerCase(Locale.ROOT) + " " + Ui.clock(due.getTimeInMillis()), android.widget.Toast.LENGTH_SHORT).show());
                try { a.loadWorkspace(); } catch (Exception ignored) { /* the next sync shows it */ }
                Reminders.schedule(a);
                if (saved != null) a.runOnUiThread(saved);
            } catch (Exception e) {
                a.runOnUiThread(() -> a.notice(e instanceof SyncEngine.HttpError && ((SyncEngine.HttpError) e).code == 403 ? "Only the lead's owner can add a follow-up." : "Could not save the follow-up. Check the connection and try again."));
            }
        }).start();
    }
}
