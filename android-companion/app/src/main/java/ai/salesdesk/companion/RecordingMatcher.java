package ai.salesdesk.companion;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * One-to-one matching of recorder files to calls, using every clue the phone has:
 * the number in the file name, a date-time in the file name, when the file was last written, and its length.
 * Without a file-name clue the old strict rule holds (written within 2 minutes of the call's end, same length,
 * and no other call fits). A file-name clue settles cases the times alone cannot. A personal call that fits
 * as well as a business call still blocks the match, and personal call details never leave the phone.
 */
final class RecordingMatcher {
    static final long END_WINDOW_MS = 120_000;
    static final long STAMP_WINDOW_MS = 180_000;

    static final class Call {
        final String id;
        final long started;
        final long seconds;
        final boolean eligible;
        final String phone; // digits, may be empty
        Call(String id, long started, long seconds, boolean eligible) { this(id, started, seconds, eligible, ""); }
        Call(String id, long started, long seconds, boolean eligible, String phone) {
            this.id = id; this.started = started; this.seconds = seconds; this.eligible = eligible;
            this.phone = phone == null ? "" : phone.replaceAll("\\D", "");
        }
        long ended() { return started + seconds * 1000; }
    }

    static final class Audio {
        final String uri;
        final long modified;
        final long seconds;
        final String name; // the file name, may be empty
        Audio(String uri, long modified, long seconds) { this(uri, modified, seconds, ""); }
        Audio(String uri, long modified, long seconds, String name) {
            this.uri = uri; this.modified = modified; this.seconds = seconds; this.name = name == null ? "" : name;
        }
    }

    /** A chosen file for a call, and whether a file-name clue decided it ("file") or the times alone ("auto"). */
    static final class Pick {
        final String uri, mode; final int score;
        Pick(String uri, String mode, int score) { this.uri = uri; this.mode = mode; this.score = score; }
    }

    static boolean nearEnd(Call call, long modified) {
        return call.started > 0 && call.seconds > 0 && call.seconds <= 86400 && modified > 0
            && Math.abs(modified - call.ended()) <= END_WINDOW_MS;
    }

    static boolean plausible(Call call, Audio audio) {
        return audio.seconds > 0 && audio.seconds <= 86400 && nearEnd(call, audio.modified)
            && Math.abs(audio.seconds - call.seconds) <= Math.max(3, call.seconds * .15);
    }

    /**
     * Whether a recorder file is worth reading for this business call: written near the call's end, or its name
     * carries the call's time, or its number when the name holds no time at all. A file with this customer's number
     * but another date-time is an older call with them: it can never fit this call (see score), and a recorder keeps
     * years of such files, so counting them crowded the real ones out and stopped all matching.
     */
    static boolean relevant(Call call, long modified, String name) {
        if (!call.eligible) return false;
        if (nearEnd(call, modified)) return true;
        long stamp = stampOf(name);
        if (stamp > 0) return Math.abs(stamp - call.started) <= STAMP_WINDOW_MS || Math.abs(stamp - call.ended()) <= STAMP_WINDOW_MS;
        return numberIn(name, call.phone);
    }

    /** The call's last ten digits appear in the file name (spaces, dashes, brackets and + ignored). */
    static boolean numberIn(String name, String phone) {
        if (phone.length() < 10 || name.isEmpty()) return false;
        String tail = phone.substring(phone.length() - 10);
        return name.replaceAll("[\\s\\-+().]", "").contains(tail);
    }

    private static final Pattern STAMP = Pattern.compile("(20\\d\\d)[-_.]?(\\d\\d)[-_.]?(\\d\\d)[-_ T.@]?(\\d\\d)[-_.:]?(\\d\\d)[-_.:]?(\\d\\d)");

    /** A date-time written in the file name (phone's own time zone), or 0. */
    static long stampOf(String name) {
        Matcher m = STAMP.matcher(name);
        while (m.find()) {
            try {
                int mo = Integer.parseInt(m.group(2)), d = Integer.parseInt(m.group(3)), h = Integer.parseInt(m.group(4)), mi = Integer.parseInt(m.group(5)), s = Integer.parseInt(m.group(6));
                if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) continue;
                Calendar c = Calendar.getInstance();
                c.clear();
                c.set(Integer.parseInt(m.group(1)), mo - 1, d, h, mi, s);
                return c.getTimeInMillis();
            } catch (RuntimeException ignored) { /* not a date */ }
        }
        return 0;
    }

    /** How well a file fits a call; below 4 it does not fit. */
    static int score(Call call, Audio audio, boolean[] clue) {
        clue[0] = false;
        if (call.started <= 0 || call.seconds <= 0 || call.seconds > 86400) return 0; // a missed call has no recording
        if (audio.seconds > 0 && Math.abs(audio.seconds - call.seconds) > Math.max(30, call.seconds * .5)) return 0;
        int s = 0;
        if (plausible(call, audio)) s += 6;
        boolean number = numberIn(audio.name, call.phone);
        long stamp = stampOf(audio.name);
        boolean when = stamp > 0 && (Math.abs(stamp - call.started) <= STAMP_WINDOW_MS || Math.abs(stamp - call.ended()) <= STAMP_WINDOW_MS);
        if (number) s += 5;
        if (when) s += 4;
        if (stamp > 0 && !when && number) s -= 3; // same number, but the name says another time: likely another call with them
        if (audio.modified > 0 && (Math.abs(audio.modified - call.started) <= END_WINDOW_MS
            || (audio.modified >= call.started && audio.modified <= call.ended() + 600_000))) s += 1;
        if (audio.seconds > 0 && Math.abs(audio.seconds - call.seconds) <= Math.max(10, call.seconds * .25)) s += 2;
        clue[0] = number || when;
        // a file-name clue alone is not enough without the time or length agreeing too
        return (number && when) || ((number || when) && s >= 8) || plausible(call, audio) ? s : 0;
    }

    static Map<String, Pick> pick(List<Call> calls, List<Audio> recordings, Set<String> reservedUris) {
        Map<String, Pick> best = new HashMap<>();
        Set<String> tied = new HashSet<>(), seenUris = new HashSet<>();
        boolean[] clue = new boolean[1];
        for (Audio audio : recordings) {
            if (reservedUris.contains(audio.uri) || !seenUris.add(audio.uri)) continue;
            Call top = null; int topScore = 0, second = 0; boolean topClue = false;
            // non-CRM and already uploaded calls take part, so they can block a doubtful match
            for (Call call : calls) {
                int s = score(call, audio, clue);
                if (s <= 0) continue;
                if (s > topScore) { second = topScore; topScore = s; top = call; topClue = clue[0]; }
                else if (s > second) second = s;
            }
            if (top == null || !top.eligible || topScore == second) continue;
            Pick p = new Pick(audio.uri, topClue ? "file" : "auto", topScore), had = best.get(top.id);
            if (had == null) best.put(top.id, p);
            else if (p.score > had.score) { best.put(top.id, p); tied.remove(top.id); }
            else if (p.score == had.score) tied.add(top.id); // two files fit one call equally: leave it for review
        }
        for (String id : tied) best.remove(id);
        return best;
    }

    static Map<String, String> match(List<Call> calls, List<Audio> recordings, Set<String> reservedUris) {
        Map<String, String> out = new HashMap<>();
        for (Map.Entry<String, Pick> e : pick(calls, recordings, reservedUris).entrySet()) out.put(e.getKey(), e.getValue().uri);
        return out;
    }
}
