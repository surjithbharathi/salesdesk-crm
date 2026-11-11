package ai.salesdesk.companion;

import android.app.AlertDialog;
import android.app.Dialog;
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
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * One lead: a white header with who it is, the stage and owner, the four actions (Call, WhatsApp, Note, Follow-up) and the
 * tabs Activity (the history as a conversation), Details (tap one to change it) and Follow-ups. The lead is read
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
    private String tab = "activity";

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
        root.setBackgroundColor(android.graphics.Color.WHITE);
        Ui.clearBars(root, true, true);
        header = a.column();
        header.setBackgroundColor(android.graphics.Color.WHITE);
        header.setPadding(dp(4), dp(4), dp(4), 0);
        root.addView(header, new LinearLayout.LayoutParams(-1, -2));
        View edge = new View(a); edge.setBackgroundColor(MainActivity.LINE);
        root.addView(edge, new LinearLayout.LayoutParams(-1, 1));
        ScrollView scroll = new ScrollView(a);
        scroll.setFillViewport(true);
        body = a.column();
        body.setPadding(dp(12), dp(12), dp(12), dp(28));
        scroll.addView(body);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        dialog.setContentView(root);
        Window w = dialog.getWindow();
        if (w != null) {
            w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            w.setStatusBarColor(android.graphics.Color.WHITE);
            w.setNavigationBarColor(android.graphics.Color.WHITE);
            if (MainActivity.LIGHTBARS) w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
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
        body.setBackgroundColor(MainActivity.BG);
        if (data == null) { TextView t = text(body, "Loading the lead…", 13, false); t.setTextColor(MainActivity.MUTED); if (tab.equals("details")) details(); return; }
        if (tab.equals("details")) details(); else if (tab.equals("followups")) tasks(); else history();
    }

    // the white header: back and the lead menu, who it is, the four actions, then the tabs
    private void drawHeader() {
        header.removeAllViews();
        LinearLayout top = a.horizontal();
        android.widget.ImageButton back = new android.widget.ImageButton(a);
        back.setImageResource(R.drawable.ic_chevron_left); back.setColorFilter(MainActivity.INK); back.setBackground(null);
        back.setContentDescription("Back"); back.setOnClickListener(v -> dialog.dismiss());
        top.addView(back, new LinearLayout.LayoutParams(dp(44), dp(44)));
        top.addView(new View(a), new LinearLayout.LayoutParams(0, 1, 1));
        if (data != null && (data.optBoolean("canArchive") || data.optBoolean("canDelete"))) {
            TextView more = new TextView(a);
            more.setText("⋮"); more.setTextSize(22); more.setTypeface(Typeface.DEFAULT_BOLD); more.setTextColor(MainActivity.INK); more.setGravity(Gravity.CENTER);
            more.setContentDescription("More: archive, delete, block number");
            more.setOnClickListener(v -> moreMenu(more));
            top.addView(more, new LinearLayout.LayoutParams(dp(44), dp(44)));
        }
        header.addView(top);

        LinearLayout who = a.horizontal(); who.setPadding(dp(8), 0, dp(8), dp(14));
        who.addView(Ui.avatar(a, lead.optString("name", "Lead"), true, 56));
        LinearLayout names = a.column(); names.setPadding(dp(14), 0, 0, 0);
        TextView name = Ui.text(a, lead.optString("name", "Lead"), 21, true, MainActivity.INK); name.setTypeface(Typeface.DEFAULT_BOLD); names.addView(name);
        String place = a.joined(lead.optString("company"), a.joined(lead.optString("city"), lead.optString("state")));
        TextView sub = Ui.text(a, a.joined(phoneLabel(), place), 13, false, MainActivity.MUTED); sub.setPadding(0, dp(2), 0, dp(6)); names.addView(sub);
        LinearLayout chips = a.horizontal();
        int[] sc = Ui.stageColours(stageLabel());
        TextView stage = Ui.chip(a, stageLabel() + (canEdit() ? "  ▾" : ""), sc[0], sc[1]); stage.setPadding(dp(10), dp(5), dp(10), dp(5));
        if (canEdit()) { stage.setOnClickListener(v -> chooseStage()); stage.setContentDescription("Stage " + stageLabel() + ". Change stage"); }
        chips.addView(stage);
        String owner = lead.optString("ownerName");
        TextView ow = Ui.chip(a, owner.isEmpty() ? (lead.optString("owner").isEmpty() ? "Unassigned" : "Owner") : owner, MainActivity.NEUTRAL, 0xff45525c); ow.setPadding(dp(10), dp(5), dp(10), dp(5)); chips.addView(ow);
        names.addView(chips);
        who.addView(names, new LinearLayout.LayoutParams(0, -2, 1));
        header.addView(who);

        LinearLayout row = a.horizontal(); row.setPadding(dp(8), dp(2), dp(8), dp(14));
        action(row, "Call", R.drawable.ic_phone, Ui.CALL, android.graphics.Color.WHITE, this::call);
        action(row, "WhatsApp", R.drawable.ic_message, Ui.CALL_SOFT, Ui.CALL_INK, this::whatsApp);
        action(row, "Note", R.drawable.ic_note, MainActivity.SOFT, MainActivity.ACCENT, this::addNote);
        action(row, "Follow-up", R.drawable.ic_calendar_check, MainActivity.SOFT, MainActivity.ACCENT, this::followUp);
        header.addView(row);

        LinearLayout tabs = a.horizontal();
        JSONArray tasks = data == null ? null : data.optJSONArray("tasks");
        tabButton(tabs, "Activity", "activity");
        tabButton(tabs, "Details", "details");
        tabButton(tabs, "Follow-ups" + (tasks == null || tasks.length() == 0 ? "" : " " + tasks.length()), "followups");
        header.addView(tabs);
    }

    private void action(LinearLayout row, String label, int icon, int bg, int fg, Runnable run) {
        LinearLayout cell = a.column(); cell.setGravity(Gravity.CENTER_HORIZONTAL);
        ImageView i = a.glyph(icon, fg); i.setPadding(dp(14), dp(14), dp(14), dp(14)); i.setBackground(a.surface(bg, 16));
        cell.addView(i, new LinearLayout.LayoutParams(dp(52), dp(52)));
        TextView t = Ui.text(a, label, 12, true, MainActivity.INK); t.setPadding(0, dp(6), 0, 0); cell.addView(t);
        cell.setFocusable(true); cell.setContentDescription(label); cell.setOnClickListener(v -> run.run());
        row.addView(cell, new LinearLayout.LayoutParams(0, -2, 1));
    }

    private void tabButton(LinearLayout row, String label, String key) {
        boolean on = tab.equals(key);
        LinearLayout cell = a.column(); cell.setGravity(Gravity.CENTER_HORIZONTAL);
        TextView t = Ui.text(a, label, 14, true, on ? MainActivity.ACCENT : MainActivity.MUTED); t.setGravity(Gravity.CENTER); t.setPadding(0, dp(12), 0, dp(10));
        cell.addView(t, new LinearLayout.LayoutParams(-1, -2));
        View line = new View(a); line.setBackgroundColor(on ? MainActivity.ACCENT : android.graphics.Color.TRANSPARENT);
        cell.addView(line, new LinearLayout.LayoutParams(-1, dp(2)));
        cell.setFocusable(true); cell.setSelected(on); cell.setContentDescription(label + (on ? ", selected" : ""));
        cell.setOnClickListener(v -> { tab = key; draw(); });
        row.addView(cell, new LinearLayout.LayoutParams(0, -2, 1));
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

    private void details() {
        LinearLayout c = box();
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

    private void history() {
        JSONArray acts = data.optJSONArray("activities");
        if (acts == null || acts.length() == 0) { TextView t = text(body, "Nothing has been recorded for this lead yet. Call, add a note or plan a follow-up.", 13, false); t.setTextColor(MainActivity.MUTED); return; }
        // the conversation fills the area under the header on a soft chat background, like the web lead page
        body.setBackgroundColor(0xFFF0EEE9);
        HistoryView.draw(a, body, acts, lead.optString("name"));
    }

    private void tasks() {
        JSONArray tasks = data.optJSONArray("tasks");
        if (tasks == null || tasks.length() == 0) { TextView t = text(body, "No open follow-ups. Tap Follow-up to plan the next call.", 13, false); t.setTextColor(MainActivity.MUTED); return; }
        LinearLayout g = Ui.group(a, body);
        long now = System.currentTimeMillis();
        for (int i = 0; i < tasks.length(); i++) {
            JSONObject t = tasks.optJSONObject(i);
            if (t == null) continue;
            if (i > 0) Ui.hairline(a, g, 16);
            long due = Ui.ms(t.optString("due")); boolean late = due > 0 && due < now;
            LinearLayout row = Ui.row(a, g, null, t.optString("title"), (late ? "Late since " : "") + Ui.dayLabel(due) + " · " + Ui.clock(due), MainActivity.INK, late ? MainActivity.RED : MainActivity.MUTED);
            if (canEdit()) row.addView(Ui.pill(a, "Done", false, MainActivity.ACCENT, () -> save("PATCH", "/v1/tasks/" + t.optString("id"), put("status", "Done"), "Follow-up done")));
        }
    }

    // ---- actions ----

    private void call() {
        String d = digits();
        if (d.isEmpty()) { note("This lead has no phone number."); return; }
        CompanySim.dial(a, "+" + d);
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
        FollowUpSheet.open(a, id, lead.optString("name"), "Call back", this::load);
    }

    // the lead menu, as on the web: archive (kept, out of the lists), delete for good, or delete and block the number
    private void moreMenu(View anchor) {
        android.widget.PopupMenu menu = new android.widget.PopupMenu(a, anchor);
        String name = lead.optString("name", "this lead");
        if (data.optBoolean("canArchive")) menu.getMenu().add(0, 1, 1, "Archive lead");
        if (data.optBoolean("canDelete")) menu.getMenu().add(0, 2, 2, "Delete lead");
        if (data.optBoolean("canDelete") && !digits().isEmpty()) menu.getMenu().add(0, 3, 3, "Delete and block number");
        menu.setOnMenuItemClickListener(item -> {
            int which = item.getItemId();
            String title = which == 1 ? "Archive " + name + "?" : which == 2 ? "Delete " + name + " for good?" : "Delete " + name + " and block " + phoneLabel() + "?";
            String message = which == 1 ? "The lead leaves the lists but is kept. An admin can restore it on the web."
                : which == 2 ? "The lead, its calls, recordings, notes, messages and follow-ups are removed. This cannot be undone. If the number calls again or TeleCRM syncs it, the lead comes back; use \"Delete and block number\" to stop that."
                : "The lead, its calls, recordings, notes, messages and follow-ups are removed. Calls and WhatsApp from this number will not create a lead again. Unblock it on the web in Settings, Blocked numbers.";
            String button = which == 1 ? "Archive" : which == 2 ? "Delete" : "Delete and block";
            String path = "/v1/leads/" + id + (which == 1 ? "/archive" : which == 2 ? "/delete" : "/delete-and-block");
            String done = which == 1 ? "Lead archived" : which == 2 ? "Lead deleted" : "Lead deleted and number blocked";
            new AlertDialog.Builder(a).setTitle(title).setMessage(message).setNegativeButton("Cancel", null)
                .setPositiveButton(button, (d, w) -> leave(path, done)).show();
            return true;
        });
        menu.show();
    }

    // runs an action that removes the lead from view, then closes the screen and refreshes the lists
    private void leave(String path, String done) {
        new Thread(() -> {
            try {
                SyncEngine.requestApi(a, path, "POST", new JSONObject());
                a.runOnUiThread(() -> { android.widget.Toast.makeText(a, done, android.widget.Toast.LENGTH_SHORT).show(); dialog.dismiss(); });
                try { a.loadWorkspace(); a.runOnUiThread(a::render); } catch (Exception ignored) { /* the next refresh drops it */ }
            } catch (Exception e) {
                a.runOnUiThread(() -> note(e instanceof SyncEngine.HttpError && ((SyncEngine.HttpError) e).code == 403 ? "Only an admin can delete a lead, and only its owner can archive it." : problem(e)));
            }
        }).start();
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
