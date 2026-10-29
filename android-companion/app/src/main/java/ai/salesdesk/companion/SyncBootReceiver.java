package ai.salesdesk.companion;
import android.content.*;

public class SyncBootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){if(Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())||Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())){boolean enabled=SecureConfig.loggedIn(context)&&SecureConfig.prefs(context).getBoolean("enabled",false);SyncJob.schedule(context,enabled);if(enabled)CallMonitorService.start(context);}}
}
