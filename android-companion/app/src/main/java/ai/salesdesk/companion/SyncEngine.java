package ai.salesdesk.companion;
import android.Manifest;
import android.content.*;
import android.content.pm.PackageManager;
import android.database.*;
import android.database.sqlite.*;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.*;
import java.net.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.*;

final class SyncEngine {
    static class HttpError extends IOException { final int code; HttpError(int code) { super("Sync request rejected ("+code+")"); this.code=code; } }
    static final AtomicBoolean running = new AtomicBoolean(false);
    static volatile boolean cancelled;
    static void cancel() { cancelled = true; }
    static void check(Context c) throws Exception { if (cancelled || !SecureConfig.loggedIn(c) || !SecureConfig.prefs(c).getBoolean("enabled", false)) throw new Exception("Sync paused; sign in and enable business sync"); }
    static String request(Context c, String path, String method, byte[] bytes, Map<String,String> headers) throws Exception {
        check(c); return transport(c,path,method,bytes,headers,true);
    }
    static JSONObject requestApi(Context c,String path,String method,JSONObject body) throws Exception {
        return new JSONObject(transport(c,path,method,body==null?null:body.toString().getBytes("UTF-8"),Collections.singletonMap("Content-Type","application/json"),!path.equals("/v1/login")));
    }
    static String transport(Context c,String path,String method,byte[] bytes,Map<String,String> headers,boolean authenticated) throws Exception {
        String base = SecureConfig.prefs(c).getString("endpoint", ""); URL url = new URL(base + path);
        if (!url.getProtocol().equals("https") && !(BuildConfig.DEBUG && url.getProtocol().equals("http") && (url.getHost().equals("127.0.0.1") || url.getHost().equals("localhost")))) throw new Exception("HTTPS is required (debug USB loopback is supported)");
        if (url.getUserInfo() != null || url.getQuery() != null || url.getRef() != null) throw new Exception("Invalid endpoint");
        HttpURLConnection connection = (HttpURLConnection)url.openConnection(); connection.setInstanceFollowRedirects(false); connection.setRequestMethod(method); connection.setConnectTimeout(15000); connection.setReadTimeout(30000);
        if(authenticated) connection.setRequestProperty("Authorization", "Bearer " + SecureConfig.token(c));
        for (Map.Entry<String,String> entry : headers.entrySet()) connection.setRequestProperty(entry.getKey(), entry.getValue());
        try {
            if (bytes != null) { connection.setDoOutput(true); connection.setFixedLengthStreamingMode(bytes.length); try (OutputStream out = connection.getOutputStream()) { out.write(bytes); } }
            int code = connection.getResponseCode(); if (code < 200 || code >= 300) throw new HttpError(code);
            try (InputStream in = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) { byte[] buffer = new byte[4096]; int n; while ((n=in.read(buffer)) != -1) { if (out.size() + n > 1048576) throw new Exception("Response too large"); out.write(buffer,0,n); } return out.toString("UTF-8"); }
        } finally { connection.disconnect(); }
    }
    static String normalize(String value, String country) { String number = value.replaceAll("[^0-9]", ""); if (value.trim().startsWith("+")) return number; if (number.startsWith("00")) return number.substring(2); if (number.startsWith("0")) number = number.substring(1); return number.length() == 10 ? country + number : number; }
    static File recording(Context c,String id) throws Exception {
        if(!id.matches("[a-f0-9-]{36}"))throw new Exception("Invalid recording");
        URL url=new URL(SecureConfig.prefs(c).getString("endpoint","")+"/v1/recordings/"+id);
        if(!url.getProtocol().equals("https")&&!(BuildConfig.DEBUG&&url.getProtocol().equals("http")&&(url.getHost().equals("127.0.0.1")||url.getHost().equals("localhost"))))throw new Exception("HTTPS required");
        HttpURLConnection connection=(HttpURLConnection)url.openConnection();connection.setInstanceFollowRedirects(false);connection.setRequestProperty("Authorization","Bearer "+SecureConfig.token(c));connection.setConnectTimeout(15000);connection.setReadTimeout(30000);
        File file=File.createTempFile("crm-recording-",".audio",c.getCacheDir());boolean complete=false;
        try{int code=connection.getResponseCode();if(code!=200)throw new HttpError(code);try(InputStream in=connection.getInputStream();OutputStream out=new FileOutputStream(file)){byte[] buf=new byte[8192];int n,total=0;while((n=in.read(buf))!=-1){total+=n;if(total>20*1024*1024)throw new IOException("Recording exceeds 20 MiB");out.write(buf,0,n);}}complete=true;return file;}finally{connection.disconnect();if(!complete)file.delete();}
    }
    static ArrayList<JSONObject> calls(SQLiteDatabase db) throws Exception {
        ArrayList<JSONObject> list = new ArrayList<>();
        try (Cursor cur = db.rawQuery("SELECT * FROM calls WHERE uploaded=0 ORDER BY started DESC LIMIT 500", null)) { while (cur.moveToNext()) { JSONObject row=new JSONObject(); for (String col : cur.getColumnNames()) row.put(col, cur.isNull(cur.getColumnIndexOrThrow(col)) ? "" : cur.getString(cur.getColumnIndexOrThrow(col))); list.add(row); } }
        return list;
    }
    static long duration(Context c, Uri uri) { try (MediaMetadataRetriever mm = new MediaMetadataRetriever()) { mm.setDataSource(c,uri); return Long.parseLong(mm.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION))/1000; } catch (Exception e) { return 0; } }
    static long modified(Context c, Uri uri) { try (Cursor cur=c.getContentResolver().query(uri,new String[]{DocumentsContract.Document.COLUMN_LAST_MODIFIED},null,null,null)) { return cur!=null && cur.moveToFirst() ? cur.getLong(0) : 0; } catch (Exception e) { return 0; } }
    static void matchFolder(Context c, SQLiteDatabase db, ArrayList<JSONObject> rows) throws Exception {
        String saved=SecureConfig.prefs(c).getString("folder", ""); if(saved.isEmpty() || rows.isEmpty()) return;
        Set<String> eligible=new HashSet<>(), reserved=new HashSet<>(), reservedDocuments=new HashSet<>();
        long earliest=Long.MAX_VALUE;
        for(JSONObject row:rows) if(row.getString("uri").isEmpty() && row.getLong("duration")>0) {
            eligible.add(row.getString("local_id")); earliest=Math.min(earliest,row.getLong("started"));
        }
        if(eligible.isEmpty()) return;
        try(Cursor used=db.rawQuery("SELECT uri FROM calls WHERE uri IS NOT NULL AND uri<>''",null)) {
            while(used.moveToNext()) {
                String value=used.getString(0); reserved.add(value);
                try { Uri uri=Uri.parse(value); reservedDocuments.add(uri.getAuthority()+"/"+DocumentsContract.getDocumentId(uri)); } catch(Exception ignored) {}
            }
        }
        // Nearby personal calls block ambiguous matches, but are never stored or uploaded.
        ArrayList<RecordingMatcher.Call> timings=new ArrayList<>();
        try(Cursor log=c.getContentResolver().query(CallLog.Calls.CONTENT_URI,
            new String[]{CallLog.Calls._ID,CallLog.Calls.DATE,CallLog.Calls.DURATION},
            CallLog.Calls.DATE+">=?",new String[]{String.valueOf(Math.max(0,earliest-86400000L-120000L))},CallLog.Calls.DATE+" DESC")) {
            if(log==null) return;
            while(log.moveToNext()) {
                check(c); if(timings.size()>=5000) return; // Incomplete evidence: require manual review.
                long start=log.getLong(1); String id=log.getString(0)+"-"+start;
                timings.add(new RecordingMatcher.Call(id,start,log.getLong(2),eligible.contains(id)));
            }
        }
        Uri tree=Uri.parse(saved), children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
        ArrayList<RecordingMatcher.Audio> audio=new ArrayList<>();
        try(Cursor files=c.getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_LAST_MODIFIED},null,null,null)) {
            if(files==null) return;
            int seen=0; while(files.moveToNext()) {
                check(c); if(++seen>5000) return;
                String mime=files.getString(1); if(mime==null || !mime.startsWith("audio/")) continue;
                long changed=files.getLong(2); if(changed>System.currentTimeMillis()-15000) continue;
                boolean relevant=false;
                for(RecordingMatcher.Call call:timings) if(call.eligible && RecordingMatcher.nearEnd(call,changed)) { relevant=true; break; }
                if(!relevant) continue;
                Uri uri=DocumentsContract.buildDocumentUriUsingTree(tree,files.getString(0));
                if(!reserved.contains(uri.toString()) && !reservedDocuments.contains(uri.getAuthority()+"/"+DocumentsContract.getDocumentId(uri))) audio.add(new RecordingMatcher.Audio(uri.toString(),changed,duration(c,uri)));
            }
        }
        Map<String,String> matches=RecordingMatcher.match(timings,audio,reserved);
        for(Map.Entry<String,String> match:matches.entrySet()) {
            ContentValues values=new ContentValues(); values.put("uri",match.getValue()); values.put("mode","auto");
            db.update("calls",values,"local_id=? AND uploaded=0 AND (uri IS NULL OR uri='')",new String[]{match.getKey()});
        }
    }

    static void run(Context c) throws Exception {
        if(!running.compareAndSet(false,true)) return; cancelled=false;
        try(QueueDb helper=new QueueDb(c)) {
            check(c); if(c.checkSelfPermission(Manifest.permission.READ_CALL_LOG)!=PackageManager.PERMISSION_GRANTED) throw new Exception("Call-log permission missing");
            if(c.checkSelfPermission(Manifest.permission.READ_PHONE_STATE)==PackageManager.PERMISSION_GRANTED && c.getSystemService(android.telecom.TelecomManager.class).isInCall()) return;
            SQLiteDatabase db=helper.getWritableDatabase();
            JSONArray targets; boolean online=true;
            try { targets=new JSONArray(request(c,"/v1/targets","GET",null,Collections.emptyMap())); SecureConfig.prefs(c).edit().putString("targets",targets.toString()).commit(); }
            catch(Exception e) { if(e instanceof HttpError && (((HttpError)e).code==401 || ((HttpError)e).code==403)) throw e; targets=new JSONArray(SecureConfig.prefs(c).getString("targets","[]")); online=false; }
            Set<String> phones=new HashSet<>(); for(int i=0;i<targets.length();i++) phones.add(targets.getJSONObject(i).getString("phone"));
            long since=SecureConfig.prefs(c).getLong("since",System.currentTimeMillis()); String country=SecureConfig.prefs(c).getString("country","91");
            try(Cursor log=c.getContentResolver().query(CallLog.Calls.CONTENT_URI,new String[]{CallLog.Calls._ID,CallLog.Calls.NUMBER,CallLog.Calls.DATE,CallLog.Calls.DURATION,CallLog.Calls.TYPE},CallLog.Calls.DATE+">=?",new String[]{String.valueOf(Math.max(since,System.currentTimeMillis()-30L*86400000))},CallLog.Calls.DATE+" DESC")) {
                int count=0; while(log!=null && log.moveToNext() && count++<5000) { check(c); String phone=normalize(log.getString(1)==null?"":log.getString(1),country); if(!phones.contains(phone)) continue;
                    int type=log.getInt(4); String direction=type==CallLog.Calls.INCOMING_TYPE?"Incoming":type==CallLog.Calls.OUTGOING_TYPE?"Outgoing":type==CallLog.Calls.MISSED_TYPE?"Missed":type==CallLog.Calls.REJECTED_TYPE?"Rejected":""; if(direction.isEmpty()) continue;
                    long start=log.getLong(2), seconds=log.getLong(3); if(start+seconds*1000>System.currentTimeMillis()-15000) continue;
                    ContentValues v=new ContentValues(); v.put("local_id",log.getString(0)+"-"+start); v.put("phone",phone); v.put("started",start); v.put("duration",seconds); v.put("direction",direction); db.insertWithOnConflict("calls",null,v,SQLiteDatabase.CONFLICT_IGNORE);
                }
            }
            int synced=0, uploaded=0;
            if(!online) { SecureConfig.prefs(c).edit().putString("status","Offline: business calls queued locally using the last assigned-lead list. Retry when connected.").apply(); return; }
            for(JSONObject row:calls(db)) {
                check(c); if(!phones.contains(row.getString("phone"))) continue;
                String remote=row.getString("remote_id");
                if(remote.isEmpty()) { JSONObject payload=new JSONObject().put("localId",row.getString("local_id")).put("phone",row.getString("phone")).put("startedAt",row.getLong("started")).put("duration",row.getLong("duration")).put("direction",row.getString("direction"));
                    remote=new JSONObject(request(c,"/v1/calls","POST",payload.toString().getBytes("UTF-8"),Collections.singletonMap("Content-Type","application/json"))).getString("id"); ContentValues v=new ContentValues(); v.put("remote_id",remote); db.update("calls",v,"local_id=?",new String[]{row.getString("local_id")}); synced++; }
            }
            // Publish call logs first: scanning/reading audio must not delay the CRM timeline.
            ArrayList<JSONObject> matchable=calls(db);
            matchable.removeIf(row->!phones.contains(row.optString("phone")));
            matchFolder(c,db,matchable);
            for(JSONObject row:calls(db)) {
                check(c); if(!phones.contains(row.getString("phone"))) continue;
                String remote=row.getString("remote_id");
                if(remote.isEmpty() || row.getString("uri").isEmpty()) continue;
                Uri uri=Uri.parse(row.getString("uri")); long seconds=duration(c,uri); if(seconds<1) continue;
                byte[] bytes; try(InputStream in=c.getContentResolver().openInputStream(uri); ByteArrayOutputStream out=new ByteArrayOutputStream()) { if(in==null) continue; byte[] buf=new byte[8192]; int n; while((n=in.read(buf))!=-1) { check(c); if(out.size()+n>20*1024*1024) throw new Exception("Recording exceeds 20 MiB"); out.write(buf,0,n); } bytes=out.toByteArray(); }
                Map<String,String> headers=new HashMap<>(); headers.put("Content-Type","application/octet-stream"); headers.put("X-Match-Mode",row.getString("mode")); headers.put("X-Audio-Duration",String.valueOf(seconds)); headers.put("X-File-Modified",String.valueOf(modified(c,uri)));
                request(c,"/v1/calls/"+remote+"/recording","PUT",bytes,headers); ContentValues v=new ContentValues(); v.put("uploaded",1); db.update("calls",v,"local_id=?",new String[]{row.getString("local_id")}); uploaded++;
            }
            SecureConfig.prefs(c).edit().putString("status","Updated "+android.text.format.DateFormat.getTimeFormat(c).format(new java.util.Date())+" · "+synced+" new calls · "+uploaded+" recordings").apply();
        } finally { running.set(false); }
    }
}
