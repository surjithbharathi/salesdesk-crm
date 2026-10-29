package ai.salesdesk.companion;
import android.content.*;
import android.security.keystore.*;
import android.util.Base64;
import java.security.KeyStore;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;

final class SecureConfig {
    static String deviceId(Context c) { String id=prefs(c).getString("deviceId",""); if(id.isEmpty()){id=java.util.UUID.randomUUID().toString();prefs(c).edit().putString("deviceId",id).commit();} return id; }
    static boolean loggedIn(Context c) { return !prefs(c).getString("userId","").isEmpty() && prefs(c).contains("token"); }
    static String queueName(Context c) { return "calls-"+java.util.UUID.nameUUIDFromBytes((prefs(c).getString("endpoint","")+"/"+prefs(c).getString("userId","signed-out")).getBytes(java.nio.charset.StandardCharsets.UTF_8))+".sqlite"; }
    static void logout(Context c) { prefs(c).edit().putBoolean("clickToCall",false).putBoolean("callWhileLocked",false).commit(); c.stopService(new Intent(c,CallBridgeService.class)); SyncJob.schedule(c,false); prefs(c).edit().remove("token").remove("userId").remove("user").remove("workspace").remove("targets").remove("since").remove("trackingPolicy").remove("trackingSince").putBoolean("screenPop",false).putBoolean("postCallFeedback",false).putBoolean("unconnectedFeedback",false).putBoolean("enabled",false).commit(); }
    static android.content.SharedPreferences prefs(Context c) { return c.getSharedPreferences("sync", Context.MODE_PRIVATE); }
    static javax.crypto.SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias("salesdesk-device")) {
            KeyGenerator gen = KeyGenerator.getInstance("AES", "AndroidKeyStore");
            gen.init(new KeyGenParameterSpec.Builder("salesdesk-device", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build()); gen.generateKey();
        }
        return (javax.crypto.SecretKey) store.getKey("salesdesk-device", null);
    }
    static void token(Context c, String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        String encrypted = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)), Base64.NO_WRAP);
        prefs(c).edit().putString("token", encrypted).commit();
    }
    static String token(Context c) throws Exception {
        String[] parts = prefs(c).getString("token", "").split(":"); if (parts.length != 2) throw new Exception("Sign in to Salesdesk first");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), java.nio.charset.StandardCharsets.UTF_8);
    }
}
