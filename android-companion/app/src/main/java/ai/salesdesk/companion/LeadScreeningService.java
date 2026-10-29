package ai.salesdesk.companion;

import android.telecom.*;
import org.json.*;

/** Caller information only: never blocks, silences or records calls. */
public class LeadScreeningService extends CallScreeningService {
    @Override public void onScreenCall(Call.Details details){
        if(android.os.Build.VERSION.SDK_INT<29){respondToCall(details,new CallResponse.Builder().build());return;}
        if(details.getCallDirection()==Call.Details.DIRECTION_INCOMING)respondToCall(details,new CallResponse.Builder().setDisallowCall(false).setRejectCall(false).setSilenceCall(false).setSkipCallLog(false).setSkipNotification(false).build());
        if(!SecureConfig.loggedIn(this)||!SecureConfig.prefs(this).getBoolean("screenPop",false)||details.getHandle()==null)return;
        String number=SyncEngine.normalize(details.getHandle().getSchemeSpecificPart(),SecureConfig.prefs(this).getString("country","91"));
        PhoneAccountHandle account=details.getAccountHandle();String key=account==null?"":SimTracking.key(account.getId());
        try{JSONObject workspace=new JSONObject(SecureConfig.prefs(this).getString("workspace","{}"));JSONArray leads=workspace.optJSONArray("leads");
            if(leads==null)return;
            for(int i=0;i<leads.length();i++){JSONObject lead=leads.optJSONObject(i);if(lead==null||!number.equals(SyncEngine.normalize(lead.optString("phone"),SecureConfig.prefs(this).getString("country","91"))))continue;
                if(!SimTracking.allows(this,key,true))return;
                CallPrompts.popup(this,lead.optString("name"),lead.optString("company")+" · "+lead.optString("stage"),new android.content.Intent(this,MainActivity.class));return;
            }
        }catch(Exception ignored){}
    }
}
