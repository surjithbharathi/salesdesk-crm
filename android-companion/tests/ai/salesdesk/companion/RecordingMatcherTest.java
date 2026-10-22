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
        System.out.println(passed + " recording matching cases passed");
    }
}
