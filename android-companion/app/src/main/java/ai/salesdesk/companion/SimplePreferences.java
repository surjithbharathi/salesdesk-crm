package ai.salesdesk.companion;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.widget.*;
import org.json.*;
import java.util.*;

/** Short, task-focused settings. Android grants remain the user's choice. */
final class SimplePreferences {
    final MainActivity a;
    SimplePreferences(MainActivity activity){a=activity;}
    android.content.SharedPreferences prefs(){return SecureConfig.prefs(a);}
    void render(){
        LinearLayout sync=a.card();a.text(sync,"Calls & recordings",19,true);
        a.caption(sync,prefs().getBoolean("enabled",false)?"Call tracking is on":"Call tracking is off");
        a.primary(sync,"Choose SIM & call tracking",this::chooseSims);
        toggle(sync,"Sync call recordings",prefs().getBoolean("recordingSync",true)&&hasFolder(),enabled->{
            if(enabled&&!hasFolder()){a.pendingRecordingSetup=true;chooseFolder();}
            else{prefs().edit().putBoolean("recordingSync",enabled).commit();a.render();}
        });
        if(hasFolder())a.button(sync,"Change recording folder",this::chooseFolder);
        a.syncStatus=a.text(sync,prefs().getString("status",""),12,false);
        LinearLayout prompts=a.card();a.text(prompts,"During & after calls",19,true);
        toggle(prompts,"Show caller’s lead details",prefs().getBoolean("screenPop",false),enabled->{if(enabled)setupCaller();else{prefs().edit().putBoolean("screenPop",false).commit();a.render();}});
        toggle(prompts,"Ask for feedback after calls",prefs().getBoolean("postCallFeedback",false),enabled->{prefs().edit().putBoolean("postCallFeedback",enabled).commit();if(enabled&&android.os.Build.VERSION.SDK_INT>=33&&a.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)a.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},308);});
        toggle(prompts,"Call from web CRM",prefs().getBoolean("clickToCall",false),enabled->{
            if(!enabled){prefs().edit().putBoolean("clickToCall",false).commit();a.stopService(new Intent(a,CallBridgeService.class));return;}
            if(!CallBridgeService.permissions(a)){a.pendingBridgeSetup=true;a.requestPermissions(android.os.Build.VERSION.SDK_INT>=33?new String[]{Manifest.permission.CALL_PHONE,Manifest.permission.READ_PHONE_STATE,Manifest.permission.POST_NOTIFICATIONS}:new String[]{Manifest.permission.CALL_PHONE,Manifest.permission.READ_PHONE_STATE},304);}
            else enableBridge();
        });
        LinearLayout more=a.card();a.button(more,"Advanced & help",()->{a.screen="Advanced";a.render();});
        a.button(more,"Sign out",()->new AlertDialog.Builder(a).setMessage("Sign out and pause syncing?").setNegativeButton("Cancel",null).setPositiveButton("Sign out",(d,w)->a.logout()).show());
    }
    interface Change{void run(boolean enabled);}
    void toggle(LinearLayout box,String label,boolean value,Change change){Switch control=new Switch(a);control.setText(label);control.setTextColor(MainActivity.INK);control.setTextSize(15);control.setPadding(0,a.dp(12),0,a.dp(12));control.setMinHeight(a.dp(56));control.setChecked(value);box.addView(control,new LinearLayout.LayoutParams(-1,-2));control.setOnCheckedChangeListener((view,checked)->change.run(checked));}
    boolean hasFolder(){String folder=prefs().getString("folder","");for(UriPermission grant:a.getContentResolver().getPersistedUriPermissions())if(grant.isReadPermission()&&grant.getUri().toString().equals(folder))return true;return false;}
    void chooseFolder(){a.startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION),302);}
    void chooseSims(){
        if(a.checkSelfPermission(Manifest.permission.READ_PHONE_STATE)!=PackageManager.PERMISSION_GRANTED){a.pendingSimSetup=true;a.requestPermissions(new String[]{Manifest.permission.READ_PHONE_STATE},305);return;}
        List<android.telecom.PhoneAccountHandle> accounts=SimTracking.accounts(a);
        if(accounts.isEmpty()){a.notice("No SIM account found. Check that your SIM is active.");return;}
        LinearLayout body=a.column();body.setPadding(a.dp(20),0,a.dp(20),a.dp(12));Map<String,Spinner> choices=new LinkedHashMap<>();int index=0;
        for(android.telecom.PhoneAccountHandle account:accounts){String key=SimTracking.key(account.getId());a.text(body,SimTracking.label(a,account,++index),16,true);Spinner select=new Spinner(a);select.setAdapter(new ArrayAdapter<String>(a,android.R.layout.simple_spinner_dropdown_item,new String[]{"Leads only","All calls","Off"}));String mode=SimTracking.mode(a,key);select.setSelection(mode.equals("all")?1:mode.equals("off")?2:0);select.setMinimumHeight(a.dp(52));body.addView(select);choices.put(key,select);}
        a.text(body,"New numbers",14,true);Spinner owner=new Spinner(a);owner.setAdapter(new ArrayAdapter<String>(a,android.R.layout.simple_spinner_dropdown_item,new String[]{"Assign new leads to me","Keep new leads unassigned"}));owner.setSelection("unassigned".equals(SimTracking.policy(a).optString("assignment"))?1:0);body.addView(owner);
        new AlertDialog.Builder(a).setTitle("Call tracking").setView(a.dialogBody(body)).setNegativeButton("Cancel",null).setPositiveButton("OK",(d,w)->{
            JSONObject sims=new JSONObject();boolean all=false,enabled=false;try{for(Map.Entry<String,Spinner> entry:choices.entrySet()){int selected=entry.getValue().getSelectedItemPosition();String mode=selected==1?"all":selected==2?"off":"leads";sims.put(entry.getKey(),mode);all|=mode.equals("all");enabled|=!mode.equals("off");}}catch(JSONException e){a.notice("Unable to save. Please try again.");return;}
            String assignment=owner.getSelectedItemPosition()==1?"unassigned":"self";boolean tracking=enabled;
            if(all)new AlertDialog.Builder(a).setTitle("Track all calls?").setMessage("All calls on the selected SIMs will sync to CRM, including personal numbers. New numbers become leads. Matched recordings also upload when recording sync is on.").setNegativeButton("Cancel",null).setPositiveButton("OK",(dialog,which)->save(sims,assignment,true,tracking)).show();
            else save(sims,assignment,false,tracking);
        }).show();
    }
    void save(JSONObject sims,String assignment,boolean consent,boolean enabled){java.util.concurrent.atomic.AtomicBoolean saved=new java.util.concurrent.atomic.AtomicBoolean();a.work(()->{try{JSONObject policy=SyncEngine.requestApi(a,"/v1/tracking-preferences","PUT",new JSONObject().put("sims",sims).put("assignment",assignment).put("consent",consent));prefs().edit().putString("trackingPolicy",policy.toString()).putLong("trackingSince",System.currentTimeMillis()).commit();saved.set(true);}catch(Exception e){a.failure(e);}},()->{if(saved.get()){a.render();a.setSyncEnabled(enabled);}});}
    void setupCaller(){
        if(android.os.Build.VERSION.SDK_INT<29){a.notice("Caller details need Android 10 or later.");a.render();return;}
        android.app.role.RoleManager roles=a.getSystemService(android.app.role.RoleManager.class);
        if(!roles.isRoleAvailable(android.app.role.RoleManager.ROLE_CALL_SCREENING)){a.notice("Caller details are unavailable on this phone.");a.render();return;}
        a.pendingCallerSetup=true;
        if(!roles.isRoleHeld(android.app.role.RoleManager.ROLE_CALL_SCREENING)){a.startActivityForResult(roles.createRequestRoleIntent(android.app.role.RoleManager.ROLE_CALL_SCREENING),307);return;}
        if(!android.provider.Settings.canDrawOverlays(a)){a.startActivityForResult(new Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,Uri.parse("package:"+a.getPackageName())),310);return;}
        a.pendingCallerSetup=false;prefs().edit().putBoolean("screenPop",true).commit();a.render();
    }
    void enableBridge(){a.pendingBridgeSetup=false;prefs().edit().putBoolean("clickToCall",true).commit();a.clickToCall.start();a.render();}
}
