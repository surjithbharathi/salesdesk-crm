package ai.salesdesk.companion;

import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.app.Dialog;
import android.app.TimePickerDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.Calendar;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * One lead, laid out like the web CRM's lead page: name, stage and owner on top; the action bar (Call, WhatsApp, Note,
 * Follow-up); the lead's details (tap one to change it); then the activity history and open follow-ups. The lead is read
 * from the CRM each time, so it opens for any lead the person may see, with its full history, imported history included.
 */
final class LeadScreen {
    private static final String[][] STAGES = {{"New", "New"}, {"Prospecting", "Discussion"}, {"Opportunity", "Interested customer"}, {"Quotation given", "Quotation given"}, {"Closed", "Closed"}};
    private static final String[] STATES = {"Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand",
        "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan",
        "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
        "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry"};
    private static final String[] LANGUAGES = {"Tamil", "Telugu", "Kannada", "Malayalam", "Hindi", "Marathi", "Gujarati", "Bengali", "Odia", "Punjabi", "Assamese", "English", "Urdu", "Konkani"};

    private final MainActivity a;
    private final String id;
    private JSONObject lead, data;
    private Dialog dialog;
    private LinearLayout header, body;
    private boolean showTasks;

    static void open(MainActivity a, String id, JSONObject fromPhone) {
        if (id == null || id.isEmpty()) return;
        new LeadScreen(a, id, fromPhone).show();
    }

    private LeadScreen(MainActivity a, String id, JSONObject fromPhone) {
        this.a = a;
        this.id = id;
        this.lead = fromPhone == null ? new JSONObject() : fromPhone;
    }

    private int dp(int n) { return a.dp(n); }

    private void show() {
        dialog = new Dialog(a, android.R.style.Theme_Material_Light_NoActionBar);
        LinearLayout root = a.column();
        root.setBackgroundColor(MainActivity.BG);
        header = a.column();
        header.setBackgroundColor(MainActivity.BAR);
        header.setPadding(dp(16), dp(12), dp(16), dp(16));
        root.addView(header, new LinearLayout.LayoutParams(-1, -2));
        ScrollView scroll = new ScrollView(a);
        body = a.column();
        body.setPadding(dp(14), dp(14), dp(14), dp(28));
        scroll.addView(body);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        dialog.setContentView(root);
        Window w = dialog.getWindow();
        if (w != null) {
            w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            w.setStatusBarColor(MainActivity.BAR);
            w.setNavigationBarColor(MainActivity.BAR);
        }
        dialog.show();
        draw();
        load();
    }

    private void load() {
        new Thread(() -> {
            try {
                JSONObject r = SyncEngine.requestApi(a, "/v1/leads/" + id, "GET", null);
                a.runOnUiThread(() -> { data = r; lead = r.optJSONObject("lead") == null ? lead : r.optJSONObject("lead"); if (dialog.isShowing()) draw(); });
            } catch (Exception e) {
                a.runOnUiThread(() -> { if (dialog.isShowing()) { data = new JSONObject(); draw(); note(problem(e)); } });
            }
        }).start();
    }

    private String problem(Exception e) {
        if (e instanceof SyncEngine.HttpError) {
            int code = ((SyncEngine.HttpError) e).code;
            if (code == 403) return "Only the lead's owner can do this.";
            if (code == 404) return "This lead is no longer in the CRM.";
            if (code == 409) return "Another lead already has this number.";
        }
        return "Could not reach the CRM. Check the connection and try again.";
    }

    private boolean canEdit() { return data != null && data.optBoolean("canEdit"); }

    private String stageLabel() {
        String stage = lead.optString("stage", "New");
        if (!lead.optString("deal").isEmpty()) return lead.optString("deal");
        if (stage.equals("Closed") && !lead.optString("disposition").isEmpty()) return lead.optString("disposition");
        for (String[] s : STAGES) if (s[0].equals(stage)) return s[1];
        return stage;
    }

    private String digits() { return lead.optString("phone").replaceAll("\\D", ""); }

    private String phoneLabel() {
        if (!lead.optString("countryCode").isEmpty() && !lead.optString("mobileNumber").isEmpty()) return "+" + lead.optString("countryCode") + " " + lead.optString("mobileNumber");
        String d = digits();
        return d.isEmpty() ? "" : "+" + d;
    }

    // ---- drawing ----

    private void draw() {
        drawHeader();
        body.removeAllViews();
        actions();
        details();
        tabs();
        if (data == null) { TextView t = text(body, "Loading the lead…", 13, false); t.setTextColor(MainActivity.MUTED); return; }
        if (showTasks) tasks(); else history();
    }

