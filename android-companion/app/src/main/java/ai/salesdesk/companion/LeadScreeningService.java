package ai.salesdesk.companion;

import android.content.Context;
import android.telecom.*;
import org.json.*;

/**
 * Caller information only: never blocks, silences or records calls.
 * When a call comes in, a card shows at once from the leads saved on the phone, then the CRM is asked for the full picture
 * (last work, next follow-up, a colleague's lead, or the probable state of a new number) and the card is filled in.
 */
public class LeadScreeningService extends CallScreeningService {
    @Override public void onScreenCall(Call.Details details){
        if(android.os.Build.VERSION.SDK_INT<29){respondToCall(details,new CallResponse.Builder().build());return;}
        if(details.getCallDirection()==Call.Details.DIRECTION_INCOMING)respondToCall(details,new CallResponse.Builder().setDisallowCall(false).setRejectCall(false).setSilenceCall(false).setSkipCallLog(false).setSkipNotification(false).build());
        if(details.getCallDirection()!=Call.Details.DIRECTION_INCOMING)return;
        if(!SecureConfig.loggedIn(this)||!SecureConfig.prefs(this).getBoolean("screenPop",false)||details.getHandle()==null)return;
        String country=SecureConfig.prefs(this).getString("country","91");
        String number=SyncEngine.normalize(details.getHandle().getSchemeSpecificPart(),country);
        if(number.length()<6)return;
        PhoneAccountHandle account=details.getAccountHandle();String key=account==null?"":SimTracking.key(account.getId());
        if(!SimTracking.allows(this,key,true))return;
        JSONObject quick=fromPhone(number,country);
        if(quick!=null)CallerCard.show(this,number,quick);
        Context app=getApplicationContext();
        new Thread(()->{
            try{JSONObject card=SyncEngine.requestApi(app,"/v1/caller/"+number,"GET",null);CallerCard.show(app,number,card);}
            catch(Exception ignored){/* offline: the card from the phone stays, or nothing is shown for a number not saved here */}
        }).start();
    }

    // the lead as saved on the phone at the last refresh, so something shows even before the CRM answers
    private JSONObject fromPhone(String number,String country){
        try{
            JSONObject workspace=new JSONObject(SecureConfig.prefs(this).getString("workspace","{}"));JSONArray leads=workspace.optJSONArray("leads");
            if(leads==null)return null;
            for(int i=0;i<leads.length();i++){JSONObject lead=leads.optJSONObject(i);
                if(lead==null||!number.equals(SyncEngine.normalize(lead.optString("phone"),country)))continue;
                String stage=lead.optString("deal");if(stage.isEmpty())stage=lead.optString("stage","New");
                return new JSONObject().put("found",true).put("own",true).put("id",lead.optString("id")).put("name",lead.optString("name")).put("company",lead.optString("company")).put("city",lead.optString("city")).put("state",lead.optString("state")).put("language",lead.optString("language")).put("stage",stage).put("owner","").put("number",lead.optString("phone"));
            }
        }catch(Exception ignored){}
        return null;
    }
}
