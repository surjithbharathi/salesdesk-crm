package ai.salesdesk.companion;

import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.*;

/** Visible local call-log observer; uploads run in network-constrained Android jobs. */
public class CallMonitorService extends Service {
    CallSyncWatcher watcher;
    static boolean allowed(Context c){return SecureConfig.loggedIn(c)&&SecureConfig.prefs(c).getBoolean("enabled",false)&&c.checkSelfPermission(android.Manifest.permission.READ_CALL_LOG)==PackageManager.PERMISSION_GRANTED;}
    static void start(Context c){if(!allowed(c))return;try{c.startForegroundService(new Intent(c,CallMonitorService.class));}catch(Exception e){SecureConfig.prefs(c).edit().putString("status","Background start restricted. Open Salesdesk once to resume.").apply();}}
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public int onStartCommand(Intent intent,int flags,int id){
        if(intent!=null&&"PAUSE".equals(intent.getAction())){SecureConfig.prefs(this).edit().putBoolean("enabled",false).commit();SyncJob.schedule(this,false);stopSelf();return START_NOT_STICKY;}
        if(!allowed(this)){stopSelf();return START_NOT_STICKY;}
        try{BackgroundNotice.start(this);}catch(Exception e){SecureConfig.prefs(this).edit().putString("status","Open Salesdesk to resume background monitoring.").apply();stopSelf();return START_NOT_STICKY;}
        if(watcher==null){watcher=new CallSyncWatcher(this);watcher.start();}
        return START_STICKY;
    }
    @Override public void onDestroy(){if(watcher!=null)watcher.close();BackgroundNotice.stop(this);super.onDestroy();}
}
