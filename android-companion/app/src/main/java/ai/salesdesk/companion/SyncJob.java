package ai.salesdesk.companion;
import android.app.job.*;
import android.content.*;
public class SyncJob extends JobService {
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> { boolean retry = false; try { SyncEngine.run(this); } catch (Exception e) { SecureConfig.prefs(this).edit().putString("status", "Sync paused/failed. Check permissions, endpoint and device token; retry available.").apply(); retry = true; } jobFinished(params, retry); }).start(); return true;
    }
    public boolean onStopJob(JobParameters params) { SyncEngine.cancel(); return true; }
    static void schedule(Context c, boolean enabled) {
        JobScheduler scheduler = (JobScheduler)c.getSystemService(JOB_SCHEDULER_SERVICE);
        if (!enabled) { scheduler.cancel(710); SyncEngine.cancel(); return; }
        scheduler.schedule(new JobInfo.Builder(710, new ComponentName(c, SyncJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(15 * 60 * 1000L).setPersisted(true).setBackoffCriteria(30000, JobInfo.BACKOFF_POLICY_EXPONENTIAL).build());
    }
}
