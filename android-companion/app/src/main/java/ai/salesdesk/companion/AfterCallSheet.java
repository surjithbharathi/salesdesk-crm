package ai.salesdesk.companion;

import android.text.InputType;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.Calendar;
import org.json.JSONObject;

/**
 * "How did the call go?": one tap for the outcome, one for the next follow-up (picked for you from the outcome), and a line
 * on what was said. Saving adds a note to the lead, the follow-up if any, and moves the stage when the outcome says so.
 */
final class AfterCallSheet {
    private static final String[] OUTCOMES = {"Interested", "Call back later", "Quotation sent", "Not interested", "Wrong number", "Busy / no answer"};
    private static final String[][] NEXT = {{"2h", "In 2 hours"}, {"tomorrow", "Tomorrow 10 AM"}, {"3d", "In 3 days"}, {"none", "No follow-up"}};

    private final MainActivity a;
    private final Sheet s;
    private final String leadId, name;
    private String outcome = "", next = "tomorrow";
    private LinearLayout outcomeBox, nextBox;
    private EditText said;

    /** For a call with a lead; a number that is not a lead is offered "Add as lead" first. */
    static void open(MainActivity a, String leadId, String name, String number, long seconds) {
        if (leadId == null || leadId.isEmpty()) {
            new android.app.AlertDialog.Builder(a).setTitle("Not a lead yet").setMessage(MainActivity.prettyNumber(number) + " is not in Salesdesk. Add it as a lead to keep this call and log how it went.")
                .setNegativeButton("Not now", null).setPositiveButton("Add as lead", (d, w) -> a.leadForm(number)).show();
            return;
        }
        new AfterCallSheet(a, leadId, name, seconds).s.show();
    }

    private AfterCallSheet(MainActivity a, String leadId, String name, long seconds) {
        this.a = a; this.leadId = leadId; this.name = name;
        s = new Sheet(a, "How did the call go?", name + (seconds > 0 ? " · talked " + (seconds >= 60 ? seconds / 60 + "m " : "") + seconds % 60 + "s" : seconds == 0 ? " · not answered" : ""));
        if (seconds == 0) outcome = "Busy / no answer";
        s.label("Outcome");
        outcomeBox = a.column(); s.body.addView(outcomeBox);
        s.label("Next follow-up");
        nextBox = a.column(); s.body.addView(nextBox);
        s.label("What was said");
        said = new EditText(a); said.setHint("Wants 5 HP with installation, checking with partner"); said.setMinLines(2); said.setTextSize(15); said.setTextColor(MainActivity.INK);
        said.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        android.graphics.drawable.GradientDrawable g = a.surface(android.graphics.Color.WHITE, 14); g.setStroke(a.dp(1), MainActivity.LINE); said.setBackground(g); said.setPadding(a.dp(12), a.dp(10), a.dp(12), a.dp(10));
        said.setContentDescription("What was said");
        s.body.addView(said, new LinearLayout.LayoutParams(-1, -2));
        pickOutcome(outcome);
        s.buttons("Skip", null, "Save", this::save);
    }

    private void pickOutcome(String o) {
        outcome = o;
        // a sensible next step for each outcome; the person can still change it
        if (o.equals("Interested") || o.equals("Quotation sent")) next = o.equals("Quotation sent") ? "3d" : "tomorrow";
        else if (o.equals("Call back later")) next = "tomorrow";
        else if (o.equals("Busy / no answer")) next = "2h";
        else if (o.equals("Not interested") || o.equals("Wrong number")) next = "none";
        outcomeBox.removeAllViews();
        for (int i = 0; i < OUTCOMES.length; i += 2) {
            LinearLayout row = new LinearLayout(a);
            for (int j = i; j < Math.min(i + 2, OUTCOMES.length); j++) {
                String k = OUTCOMES[j];
                TextView t = s.option(k, k.equals(outcome), () -> pickOutcome(k));
                LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, a.dp(48), 1); p.setMargins(0, 0, j == i ? a.dp(8) : 0, a.dp(8));
                row.addView(t, p);
            }
            outcomeBox.addView(row);
        }
        drawNext();
    }

    private void drawNext() {
        nextBox.removeAllViews();
        LinearLayout row = Ui.chipRow(a, nextBox);
        for (String[] n : NEXT) row.addView(Ui.choice(a, n[1], next.equals(n[0]), () -> { next = n[0]; drawNext(); }));
    }

    private void save() {
        if (outcome.isEmpty()) { a.notice("Tap how the call went."); return; }
        String words = said.getText().toString().trim();
        String note = "Call outcome: " + outcome + (words.isEmpty() ? "" : ". " + words);
        Calendar due = Calendar.getInstance(); due.set(Calendar.SECOND, 0); due.set(Calendar.MILLISECOND, 0);
        if (next.equals("2h")) { due.add(Calendar.HOUR_OF_DAY, 2); due.set(Calendar.MINUTE, (due.get(Calendar.MINUTE) / 15) * 15); }
        else if (next.equals("tomorrow")) { due.add(Calendar.DAY_OF_YEAR, 1); due.set(Calendar.HOUR_OF_DAY, 10); due.set(Calendar.MINUTE, 0); }
        else if (next.equals("3d")) { due.add(Calendar.DAY_OF_YEAR, 3); due.set(Calendar.HOUR_OF_DAY, 10); due.set(Calendar.MINUTE, 0); }
        String task = outcome.equals("Quotation sent") ? "Follow up on the quotation" : outcome.equals("Busy / no answer") ? "Try calling again" : outcome.equals("Interested") ? "Call back, interested" : "Call back";
        String stage = outcome.equals("Interested") ? "Opportunity" : outcome.equals("Quotation sent") ? "Quotation given" : "";
        boolean follow = !next.equals("none");
        s.close();
        new Thread(() -> {
            try {
                SyncEngine.requestApi(a, "/v1/notes", "POST", new JSONObject().put("leadId", leadId).put("text", note));
                if (follow) {
                    JSONObject r = SyncEngine.requestApi(a, "/v1/tasks", "POST", new JSONObject().put("leadId", leadId).put("title", task).put("due", due.toInstant().toString()));
                    Reminders.setOffset(a, r.optString("id"), 10);
                }
                if (!stage.isEmpty()) try { SyncEngine.requestApi(a, "/v1/leads/" + leadId, "PATCH", new JSONObject().put("stage", stage)); } catch (Exception ignored) { /* a colleague's lead keeps its stage */ }
                a.runOnUiThread(() -> android.widget.Toast.makeText(a, follow ? "Saved. Follow-up " + Ui.dayLabel(due.getTimeInMillis()).toLowerCase(java.util.Locale.ROOT) + " " + Ui.clock(due.getTimeInMillis()) : "Saved", android.widget.Toast.LENGTH_SHORT).show());
                try { a.loadWorkspace(); } catch (Exception ignored) { /* the next sync shows it */ }
                Reminders.schedule(a);
            } catch (Exception e) {
                a.runOnUiThread(() -> a.notice(e instanceof SyncEngine.HttpError && ((SyncEngine.HttpError) e).code == 403 ? "Only the lead's owner can log this call." : "Could not save. Check the connection and try again."));
            }
        }).start();
    }
}
