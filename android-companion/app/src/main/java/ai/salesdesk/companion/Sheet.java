package ai.salesdesk.companion;

import android.app.Dialog;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** A sheet that slides up from the bottom: a grab handle, a title, a scrolling body and the buttons at the foot. */
final class Sheet {
    final MainActivity a;
    final Dialog dialog;
    final LinearLayout body, foot;

    Sheet(MainActivity a, String title, String subtitle) {
        this.a = a;
        dialog = new Dialog(a);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout root = a.column();
        float r = a.dp(24);
        GradientDrawable bg = new GradientDrawable(); bg.setColor(Color.WHITE); bg.setCornerRadii(new float[]{r, r, r, r, 0, 0, 0, 0});
        root.setBackground(bg);
        root.setPadding(a.dp(16), a.dp(10), a.dp(16), a.dp(16));
        View handle = new View(a); handle.setBackground(a.surface(0xffd6d5df, 2));
        LinearLayout.LayoutParams hp = new LinearLayout.LayoutParams(a.dp(40), a.dp(4)); hp.gravity = Gravity.CENTER_HORIZONTAL; hp.setMargins(0, 0, 0, a.dp(14));
        root.addView(handle, hp);
        TextView t = Ui.text(a, title, 18, true, MainActivity.INK); t.setTypeface(android.graphics.Typeface.DEFAULT_BOLD); root.addView(t);
        if (subtitle != null && !subtitle.isEmpty()) { TextView s = Ui.text(a, subtitle, 13, false, MainActivity.MUTED); s.setPadding(0, a.dp(2), 0, 0); root.addView(s); }
        ScrollView scroll = new ScrollView(a);
        body = a.column(); body.setPadding(0, a.dp(6), 0, a.dp(6));
        scroll.addView(body);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        foot = a.horizontal(); foot.setPadding(0, a.dp(10), 0, 0);
        root.addView(foot);
        dialog.setContentView(root);
        Window w = dialog.getWindow();
        if (w != null) {
            w.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT));
            w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            w.setGravity(Gravity.BOTTOM);
            w.setDimAmount(0.45f);
            w.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        }
    }

    /** A grey label over a group of choices or a field. */
    TextView label(String s) {
        TextView t = Ui.text(a, s, 13, true, MainActivity.MUTED); t.setPadding(0, a.dp(16), 0, a.dp(8)); body.addView(t); return t;
    }

    /** A row of choices that wraps by hand: a new line every `perLine` choices. */
    LinearLayout[] lines(int count, int perLine) {
        LinearLayout[] rows = new LinearLayout[(count + perLine - 1) / perLine];
        for (int i = 0; i < rows.length; i++) { rows[i] = new LinearLayout(a); body.addView(rows[i]); }
        return rows;
    }

    /** A big grid button (outcomes): outlined, or blue-edged when chosen. */
    TextView option(String s, boolean on, Runnable run) {
        TextView t = Ui.text(a, s, 14, true, on ? MainActivity.ACCENT : MainActivity.INK); t.setGravity(Gravity.CENTER); t.setMinHeight(a.dp(48));
        GradientDrawable g = a.surface(on ? MainActivity.SOFT : Color.WHITE, 14); g.setStroke(a.dp(on ? 2 : 1), on ? MainActivity.ACCENT : MainActivity.LINE); t.setBackground(g);
        t.setSelected(on); t.setFocusable(true); t.setClickable(true); t.setOnClickListener(v -> run.run());
        return t;
    }

    void buttons(String skip, Runnable onSkip, String main, Runnable onMain) {
        foot.removeAllViews();
        if (skip != null) {
            TextView s = Ui.pill(a, skip, false, MainActivity.MUTED, () -> { if (onSkip != null) onSkip.run(); dialog.dismiss(); });
            GradientDrawable g = a.surface(Color.WHITE, 26); g.setStroke(a.dp(1), MainActivity.LINE); s.setBackground(g); s.setMinHeight(a.dp(52));
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2, a.dp(52)); p.setMarginEnd(a.dp(8)); foot.addView(s, p);
        }
        TextView m = Ui.pill(a, main, true, MainActivity.ACCENT, onMain); m.setTextSize(16);
        foot.addView(m, new LinearLayout.LayoutParams(0, a.dp(52), 1));
    }

    void show() { dialog.show(); }
    void close() { dialog.dismiss(); }
}
