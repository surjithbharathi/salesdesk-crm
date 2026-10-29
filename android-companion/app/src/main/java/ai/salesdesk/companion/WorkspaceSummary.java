package ai.salesdesk.companion;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;

/** Summaries only use the workspace records already authorized by the server. */
final class WorkspaceSummary {
    static Map<String, Integer> stages(JSONArray leads) {
        Map<String, Integer> result = new LinkedHashMap<>();
        for (String stage : new String[]{"New", "Prospecting", "Opportunity", "Closed"}) result.put(stage, 0);
        for (int i = 0; i < leads.length(); i++) {
            JSONObject lead = leads.optJSONObject(i);
            if (lead == null) continue;
            String stage = lead.optString("stage", "New").trim();
            if (stage.isEmpty()) stage = "New";
            result.put(stage, result.getOrDefault(stage, 0) + 1);
        }
        return result;
    }

    static int[] workPlan(JSONArray tasks, LocalDate today, ZoneId zone) {
        int[] result = new int[3]; // overdue, today, later; undated tasks are excluded
        for (int i = 0; i < tasks.length(); i++) {
            JSONObject task = tasks.optJSONObject(i);
            if (task == null || "Done".equals(task.optString("status"))) continue;
            try {
                LocalDate due = Instant.parse(task.optString("due")).atZone(zone).toLocalDate();
                result[due.isBefore(today) ? 0 : due.equals(today) ? 1 : 2]++;
            } catch (java.time.DateTimeException ignored) { }
        }
        return result;
    }
}