    private void drawHeader() {
        header.removeAllViews();
        LinearLayout top = a.horizontal();
        TextView back = new TextView(a);
        back.setText("‹  Back");
        back.setTextSize(15);
        back.setTextColor(MainActivity.BARACCENT);
        back.setPadding(0, dp(6), dp(16), dp(6));
        back.setOnClickListener(v -> dialog.dismiss());
        back.setContentDescription("Close the lead");
        top.addView(back);
        header.addView(top);
        TextView name = new TextView(a);
        name.setText(lead.optString("name", "Lead"));
        name.setTextSize(24);
        name.setTextColor(MainActivity.ONBAR);
        name.setTypeface(Typeface.create(MainActivity.CONDENSED ? "sans-serif-condensed" : "sans-serif", Typeface.BOLD));
        name.setPadding(0, dp(6), 0, 0);
        header.addView(name);
        TextView phone = new TextView(a);
        phone.setText(phoneLabel());
        phone.setTextSize(14);
        phone.setTextColor(MainActivity.BARMUTED);
        header.addView(phone);
        LinearLayout chips = a.horizontal();
        chips.setPadding(0, dp(10), 0, 0);
        chip(chips, stageLabel() + (canEdit() ? "  ▾" : ""), true, canEdit() ? this::chooseStage : null);
        String owner = lead.optString("ownerName");
        chip(chips, owner.isEmpty() ? (lead.optString("owner").isEmpty() ? "Unassigned" : "Owner") : owner, false, null);
        header.addView(chips);
    }

