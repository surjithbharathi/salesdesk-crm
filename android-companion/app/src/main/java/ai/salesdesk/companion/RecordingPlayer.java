package ai.salesdesk.companion;

import android.app.AlertDialog;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.*;
import java.util.Locale;

/** A call recording player: play and pause, a bar to jump anywhere, back and forward 10 seconds, and playback speed. */
final class RecordingPlayer {
    private static final float[] SPEEDS = {0.25f, 0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f};
    private static String name(float s) { return (s == (int) s ? String.valueOf((int) s) : String.valueOf(s)) + "x"; }

    /** Opens the player; returns the MediaPlayer so the screen can release it, or throws when the file cannot be played. */
    static MediaPlayer open(MainActivity a, Uri uri, String title, Runnable onClose) throws Exception {
        MediaPlayer player = new MediaPlayer();
        player.setDataSource(a, uri);
        player.prepare();
        int total = Math.max(player.getDuration(), 1);
        int dp = Math.round(a.getResources().getDisplayMetrics().density);
        Handler h = new Handler(Looper.getMainLooper());
        int[] speed = {3}; // 1x
        boolean[] dragging = {false}, closed = {false};

        LinearLayout box = new LinearLayout(a); box.setOrientation(LinearLayout.VERTICAL); box.setPadding(20 * dp, 8 * dp, 20 * dp, 4 * dp);
        SeekBar bar = new SeekBar(a); bar.setMax(total);
        box.addView(bar);
        LinearLayout times = new LinearLayout(a);
        TextView at = small(a, clock(0)), end = small(a, clock(total)); end.setGravity(Gravity.END);
        times.addView(at, new LinearLayout.LayoutParams(0, -2, 1)); times.addView(end, new LinearLayout.LayoutParams(0, -2, 1));
        box.addView(times);

        LinearLayout controls = new LinearLayout(a); controls.setGravity(Gravity.CENTER_VERTICAL); controls.setPadding(0, 12 * dp, 0, 4 * dp);
        Button back = round(a, "−10s", false, dp), main = round(a, "❚❚  Pause", true, dp), ahead = round(a, "+10s", false, dp), rate = round(a, "1x", false, dp);
        LinearLayout.LayoutParams small = new LinearLayout.LayoutParams(0, 44 * dp, 1); small.setMarginEnd(6 * dp);
        LinearLayout.LayoutParams big = new LinearLayout.LayoutParams(0, 44 * dp, 1.6f); big.setMarginEnd(6 * dp);
        controls.addView(back, small); controls.addView(main, big); controls.addView(ahead, small);
        controls.addView(rate, new LinearLayout.LayoutParams(0, 44 * dp, 1));
        box.addView(controls);

        Runnable label = () -> main.setText(player.isPlaying() ? "❚❚  Pause" : "▶  Play");
        Runnable tick = new Runnable() { public void run() {
            if (closed[0]) return;
            try { int p = player.getCurrentPosition(); if (!dragging[0]) bar.setProgress(p); at.setText(clock(p)); } catch (Exception ignored) {}
            h.postDelayed(this, 250);
        } };
        main.setOnClickListener(v -> { try { if (player.isPlaying()) player.pause(); else player.start(); } catch (Exception ignored) {} label.run(); });
        back.setOnClickListener(v -> seek(player, player.getCurrentPosition() - 10000, total));
        ahead.setOnClickListener(v -> seek(player, player.getCurrentPosition() + 10000, total));
        // the speed button opens a list of speeds; the chosen one is ticked
        rate.setOnClickListener(v -> {
            PopupMenu menu = new PopupMenu(a, rate);
            for (int i = 0; i < SPEEDS.length; i++) menu.getMenu().add(0, i, i, (i == speed[0] ? "✓  " : "     ") + name(SPEEDS[i]) + (SPEEDS[i] == 1f ? "  (normal)" : ""));
            menu.setOnMenuItemClickListener(item -> {
                speed[0] = item.getItemId();
                boolean was = player.isPlaying();
                try { player.setPlaybackParams(player.getPlaybackParams().setSpeed(SPEEDS[speed[0]])); if (!was) player.pause(); } catch (Exception ignored) {}
                rate.setText(name(SPEEDS[speed[0]]));
                label.run();
                return true;
            });
            menu.show();
        });
        bar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            public void onProgressChanged(SeekBar s, int p, boolean user) { if (user) at.setText(clock(p)); }
            public void onStartTrackingTouch(SeekBar s) { dragging[0] = true; }
            public void onStopTrackingTouch(SeekBar s) { dragging[0] = false; seek(player, s.getProgress(), total); }
        });
        player.setOnCompletionListener(p -> { bar.setProgress(total); at.setText(clock(total)); main.setText("▶  Play again"); });

        Runnable close = () -> { if (closed[0]) return; closed[0] = true; h.removeCallbacksAndMessages(null); onClose.run(); };
        new AlertDialog.Builder(a).setTitle(title).setView(box).setPositiveButton("Close", (d, w) -> close.run()).setOnDismissListener(d -> close.run()).show();
        player.start();
        h.post(tick);
        return player;
    }

    private static void seek(MediaPlayer p, int to, int total) { try { p.seekTo(Math.max(0, Math.min(total - 200, to))); } catch (Exception ignored) {} }
    private static String clock(int ms) { int s = ms / 1000; return String.format(Locale.ROOT, "%d:%02d", s / 60, s % 60); }
    private static TextView small(MainActivity a, String t) { TextView v = new TextView(a); v.setText(t); v.setTextSize(12); v.setTextColor(MainActivity.MUTED); return v; }
    private static Button round(MainActivity a, String text, boolean primary, int dp) {
        Button b = new Button(a); b.setText(text); b.setAllCaps(false); b.setTextSize(14); b.setPadding(0, 0, 0, 0);
        b.setTypeface(Typeface.DEFAULT_BOLD); b.setTextColor(primary ? MainActivity.ONACCENT : MainActivity.ACCENT);
        GradientDrawable g = new GradientDrawable(); g.setCornerRadius(12 * dp);
        if (primary) g.setColor(MainActivity.ACCENT); else { g.setColor(MainActivity.SOFT); }
        b.setBackground(g); b.setMinHeight(0); b.setMinimumHeight(0); b.setMinWidth(0); b.setMinimumWidth(0);
        return b;
    }
}
