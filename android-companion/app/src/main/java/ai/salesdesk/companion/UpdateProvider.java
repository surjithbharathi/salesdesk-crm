package ai.salesdesk.companion;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

/** Hands the downloaded update to Android's package installer: one file, read-only, never exported
 *  (the installer gets a one-off read grant on the content URI). */
public final class UpdateProvider extends ContentProvider {
    static final String NAME = "salesdesk-update.apk";
    static final String MIME = "application/vnd.android.package-archive";

    static Uri uri(Context c) {
        return new Uri.Builder().scheme("content").authority(c.getPackageName() + ".updates").appendPath(NAME).build();
    }

    static File file(Context c) { return new File(new File(c.getCacheDir(), "updates"), NAME); }

    private File served(Uri uri) throws FileNotFoundException {
        Context c = getContext();
        if (c == null || uri == null || !(c.getPackageName() + ".updates").equals(uri.getAuthority())
                || uri.getPathSegments().size() != 1 || !NAME.equals(uri.getLastPathSegment()))
            throw new FileNotFoundException("Not available");
        File f = file(c);
        if (!f.isFile()) throw new FileNotFoundException("No downloaded update");
        return f;
    }

    @Override public boolean onCreate() { return true; }

    @Override public String getType(Uri uri) { return NAME.equals(uri.getLastPathSegment()) ? MIME : null; }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Read-only");
        return ParcelFileDescriptor.open(served(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File f;
        try { f = served(uri); } catch (FileNotFoundException e) { return null; }
        String[] cols = projection == null ? new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE } : projection;
        MatrixCursor cursor = new MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = NAME;
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
        }
        cursor.addRow(row);
        return cursor;
    }

    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Read-only"); }
    @Override public int delete(Uri uri, String selection, String[] selectionArgs) { throw new UnsupportedOperationException("Read-only"); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) { throw new UnsupportedOperationException("Read-only"); }
}
