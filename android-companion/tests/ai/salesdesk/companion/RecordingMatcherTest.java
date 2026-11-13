package ai.salesdesk.companion;

import java.util.*;

public final class RecordingMatcherTest {
    static final long START = 1_700_000_000_000L;
    static int passed;
    static RecordingMatcher.Call call(String id, long start, long seconds, boolean eligible) {
        return new RecordingMatcher.Call(id, start, seconds, eligible);
    }
    static RecordingMatcher.Audio audio(String uri, long end, long seconds) {
        return new RecordingMatcher.Audio(uri, end, seconds);
    }
    static void expect(String name, List<RecordingMatcher.Call> calls, List<RecordingMatcher.Audio> audio,
                       Set<String> reserved, Map<String,String> expected) {
        Map<String,String> actual = RecordingMatcher.match(calls, audio, reserved);
        if (!actual.equals(expected)) throw new AssertionError(name + ": " + actual);
        passed++;
    }
    public static void main(String[] args) {
        List<RecordingMatcher.Call> one = List.of(call("business", START, 16, true));
        RecordingMatcher.Audio clip = audio("content://contact-name-only", START + 20_000, 16);
        expect("contact-name filename is irrelevant", one, List.of(clip), Set.of(), Map.of("business", clip.uri));
        expect("personal-only call never uploads", List.of(call("personal", START, 16, false)), List.of(clip), Set.of(), Map.of());
        expect("nearby personal call blocks ambiguity", List.of(one.get(0), call("personal", START + 10_000, 17, false)), List.of(clip), Set.of(), Map.of());
        expect("different CRM calls block ambiguity", List.of(one.get(0), call("other", START + 10_000, 16, true)), List.of(clip), Set.of(), Map.of());
        expect("two possible files require review", one, List.of(clip, audio("content://second", START + 19_000, 16)), Set.of(), Map.of());
        expect("used file cannot be reused", one, List.of(clip), Set.of(clip.uri), Map.of());
        expect("large short-call duration mismatch rejected", one, List.of(audio("content://wrong", START + 20_000, 24)), Set.of(), Map.of());
        expect("late copied file rejected", one, List.of(audio("content://late", START + 200_000, 16)), Set.of(), Map.of());
        expect("missed call cannot take recording", List.of(call("missed", START, 0, true)), List.of(clip), Set.of(), Map.of());
        expect("separated calls each match once", List.of(one.get(0), call("later", START + 600_000, 60, true)),
            List.of(clip, audio("content://later", START + 665_000, 60)), Set.of(), Map.of("business", clip.uri, "later", "content://later"));
        expect("duplicate listing does not create ambiguity", one, List.of(clip, clip), Set.of(), Map.of("business", clip.uri));
        expect("invalid metadata rejected", one, List.of(audio("content://invalid", 0, -1)), Set.of(), Map.of());
        // file-name clues: the number and the date-time a recorder writes into the name
        java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("yyyyMMdd_HHmmss");
        String at = f.format(new java.util.Date(START));
        RecordingMatcher.Call biz = new RecordingMatcher.Call("biz", START, 60, true, "919876500008");
        RecordingMatcher.Call personal = new RecordingMatcher.Call("me", START + 15_000, 58, false, "919000000009");
        RecordingMatcher.Audio named = new RecordingMatcher.Audio("content://named", START + 70_000, 60, "Call recording +91 98765 00008_" + at + ".m4a");
        expect("number in the name settles a clash with a personal call", List.of(biz, personal), List.of(named), Set.of(), Map.of("biz", named.uri));
        if (!RecordingMatcher.pick(List.of(biz, personal), List.of(named), Set.of()).get("biz").mode.equals("file")) throw new AssertionError("mode file"); passed++;
        RecordingMatcher.Audio copied = new RecordingMatcher.Audio("content://copied", START + 7_200_000, 60, "9876500008_" + at + ".mp3");
        expect("number and time in the name match a file copied hours later", List.of(biz), List.of(copied), Set.of(), Map.of("biz", copied.uri));
        RecordingMatcher.Call again = new RecordingMatcher.Call("again", START + 3_600_000, 60, true, "919876500008");
        expect("the time in the name picks the right call of two with one number", List.of(biz, again), List.of(copied), Set.of(), Map.of("biz", copied.uri));
        RecordingMatcher.Audio onlyNumber = new RecordingMatcher.Audio("content://onlynumber", START + 7_200_000, 60, "9876500008.m4a");
        expect("a number alone, written hours later, is not enough", List.of(biz), List.of(onlyNumber), Set.of(), Map.of());
        RecordingMatcher.Audio wrongLength = new RecordingMatcher.Audio("content://long", START + 70_000, 600, "9876500008_" + at + ".m4a");
        expect("a file far longer than the call never matches", List.of(biz), List.of(wrongLength), Set.of(), Map.of());
        System.out.println(passed + " recording matching cases passed");
    }
}
