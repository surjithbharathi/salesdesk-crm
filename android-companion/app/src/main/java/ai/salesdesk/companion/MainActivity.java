package ai.salesdesk.companion;
import android.Manifest;
import android.app.*;
import android.os.Bundle;
import android.content.*;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaPlayer;
import android.net.Uri;
import android.view.*;
import android.widget.*;
import java.util.*;
import org.json.*;

/** Native user-scoped CRM. No customer fixtures or passwords are persisted. */
public class MainActivity extends Activity {
    final ClickToCall clickToCall=new ClickToCall(this);
    CallSyncWatcher visibleSync;
    @Override protected void onResume(){super.onResume();CallMonitorService.start(this);clickToCall.resume();visibleSync=new CallSyncWatcher(this);visibleSync.start();}
    @Override protected void onPause(){if(visibleSync!=null){visibleSync.close();visibleSync=null;}clickToCall.pause();super.onPause();}
    static final int PURPLE=0xff8a5a00,OIL=0xffe9a800,IRON=0xff1e2629,LEAF=0xff2f7d5b,SOFT=0xfffbeab8,LINE=0xffd9ddd8,ONIRON=0xffa8b3b0,INK=0xff22282a,MUTED=0xff5f6965,BG=0xfff2f3ef;
    boolean showSyncOptions,showCallingOptions,leadsToday,tasksToday=true,syncAfterCallLogPermission,pendingSimSetup,pendingRecordingSetup,pendingCallerSetup,pendingBridgeSetup;
    LinearLayout root,content;TextView syncStatus;String screen="My day",filter="All",search="",pendingCall;JSONObject workspace=new JSONObject();boolean busy;MediaPlayer player;
    final android.os.Handler handler=new android.os.Handler(android.os.Looper.getMainLooper());
    final Runnable update=new Runnable(){public void run(){if(syncStatus!=null)syncStatus.setText(SecureConfig.prefs(MainActivity.this).getString("status","Not yet synced."));handler.postDelayed(this,3000);}};
    int dp(int n){return (int)(n*getResources().getDisplayMetrics().density);}
    LinearLayout column(){LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.VERTICAL);return l;}
    TextView text(LinearLayout b,String value,int size,boolean bold){TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(INK);t.setFontFeatureSettings("kern");t.setTypeface(bold&&size>=20?Typeface.create("sans-serif-condensed",Typeface.BOLD):Typeface.create(bold?"sans-serif-medium":"sans-serif",Typeface.NORMAL));t.setLineSpacing(dp(2),1);t.setPadding(0,dp(5),0,dp(5));if(b.getGravity()==Gravity.CENTER)t.setGravity(Gravity.CENTER);b.addView(t);return t;}
    void caption(LinearLayout b,String s){text(b,s,13,false).setTextColor(MUTED);}
    GradientDrawable surface(int color,int radius){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));return d;}
    LinearLayout card(){LinearLayout c=column();c.setPadding(dp(18),dp(16),dp(18),dp(16));GradientDrawable bg=surface(Color.WHITE,10);bg.setStroke(dp(1),LINE);c.setBackground(bg);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.setMargins(0,0,0,dp(12));content.addView(c,p);return c;}
    EditText input(LinearLayout b,String label,String value){TextView title=text(b,label,12,true);title.setTextColor(MUTED);EditText e=new EditText(this);e.setId(View.generateViewId());title.setLabelFor(e.getId());e.setHint(label);e.setText(value);e.setSingleLine();e.setTextSize(15);e.setTextColor(INK);e.setHintTextColor(MUTED);e.setPadding(dp(14),dp(12),dp(14),dp(12));GradientDrawable bg=surface(Color.WHITE,10);bg.setStroke(dp(1),LINE);e.setBackground(bg);e.setMinHeight(dp(50));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.setMargins(0,dp(3),0,dp(12));b.addView(e,p);return e;}
    void button(LinearLayout b,String title,Runnable action){Button v=new Button(this);v.setText(title);v.setTextSize(13);v.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));v.setAllCaps(false);v.setTextColor(PURPLE);v.setMinHeight(dp(48));v.setMinimumHeight(dp(48));v.setPadding(dp(14),dp(8),dp(14),dp(8));v.setBackgroundTintList(null);v.setElevation(0);v.setStateListAnimator(null);GradientDrawable bg=surface(Color.WHITE,10);bg.setStroke(dp(1),LINE);v.setBackground(new android.graphics.drawable.RippleDrawable(android.content.res.ColorStateList.valueOf(0x18e9a800),bg,null));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.setMargins(0,dp(5),0,dp(5));b.addView(v,p);v.setOnClickListener(w->{try{action.run();}catch(Exception e){notice("Action failed. "+e.getMessage());}});}
    void primary(LinearLayout b,String title,Runnable action){button(b,title,action);Button v=(Button)b.getChildAt(b.getChildCount()-1);v.setTextColor(IRON);v.setTypeface(Typeface.create("sans-serif-condensed",Typeface.BOLD));v.setTextSize(16);v.setBackground(new android.graphics.drawable.RippleDrawable(android.content.res.ColorStateList.valueOf(0x33000000),surface(OIL,10),null));}
    String dateLabel(String raw){try{return android.text.format.DateFormat.getMediumDateFormat(this).format(Date.from(java.time.Instant.parse(raw)))+" · "+android.text.format.DateFormat.getTimeFormat(this).format(Date.from(java.time.Instant.parse(raw)));}catch(Exception ignored){return raw.isEmpty()?"No due date":raw;}}
    String joined(String a,String b){return a.isEmpty()?b:b.isEmpty()?a:a+" · "+b;}
    void badge(LinearLayout b,String value){TextView t=text(b,value,11,true);int color=value.equals("Done")||value.equals("Sync enabled")||value.equals("Enabled on this phone")?LEAF:PURPLE;t.setTextColor(color);t.setPadding(dp(9),dp(4),dp(9),dp(4));t.setBackground(surface(color==PURPLE?SOFT:0xffdcefe6,7));t.setLayoutParams(new LinearLayout.LayoutParams(-2,-2));}

    ImageView glyph(int resource,int color){ImageView i=new ImageView(this);i.setImageResource(resource);i.setColorFilter(color);i.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);return i;}
    LinearLayout horizontal(){LinearLayout r=new LinearLayout(this);r.setGravity(Gravity.CENTER_VERTICAL);return r;}
    void identity(LinearLayout card,String name,String detail,int icon){LinearLayout row=horizontal();ImageView avatar=glyph(icon,PURPLE);avatar.setPadding(dp(11),dp(11),dp(11),dp(11));avatar.setBackground(surface(SOFT,14));row.addView(avatar,new LinearLayout.LayoutParams(dp(44),dp(44)));LinearLayout labels=column();LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(0,-2,1);lp.setMargins(dp(12),0,0,0);row.addView(labels,lp);text(labels,name,16,true);if(!detail.isEmpty())caption(labels,detail);card.addView(row);}
    void section(String title,String detail){LinearLayout row=horizontal();TextView t=text(row,title,17,true);t.setLayoutParams(new LinearLayout.LayoutParams(0,-2,1));if(!detail.isEmpty())text(row,detail,12,false).setTextColor(MUTED);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.setMargins(0,dp(6),0,dp(10));content.addView(row,p);}
    void pair(LinearLayout parent,String first,Runnable a,String second,Runnable b){LinearLayout row=horizontal();LinearLayout left=column(),right=column();LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(0,-2,1),rp=new LinearLayout.LayoutParams(0,-2,1);lp.setMargins(0,0,dp(5),0);rp.setMargins(dp(5),0,0,0);row.addView(left,lp);row.addView(right,rp);button(left,first,a);button(right,second,b);parent.addView(row);}
    ScrollView dialogBody(LinearLayout body){ScrollView scroll=new ScrollView(this);scroll.addView(body);return scroll;}
    void notice(String s){new AlertDialog.Builder(this).setMessage(s).setPositiveButton("OK",null).show();}
    JSONArray rows(String key){JSONArray a=workspace.optJSONArray(key);return a==null?new JSONArray():a;}
    String leadName(String id){for(int i=0;i<rows("leads").length();i++){JSONObject l=rows("leads").optJSONObject(i);if(l!=null&&l.optString("id").equals(id))return l.optString("name");}return "Business contact";}
    String phoneName(String number){String country=SecureConfig.prefs(this).getString("country","91"),n=SyncEngine.normalize(number,country);for(int i=0;i<rows("leads").length();i++){JSONObject l=rows("leads").optJSONObject(i);if(l!=null&&SyncEngine.normalize(l.optString("phone"),country).equals(n))return l.optString("name");}return "Assigned business contact";}
    void work(Runnable task){work(task,()->{});}
    void work(Runnable task,Runnable complete){if(busy){notice("Please wait for the current request.");return;}busy=true;new Thread(()->{try{task.run();}finally{runOnUiThread(()->{busy=false;complete.run();});}}).start();}
    void failure(Exception e){runOnUiThread(()->{if(e instanceof SyncEngine.HttpError&&(((SyncEngine.HttpError)e).code==401||((SyncEngine.HttpError)e).code==403)){SyncJob.schedule(this,false);SecureConfig.prefs(this).edit().putBoolean("enabled",false).commit();notice("Session expired or access denied. Sign out and sign in again. Sync is paused.");}else notice("Request failed. Check connection and server. "+e.getMessage());});}
    @Override public void onCreate(Bundle state){super.onCreate(state);if(!BuildConfig.CRM_API_ORIGIN.equals(SecureConfig.prefs(this).getString("endpoint",""))){if(SecureConfig.loggedIn(this))SecureConfig.logout(this);SecureConfig.prefs(this).edit().putString("endpoint",BuildConfig.CRM_API_ORIGIN).commit();}if(!BuildConfig.DEBUG)getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE,WindowManager.LayoutParams.FLAG_SECURE);getWindow().setStatusBarColor(IRON);getWindow().getDecorView().setSystemUiVisibility(0);getWindow().setNavigationBarColor(IRON);if(state!=null){pendingCall=state.getString("pending");screen=state.getString("screen","My day");filter=state.getString("filter","All");search=state.getString("search","");showSyncOptions=state.getBoolean("syncOptions");showCallingOptions=state.getBoolean("callingOptions");leadsToday=state.getBoolean("leadsToday");tasksToday=state.getBoolean("tasksToday",true);}try{workspace=new JSONObject(SecureConfig.prefs(this).getString("workspace","{}"));}catch(Exception ignored){}render();handler.post(update);if(SecureConfig.loggedIn(this))refresh();}
    void render(){syncStatus=null;root=column();root.setBackgroundColor(BG);root.setOnApplyWindowInsetsListener((v,insets)->{if(android.os.Build.VERSION.SDK_INT>=30){android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars());v.setPadding(bars.left,bars.top,bars.right,bars.bottom);}else v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});setContentView(root);root.requestApplyInsets();if(!SecureConfig.loggedIn(this)){login();return;}
        LinearLayout bar=horizontal();bar.setBackgroundColor(IRON);bar.setPadding(dp(20),dp(10),dp(16),dp(12));LinearLayout heading=column();TextView brand=text(heading,"Salesdesk",12,true);brand.setTextColor(OIL);text(heading,screen.equals("Dashboard")?"Overview":screen,26,true).setTextColor(Color.WHITE);bar.addView(heading,new LinearLayout.LayoutParams(0,-2,1));ImageButton refresh=new ImageButton(this);refresh.setImageResource(R.drawable.ic_refresh_cw);refresh.setColorFilter(OIL);refresh.setPadding(dp(13),dp(13),dp(13),dp(13));refresh.setContentDescription("Refresh workspace");refresh.setBackground(surface(0xff2a3438,12));bar.addView(refresh,new LinearLayout.LayoutParams(dp(48),dp(48)));refresh.setOnClickListener(v->refresh());ImageButton preferences=new ImageButton(this);preferences.setImageResource(R.drawable.ic_settings_2);preferences.setContentDescription("Workspace menu");preferences.setColorFilter(OIL);preferences.setBackground(surface(0xff2a3438,12));bar.addView(preferences,new LinearLayout.LayoutParams(dp(48),dp(48)));preferences.setOnClickListener(this::workspaceMenu);root.addView(bar);
        ScrollView scroll=new ScrollView(this);scroll.setClipToPadding(false);scroll.setVerticalScrollBarEnabled(false);content=column();content.setPadding(dp(18),dp(6),dp(18),dp(18));scroll.addView(content);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        if(screen.equals("My day"))myDay();else if(screen.equals("Dashboard"))home();else if(screen.equals("Leads"))leads();else if(screen.equals("Tickets"))tickets();else if(screen.equals("Users"))workspaceUsers();else if(screen.equals("To-do"))tasks();else if(screen.equals("Activity"))activity();else if(screen.equals("Calls"))calls();else if(screen.equals("Advanced"))advancedPreferences();else settings();
        LinearLayout nav=horizontal();nav.setPadding(dp(8),dp(8),dp(8),dp(6));nav.setBackgroundColor(IRON);String[] names={"My day","Leads","Calls","To-do","Activity"};int[] icons={R.drawable.ic_house,R.drawable.ic_users_round,R.drawable.ic_phone,R.drawable.ic_calendar_check,R.drawable.ic_refresh_cw};for(int i=0;i<names.length;i++){final String target=names[i];boolean selected=screen.equals(target);LinearLayout item=column();item.setGravity(Gravity.CENTER);item.setPadding(0,dp(7),0,dp(3));item.setContentDescription(target);item.setSelected(selected);item.setFocusable(true);item.setMinimumHeight(dp(56));ImageView icon=glyph(icons[i],selected?OIL:ONIRON);icon.setPadding(dp(10),dp(5),dp(10),dp(5));if(selected)icon.setBackground(surface(0xff2a3438,12));item.addView(icon,new LinearLayout.LayoutParams(dp(46),dp(32)));text(item,target,10,selected).setTextColor(selected?OIL:ONIRON);nav.addView(item,new LinearLayout.LayoutParams(0,-2,1));item.setOnClickListener(v->{screen=target;render();});}root.addView(nav);
    }
    void login(){
        LinearLayout banner=column();banner.setBackgroundColor(IRON);banner.setPadding(dp(26),dp(64),dp(26),dp(30));text(banner,"Salesdesk",40,true).setTextColor(OIL);TextView tag=text(banner,"Calls, follow-ups and daily goals for the Devi Industries team.",15,false);tag.setTextColor(Color.WHITE);root.addView(banner);ScrollView scroll=new ScrollView(this);LinearLayout b=column();b.setPadding(dp(26),dp(24),dp(26),dp(24));scroll.addView(b);root.addView(scroll);
        text(b,"Sign in",26,true);
        caption(b,"Use the same username and password as web CRM. Your company connection is already configured — no IP address or server link needed.");
        EditText user=input(b,"Username",""),password=input(b,"Password","");user.setInputType(33);password.setInputType(129);
        primary(b,"Sign in",()->{
            String username=user.getText().toString().trim(),secret=password.getText().toString();if(username.isEmpty()||secret.isEmpty()){notice("Enter your CRM username and password.");return;}password.setText("");
            SecureConfig.prefs(this).edit().putString("endpoint",BuildConfig.CRM_API_ORIGIN).commit();
            work(()->{try{JSONObject r=SyncEngine.requestApi(this,"/v1/login","POST",new JSONObject().put("username",username).put("password",secret).put("deviceId",SecureConfig.deviceId(this)));JSONObject a=r.getJSONObject("user");SecureConfig.token(this,r.getString("token"));SecureConfig.prefs(this).edit().putString("userId",a.getString("id")).putString("user",a.toString()).remove("workspace").remove("kpiDay").remove("kpiEarned").remove("targets").putLong("since",System.currentTimeMillis()).putBoolean("enabled",false).putBoolean("clickToCall",false).putBoolean("callWhileLocked",false).commit();workspace=new JSONObject();runOnUiThread(this::render);loadWorkspace();}catch(Exception e){runOnUiThread(()->notice(e instanceof SyncEngine.HttpError?(((SyncEngine.HttpError)e).code==401?"Username or password is incorrect. Use the account created in web CRM.":"Company CRM is not ready or access was refused. Contact your administrator."):"Cannot reach your company CRM. Check your internet connection and try again."));}});
        });caption(b,"Password is never saved. Business call sync and background calling stay off until you enable them in Settings.");
    }
    void refresh(){work(()->{try{loadWorkspace();}catch(Exception e){failure(e);}});}
    void loadWorkspace()throws Exception{try{JSONObject policy=SyncEngine.requestApi(this,"/v1/tracking-preferences","GET",null);SecureConfig.prefs(this).edit().putString("trackingPolicy",policy.toString()).commit();}catch(SyncEngine.HttpError e){if(e.code!=404)throw e;}JSONObject d=SyncEngine.requestApi(this,"/v1/workspace","GET",null);SecureConfig.prefs(this).edit().putString("workspace",d.toString()).putLong("workspaceAt",System.currentTimeMillis()).commit();workspace=d;loadKpi();runOnUiThread(this::render);}
    /** Today's goals, streak and next call from the CRM. An older server without this endpoint just leaves the card out. */
    void loadKpi(){
        try{
            java.time.ZoneId zone=java.time.ZoneId.systemDefault();
            long start=java.time.LocalDate.now(zone).atStartOfDay(zone).toInstant().toEpochMilli();
            int offset=java.util.TimeZone.getDefault().getOffset(System.currentTimeMillis())/60000;
            JSONObject day=SyncEngine.requestApi(this,"/v1/kpi/day/"+offset+"/"+start+"/"+(start+86399999L),"GET",null);
            SecureConfig.prefs(this).edit().putString("kpiDay",day.toString()).commit();
            cheerForNew(day);
        }catch(Exception e){
            SecureConfig.prefs(this).edit().remove("kpiDay").commit();
        }
    }
    /** A short "Well done" when a badge, milestone, finished challenge or level is new since the last refresh. */
    void cheerForNew(JSONObject day){
        Map<String,String> earned=new LinkedHashMap<>();
        JSONObject level=day.optJSONObject("level");
        if(level!=null)earned.put("level:"+level.optInt("level"),"Level "+level.optInt("level")+": "+level.optString("name"));
        for(String key:new String[]{"badges","milestones"}){JSONArray items=day.optJSONArray(key);if(items!=null)for(int i=0;i<items.length();i++){JSONObject o=items.optJSONObject(i);if(o!=null&&o.optBoolean("earned"))earned.put(key+":"+o.optString("id"),o.optString("label"));}}
        JSONArray challenges=day.optJSONArray("challenges");
        if(challenges!=null)for(int i=0;i<challenges.length();i++){JSONObject o=challenges.optJSONObject(i);if(o!=null&&o.optBoolean("done"))earned.put("challenge:"+o.optString("id"),"Challenge done: "+o.optString("label"));}
        String before=SecureConfig.prefs(this).getString("kpiEarned",null);
        SecureConfig.prefs(this).edit().putString("kpiEarned",String.join("|",earned.keySet())).commit();
        if(before==null)return;
        Set<String> known=new HashSet<>(Arrays.asList(before.split("\\|")));
        List<String> fresh=new ArrayList<>();
        for(Map.Entry<String,String> e:earned.entrySet())if(!known.contains(e.getKey()))fresh.add(e.getValue());
        if(!fresh.isEmpty())runOnUiThread(()->Toast.makeText(this,"Well done. "+String.join(", ",fresh)+".",Toast.LENGTH_LONG).show());
    }
    void goalRow(LinearLayout card,String label,int value,int goal){
        boolean dark="dark".equals(card.getTag()),met=goal>0&&value>=goal;
        int ink=dark?Color.WHITE:INK,tint=met?(dark?0xff4fc08e:LEAF):OIL;
        LinearLayout row=horizontal();
        text(row,label,14,false).setTextColor(ink);((TextView)row.getChildAt(0)).setLayoutParams(new LinearLayout.LayoutParams(0,-2,1));
        text(row,value+" of "+goal,14,true).setTextColor(met?tint:ink);
        card.addView(row);
        ProgressBar bar=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);
        bar.setMax(Math.max(1,goal));bar.setProgress(Math.min(value,Math.max(1,goal)));
        bar.setProgressTintList(android.content.res.ColorStateList.valueOf(tint));
        bar.setProgressBackgroundTintList(android.content.res.ColorStateList.valueOf(dark?0xff3a454a:0xffe3e6e1));
        bar.setContentDescription(label+", "+value+" of "+goal);
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,dp(8));p.setMargins(0,0,0,dp(8));
        card.addView(bar,p);
    }
    void lightCaption(LinearLayout box,String value){text(box,value,13,false).setTextColor(ONIRON);}
    static final int RED=0xffbf3b2b;
    String boardPeriod="week";JSONArray monthRows=null;
    void chip(LinearLayout row,String label,boolean on){
        TextView t=text(row,label,12,on);t.setTextColor(on?0xff7a4e00:MUTED);t.setPadding(dp(10),dp(7),dp(10),dp(7));
        t.setBackground(surface(on?0xfffbeab8:0xffeceee9,10));
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(0,-2,1);p.setMargins(0,0,dp(6),dp(6));t.setLayoutParams(p);
        t.setContentDescription(label+(on?", earned":", not yet"));
    }
    void chipRows(LinearLayout box,JSONArray items,boolean withProgress){
        for(int i=0;i<items.length();i+=2){
            LinearLayout row=horizontal();
            for(int j=i;j<Math.min(i+2,items.length());j++){
                JSONObject m=items.optJSONObject(j);if(m==null)continue;
                boolean on=m.optBoolean("earned");
                chip(row,on||!withProgress?m.optString("label"):m.optString("label")+" · "+m.optInt("value")+"/"+m.optInt("target"),on);
            }
            if(i+1>=items.length())row.addView(new View(this),new LinearLayout.LayoutParams(0,1,1));
            box.addView(row);
        }
    }
    int earnedCount(JSONArray items){int n=0;for(int i=0;i<items.length();i++)if(items.optJSONObject(i)!=null&&items.optJSONObject(i).optBoolean("earned"))n++;return n;}
    /** Level, next call, goal rings, team goal, challenges, badges, milestones, leaderboard and the stars of the week. */
    void myDay(){
        JSONObject d;
        try{d=new JSONObject(SecureConfig.prefs(this).getString("kpiDay","{}"));}catch(Exception e){d=new JSONObject();}
        JSONObject goal=d.optJSONObject("goal"),today=d.optJSONObject("today");
        JSONObject user=workspace.optJSONObject("user");
        String name=user==null?"":user.optString("name","").split(" ")[0];
        int hour=java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY);
        LinearLayout hero=card();hero.setBackground(surface(IRON,12));
        text(hero,(hour<12?"Good morning":hour<17?"Good afternoon":"Good evening")+(name.isEmpty()?"":", "+name),24,true).setTextColor(Color.WHITE);
        if(goal==null||today==null){
            lightCaption(hero,"Your goals and points appear here once the CRM answers. Use the refresh button at the top.");
            return;
        }
        JSONObject level=d.optJSONObject("level");
        if(level!=null){
            LinearLayout row=horizontal();
            TextView badge=new TextView(this);badge.setText(String.valueOf(level.optInt("level")));badge.setTextSize(26);badge.setTextColor(IRON);badge.setGravity(Gravity.CENTER);badge.setTypeface(Typeface.create("sans-serif-condensed",Typeface.BOLD));badge.setBackground(surface(OIL,6));badge.setContentDescription("Level "+level.optInt("level"));
            row.addView(badge,new LinearLayout.LayoutParams(dp(52),dp(52)));
            LinearLayout labels=column();LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(0,-2,1);lp.setMargins(dp(12),0,0,0);row.addView(labels,lp);
            text(labels,level.optString("name"),22,true).setTextColor(Color.WHITE);
            int floor=level.optInt("floor"),next=level.optInt("next",-1),points=level.optInt("points");
            ProgressBar lv=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);lv.setMax(next>floor?next-floor:1);lv.setProgress(next>floor?points-floor:1);
            lv.setProgressTintList(android.content.res.ColorStateList.valueOf(OIL));lv.setProgressBackgroundTintList(android.content.res.ColorStateList.valueOf(0xff3a454a));lv.setContentDescription("Level progress");
            labels.addView(lv,new LinearLayout.LayoutParams(-1,dp(8)));
            lightCaption(labels,(next>floor?level.optInt("toNext")+" points to "+level.optString("nextName"):"Top level")+" · "+points+" points in all");
            hero.addView(row);
        }
        int streak=d.optInt("streak");JSONObject week=d.optJSONObject("week"),month=d.optJSONObject("month");
        StringBuilder standing=new StringBuilder(streak>0?streak+(streak==1?" working day":" working days")+" in a row":"No streak yet");
        if(d.optInt("bestStreak")>streak)standing.append(" (best ").append(d.optInt("bestStreak")).append(")");
        if(week!=null&&week.optInt("rank")>0)standing.append(" · #").append(week.optInt("rank")).append(" of ").append(week.optInt("of")).append(" this week");
        if(month!=null&&month.optInt("rank")>0)standing.append(" · #").append(month.optInt("rank")).append(" this month");
        lightCaption(hero,standing.toString());
        int late=d.optInt("lateLeft");
        if(late>0){TextView t=text(hero,late+(late==1?" follow-up is late":" follow-ups are late"),14,true);t.setTextColor(0xffff8a7a);}

        JSONObject next=d.optJSONObject("next");
        LinearLayout nextCard=card();
        if(next!=null){
            GradientDrawable edge=surface(Color.WHITE,10);edge.setStroke(dp(2),next.optString("reason").contains("late")?RED:OIL);nextCard.setBackground(edge);
            TextView reason=text(nextCard,next.optString("reason"),12,true);reason.setTextColor(RED);
            text(nextCard,next.optString("name"),20,true);
            caption(nextCard,joined(next.optString("company"),joined(next.optString("city"),next.optString("product"))));
            final String phone=next.optString("phone");
            if(!phone.isEmpty())primary(nextCard,"Call "+phone,()->startActivity(new Intent(Intent.ACTION_DIAL,Uri.fromParts("tel",phone,null))));
            int left=goal.optInt("calls")-today.optInt("calls");
            caption(nextCard,today.optInt("calls")==0?"Your first call starts the day.":left>0?left+(left==1?" call":" calls")+" to reach today's goal.":"Goal reached. Every extra call still scores.");
        }else{
            text(nextCard,"You are all caught up",18,true);
            caption(nextCard,"No late follow-ups and no uncalled leads. New enquiries will appear here.");
        }

        section("Today's goals",today.optInt("points")+" points");
        LinearLayout rings=card();rings.setBackground(surface(IRON,12));rings.setTag("dark");LinearLayout ringRow=horizontal();
        String[] labels={"Calls","Answered","Quotations"};String[] keys={"calls","answered","quotations"};
        for(int i=0;i<3;i++){
            LinearLayout cell=column();cell.setGravity(Gravity.CENTER_HORIZONTAL);
            cell.addView(new RingView(this,labels[i],today.optInt(keys[i]),goal.optInt(keys[i]),OIL,Color.WHITE,ONIRON,0xff3a454a),new LinearLayout.LayoutParams(-1,-2));
            TextView l=text(cell,labels[i],13,true);l.setGravity(Gravity.CENTER);l.setTextColor(Color.WHITE);
            LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(0,-2,1);p.setMargins(dp(3),0,dp(3),0);ringRow.addView(cell,p);
        }
        rings.addView(ringRow);
        JSONObject team=d.optJSONObject("teamToday");
        if(team!=null&&team.optInt("goal")>0){View gap=new View(this);rings.addView(gap,new LinearLayout.LayoutParams(-1,dp(10)));goalRow(rings,"Team calls today",team.optInt("calls"),team.optInt("goal"));}

        JSONArray challenges=d.optJSONArray("challenges");
        if(challenges!=null&&challenges.length()>0){
            section("Challenges this week",earnedDone(challenges)+" of "+challenges.length());
            LinearLayout box=card();
            for(int i=0;i<challenges.length();i++){JSONObject ch=challenges.optJSONObject(i);if(ch!=null)goalRow(box,ch.optString("label"),ch.optInt("value"),ch.optInt("target"));}
        }
        JSONArray badges=d.optJSONArray("badges");
        if(badges!=null&&badges.length()>0){section("Badges today",earnedCount(badges)+" of "+badges.length());chipRows(card(),badges,false);}
        JSONArray marks=d.optJSONArray("milestones");
        if(marks!=null&&marks.length()>0){section("Milestones",earnedCount(marks)+" of "+marks.length());chipRows(card(),marks,true);}

        JSONArray board=boardPeriod.equals("month")?monthRows:d.optJSONArray("weekBoard");
        section("Leaderboard",boardPeriod.equals("month")?"This month":"This week");
        LinearLayout lb=card();
        pair(lb,"This week",()->{boardPeriod="week";render();},"This month",()->{boardPeriod="month";loadMonthBoard();});
        String me=SecureConfig.prefs(this).getString("userId","");
        if(board==null||board.length()==0)caption(lb,boardPeriod.equals("month")?"Loading the month…":"No activity yet this week.");
        else for(int i=0;i<Math.min(8,board.length());i++){
            JSONObject r=board.optJSONObject(i);if(r==null)continue;
            LinearLayout row=horizontal();boolean mine=me.equals(r.optString("userId"));
            TextView rank=text(row,String.valueOf(r.optInt("rank")),16,true);rank.setTextColor(PURPLE);rank.setMinWidth(dp(26));
            TextView who=text(row,r.optString("name")+(mine?" (you)":""),14,mine);who.setLayoutParams(new LinearLayout.LayoutParams(0,-2,1));
            text(row,String.valueOf(r.optInt("points")),16,true);
            lb.addView(row);
        }
        JSONArray stars=d.optJSONArray("hallOfFame");
        if(stars!=null&&stars.length()>0){
            section("Stars of the week","Last finished weeks");
            LinearLayout box=card();
            for(int i=0;i<stars.length();i++){JSONObject w=stars.optJSONObject(i);if(w==null)continue;text(box,w.optString("name")+" · "+w.optInt("points")+" points",14,w.optString("userId").equals(me));caption(box,"Week of "+w.optString("weekStart"));}
        }
        caption(card(),"Points come only from calls and changes saved in the CRM: 1 per call, 1 more when answered (10 seconds or longer), 3 per follow-up done on time, 10 per quotation, 50 per order won. Tapping cannot earn points.");
    }
    int earnedDone(JSONArray items){int n=0;for(int i=0;i<items.length();i++)if(items.optJSONObject(i)!=null&&items.optJSONObject(i).optBoolean("done"))n++;return n;}
    void loadMonthBoard(){
        work(()->{
            try{
                int offset=java.util.TimeZone.getDefault().getOffset(System.currentTimeMillis())/60000;
                monthRows=SyncEngine.requestApi(this,"/v1/kpi/leaderboard/month/"+offset,"GET",null).getJSONArray("rows");
                runOnUiThread(this::render);
            }catch(Exception e){failure(e);}
        });
    }
    void home(){JSONObject user=workspace.optJSONObject("user");if(user==null)try{user=new JSONObject(SecureConfig.prefs(this).getString("user","{}"));}catch(Exception ignored){}LinearLayout welcome=card();String name=user==null?"there":user.optString("name","there");text(welcome,"Hello, "+name.split(" ")[0],22,true);caption(welcome,"Leads, follow-ups and calls at a glance.");int open=0;for(int i=0;i<rows("tasks").length();i++){JSONObject t=rows("tasks").optJSONObject(i);if(t!=null&&!t.optString("status").equals("Done"))open++;}LinearLayout metrics=horizontal();welcome.addView(metrics);metric(metrics,"New today",todayLeads(),"Leads");metric(metrics,"Open tasks",open,"To-do");pair(welcome,"+ Add lead",this::leadForm,"+ New task",this::taskForm);long at=SecureConfig.prefs(this).getLong("workspaceAt",0);caption(welcome,at==0?"Pull your workspace with refresh.":"Updated "+android.text.format.DateFormat.getTimeFormat(this).format(new Date(at)));homeOverview();section("Recent activity","Latest updates");JSONArray a=rows("activities");if(a.length()==0){LinearLayout empty=card();identity(empty,"You’re all set","Updates will appear as your team works.",R.drawable.ic_calendar_check);}for(int i=a.length()-1;i>=Math.max(0,a.length()-12);i--){JSONObject r=a.optJSONObject(i);if(r==null)continue;LinearLayout entry=card();identity(entry,leadName(r.optString("leadId")),dateLabel(r.optString("createdAt",r.optString("date"))),R.drawable.ic_users_round);text(entry,r.optString("text",r.optString("title",r.optString("type","Activity"))),13,false);}}
    void metric(LinearLayout row,String label,int value,String target){LinearLayout tile=column();tile.setPadding(dp(14),dp(12),dp(10),dp(12));tile.setBackground(surface(target.equals("Leads")?SOFT:0xffdcefe6,14));text(tile,String.valueOf(value),27,true).setTextColor(target.equals("Leads")?PURPLE:LEAF);text(tile,label,12,false);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(0,-2,1);p.setMargins(0,dp(10),dp(6),dp(8));row.addView(tile,p);tile.setContentDescription(label+", "+value+". Open "+target);tile.setFocusable(true);tile.setOnClickListener(v->{screen=target;render();});}
    void homeOverview(){
        section("Your pipeline","Assigned leads");
        LinearLayout pipeline=card();
        for(Map.Entry<String,Integer> entry:WorkspaceSummary.stages(rows("leads")).entrySet()){
            LinearLayout row=horizontal();
            String stageLabel=entry.getKey().equals("Prospecting")?"Discussions · Prospecting":entry.getKey().equals("Opportunity")?"Interested · Opportunity":entry.getKey();
            TextView label=text(row,stageLabel,14,false);
            label.setLayoutParams(new LinearLayout.LayoutParams(0,-2,1));
            text(row,String.valueOf(entry.getValue()),18,true).setTextColor(PURPLE);
            pipeline.addView(row);
        }
        button(pipeline,"View leads",()->{screen="Leads";render();});
        section("Your work plan","Phone timezone");
        int[] plan=WorkspaceSummary.workPlan(rows("tasks"),java.time.LocalDate.now(),java.time.ZoneId.systemDefault());
        LinearLayout schedule=card();
        String[] labels={"Overdue","Due today","Upcoming"};
        for(int i=0;i<labels.length;i++){
            LinearLayout row=horizontal();
            TextView label=text(row,labels[i],14,false);
            label.setLayoutParams(new LinearLayout.LayoutParams(0,-2,1));
            text(row,String.valueOf(plan[i]),18,true).setTextColor(i==0&&plan[i]>0?0xffbf3b2b:PURPLE);
            schedule.addView(row);
        }
        caption(schedule,"Open tasks with a due date. Completed and undated tasks are excluded.");
        button(schedule,"View follow-ups",()->{screen="To-do";render();});
    }
    List<JSONObject> leadActivities(String id){
        List<JSONObject> result=new ArrayList<>();
        for(int i=0;i<rows("activities").length();i++){
            JSONObject item=rows("activities").optJSONObject(i);
            if(item!=null&&id.equals(item.optString("leadId")))result.add(item);
        }
        result.sort((a,b)->Long.compare(activityTime(b),activityTime(a)));
        return result;
    }
    long activityTime(JSONObject activity){
        try{return java.time.Instant.parse(activity.optString("createdAt",activity.optString("date"))).toEpochMilli();}
        catch(java.time.DateTimeException ignored){return 0;}
    }
    JSONObject latestActivity(String id){List<JSONObject> items=leadActivities(id);return items.isEmpty()?null:items.get(0);}
    void leadTimeline(LinearLayout parent,String id){
        text(parent,"Activity timeline",17,true);
        List<JSONObject> items=leadActivities(id);
        if(items.isEmpty())caption(parent,"No activity yet for this lead.");
        for(int i=0;i<Math.min(items.size(),20);i++){
            JSONObject item=items.get(i);
            text(parent,item.optString("type","Activity")+" · "+dateLabel(item.optString("createdAt",item.optString("date"))),12,true);
            caption(parent,item.optString("text",item.optString("title","")));
            if(!item.optString("voiceNoteId").isEmpty())button(parent,"Play voice feedback",()->playVoiceFeedback(item.optString("voiceNoteId")));
        }
        if(items.size()>20)caption(parent,"Showing the latest 20 activities.");
    }
    boolean isToday(String value){try{return java.time.Instant.parse(value).atZone(java.time.ZoneId.systemDefault()).toLocalDate().equals(java.time.LocalDate.now());}catch(java.time.DateTimeException ignored){return false;}}
    int todayLeads(){int count=0;for(int i=0;i<rows("leads").length();i++){JSONObject lead=rows("leads").optJSONObject(i);if(lead!=null&&isToday(lead.optString("createdAt")))count++;}return count;}
    void activity(){
        button(content,"Call history & recording status",()->{screen="Calls";render();});
        section("Lead activity","Latest first");
        List<JSONObject> items=new ArrayList<>();
        for(int i=0;i<rows("activities").length();i++){JSONObject item=rows("activities").optJSONObject(i);if(item!=null)items.add(item);}
        items.sort((a,b)->Long.compare(activityTime(b),activityTime(a)));
        if(items.isEmpty())caption(card(),"Calls, notes and lead updates will appear here.");
        for(JSONObject item:items){LinearLayout entry=card();badge(entry,item.optString("type","Activity"));identity(entry,leadName(item.optString("leadId")),dateLabel(item.optString("createdAt",item.optString("date"))),R.drawable.ic_phone);text(entry,item.optString("text",item.optString("title","")),14,false);}
    }
    void chats(){
        section("WhatsApp chats","Synced from CRM");
        caption(content,"Incoming and manually sent messages from your connected WhatsApp account. Refresh to fetch the latest synced messages.");
        int count=0;
        for(int i=0;i<rows("conversations").length();i++){
            JSONObject conversation=rows("conversations").optJSONObject(i);
            if(conversation==null||!"WhatsApp".equals(conversation.optString("channel")))continue;
            count++;LinearLayout entry=card();
            identity(entry,leadName(conversation.optString("leadId")),"WhatsApp",R.drawable.ic_users_round);
            List<JSONObject> messages=conversationMessages(conversation.optString("id"));
            if(!messages.isEmpty()){JSONObject last=messages.get(messages.size()-1);caption(entry,last.optString("text"));caption(entry,dateLabel(last.optString("occurredAt",last.optString("createdAt"))));}
            button(entry,"View conversation",()->{
                LinearLayout body=column();body.setPadding(dp(18),0,dp(18),dp(12));
                for(JSONObject message:messages){text(body,("Outgoing".equals(message.optString("direction"))?"You":"Customer")+" · "+dateLabel(message.optString("occurredAt",message.optString("createdAt"))),12,true);caption(body,message.optString("text"));}
                if(messages.isEmpty())caption(body,"No synced messages yet.");
                new AlertDialog.Builder(this).setTitle(leadName(conversation.optString("leadId"))).setView(dialogBody(body)).setPositiveButton("Close",null).show();
            });
        }
        if(count==0)caption(card(),"No WhatsApp conversations synced to your assigned leads. A workspace admin can connect WhatsApp in web CRM Integrations.");
    }
    List<JSONObject> conversationMessages(String id){
        List<JSONObject> result=new ArrayList<>();
        for(int i=0;i<rows("messages").length();i++){JSONObject message=rows("messages").optJSONObject(i);if(message!=null&&id.equals(message.optString("conversationId")))result.add(message);}
        result.sort((a,b)->a.optString("occurredAt",a.optString("createdAt")).compareTo(b.optString("occurredAt",b.optString("createdAt"))));return result;
    }
    interface Payload{JSONObject get()throws Exception;}
    void playVoiceFeedback(String id){work(()->{try{java.io.File audio=SyncEngine.audio(this,id,true);runOnUiThread(()->play(Uri.fromFile(audio),true));}catch(Exception e){failure(e);}});}
    void mutate(String path,String method,Payload payload){work(()->{try{SyncEngine.requestApi(this,path,method,payload.get());loadWorkspace();}catch(Exception e){if(path.startsWith("/v1/leads")&&e instanceof SyncEngine.HttpError&&((SyncEngine.HttpError)e).code==409)runOnUiThread(()->notice("A lead with this mobile number already exists in your workspace. Search for it or ask your administrator."));else failure(e);}});}
    void leads(){LinearLayout tools=card();EditText query=input(tools,"Search your leads",search);query.setCompoundDrawablesRelativeWithIntrinsicBounds(R.drawable.ic_search,0,0,0);query.setCompoundDrawablePadding(dp(10));query.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH);Runnable apply=()->{search=query.getText().toString().trim();((android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(query.getWindowToken(),0);render();};query.setOnEditorActionListener((v,action,event)->{if(action==android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH){apply.run();return true;}return false;});pair(tools,"Search",apply,"+ Add lead",this::leadForm);button(tools,leadsToday?"Show all my leads":"Show today’s new leads",()->{leadsToday=!leadsToday;render();});section("My leads",rows("leads").length()+" assigned · "+todayLeads()+" new today");int shown=0;for(int i=0;i<rows("leads").length();i++){JSONObject l=rows("leads").optJSONObject(i);if(l==null||(leadsToday&&!isToday(l.optString("createdAt"))))continue;if(!l.toString().toLowerCase(Locale.ROOT).contains(search.toLowerCase(Locale.ROOT)))continue;shown++;LinearLayout c=card();identity(c,l.optString("name"),l.optString("company").isEmpty()?displayPhone(l):l.optString("company"),R.drawable.ic_users_round);if(!l.optString("company").isEmpty())caption(c,displayPhone(l));badge(c,l.optString("stage","New"));if(!l.optString("source").isEmpty())caption(c,"Source · "+l.optString("source"));JSONObject last=latestActivity(l.optString("id"));if(last!=null)caption(c,last.optString("type","Activity")+" · "+dateLabel(last.optString("createdAt",last.optString("date"))));c.setFocusable(true);c.setContentDescription("Open lead "+l.optString("name"));c.setOnClickListener(v->leadDetail(l));}if(shown==0){LinearLayout empty=card();identity(empty,"No matching leads","Try a different name or phone number.",R.drawable.ic_search);}}
    String displayPhone(JSONObject lead){return lead.optString("countryCode").isEmpty()?lead.optString("phone"):"+"+lead.optString("countryCode")+" · "+lead.optString("mobileNumber");}
    void leadForm(){LinearLayout b=column();b.setPadding(dp(20),0,dp(20),0);EditText name=input(b,"Name",""),code=input(b,"Country code","+91"),phone=input(b,"Mobile number",""),company=input(b,"Company","");code.setInputType(3);phone.setInputType(3);new AlertDialog.Builder(this).setTitle("New lead").setView(dialogBody(b)).setNegativeButton("Cancel",null).setPositiveButton("Save",(d,w)->mutate("/v1/leads","POST",()->new JSONObject().put("name",name.getText().toString()).put("countryCode",code.getText().toString()).put("mobileNumber",phone.getText().toString()).put("company",company.getText().toString()))).show();}
    void leadDetail(JSONObject l){LinearLayout b=column();b.setPadding(dp(20),0,dp(20),0);text(b,"Country code · +"+l.optString("countryCode","91"),14,false);text(b,"Mobile number · "+l.optString("mobileNumber",l.optString("phone")),16,true);caption(b,l.optString("email")+" · "+l.optString("company"));button(b,"Change stage",()->{String[] stages={"New","Prospecting","Opportunity","Closed"};new AlertDialog.Builder(this).setTitle("Lead stage").setItems(stages,(d,w)->mutate("/v1/leads/"+l.optString("id"),"PATCH",()->new JSONObject().put("stage",stages[w]))).show();});button(b,"Add note",()->{EditText note=new EditText(this);note.setHint("Your note");new AlertDialog.Builder(this).setTitle("Add note").setView(note).setNegativeButton("Cancel",null).setPositiveButton("Save",(d,w)->mutate("/v1/notes","POST",()->new JSONObject().put("leadId",l.optString("id")).put("text",note.getText().toString()))).show();});button(b,"Open dialer",()->new AlertDialog.Builder(this).setMessage("Open this number in the dialer? No call is placed automatically.").setNegativeButton("Cancel",null).setPositiveButton("Open dialer",(d,w)->startActivity(new Intent(Intent.ACTION_DIAL,Uri.fromParts("tel",l.optString("phone"),null)))).show());leadTimeline(b,l.optString("id"));new AlertDialog.Builder(this).setTitle(l.optString("name")).setView(dialogBody(b)).setPositiveButton("Close",null).show();}
    void tasks(){LinearLayout tools=card();identity(tools,"Keep the next step clear",rows("tasks").length()+" assigned tasks",R.drawable.ic_calendar_check);primary(tools,"+ Add task",this::taskForm);button(tools,tasksToday?"Show all tasks":"Show today’s tasks",()->{tasksToday=!tasksToday;render();});section(tasksToday?"Today’s to-do":"All tasks","");int visibleTasks=0;for(int i=0;i<rows("tasks").length();i++){JSONObject item=rows("tasks").optJSONObject(i);if(item!=null&&(!tasksToday||(isToday(item.optString("due"))&&!"Done".equals(item.optString("status")))))visibleTasks++;}if(visibleTasks==0){LinearLayout empty=card();identity(empty,"A clear schedule","Create a follow-up for your next conversation.",R.drawable.ic_calendar_check);}for(int i=0;i<rows("tasks").length();i++){JSONObject t=rows("tasks").optJSONObject(i);if(t==null||(tasksToday&&(!isToday(t.optString("due"))||"Done".equals(t.optString("status")))))continue;LinearLayout c=card();badge(c,t.optString("status","Open"));text(c,t.optString("title"),16,true);caption(c,dateLabel(t.optString("due")));button(c,t.optString("status").equals("Done")?"Reopen task":"Mark as done",()->mutate("/v1/tasks/"+t.optString("id"),"PATCH",()->new JSONObject().put("status",t.optString("status").equals("Done")?"Open":"Done")));}}
    void taskForm(){LinearLayout b=column();b.setPadding(dp(20),0,dp(20),dp(12));EditText title=input(b,"Task title","");Calendar due=Calendar.getInstance();due.add(Calendar.DAY_OF_YEAR,1);due.set(Calendar.SECOND,0);due.set(Calendar.MILLISECOND,0);TextView summary=text(b,dateLabel(due.toInstant().toString()),14,true);button(b,"Choose due date and time",()->new DatePickerDialog(this,(picker,y,m,d)->{due.set(y,m,d);new TimePickerDialog(this,(clock,h,min)->{due.set(Calendar.HOUR_OF_DAY,h);due.set(Calendar.MINUTE,min);summary.setText(dateLabel(due.toInstant().toString()));},due.get(Calendar.HOUR_OF_DAY),due.get(Calendar.MINUTE),android.text.format.DateFormat.is24HourFormat(this)).show();},due.get(Calendar.YEAR),due.get(Calendar.MONTH),due.get(Calendar.DAY_OF_MONTH)).show());AlertDialog dialog=new AlertDialog.Builder(this).setTitle("New task").setView(dialogBody(b)).setNegativeButton("Cancel",null).setPositiveButton("Save",null).create();dialog.setOnShowListener(v->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(w->{String value=title.getText().toString().trim();if(value.isEmpty()){title.setError("Enter a task title");return;}mutate("/v1/tasks","POST",()->new JSONObject().put("title",value).put("due",due.toInstant().toString()));dialog.dismiss();}));dialog.show();}
    void calls(){HorizontalScrollView horizontal=new HorizontalScrollView(this);horizontal.setHorizontalScrollBarEnabled(false);LinearLayout tabs=new LinearLayout(this);for(String f:new String[]{"All","Incoming","Outgoing","Missed"}){Button b=new Button(this);b.setText(f);b.setTextSize(12);b.setAllCaps(false);b.setMinHeight(dp(48));b.setMinWidth(dp(64));b.setPadding(dp(14),dp(8),dp(14),dp(8));b.setTextColor(f.equals(filter)?IRON:PURPLE);b.setBackgroundTintList(null);b.setBackground(surface(f.equals(filter)?OIL:0xffefe9d6,10));b.setSelected(f.equals(filter));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-2,-2);p.setMargins(0,0,dp(6),dp(8));tabs.addView(b,p);b.setOnClickListener(v->{filter=f;render();});}horizontal.addView(tabs);content.addView(horizontal);button(content,"Sync business calls",this::sync);caption(content,"Assigned CRM contacts only. Personal calls stay private.");Set<String> ids=new HashSet<>();int count=0;try(QueueDb db=new QueueDb(this);Cursor cur=db.getReadableDatabase().rawQuery("SELECT * FROM calls ORDER BY started DESC LIMIT 500",null)){while(cur.moveToNext()){JSONObject r=new JSONObject();for(String k:cur.getColumnNames())r.put(k,cur.isNull(cur.getColumnIndexOrThrow(k))?"":cur.getString(cur.getColumnIndexOrThrow(k)));ids.add(r.optString("remote_id"));if(!filter.equals("All")&&!filter.equals(r.optString("direction")))continue;callCard(r,true);count++;}}catch(Exception e){caption(content,"Local queue unavailable.");}for(int i=0;i<rows("mobileCalls").length();i++){JSONObject r=rows("mobileCalls").optJSONObject(i);if(r==null||ids.contains(r.optString("id"))||(!filter.equals("All")&&!filter.equals(r.optString("direction"))))continue;callCard(r,false);count++;}if(count==0){LinearLayout empty=card();text(empty,filter.equals("All")?"Your call history starts here":"No "+filter.toLowerCase(Locale.ROOT)+" calls",17,true);caption(empty,SecureConfig.prefs(this).getBoolean("enabled",false)?"Synced calls to assigned leads will appear here. Try another filter.":"Enable business call sync in Settings to get started.");}}
    void callCard(JSONObject r,boolean local){LinearLayout c=card();long duration=r.optLong("duration",0);badge(c,r.optString("direction")+" · "+String.format(Locale.ROOT,"%d:%02d",duration/60,duration%60));identity(c,phoneName(r.optString("phone")),r.optString("phone"),R.drawable.ic_phone);long time=r.optLong(local?"started":"startedAt",0);if(time==0)try{time=java.time.Instant.parse(r.optString("startedAt")).toEpochMilli();}catch(Exception ignored){}caption(c,time==0?r.optString("startedAt"):dateLabel(java.time.Instant.ofEpochMilli(time).toString()));String remote=local?r.optString("remote_id"):r.optString("id");String recording=r.optString("recordingId");if(local)for(int i=0;i<rows("mobileCalls").length();i++){JSONObject server=rows("mobileCalls").optJSONObject(i);if(server!=null&&server.optString("id").equals(remote))recording=server.optString("recordingId");}caption(c,(remote.isEmpty()?"Waiting to sync":"Synced to CRM")+" · "+(!recording.isEmpty()||local&&r.optInt("uploaded")==1?"Recording uploaded":!r.optString("uri").isEmpty()?"Recording attached":"No recording attached"));if(local&&!r.optString("uri").isEmpty())button(c,"Play phone recording",()->play(Uri.parse(r.optString("uri")),false));if(!remote.isEmpty())button(c,"Add call feedback",()->startActivity(new Intent(this,FeedbackActivity.class).putExtra("callId",remote).putExtra("userId",SecureConfig.prefs(this).getString("userId",""))));if(!recording.isEmpty()){final String id=recording;button(c,"Play CRM recording",()->remotePlay(id));}}
    void play(Uri uri,boolean fromCrm){try{if(player!=null)player.release();player=new MediaPlayer();player.setDataSource(this,uri);player.prepare();player.start();new AlertDialog.Builder(this).setTitle("Call recording").setMessage(fromCrm?"Playing your CRM recording.":"Playing the recording on your phone.").setPositiveButton("Stop",(d,w)->stopPlayer()).setOnCancelListener(d->stopPlayer()).show();}catch(Exception e){notice("Recording unavailable. Re-select its file or folder in Settings.");}}
    void stopPlayer(){if(player!=null){player.release();player=null;}clearAudioCache();}
    void clearAudioCache(){java.io.File[] files=getCacheDir().listFiles((dir,name)->name.startsWith("crm-recording-"));if(files!=null)for(java.io.File f:files)f.delete();}
    void remotePlay(String id){work(()->{try{java.io.File audio=SyncEngine.recording(this,id);runOnUiThread(()->play(Uri.fromFile(audio),true));}catch(Exception e){failure(e);}});}
    void sync(){if(!SecureConfig.prefs(this).getBoolean("enabled",false)){notice("Open Preferences and choose SIM & call tracking first.");return;}if(checkSelfPermission(Manifest.permission.READ_CALL_LOG)!=PackageManager.PERMISSION_GRANTED){setSyncEnabled(true);return;}work(()->{try{SyncEngine.run(this);loadWorkspace();}catch(Exception e){failure(e);}runOnUiThread(this::render);});}
    void setSyncEnabled(boolean enabled){
        if(enabled&&checkSelfPermission(Manifest.permission.READ_CALL_LOG)!=PackageManager.PERMISSION_GRANTED){
            SecureConfig.prefs(this).edit().putBoolean("enabled",false).putString("status","Call-log permission required. Sync paused.").commit();SyncJob.schedule(this,false);syncAfterCallLogPermission=true;requestPermissions(new String[]{Manifest.permission.READ_CALL_LOG},301);return;
        }
        syncAfterCallLogPermission=false;SecureConfig.prefs(this).edit().putBoolean("enabled",enabled).commit();SyncJob.schedule(this,enabled);if(enabled){CallMonitorService.start(this);sync();}else render();
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){
        super.onRequestPermissionsResult(request,permissions,results);
        if(request==301){boolean resume=syncAfterCallLogPermission;syncAfterCallLogPermission=false;
            if(checkSelfPermission(Manifest.permission.READ_CALL_LOG)==PackageManager.PERMISSION_GRANTED){
                if(visibleSync!=null)visibleSync.close();visibleSync=new CallSyncWatcher(this);visibleSync.start();
                if(resume)setSyncEnabled(true);else render();
            }else{SecureConfig.prefs(this).edit().putBoolean("enabled",false).commit();SyncJob.schedule(this,false);render();new AlertDialog.Builder(this).setMessage("Call-log access was not allowed. Sync remains paused. Allow Call logs in Android app permissions, then enable sync again.").setNegativeButton("Close",null).setPositiveButton("App permissions",(dialog,which)->startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())))).show();}
        }else if(request==305&&pendingSimSetup){pendingSimSetup=false;render();if(checkSelfPermission(Manifest.permission.READ_PHONE_STATE)==PackageManager.PERMISSION_GRANTED)new SimplePreferences(this).chooseSims();}
        else if(request==304&&pendingBridgeSetup){pendingBridgeSetup=false;if(CallBridgeService.permissions(this))new SimplePreferences(this).enableBridge();else render();}
        else{if(request==308&&android.os.Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)SecureConfig.prefs(this).edit().putBoolean("postCallFeedback",false).commit();render();}
    }
    void settings(){new SimplePreferences(this).render();}
    boolean workspaceAdmin(){JSONObject user=workspace.optJSONObject("user");return user!=null&&"admin".equals(user.optString("role"));}
    void workspaceMenu(View anchor){PopupMenu menu=new PopupMenu(this,anchor);menu.getMenu().add("Overview");menu.getMenu().add("Preferences");if(rows("tickets").length()>0)menu.getMenu().add("Tickets");if(workspaceAdmin())menu.getMenu().add("Users");menu.setOnMenuItemClickListener(item->{String picked=item.getTitle().toString();screen=picked.equals("Overview")?"Dashboard":picked;render();return true;});menu.show();}
    void tickets(){section("My tickets","Assigned to you");if(rows("tickets").length()==0){caption(card(),"No tickets assigned to you.");return;}for(int i=0;i<rows("tickets").length();i++){JSONObject ticket=rows("tickets").optJSONObject(i);if(ticket==null)continue;LinearLayout box=card();text(box,ticket.optString("subject",ticket.optString("title","Support ticket")),17,true);badge(box,ticket.optString("status","Open"));caption(box,ticket.optString("description"));}}
    void workspaceUsers(){if(!workspaceAdmin()){caption(card(),"Workspace administrator access required.");return;}caption(content,"Workspace users · view only");button(content,"Load users",()->work(()->{try{JSONObject response=SyncEngine.requestApi(this,"/v1/admin/users","GET",null);runOnUiThread(()->{if(!"Users".equals(screen)||!workspaceAdmin())return;JSONArray users=response.optJSONArray("users");if(users==null)return;while(content.getChildCount()>2)content.removeViewAt(2);for(int i=0;i<users.length();i++){JSONObject user=users.optJSONObject(i);if(user==null)continue;LinearLayout box=card();identity(box,user.optString("name"),user.optString("username"),R.drawable.ic_users_round);badge(box,user.optString("role")+" · "+(user.optBoolean("active")?"Active":"Inactive"));}});}catch(Exception e){failure(e);}}));}
    void advancedPreferences(){
        button(content,"Back to Preferences",()->{screen="Preferences";render();});
        section("Advanced & help","");
        LinearLayout feedbackOptions=card();preferenceToggle(feedbackOptions,"Feedback for missed calls too","unconnectedFeedback");
        LinearLayout account=card();caption(account,"SIGNED IN TO YOUR COMPANY");
        try{JSONObject u=new JSONObject(SecureConfig.prefs(this).getString("user","{}"));text(account,u.optString("name"),21,true);caption(account,u.optString("username")+" · "+u.optString("role"));}catch(Exception ignored){}
        LinearLayout status=card();text(status,"Business call sync",19,true);badge(status,SecureConfig.prefs(this).getBoolean("enabled",false)?"Sync enabled":"Sync paused");
        syncStatus=text(status,SecureConfig.prefs(this).getString("status","Not yet synced."),13,false);
        caption(status,"Keep your assigned business calls and recordings together.");
        primary(status,"Sync now",this::sync);
        LinearLayout calling=card();button(calling,"Background calling  ·  "+(showCallingOptions?"Hide":"Manage"),()->{showCallingOptions=!showCallingOptions;render();});if(showCallingOptions)clickToCall.settings(calling);else caption(calling,SecureConfig.prefs(this).getBoolean("clickToCall",false)?"Enabled on this phone":"Off · Your phone stays in control");
        LinearLayout controls=card();button(controls,"Recording & sync preferences  ·  "+(showSyncOptions?"Hide":"Manage"),()->{showSyncOptions=!showSyncOptions;render();});button(controls,"Review unmatched recording",this::review);if(showSyncOptions){LinearLayout b=controls;text(b,"Call logs & recordings",17,true);caption(b,"Assigned CRM contacts only. No microphone access: only existing recordings you select can upload. Obtain participants’ consent and follow company policy.");
        boolean granted=checkSelfPermission(Manifest.permission.READ_CALL_LOG)==PackageManager.PERMISSION_GRANTED;
        caption(b,"Call-log permission · "+(granted?"Allowed":"Not granted"));
        if(!granted)button(b,"Allow call-log access",()->requestPermissions(new String[]{Manifest.permission.READ_CALL_LOG},301));
        caption(b,"Recording folder · "+(SecureConfig.prefs(this).getString("folder","").isEmpty()?"Not selected":"Selected"));
        CheckBox recordings=new CheckBox(this);recordings.setText("Sync matched call recordings");recordings.setTextColor(INK);recordings.setMinHeight(dp(48));recordings.setChecked(SecureConfig.prefs(this).getBoolean("recordingSync",true));b.addView(recordings);recordings.setOnCheckedChangeListener((view,value)->SecureConfig.prefs(this).edit().putBoolean("recordingSync",value).commit());
        button(b,"Remove recording folder",()->new AlertDialog.Builder(this).setMessage("Stop access to this folder? Original recordings and uploaded CRM recordings remain unchanged.").setNegativeButton("Cancel",null).setPositiveButton("Remove folder",(dialog,which)->{String saved=SecureConfig.prefs(this).getString("folder","");if(!saved.isEmpty())try{getContentResolver().releasePersistableUriPermission(Uri.parse(saved),Intent.FLAG_GRANT_READ_URI_PERMISSION);}catch(SecurityException ignored){}SecureConfig.prefs(this).edit().remove("folder").commit();render();}).show());
        button(b,"Choose recording folder",()->startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION),302));
        EditText country=input(b,"Country calling code",SecureConfig.prefs(this).getString("country","91"));country.setInputType(2);
        CheckBox enabled=new CheckBox(this);enabled.setText("I authorize sync of my assigned business calls and matched recordings");enabled.setTextSize(14);enabled.setTextColor(INK);enabled.setButtonTintList(android.content.res.ColorStateList.valueOf(PURPLE));enabled.setMinHeight(dp(48));enabled.setChecked(SecureConfig.prefs(this).getBoolean("enabled",false));b.addView(enabled);
        primary(b,"Save sync settings",()->{String code=country.getText().toString().trim();if(!code.matches("[1-9][0-9]{0,2}")){country.setError("Enter a valid country calling code");return;}SecureConfig.prefs(this).edit().putString("country",code).commit();setSyncEnabled(enabled.isChecked());});
        button(b,"Recording matching help",()->notice("Auto matching uses the recording file’s saved time near the call end and its actual audio duration. Filenames do not matter. Nearby personal calls also block ambiguous matches. Ambiguous recordings require manual review. Only direct audio files in your selected folder are scanned. Only calls since sign-in are eligible. The 15-minute Android job remains a fallback when the app and background bridge are stopped."));
        button(b,"Pause business sync",()->{SecureConfig.prefs(this).edit().putBoolean("enabled",false).commit();SyncJob.schedule(this,false);render();});
        }
        LinearLayout session=card();text(session,"Account & app",19,true);caption(session,"Salesdesk "+BuildConfig.VERSION_NAME+" · Your web and mobile CRM use the same account.");
        button(session,"Notification preferences",()->startActivity(new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,getPackageName())));
        button(session,"Android app permissions",()->startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName()))));
        button(session,"Diagnose call sync",this::diagnostics);
        button(session,"Recording upload history",()->{screen="Calls";render();});
        button(session,"Sign out",()->new AlertDialog.Builder(this).setMessage("Pause sync and remove session and cached workspace? Pending queue remains private to this account on this phone. Original recordings and CRM records are not deleted.").setNegativeButton("Cancel",null).setPositiveButton("Sign out",(d,w)->logout()).show());
    }
    void diagnostics(){
        android.content.SharedPreferences prefs=SecureConfig.prefs(this);
        boolean folderReadable=false;
        String folder=prefs.getString("folder","");
        for(android.content.UriPermission grant:getContentResolver().getPersistedUriPermissions())if(grant.isReadPermission()&&grant.getUri().toString().equals(folder))folderReadable=true;
        android.os.PowerManager power=(android.os.PowerManager)getSystemService(POWER_SERVICE);
        String summary="Business call sync: "+(prefs.getBoolean("enabled",false)?"Enabled":"Paused")
            +"\nCall-log permission: "+(checkSelfPermission(Manifest.permission.READ_CALL_LOG)==PackageManager.PERMISSION_GRANTED?"Allowed":"Missing")
            +"\nRecording sync: "+(prefs.getBoolean("recordingSync",true)?"Enabled":"Paused")
            +"\nRecording folder access: "+(folderReadable?"Granted":"Select folder again")
            +"\nBackground calling: "+(prefs.getBoolean("clickToCall",false)?"Enabled":"Off")
            +"\nCall-bridge permissions: "+(CallBridgeService.permissions(this)?"Granted":"Missing")
            +"\nBattery optimization: "+(power.isIgnoringBatteryOptimizations(getPackageName())?"Unrestricted":"Review Android settings")
            +"\n\nLast sync: "+prefs.getString("status","Not yet synced.");
        notice(summary);
    }
    void preferenceToggle(LinearLayout box,String label,String key){CheckBox toggle=new CheckBox(this);toggle.setText(label);toggle.setTextColor(INK);toggle.setMinHeight(dp(48));toggle.setChecked(SecureConfig.prefs(this).getBoolean(key,false));box.addView(toggle);toggle.setOnCheckedChangeListener((view,value)->SecureConfig.prefs(this).edit().putBoolean(key,value).commit());}
    void logout(){SecureConfig.prefs(this).edit().putBoolean("clickToCall",false).commit();stopService(new Intent(this,CallBridgeService.class));if(busy||SyncEngine.running.get()){SyncJob.schedule(this,false);notice("Current request is stopping. Calling is paused. Retry sign out shortly.");return;}stopPlayer();work(()->{try{SyncEngine.requestApi(this,"/v1/logout","POST",new JSONObject());}catch(Exception ignored){}SecureConfig.logout(this);workspace=new JSONObject();runOnUiThread(this::render);});}
    void review(){try(QueueDb db=new QueueDb(this)){ArrayList<JSONObject> list=SyncEngine.calls(db.getReadableDatabase());if(list.isEmpty()){notice("No pending business recordings. Sync after a new assigned-lead call.");return;}String[] choices=new String[list.size()];for(int i=0;i<list.size();i++)choices[i]=phoneName(list.get(i).optString("phone"))+" · "+new Date(list.get(i).optLong("started"))+" · "+list.get(i).optString("duration")+" sec";new AlertDialog.Builder(this).setTitle("Choose call to attach recording").setItems(choices,(d,w)->{pendingCall=list.get(w).optString("local_id");startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("audio/*").addCategory(Intent.CATEGORY_OPENABLE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION),303);}).show();}catch(Exception e){notice("Unable to open pending recordings.");}}
    @Override protected void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);state.putString("pending",pendingCall);state.putString("screen",screen);state.putString("filter",filter);state.putString("search",search);state.putBoolean("syncOptions",showSyncOptions);state.putBoolean("callingOptions",showCallingOptions);state.putBoolean("leadsToday",leadsToday);state.putBoolean("tasksToday",tasksToday);}
    @Override protected void onDestroy(){handler.removeCallbacks(update);stopPlayer();super.onDestroy();}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(pendingCallerSetup&&(request==307||request==310)){boolean granted=request==307&&android.os.Build.VERSION.SDK_INT>=29?getSystemService(android.app.role.RoleManager.class).isRoleHeld(android.app.role.RoleManager.ROLE_CALL_SCREENING):android.provider.Settings.canDrawOverlays(this);if(granted)new SimplePreferences(this).setupCaller();else{pendingCallerSetup=false;SecureConfig.prefs(this).edit().putBoolean("screenPop",false).commit();render();}return;}if(result!=RESULT_OK||data==null||data.getData()==null){if(request==302){pendingRecordingSetup=false;render();}return;}Uri uri=data.getData();try{getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);if(request==302){android.content.SharedPreferences.Editor editor=SecureConfig.prefs(this).edit().putString("folder",uri.toString());if(pendingRecordingSetup)editor.putBoolean("recordingSync",true);editor.commit();pendingRecordingSetup=false;render();}if(request==303&&pendingCall!=null){String call=pendingCall;new AlertDialog.Builder(this).setMessage("Confirm this file belongs to selected call. A wrong attachment can disclose a private conversation. Upload next sync?").setNegativeButton("Cancel",null).setPositiveButton("Confirm match",(d,w)->{try(QueueDb db=new QueueDb(this)){ContentValues v=new ContentValues();v.put("uri",uri.toString());v.put("mode","manual");db.getWritableDatabase().update("calls",v,"local_id=? AND uploaded=0",new String[]{call});notice("Match saved. Sync when ready.");}}).show();}}catch(Exception e){notice("File permission not granted. Choose an accessible recording folder.");}}
}
