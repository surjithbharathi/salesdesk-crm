package ai.salesdesk.companion;
import android.content.*;
import android.database.sqlite.*;
final class QueueDb extends SQLiteOpenHelper {
    QueueDb(Context c) { super(c, SecureConfig.queueName(c), null, 2); }
    public void onCreate(SQLiteDatabase db) { db.execSQL("CREATE TABLE calls(local_id TEXT PRIMARY KEY, phone TEXT, started INTEGER, duration INTEGER, direction TEXT, remote_id TEXT, uri TEXT, mode TEXT, uploaded INTEGER DEFAULT 0, account TEXT DEFAULT '')"); }
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { if(oldVersion<2)db.execSQL("ALTER TABLE calls ADD COLUMN account TEXT DEFAULT ''"); }
}