    private void chip(LinearLayout row, String label, boolean strong, Runnable action) {
        TextView t = new TextView(a);
        t.setText(label);
        t.setTextSize(13);
        t.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        t.setTextColor(strong ? MainActivity.ONACCENT : MainActivity.ONBAR);
        t.setPadding(dp(12), dp(7), dp(12), dp(7));
        GradientDrawable bg = a.surface(strong ? MainActivity.ACCENT : MainActivity.BARCHIP, 16);
        t.setBackground(bg);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2, -2);
        p.setMargins(0, 0, dp(8), 0);
        row.addView(t, p);
        if (action != null) { t.setOnClickListener(v -> action.run()); t.setMinHeight(dp(36)); }
    }

    private LinearLayout box() {
        LinearLayout c = a.column();
        c.setPadding(dp(16), dp(12), dp(16), dp(12));
        GradientDrawable bg = a.surface(Color.WHITE, MainActivity.RADIUS);
        bg.setStroke(dp(1), MainActivity.LINE);
        c.setBackground(bg);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
        p.setMargins(0, 0, 0, dp(12));
        body.addView(c, p);
        return c;
    }

    private TextView text(LinearLayout parent, String value, int size, boolean bold) { return a.text(parent, value, size, bold); }

    private void actions() {
        LinearLayout c = box();
        c.setPadding(dp(4), dp(4), dp(4), dp(4));
        LinearLayout row = a.horizontal();
        action(row, "Call", MainActivity.LEAF, this::call);
        action(row, "WhatsApp", MainActivity.LEAF, this::whatsApp);
        action(row, "Add note", MainActivity.PURPLE, this::addNote);
        action(row, "Follow-up", MainActivity.PURPLE, this::followUp);
        c.addView(row);
    }

    private void action(LinearLayout row, String label, int color, Runnable run) {
        TextView t = new TextView(a);
        t.setText(label);
        t.setTextSize(13);
        t.setGravity(Gravity.CENTER);
        t.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        t.setTextColor(color);
        t.setMinHeight(dp(48));
        t.setPadding(dp(2), dp(12), dp(2), dp(12));
        t.setBackground(new android.graphics.drawable.RippleDrawable(android.content.res.ColorStateList.valueOf(0x18e9a800), null, a.surface(Color.WHITE, 8)));
        t.setOnClickListener(v -> run.run());
        row.addView(t, new LinearLayout.LayoutParams(0, -2, 1));
    }

    private void details() {
        LinearLayout c = box();
        TextView title = text(c, "Details", 15, true);
        title.setPadding(0, 0, 0, dp(4));
        field(c, "Phone", phoneLabel(), null);
        field(c, "Email", lead.optString("email"), "email");
        field(c, "Business", lead.optString("company"), "company");
        field(c, "City", lead.optString("city"), "city");
        field(c, "State", lead.optString("state"), "state");
        if (lead.optString("state").isEmpty() && !lead.optString("probableState").isEmpty()) probable(c);
        String language = lead.optString("language");
        field(c, "Language", language.isEmpty() ? "" : language + ("call".equals(lead.optString("languageFrom")) ? "  (heard on a call)" : ""), "language");
        field(c, "Source", lead.optString("source"), null);
        if (lead.optLong("value", 0) > 0) field(c, "Value", "₹" + String.format(Locale.ENGLISH, "%,d", lead.optLong("value")), null);
        if (!lead.optString("createdAt").isEmpty()) field(c, "Created", a.dateLabel(lead.optString("createdAt")), null);
        if (data != null && !canEdit()) { TextView t = text(c, lead.optString("owner").isEmpty() ? "Unassigned lead: only its owner can change it." : "View only: this lead belongs to " + lead.optString("ownerName", "a colleague") + ".", 12, false); t.setTextColor(MainActivity.MUTED); }
    }

    private void field(LinearLayout parent, String label, String value, String key) {
        LinearLayout row = a.horizontal();
        row.setPadding(0, dp(8), 0, dp(8));
        TextView l = new TextView(a);
        l.setText(label);
        l.setTextSize(13);
        l.setTextColor(MainActivity.MUTED);
        row.addView(l, new LinearLayout.LayoutParams(dp(96), -2));
        TextView v = new TextView(a);
        boolean editable = key != null && canEdit();
        v.setText(value.isEmpty() ? (editable ? "Add" : "—") : value);
        v.setTextSize(15);
        v.setTextColor(value.isEmpty() && editable ? MainActivity.PURPLE : MainActivity.INK);
        row.addView(v, new LinearLayout.LayoutParams(0, -2, 1));
        if (editable) { row.setOnClickListener(x -> edit(label, key)); row.setContentDescription("Change " + label); row.setMinimumHeight(dp(44)); }
        View line = new View(a);
        line.setBackgroundColor(MainActivity.LINE);
        parent.addView(row);
        parent.addView(line, new LinearLayout.LayoutParams(-1, 1));
    }

    private void probable(LinearLayout parent) {
        LinearLayout row = a.column();
        row.setPadding(0, dp(8), 0, dp(8));
        TextView t = text(row, "Probable state · " + lead.optString("probableState") + "  (from the mobile number series)", 13, false);
        t.setTextColor(MainActivity.MUTED);
        if (canEdit()) {
            LinearLayout buttons = a.horizontal();
            for (String s : lead.optString("probableState").split("\\s*/\\s*")) {
                if (s.isEmpty()) continue;
                TextView b = new TextView(a);
                b.setText("Use " + s);
                b.setTextSize(13);
                b.setTextColor(MainActivity.PURPLE);
                b.setPadding(dp(12), dp(8), dp(12), dp(8));
                GradientDrawable bg = a.surface(Color.WHITE, 8);
                bg.setStroke(dp(1), MainActivity.LINE);
                b.setBackground(bg);
                LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2, -2);
                p.setMargins(0, dp(4), dp(8), 0);
                buttons.addView(b, p);
                b.setOnClickListener(v -> save("PATCH", "/v1/leads/" + id, put("state", s), "State saved"));
            }
            row.addView(buttons);
        }
        parent.addView(row);
    }

    private void tabs() {
        LinearLayout row = a.horizontal();
        row.setPadding(0, dp(4), 0, dp(8));
        JSONArray acts = data == null ? new JSONArray() : data.optJSONArray("activities");
        JSONArray tasks = data == null ? new JSONArray() : data.optJSONArray("tasks");
        tab(row, "Activity history" + (acts == null ? "" : " (" + acts.length() + ")"), !showTasks, () -> { showTasks = false; draw(); });
        tab(row, "Follow-ups" + (tasks == null ? "" : " (" + tasks.length() + ")"), showTasks, () -> { showTasks = true; draw(); });
        body.addView(row);
    }

    private void tab(LinearLayout row, String label, boolean on, Runnable run) {
        TextView t = new TextView(a);
        t.setText(label);
        t.setTextSize(14);
        t.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        t.setTextColor(on ? MainActivity.ONACCENT : MainActivity.PURPLE);
        t.setPadding(dp(14), dp(9), dp(14), dp(9));
        t.setBackground(a.surface(on ? MainActivity.ACCENT : MainActivity.SOFT, 18));
        t.setMinHeight(dp(40));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2, -2);
        p.setMargins(0, 0, dp(8), 0);
        row.addView(t, p);
        t.setOnClickListener(v -> run.run());
    }

    private void history() {
        JSONArray acts = data.optJSONArray("activities");
        if (acts == null || acts.length() == 0) { TextView t = text(body, "No activity yet. Call, add a note or plan a follow-up.", 13, false); t.setTextColor(MainActivity.MUTED); return; }
        for (int i = 0; i < acts.length(); i++) {
            JSONObject item = acts.optJSONObject(i);
            if (item == null) continue;
            LinearLayout c = box();
            String type = item.optString("type", "Activity");
            boolean missed = type.equals("Call") && ("No answer".equals(item.optString("outcome")) || "Missed".equals(item.optString("direction")) || "Rejected".equals(item.optString("direction")));
            String title = type.equals("Call") ? (missed ? "Missed call" : (item.optString("direction").isEmpty() ? "" : item.optString("direction") + " ") + "call") : type.equals("System") ? "Update" : type;
            int secs = item.optInt("duration", 0);
            if (type.equals("Call") && secs > 0) title += " · " + (secs >= 60 ? secs / 60 + "m " : "") + secs % 60 + "s";
            TextView head = text(c, title, 14, true);
            head.setTextColor(missed ? MainActivity.RED : type.equals("Call") ? MainActivity.LEAF : MainActivity.INK);
            String when = item.optString("occurredAt", item.optString("createdAt"));
            String meta = a.joined(item.optString("by"), when.isEmpty() ? "" : a.dateLabel(when));
            if (!item.optString("importedFrom").isEmpty()) meta = a.joined(meta, "from " + item.optString("importedFrom"));
            if (!meta.isEmpty()) { TextView m = text(c, meta, 12, false); m.setTextColor(MainActivity.MUTED); }
            String words = item.optString("text").replace("<br>", "\n").replace("<br/>", "\n").trim();
            if (!words.isEmpty() && !words.startsWith("Phone sync ·")) text(c, words, 14, false);
            if (!item.optString("recordingId").isEmpty()) small(c, "▶  Play recording", () -> a.remotePlay(item.optString("recordingId")));
            if (!item.optString("voiceNoteId").isEmpty()) small(c, "▶  Play voice note", () -> a.playVoiceFeedback(item.optString("voiceNoteId")));
        }
    }

    private void tasks() {
        JSONArray tasks = data.optJSONArray("tasks");
        if (tasks == null || tasks.length() == 0) { TextView t = text(body, "No open follow-ups. Tap Follow-up to plan the next call.", 13, false); t.setTextColor(MainActivity.MUTED); return; }
        for (int i = 0; i < tasks.length(); i++) {
            JSONObject t = tasks.optJSONObject(i);
            if (t == null) continue;
            LinearLayout c = box();
            text(c, t.optString("title"), 15, true);
            TextView due = text(c, a.dateLabel(t.optString("due")), 13, false);
            due.setTextColor(MainActivity.MUTED);
            if (canEdit()) small(c, "Mark as done", () -> save("PATCH", "/v1/tasks/" + t.optString("id"), put("status", "Done"), "Follow-up done"));
        }
    }

    private void small(LinearLayout parent, String label, Runnable run) {
        TextView b = new TextView(a);
        b.setText(label);
        b.setTextSize(13);
        b.setTextColor(MainActivity.PURPLE);
        b.setPadding(0, dp(10), 0, dp(4));
        b.setMinHeight(dp(40));
        b.setOnClickListener(v -> run.run());
        parent.addView(b);
    }

    // ---- actions ----

    private void call() {
        String d = digits();
        if (d.isEmpty()) { note("This lead has no phone number."); return; }
        boolean direct = a.checkSelfPermission(android.Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED;
        try { a.startActivity(new Intent(direct ? Intent.ACTION_CALL : Intent.ACTION_DIAL, Uri.fromParts("tel", "+" + d, null))); }
        catch (Exception e) { a.startActivity(new Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", "+" + d, null))); }
    }

    private void whatsApp() {
        String d = digits();
        if (d.isEmpty()) { note("This lead has no phone number."); return; }
        try { a.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/" + d))); }
        catch (Exception e) { note("WhatsApp is not installed on this phone."); }
    }

    private boolean owned() {
        if (canEdit()) return true;
        note(data == null ? "Loading the lead. Try again in a moment." : "Only the lead's owner can do this.");
        return false;
    }

    private void addNote() {
        if (!owned()) return;
        LinearLayout b = a.column();
        b.setPadding(dp(20), dp(8), dp(20), 0);
        EditText note = new EditText(a);
        note.setHint("What did the customer say?");
        note.setMinLines(3);
        b.addView(note);
        new AlertDialog.Builder(a).setTitle("Add note").setView(b).setNegativeButton("Cancel", null)
            .setPositiveButton("Save", (d, w) -> { String text = note.getText().toString().trim(); if (!text.isEmpty()) save("POST", "/v1/notes", put("leadId", id, "text", text), "Note saved"); }).show();
    }

    private void followUp() {
        if (!owned()) return;
        LinearLayout b = a.column();
        b.setPadding(dp(20), dp(8), dp(20), 0);
        EditText title = new EditText(a);
        title.setText("Call " + lead.optString("name"));
        b.addView(title);
        Calendar due = Calendar.getInstance();
        due.add(Calendar.DAY_OF_YEAR, 1);
        due.set(Calendar.HOUR_OF_DAY, 11);
        due.set(Calendar.MINUTE, 0);
        due.set(Calendar.SECOND, 0);
        due.set(Calendar.MILLISECOND, 0);
        TextView when = text(b, a.dateLabel(due.toInstant().toString()), 15, true);
        when.setTextColor(MainActivity.PURPLE);
        when.setPadding(0, dp(12), 0, dp(12));
        when.setOnClickListener(v -> new DatePickerDialog(a, (p, y, m, d) -> { due.set(y, m, d);
            new TimePickerDialog(a, (c, h, min) -> { due.set(Calendar.HOUR_OF_DAY, h); due.set(Calendar.MINUTE, min); when.setText(a.dateLabel(due.toInstant().toString())); },
                due.get(Calendar.HOUR_OF_DAY), due.get(Calendar.MINUTE), android.text.format.DateFormat.is24HourFormat(a)).show();
        }, due.get(Calendar.YEAR), due.get(Calendar.MONTH), due.get(Calendar.DAY_OF_MONTH)).show());
        TextView hint = text(b, "Tap the date to change it.", 12, false);
        hint.setTextColor(MainActivity.MUTED);
        new AlertDialog.Builder(a).setTitle("Plan a follow-up").setView(b).setNegativeButton("Cancel", null)
            .setPositiveButton("Save", (d, w) -> { String t = title.getText().toString().trim(); save("POST", "/v1/tasks", put("leadId", id, "title", t.isEmpty() ? "Follow up" : t, "due", due.toInstant().toString()), "Follow-up saved"); }).show();
    }

    private void chooseStage() {
        String[] labels = new String[STAGES.length];
        for (int i = 0; i < STAGES.length; i++) labels[i] = STAGES[i][1];
        new AlertDialog.Builder(a).setTitle("Stage").setItems(labels, (d, w) -> save("PATCH", "/v1/leads/" + id, put("stage", STAGES[w][0]), "Stage changed")).show();
    }

    private void edit(String label, String key) {
        if (key.equals("state") || key.equals("language")) {
            String[] items = key.equals("state") ? STATES : LANGUAGES;
            new AlertDialog.Builder(a).setTitle(label).setItems(items, (d, w) -> save("PATCH", "/v1/leads/" + id, put(key, items[w]), label + " saved")).show();
            return;
        }
        LinearLayout b = a.column();
        b.setPadding(dp(20), dp(8), dp(20), 0);
        EditText e = new EditText(a);
        e.setSingleLine();
        e.setText(lead.optString(key));
        if (key.equals("email")) e.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        b.addView(e);
        new AlertDialog.Builder(a).setTitle(label).setView(b).setNegativeButton("Cancel", null)
            .setPositiveButton("Save", (d, w) -> save("PATCH", "/v1/leads/" + id, put(key, e.getText().toString().trim()), label + " saved")).show();
    }

    private static JSONObject put(String... pairs) {
        JSONObject o = new JSONObject();
        try { for (int i = 0; i + 1 < pairs.length; i += 2) o.put(pairs[i], pairs[i + 1]); } catch (Exception ignored) {}
        return o;
    }

    private void save(String method, String path, JSONObject payload, String done) {
        new Thread(() -> {
            try {
                SyncEngine.requestApi(a, path, method, payload);
                a.runOnUiThread(() -> android.widget.Toast.makeText(a, done, android.widget.Toast.LENGTH_SHORT).show());
                load();
                try { a.loadWorkspace(); a.runOnUiThread(a::render); } catch (Exception ignored) { /* the lead screen already shows the change */ }
            } catch (Exception e) {
                a.runOnUiThread(() -> note(problem(e)));
            }
        }).start();
    }

    private void note(String s) { new AlertDialog.Builder(a).setMessage(s).setPositiveButton("OK", null).show(); }
}
