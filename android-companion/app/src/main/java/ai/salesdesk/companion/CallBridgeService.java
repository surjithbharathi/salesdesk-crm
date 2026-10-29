package ai.salesdesk.companion;
import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.*;
import android.telecom.TelecomManager;
import org.json.JSONObject;

/** Explicitly enabled bridge; no hidden service, boot launch or automatic redial. */
public class CallBridgeService extends Service {
    private volatile boolean stopped;
    private Thread worker;
    private CallSyncWatcher syncWatcher;
    static boolean permissions(Context c){return c.checkSelfPermission(Manifest.permission.CALL_PHONE)==PackageManager.PERMISSION_GRANTED&&c.checkSelfPermission(Manifest.permission.READ_PHONE_STATE)==PackageManager.PERMISSION_GRANTED&&(Build.VERSION.SDK_INT<33||c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED);}
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public int onStartCommand(Intent intent,int flags,int id){
        if(intent!=null&&"STOP".equals(intent.getAction())){SecureConfig.prefs(this).edit().putBoolean("clickToCall",false).commit();stopSelf();return START_NOT_STICKY;}
        if(!SecureConfig.loggedIn(this)||!SecureConfig.prefs(this).getBoolean("clickToCall",false)||!permissions(this)){stopSelf();return START_NOT_STICKY;}
        try{BackgroundNotice.start(this);}catch(Exception e){stopSelf();return START_NOT_STICKY;}
        if(worker==null){stopped=false;syncWatcher=new CallSyncWatcher(this);syncWatcher.start();worker=new Thread(this::loop,"salesdesk-call-bridge");worker.start();}
        return START_STICKY;
    }
    private boolean ready(String user){
        if(stopped||!SecureConfig.loggedIn(this)||!user.equals(SecureConfig.prefs(this).getString("userId",""))||!SecureConfig.prefs(this).getBoolean("clickToCall",false)||!permissions(this))return false;
        if(((KeyguardManager)getSystemService(KEYGUARD_SERVICE)).isKeyguardLocked()&&!SecureConfig.prefs(this).getBoolean("callWhileLocked",false))return false;
        if(checkSelfPermission(Manifest.permission.READ_PHONE_STATE)!=PackageManager.PERMISSION_GRANTED)return false;
        try{return !getSystemService(TelecomManager.class).isInCall();}catch(SecurityException e){return false;}catch(Exception e){return false;}
    }
    private void loop(){
        while(!stopped){
            if(!SecureConfig.loggedIn(this)||!SecureConfig.prefs(this).getBoolean("clickToCall",false)){stopSelf();return;}
            String user=SecureConfig.prefs(this).getString("userId","");long began=SystemClock.elapsedRealtime();
            try{
                JSONObject response=SyncEngine.requestApi(this,"/v1/click-to-call/poll","POST",new JSONObject().put("armed",ready(user)));
                JSONObject command=response.optJSONObject("command");
                if(command!=null){
                    String outcome="Failed",id=command.getString("id");
                    try{
                        String phone=command.getString("phone");
                        if(!ready(user)||SystemClock.elapsedRealtime()-began>10000||System.currentTimeMillis()>command.getLong("expiresAt")||!phone.matches("\\+?[1-9][0-9]{7,14}"))throw new Exception("Not ready");
                        if(id.equals(SecureConfig.prefs(this).getString("lastDialCommand","")))throw new Exception("Already handled");
                        if(!SecureConfig.prefs(this).edit().putString("lastDialCommand",id).commit())throw new Exception("Receipt failed");
                        if(checkSelfPermission(Manifest.permission.CALL_PHONE)!=PackageManager.PERMISSION_GRANTED)throw new SecurityException("Call permission revoked");
                        getSystemService(TelecomManager.class).placeCall(Uri.fromParts("tel",phone,null),new Bundle());
                        outcome="Dialer launched";
                    }catch(Exception ignored){/* No fallback intent or retry that could dial twice. */}
                    if(user.equals(SecureConfig.prefs(this).getString("userId","")))try{SyncEngine.requestApi(this,"/v1/click-to-call/ack","POST",new JSONObject().put("id",id).put("status",outcome));}catch(Exception ignored){}
                }
            }catch(Exception e){if(e instanceof SyncEngine.HttpError&&(((SyncEngine.HttpError)e).code==401||((SyncEngine.HttpError)e).code==403)){SecureConfig.prefs(this).edit().putBoolean("clickToCall",false).commit();stopSelf();return;}}
            try{Thread.sleep(3000);}catch(InterruptedException ignored){return;}
        }
    }
    @Override public void onDestroy(){stopped=true;if(syncWatcher!=null)syncWatcher.close();if(worker!=null)worker.interrupt();BackgroundNotice.stop(this);super.onDestroy();}
}
