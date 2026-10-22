package ai.salesdesk.companion;

import java.util.*;

/** Filename-independent, one-to-one matching. Personal call metadata stays on-device. */
final class RecordingMatcher {
    static final long END_WINDOW_MS = 120_000;

    static final class Call {
        final String id;
        final long started;
        final long seconds;
        final boolean eligible;
        Call(String id, long started, long seconds, boolean eligible) {
            this.id = id; this.started = started; this.seconds = seconds; this.eligible = eligible;
        }
    }

    static final class Audio {
        final String uri;
        final long modified;
        final long seconds;
        Audio(String uri, long modified, long seconds) {
            this.uri = uri; this.modified = modified; this.seconds = seconds;
        }
    }

    static boolean nearEnd(Call call, long modified) {
        return call.started > 0 && call.seconds > 0 && call.seconds <= 86400 && modified > 0
            && Math.abs(modified - (call.started + call.seconds * 1000)) <= END_WINDOW_MS;
    }

    static boolean plausible(Call call, Audio audio) {
        return audio.seconds > 0 && audio.seconds <= 86400 && nearEnd(call, audio.modified)
            && Math.abs(audio.seconds - call.seconds) <= Math.max(3, call.seconds * .15);
    }

    static Map<String, String> match(List<Call> calls, List<Audio> recordings, Set<String> reservedUris) {
        Map<String, Set<String>> candidates = new HashMap<>();
        Set<String> seenUris = new HashSet<>();
        for (Audio audio : recordings) {
            if (reservedUris.contains(audio.uri) || !seenUris.add(audio.uri)) continue;
            Call only = null;
            int count = 0;
            // Include non-CRM and previously uploaded calls as ambiguity blockers.
            for (Call call : calls) {
                if (plausible(call, audio)) { only = call; count++; }
            }
            if (count == 1 && only != null && only.eligible) {
                candidates.computeIfAbsent(only.id, ignored -> new HashSet<>()).add(audio.uri);
            }
        }
        Map<String, String> matches = new HashMap<>();
        for (Map.Entry<String, Set<String>> entry : candidates.entrySet()) {
            if (entry.getValue().size() == 1) matches.put(entry.getKey(), entry.getValue().iterator().next());
        }
        return matches;
    }
}
