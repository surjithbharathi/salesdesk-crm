package ai.salesdesk.companion;

import android.app.*;
import android.os.*;
import android.widget.*;
import android.media.MediaRecorder;
import java.io.File;
import java.util.Collections;
import org.json.JSONObject;

/** A user-started voice note; never captures live call audio. */
public class FeedbackActivity extends Activity {
    String callId,userId,clientId=java.util.UUID.randomUUID().toString(),textId=java.util.UUID.randomUUID().toString();File audio;MediaRecorder recorder;boolean busy,voiceUploaded;
    EditText note;TextView status;Button record,send,listen;android.media.MediaPlayer player;boolean pendingMic;long recordingAt;
    final Handler timerHandler=new Handler(Looper.getMainLooper());
    final Runnable tick=new Runnable(){public void run(){if(recorder!=null){long seconds=(SystemClock.elapsedRealtime()-recordingAt)/1000;status.setText(String.format(java.util.Locale.ROOT,"Recording %d:%02d · Tap Stop when done",seconds/60,seconds%60));timerHandler.postDelayed(this,500);}}};
    @Override public void onCreate(Bundle state){super.onCreate(state);callId=getIntent().getStringExtra("callId");userId=getIntent().getStringExtra("userId");
        if(callId==null||!callId.matches("[a-f0-9-]{36}")||!validUser()){finish();return;}
        getWindow().setFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE,android.view.WindowManager.LayoutParams.FLAG_SECURE);
        new FeedbackLayout(this).render();
        if(android.os.Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,this::closeFeedback);
    }
    boolean validUser(){return SecureConfig.loggedIn(this)&&userId!=null&&userId.equals(SecureConfig.prefs(this).getString("userId",""));}
    void toggleRecording(){if(busy||voiceUploaded)return;if(recorder!=null){stopRecording();return;}
        if(checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)!=android.content.pm.PackageManager.PERMISSION_GRANTED){pendingMic=true;requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO},306);return;}
        if(checkSelfPermission(android.Manifest.permission.READ_PHONE_STATE)!=android.content.pm.PackageManager.PERMISSION_GRANTED){status.setText("Grant phone-state permission in Preferences to ensure a call is not active.");return;}
        if(getSystemService(android.telecom.TelecomManager.class).isInCall()){status.setText("Finish the call before recording feedback.");return;}
        stopPreview();listen.setEnabled(false);try{if(audio!=null)audio.delete();audio=File.createTempFile("voice-feedback-",".m4a",getCacheDir());recorder=new MediaRecorder();recorder.setAudioSource(MediaRecorder.AudioSource.MIC);recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);recorder.setOutputFile(audio.getAbsolutePath());recorder.setMaxDuration(120000);recorder.setMaxFileSize(5*1024*1024);recorder.setOnInfoListener((r,what,extra)->stopRecording());recorder.prepare();recorder.start();recordingAt=SystemClock.elapsedRealtime();timerHandler.post(tick);record.setText("Stop recording");status.setText("Recording your feedback · maximum 2 minutes");}catch(Exception e){stopRecording();status.setText("Unable to record. Check microphone access.");}
    }
    void stopRecording(){if(recorder==null)return;timerHandler.removeCallbacks(tick);try{recorder.stop();status.setText("Voice note ready. Listen or save your feedback.");}catch(Exception e){if(audio!=null)audio.delete();audio=null;status.setText("Recording was too short. Try again.");}finally{recorder.release();recorder=null;record.setText("Record again");listen.setEnabled(audio!=null);}}
    void stopPreview(){if(player!=null){player.release();player=null;}if(listen!=null)listen.setText("Listen to voice note");}
    void preview(){if(player!=null){stopPreview();return;}if(audio==null||busy)return;try{player=new android.media.MediaPlayer();player.setDataSource(audio.getAbsolutePath());player.setOnCompletionListener(p->stopPreview());player.prepare();player.start();listen.setText("Stop playback");}catch(Exception e){stopPreview();status.setText("Voice note unavailable. Please record again.");}}
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);if(request==306&&pendingMic){pendingMic=false;if(checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)==android.content.pm.PackageManager.PERMISSION_GRANTED)toggleRecording();else status.setText("Microphone access was not allowed. You can type your feedback instead.");}}
    void upload(){if(busy||!validUser())return;stopRecording();stopPreview();String text=note.getText().toString().trim();if(text.isEmpty()&&audio==null){status.setText("Add text or record a voice note first.");return;}
        busy=true;send.setEnabled(false);send.setText("Saving…");record.setEnabled(false);note.setEnabled(false);new Thread(()->{try{if(!validUser())throw new Exception("Account changed. Reopen feedback.");
            if(audio!=null&&!voiceUploaded){byte[] bytes=java.nio.file.Files.readAllBytes(audio.toPath());SyncEngine.transport(this,"/v1/calls/"+callId+"/feedback","PUT",bytes,Collections.singletonMap("X-Feedback-Id",clientId),true);voiceUploaded=true;}
            if(!text.isEmpty()) SyncEngine.requestApi(this,"/v1/calls/"+callId+"/feedback","POST",new JSONObject().put("clientId",textId).put("text",text));
            if(audio!=null)audio.delete();runOnUiThread(()->{busy=false;getSystemService(NotificationManager.class).cancel(callId.hashCode());Toast.makeText(this,"Feedback saved",Toast.LENGTH_LONG).show();finish();});
        }catch(Exception e){runOnUiThread(()->{busy=false;send.setEnabled(true);send.setText("Retry save");record.setEnabled(!voiceUploaded);status.setText("Could not finish saving. Your feedback is still here. Check your connection and retry.");});}}).start();
    }
    @Override protected void onStop(){stopRecording();stopPreview();super.onStop();}
    void closeFeedback(){if(busy)return;if(audio!=null||!note.getText().toString().trim().isEmpty())new AlertDialog.Builder(this).setTitle("Discard feedback?").setNegativeButton("Keep editing",null).setPositiveButton("Discard",(d,w)->finish()).show();else finish();}
    // Android 13+ uses the native callback registered above; this handles older devices.
    @android.annotation.SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed(){closeFeedback();}
    @Override protected void onDestroy(){timerHandler.removeCallbacksAndMessages(null);stopRecording();stopPreview();if(audio!=null&&!busy)audio.delete();super.onDestroy();}
}
