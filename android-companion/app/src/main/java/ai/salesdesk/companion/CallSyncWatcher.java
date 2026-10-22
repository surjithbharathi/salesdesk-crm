package ai.salesdesk.companion;

import android.content.Context;
import android.database.ContentObserver;
import android.os.Handler;
import android.os.Looper;
import android.provider.CallLog;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;

/** Watches only for changes; SyncEngine still limits collection to assigned leads. */
final class CallSyncWatcher {
    private final Context context;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile boolean closed;
    private boolean registered;
    private final AtomicBoolean queued = new AtomicBoolean(false);
    private final Runnable sync = this::dispatch;
    private void dispatch() {
        if (closed || !SecureConfig.loggedIn(context) || !SecureConfig.prefs(context).getBoolean("enabled", false)) return;
        if (!queued.compareAndSet(false, true)) return;
        try { worker.execute(() -> {
            try {
            if (closed || !SecureConfig.prefs(context).getBoolean("enabled", false)) return;
            try { SyncEngine.run(context); }
            catch (Exception error) {
                boolean denied = error instanceof SyncEngine.HttpError && (((SyncEngine.HttpError)error).code == 401 || ((SyncEngine.HttpError)error).code == 403);
                if (denied) {
                    SecureConfig.prefs(context).edit().putBoolean("enabled", false).putString("status", "Session expired or access denied. Sign in again; sync paused.").commit();
                    SyncJob.schedule(context, false);
                } else SecureConfig.prefs(context).edit().putString("status", "Sync pending. Check call-log permission and internet; retrying automatically.").apply();
            }
            } finally { queued.set(false); }
        }); } catch (RejectedExecutionException ignored) { queued.set(false); }
    }
    private final Runnable fallback = new Runnable() {
        public void run() { if (!closed) { sync.run(); handler.postDelayed(this, 60000); } }
    };
    private final ContentObserver observer = new ContentObserver(handler) {
        @Override public void onChange(boolean selfChange) { changed(); }
    };
    CallSyncWatcher(Context context) { this.context = context.getApplicationContext(); }
    void start() {
        try { context.getContentResolver().registerContentObserver(CallLog.Calls.CONTENT_URI, true, observer); registered = true; }
        catch (SecurityException ignored) { /* Permission is requested only in Settings. */ }
        handler.post(fallback);
    }
    private void changed() {
        // Give Android time to finalize duration, then retry for recordings written later.
        handler.removeCallbacks(sync);
        handler.postDelayed(sync, 20000);
        handler.postDelayed(sync, 45000);
        handler.postDelayed(sync, 90000);
    }
    void close() {
        closed = true;
        handler.removeCallbacksAndMessages(null);
        if (registered) context.getContentResolver().unregisterContentObserver(observer);
        worker.shutdown();
    }
}
