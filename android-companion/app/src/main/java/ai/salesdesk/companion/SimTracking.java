package ai.salesdesk.companion;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.telecom.PhoneAccountHandle;
import android.telecom.TelecomManager;
import org.json.JSONObject;
import java.util.Collections;
import java.util.List;

final class SimTracking {
    static String key(String account){
        if(account==null||account.isEmpty())return "";
        try{byte[] bytes=java.security.MessageDigest.getInstance("SHA-256").digest(account.getBytes(java.nio.charset.StandardCharsets.UTF_8));StringBuilder result=new StringBuilder();for(byte b:bytes)result.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return result.toString();}catch(Exception e){throw new IllegalStateException(e);}
    }
    static List<PhoneAccountHandle> accounts(Context c){
        if(c.checkSelfPermission(Manifest.permission.READ_PHONE_STATE)!=PackageManager.PERMISSION_GRANTED)return Collections.emptyList();
        try{return c.getSystemService(TelecomManager.class).getCallCapablePhoneAccounts();}catch(SecurityException e){return Collections.emptyList();}
    }
    static JSONObject policy(Context c){try{return new JSONObject(SecureConfig.prefs(c).getString("trackingPolicy","{}"));}catch(Exception e){return new JSONObject();}}
    static String label(Context c,PhoneAccountHandle account,int index){
        String fallback="SIM account "+index;
        if(c.checkSelfPermission(Manifest.permission.READ_PHONE_NUMBERS)!=PackageManager.PERMISSION_GRANTED)return fallback;
        try{android.telecom.PhoneAccount details=c.getSystemService(TelecomManager.class).getPhoneAccount(account);return details==null||details.getLabel()==null?fallback:String.valueOf(details.getLabel());}
        catch(SecurityException e){return fallback;}
    }
    static String mode(Context c,String key){JSONObject sims=policy(c).optJSONObject("sims");return sims==null||sims.length()==0?"leads":sims.optString(key,"off");}
    static boolean allows(Context c,String key,boolean known){String mode=mode(c,key);return "all".equals(mode)||("leads".equals(mode)&&known);}
}
