package ai.salesdesk.companion;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.view.View;

/** A goal ring: it fills as the count nears the goal and turns green with a tick when the goal is met. */
final class RingView extends View {
    private final Paint track = new Paint(Paint.ANTI_ALIAS_FLAG), arc = new Paint(Paint.ANTI_ALIAS_FLAG), big = new Paint(Paint.ANTI_ALIAS_FLAG), small = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF box = new RectF();
    private final Path tick = new Path();
    private final int value, goal, color;

    RingView(Context context, String label, int value, int goal, int color, int ink, int muted) {
        super(context);
        this.value = value;
        this.goal = goal;
        this.color = color;
        track.setStyle(Paint.Style.STROKE);
        track.setColor(0xffeceef5);
        arc.setStyle(Paint.Style.STROKE);
        arc.setStrokeCap(Paint.Cap.ROUND);
        arc.setColor(color);
        big.setColor(ink);
        big.setTextAlign(Paint.Align.CENTER);
        big.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        small.setColor(muted);
        small.setTextAlign(Paint.Align.CENTER);
        setContentDescription(label + ", " + value + " of " + goal);
    }

    @Override protected void onMeasure(int widthSpec, int heightSpec) {
        int size = Math.min(View.MeasureSpec.getSize(widthSpec), (int) (132 * getResources().getDisplayMetrics().density));
        setMeasuredDimension(size, size);
    }

    @Override protected void onDraw(Canvas canvas) {
        float size = getWidth(), stroke = size * 0.11f, pad = stroke / 2 + 2;
        track.setStrokeWidth(stroke);
        arc.setStrokeWidth(stroke);
        box.set(pad, pad, size - pad, size - pad);
        canvas.drawArc(box, 0, 360, false, track);
        boolean met = goal > 0 && value >= goal;
        float share = goal > 0 ? Math.min(1f, value / (float) goal) : 0f;
        arc.setColor(met ? 0xff17806c : color);
        if (share > 0) canvas.drawArc(box, -90, 360 * share, false, arc);
        if (met) {
            float c = size / 2;
            tick.reset();
            tick.moveTo(c - size * 0.16f, c + size * 0.01f);
            tick.lineTo(c - size * 0.04f, c + size * 0.13f);
            tick.lineTo(c + size * 0.18f, c - size * 0.12f);
            arc.setStrokeWidth(stroke * 0.7f);
            canvas.drawPath(tick, arc);
        } else {
            big.setTextSize(size * 0.3f);
            small.setTextSize(size * 0.12f);
            canvas.drawText(String.valueOf(value), size / 2, size / 2 + size * 0.06f, big);
            canvas.drawText("of " + goal, size / 2, size / 2 + size * 0.24f, small);
        }
    }
}
