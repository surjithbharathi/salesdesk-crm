package ai.salesdesk.companion;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.os.*;
import android.view.*;
import android.widget.*;
import org.json.*;

final class CallPrompts {
    private static View current;
    private static WindowManager currentManager;
    static void dismiss(){if(current!=null)try{currentManager.removeView(current);}catch(Exception ignored){}current=null;currentManager=null;}
    static void popup(Context c,String title,String detail,Intent open){
        if(!SecureConfig.loggedIn(c)||!android.provider.Settings.canDrawOverlays(c)||((KeyguardManager)c.getSystemService(Context.KEYGUARD_SERVICE)).isKeyguardLocked())return;
        new Handler(Looper.getMainLooper()).post(()->{
            dismiss();LinearLayout box=new LinearLayout(c);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(32,24,32,24);box.setBackgroundColor(Color.WHITE);
            TextView heading=new TextView(c);heading.setText(title);heading.setTextSize(19);heading.setTextColor(Color.BLACK);box.addView(heading);
            TextView body=new TextView(c);body.setText(detail);body.setTextColor(Color.DKGRAY);box.addView(body);
            if(open!=null){Button action=new Button(c);action.setText(open.getComponent()!=null&&open.getComponent().getClassName().endsWith("FeedbackActivity")?"Add feedback":"View lead");box.addView(action);action.setOnClickListener(v->{dismiss();c.startActivity(open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));});}
            Button close=new Button(c);close.setText("Dismiss");box.addView(close);close.setOnClickListener(v->dismiss());
            WindowManager.LayoutParams params=new WindowManager.LayoutParams(-1,-2,WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,android.graphics.PixelFormat.TRANSLUCENT);params.gravity=Gravity.TOP;params.y=100;
            try{currentManager=c.getSystemService(WindowManager.class);currentManager.addView(box,params);current=box;new Handler(Looper.getMainLooper()).postDelayed(()->{if(current==box)dismiss();},30000);}catch(Exception ignored){current=null;currentManager=null;}
        });
    }
    static void afterCall(Context c,String id,String phone,long duration){
        if(!SecureConfig.prefs(c).getBoolean("postCallFeedback",false))return;
        boolean connected=duration>0;
        if(!connected&&!SecureConfig.prefs(c).getBoolean("unconnectedFeedback",false))return;
        Intent intent=new Intent(c,FeedbackActivity.class).putExtra("callId",id).putExtra("userId",SecureConfig.prefs(c).getString("userId",""));
        NotificationManager manager=c.getSystemService(NotificationManager.class);manager.createNotificationChannel(new NotificationChannel("call-feedback","Post-call feedback",NotificationManager.IMPORTANCE_HIGH));
        PendingIntent open=PendingIntent.getActivity(c,id.hashCode(),intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        if(android.os.Build.VERSION.SDK_INT<33||c.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)==android.content.pm.PackageManager.PERMISSION_GRANTED)
            manager.notify(id.hashCode(),new Notification.Builder(c,"call-feedback").setSmallIcon(android.R.drawable.ic_menu_edit).setContentTitle("Add call feedback").setContentText("Tap to add a text or voice note in Salesdesk").setVisibility(Notification.VISIBILITY_PRIVATE).setContentIntent(open).setAutoCancel(true).build());
        popup(c,"Call finished","Add a text or voice note for this call.",intent);
    }
}
