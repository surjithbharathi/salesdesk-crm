package ai.salesdesk.companion;
import android.app.job.*;
import android.content.*;
public class SyncJob extends JobService {
    public boolean onStartJob(JobParameters params) {
        if(!SecureConfig.loggedIn(this)||!SecureConfig.prefs(this).getBoolean("enabled",false)) return false;
        new Thread(() -> { boolean retry = false; try { SyncEngine.run(this); } catch (Exception e) { boolean denied=e instanceof SyncEngine.HttpError&&(((SyncEngine.HttpError)e).code==401||((SyncEngine.HttpError)e).code==403); SecureConfig.prefs(this).edit().putString("status", denied?"Session expired or access denied. Sign in again; sync paused.":"Sync failed. Check permissions and connection; retry available.").apply(); if(denied){SecureConfig.prefs(this).edit().putBoolean("enabled",false).commit();schedule(this,false);}else retry=true; } jobFinished(params, retry); }).start(); return true;
    }
    public boolean onStopJob(JobParameters params) { SyncEngine.cancel(); return true; }
    static void schedule(Context c, boolean enabled) {
        JobScheduler scheduler = (JobScheduler)c.getSystemService(JOB_SCHEDULER_SERVICE);
        if (!enabled || !SecureConfig.loggedIn(c)) { scheduler.cancel(710); SyncEngine.cancel(); return; }
        scheduler.schedule(new JobInfo.Builder(710, new ComponentName(c, SyncJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(15 * 60 * 1000L).setPersisted(true).setBackoffCriteria(30000, JobInfo.BACKOFF_POLICY_EXPONENTIAL).build());
    }
}
