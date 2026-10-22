package ai.salesdesk.companion;
import android.Manifest;
import android.app.*;
import android.os.Bundle;
import android.content.*;
import android.database.sqlite.*;
import android.net.Uri;
import android.widget.*;
import java.util.*;
import org.json.JSONObject;

public class MainActivity extends Activity {
    EditText endpoint, token, country; CheckBox enabled; TextView status; String pendingCall;
    final android.os.Handler handler=new android.os.Handler(android.os.Looper.getMainLooper());
    final Runnable update=new Runnable(){ public void run(){ if(status!=null) status.setText(SecureConfig.prefs(MainActivity.this).getString("status","Not yet synced. Select folder, grant call-log access and enable sync.")); handler.postDelayed(this,3000); } };
    TextView label(LinearLayout box,String text){ TextView t=new TextView(this); t.setText(text); t.setPadding(0,12,0,6); box.addView(t); return t; }
    EditText input(LinearLayout box,String title,String value){ label(box,title); EditText e=new EditText(this); e.setSingleLine(true); e.setText(value); box.addView(e); return e; }
    void button(LinearLayout box,String title,Runnable action){ Button b=new Button(this); b.setText(title); box.addView(b); b.setOnClickListener(v->{try{action.run();}catch(Exception e){notice("Action failed. Check setup and retry.");}}); }
    void notice(String text){new AlertDialog.Builder(this).setMessage(text).setPositiveButton("OK",null).show();}
    @Override public void onCreate(Bundle state){
        super.onCreate(state); getWindow().setFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE,android.view.WindowManager.LayoutParams.FLAG_SECURE);
        if(state!=null) pendingCall=state.getString("pending");
        ScrollView scroll=new ScrollView(this); LinearLayout box=new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL); box.setPadding(28,28,28,28); scroll.addView(box); setContentView(scroll);
        label(box,"Salesdesk · Android companion").setTextSize(24);
        label(box,"No recording or microphone access. Syncs only new business calls for leads assigned to this device owner. Select an accessible recording folder; grant call-log permission. Recording/upload consent must be obtained from the people involved. Personal/unmatched calls are not uploaded. Android background scheduling may delay sync.");
        endpoint=input(box,"Device API base URL (HTTPS; USB debug: http://127.0.0.1:3101)",SecureConfig.prefs(this).getString("endpoint","http://127.0.0.1:3101"));
        token=input(box,"Device token (blank keeps saved token)",""); token.setInputType(129);
        country=input(box,"Country calling code for 10-digit local numbers",SecureConfig.prefs(this).getString("country","91")); country.setInputType(2);
        enabled=new CheckBox(this); enabled.setText("I authorize business-call and matched-recording sync to this endpoint"); enabled.setChecked(SecureConfig.prefs(this).getBoolean("enabled",false)); box.addView(enabled);
        button(box,"Save configuration",()->{
            try{
                if(SyncEngine.running.get()) {notice("Wait for the current sync to finish or Pause first.");return;}
                String base=endpoint.getText().toString().trim().replaceAll("/+$", ""), secret=token.getText().toString().trim(); java.net.URI uri=new java.net.URI(base);
                if(uri.getHost()==null || uri.getRawUserInfo()!=null || uri.getRawQuery()!=null || uri.getRawFragment()!=null || !(uri.getPath()==null || uri.getPath().isEmpty()) || !("https".equals(uri.getScheme()) || (BuildConfig.DEBUG && "http".equals(uri.getScheme()) && ("127.0.0.1".equals(uri.getHost())||"localhost".equals(uri.getHost()))))) {notice("Use an HTTPS origin without a path. Debug allows USB loopback only.");return;}
                if(!country.getText().toString().matches("[1-9][0-9]{0,2}")) {notice("Enter a country calling code.");return;}
                String previous=SecureConfig.prefs(this).getString("endpoint","");
                if(!previous.isEmpty() && (!previous.equals(base) || (!secret.isEmpty() && !secret.equals(SecureConfig.token(this))))) {notice("Pause and reset the local queue before changing the device token or server. This prevents cross-device duplicates.");return;}
                if(!secret.isEmpty()){if(!secret.matches("[A-Za-z0-9_-]{43}")){notice("Invalid device token.");return;}SecureConfig.token(this,secret);} else SecureConfig.token(this);
                android.content.SharedPreferences.Editor edit=SecureConfig.prefs(this).edit().putString("endpoint",base).putString("country",country.getText().toString()).putBoolean("enabled",enabled.isChecked()); if(!SecureConfig.prefs(this).contains("since")) edit.putLong("since",System.currentTimeMillis()); edit.commit(); token.setText(""); SyncJob.schedule(this,enabled.isChecked()); notice("Saved. New calls from now are eligible. Sync now runs the compatibility check.");
            }catch(Exception e){notice("Unable to save configuration. Check the token and endpoint.");}
        });
        button(box,"Grant call-log permission",()->requestPermissions(new String[]{Manifest.permission.READ_CALL_LOG},301));
        button(box,"Choose recording folder",()->startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION),302));
        button(box,"Sync now / compatibility check",()->new Thread(()->{try{SyncEngine.run(this);}catch(Exception e){SecureConfig.prefs(this).edit().putString("status","Sync failed: "+e.getMessage()).apply();}}).start());
        button(box,"Review / attach an unmatched recording",()->{
            try(QueueDb helper=new QueueDb(this)){
                ArrayList<JSONObject> rows=SyncEngine.calls(helper.getReadableDatabase()); if(rows.isEmpty()){notice("No pending business calls. Run Sync now after a call.");return;}
                String[] options=new String[rows.size()]; for(int i=0;i<rows.size();i++){JSONObject r=rows.get(i);options[i]=new Date(r.getLong("started"))+" · "+r.getString("phone")+" · "+r.getString("direction")+" · "+r.getString("duration")+"s";}
                new AlertDialog.Builder(this).setTitle("Choose the call; then choose its recording").setItems(options,(dialog,which)->{try{pendingCall=rows.get(which).getString("local_id");startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("audio/*").addCategory(Intent.CATEGORY_OPENABLE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION),303);}catch(Exception e){notice("Unable to open file picker.");}}).show();
            }catch(Exception e){notice("Unable to read the local queue.");}
        });
        button(box,"Pause sync",()->{enabled.setChecked(false);SecureConfig.prefs(this).edit().putBoolean("enabled",false).commit();SyncJob.schedule(this,false);notice("Sync paused. Previously uploaded CRM records remain. Revoke the device in CRM to disable its token.");});
        button(box,"Reset local configuration and queue",()->new AlertDialog.Builder(this).setMessage("Delete this app's pending queue and saved token? Unsynced entries will be lost. Original phone call logs/recordings and existing CRM records are NOT deleted. Pause first and wait for running sync to stop.").setNegativeButton("Cancel",null).setPositiveButton("Reset local data",(d,w)->{if(SyncEngine.running.get()){notice("Sync is still stopping. Retry later.");return;}SyncJob.schedule(this,false);deleteDatabase("business-sync.sqlite");SecureConfig.prefs(this).edit().clear().commit();recreate();}).show());
        status=label(box,"");handler.post(update);
    }
    @Override protected void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);state.putString("pending",pendingCall);}
    @Override protected void onDestroy(){handler.removeCallbacks(update);super.onDestroy();}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(result!=RESULT_OK||data==null||data.getData()==null)return;Uri uri=data.getData();
        try{getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if(request==302){SecureConfig.prefs(this).edit().putString("folder",uri.toString()).commit();notice("Folder access saved. Only direct audio files in this selected folder are scanned.");}
            if(request==303 && pendingCall!=null){final String call=pendingCall;new AlertDialog.Builder(this).setMessage("Confirm this audio file belongs to the selected call. A wrong attachment could disclose another conversation. Upload on next sync?").setNegativeButton("Cancel",null).setPositiveButton("Confirm recording match",(d,w)->{try(QueueDb helper=new QueueDb(this)){ContentValues v=new ContentValues();v.put("uri",uri.toString());v.put("mode","manual");helper.getWritableDatabase().update("calls",v,"local_id=? AND uploaded=0",new String[]{call});notice("Match saved. Press Sync now to upload.");}}).show();}
        }catch(Exception e){notice("Folder/file access was not granted. Select a shareable recording folder.");}
    }
}
