package ai.salesdesk.companion;
import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.Build;
import java.util.HashSet;
import java.util.Set;

/** One persistent notice shared by the call observer and web-call bridge. */
final class BackgroundNotice {
    static final int ID=7150;
    private static final Set<String> running=new HashSet<>();
    static Notification notification(Context context){
        NotificationManager manager=context.getSystemService(NotificationManager.class);manager.createNotificationChannel(new NotificationChannel("salesdesk-background","Salesdesk",NotificationManager.IMPORTANCE_LOW));
        PendingIntent open=PendingIntent.getActivity(context,ID,new Intent(context,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(context,"salesdesk-background").setSmallIcon(android.R.drawable.ic_menu_call).setContentTitle("Salesdesk is running in background").setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).setShowWhen(false).build();
    }
    static synchronized void start(Service service){Notification notice=notification(service);if(Build.VERSION.SDK_INT>=34)service.startForeground(ID,notice,ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);else service.startForeground(ID,notice);running.add(service.getClass().getName());}
    static synchronized void stop(Service service){running.remove(service.getClass().getName());service.stopForeground(Service.STOP_FOREGROUND_DETACH);NotificationManager manager=service.getSystemService(NotificationManager.class);if(running.isEmpty())manager.cancel(ID);else manager.notify(ID,notification(service));}
}
