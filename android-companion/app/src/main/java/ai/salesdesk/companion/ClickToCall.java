package ai.salesdesk.companion;
import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.widget.CheckBox;
import android.widget.LinearLayout;

/** Settings for the user-started, visible background call bridge. */
final class ClickToCall {
    private final MainActivity activity;
    ClickToCall(MainActivity activity){this.activity=activity;}
    void resume(){if(SecureConfig.loggedIn(activity)&&SecureConfig.prefs(activity).getBoolean("clickToCall",false)&&CallBridgeService.permissions(activity))start();}
    void pause(){/* Notification-backed bridge intentionally outlives the screen. */}
    void start(){try{activity.startForegroundService(new Intent(activity,CallBridgeService.class));}catch(Exception e){SecureConfig.prefs(activity).edit().putBoolean("clickToCall",false).commit();activity.notice("Android refused the bridge start. Enable again while Salesdesk is open.");}}
    void settings(LinearLayout box){
        activity.text(box,"Background calling",19,true);
        activity.badge(box,SecureConfig.prefs(activity).getBoolean("clickToCall",false)?"Enabled on this phone":"Not enabled");
        activity.caption(box,"Call from web CRM using this phone’s SIM, even when Salesdesk is minimized. A persistent notification shows when the bridge is running. Carrier charges apply; there is no automatic redial.");
        activity.caption(box,"Phone, phone-state and notification permissions: "+(CallBridgeService.permissions(activity)?"Granted":"Not granted"));
        if(!CallBridgeService.permissions(activity))activity.button(box,"Grant call-bridge permissions",()->activity.requestPermissions(Build.VERSION.SDK_INT>=33?new String[]{Manifest.permission.CALL_PHONE,Manifest.permission.READ_PHONE_STATE,Manifest.permission.POST_NOTIFICATIONS}:new String[]{Manifest.permission.CALL_PHONE,Manifest.permission.READ_PHONE_STATE},304));
        CheckBox enabled=new CheckBox(activity);enabled.setText("Allow web CRM SIM calls while this app is in the background");enabled.setChecked(SecureConfig.prefs(activity).getBoolean("clickToCall",false));box.addView(enabled);
        enabled.setOnCheckedChangeListener((button,value)->{if(value&&!CallBridgeService.permissions(activity)){enabled.setChecked(false);activity.notice("Grant permissions yourself before enabling.");return;}SecureConfig.prefs(activity).edit().putBoolean("clickToCall",value).commit();if(value)start();else activity.stopService(new Intent(activity,CallBridgeService.class));});
        CheckBox locked=new CheckBox(activity);locked.setText("Also allow web-triggered calls while this phone is locked");locked.setChecked(SecureConfig.prefs(activity).getBoolean("callWhileLocked",false));box.addView(locked);locked.setOnCheckedChangeListener((button,value)->SecureConfig.prefs(activity).edit().putBoolean("callWhileLocked",value).commit());
        activity.button(box,"Open Android battery optimization settings",()->activity.startActivity(new Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)));
        activity.button(box,"Background calling help",()->activity.notice("Force stop, offline status, expired login, battery restrictions or reboot may make calling unavailable. Review Vivo background activity/autostart settings yourself if needed. No system settings are changed automatically. Enable again after reboot or Force stop; dual-SIM phones may still prompt for a SIM."));
    }
}
