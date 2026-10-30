package ai.salesdesk.companion;

import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.*;
import android.widget.*;
import org.json.*;

/** Presentation only; upload and permission checks stay in FeedbackActivity. */
final class FeedbackLayout {
    final FeedbackActivity a;
    FeedbackLayout(FeedbackActivity activity){a=activity;}
    int dp(int value){return (int)(value*a.getResources().getDisplayMetrics().density);}
    LinearLayout column(){LinearLayout view=new LinearLayout(a);view.setOrientation(LinearLayout.VERTICAL);return view;}
    GradientDrawable surface(int color,int radius){GradientDrawable shape=new GradientDrawable();shape.setColor(color);shape.setCornerRadius(dp(radius));return shape;}
    TextView text(LinearLayout parent,String value,int size,boolean bold){TextView view=new TextView(a);view.setText(value);view.setTextSize(size);view.setTextColor(bold?MainActivity.INK:MainActivity.MUTED);view.setTypeface(Typeface.create(bold?"sans-serif-medium":"sans-serif",Typeface.NORMAL));view.setPadding(0,dp(5),0,dp(5));parent.addView(view);return view;}
    LinearLayout card(LinearLayout parent){LinearLayout box=column();box.setPadding(dp(20),dp(16),dp(20),dp(16));box.setBackground(surface(Color.WHITE,20));LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(-1,-2);params.setMargins(0,0,0,dp(14));parent.addView(box,params);return box;}
    Button button(LinearLayout parent,String value,boolean primary,Runnable action){Button view=new Button(a);view.setText(value);view.setAllCaps(false);view.setTextSize(15);view.setTextColor(primary?MainActivity.ONACCENT:MainActivity.PURPLE);view.setBackgroundTintList(null);view.setBackground(surface(primary?MainActivity.ACCENT:MainActivity.SOFT,10));view.setMinHeight(dp(50));LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(-1,-2);params.setMargins(0,dp(6),0,dp(6));parent.addView(view,params);view.setOnClickListener(v->action.run());return view;}
    String contact(){try{JSONObject workspace=new JSONObject(SecureConfig.prefs(a).getString("workspace","{}"));JSONArray calls=workspace.optJSONArray("mobileCalls"),leads=workspace.optJSONArray("leads");if(calls!=null)for(int i=0;i<calls.length();i++){JSONObject call=calls.optJSONObject(i);if(call==null||!a.callId.equals(call.optString("id")))continue;if(leads!=null)for(int j=0;j<leads.length();j++){JSONObject lead=leads.optJSONObject(j);if(lead!=null&&call.optString("leadId").equals(lead.optString("id")))return lead.optString("name","Recent call");}return call.optString("phone","Recent call");}}catch(Exception ignored){}return "Recent call";}
    void render(){
        LinearLayout root=column();root.setBackgroundColor(MainActivity.BG);root.setOnApplyWindowInsetsListener((view,insets)->{if(android.os.Build.VERSION.SDK_INT>=30){android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.ime());view.setPadding(bars.left,bars.top,bars.right,bars.bottom);}else view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});a.setContentView(root);root.requestApplyInsets();a.getWindow().setStatusBarColor(MainActivity.BG);a.getWindow().setNavigationBarColor(Color.WHITE);a.getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        LinearLayout header=column();header.setPadding(dp(22),dp(12),dp(22),dp(12));text(header,"Call feedback",26,true);root.addView(header);
        ScrollView scroll=new ScrollView(a);LinearLayout body=column();body.setPadding(dp(18),dp(4),dp(18),dp(12));scroll.addView(body);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        LinearLayout identity=card(body);text(identity,contact(),20,true);text(identity,"What happened on this call?",14,false);
        LinearLayout notes=card(body);text(notes,"Quick note",16,true);a.note=new EditText(a);a.note.setHint("Discussion, outcome or next step…");a.note.setTextSize(16);a.note.setTextColor(MainActivity.INK);a.note.setHintTextColor(MainActivity.MUTED);a.note.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE|android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);a.note.setMinLines(3);a.note.setGravity(Gravity.TOP);a.note.setPadding(dp(12),dp(12),dp(12),dp(12));a.note.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(4000)});a.note.setBackground(surface(MainActivity.BG,10));notes.addView(a.note);
        LinearLayout voice=card(body);text(voice,"Voice note",16,true);text(voice,"Record your feedback · up to 2 minutes",13,false);a.record=button(voice,"Record voice note",false,a::toggleRecording);a.listen=button(voice,"Listen to voice note",false,a::preview);a.listen.setEnabled(false);
        LinearLayout footer=column();footer.setPadding(dp(18),dp(8),dp(18),dp(12));footer.setBackgroundColor(Color.WHITE);a.status=text(footer,"Add a note, a voice note, or both.",13,false);a.status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);a.send=button(footer,"Save feedback",true,a::upload);button(footer,"Not now",false,a::closeFeedback);root.addView(footer);
    }
}
