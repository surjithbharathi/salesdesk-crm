// Copies the old JSON `records` store into the Phase 1 tables (docs/PHASE1_SCHEMA.md section 8).
// - Never changes or deletes legacy rows; ids are preserved so the Android app keeps working.
// - Idempotent: re-running skips rows that are already imported.
// - Dry run (default) performs the whole import inside a transaction, verifies it, then rolls back,
//   so the report shows exactly what the real run would do.
import { canonicalPhone } from "./phone.mjs";

const slug = (text) =>
  String(text).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "other";
const iso = (value, fallback) => {
  const time = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
};
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

export function importLegacy(db, { dryRun = true } = {}) {
  const has = (name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(name));
  if (!has("records")) throw Error("No legacy `records` table found; nothing to import");
  if (!has("statuses") || !has("leads")) throw Error("Run migrations first (scripts/migrate.mjs)");
  const kind = (name) =>
    db.prepare("SELECT body FROM records WHERE kind=?").all(name).map((row) => JSON.parse(row.body));
  const legacy = {
    users: kind("users"), leads: kind("leads"), activities: kind("activities"), tasks: kind("tasks"),
    lists: kind("lists"), mobileCalls: kind("mobileCalls"),
  };
  const devices = has("mobile_devices")
    ? new Map(db.prepare("SELECT body FROM mobile_devices").all().map((r) => JSON.parse(r.body)).map((d) => [d.id, d]))
    : new Map();
  const authAdmins = has("auth_accounts")
    ? new Set(db.prepare("SELECT user_id FROM auth_accounts WHERE role='admin'").all().map((r) => r.user_id))
    : new Set();
  const recordingRows = has("mobile_audio") ? db.prepare("SELECT count(*) c FROM mobile_audio").get().c : 0;

  const report = {
    mode: dryRun ? "dry-run (nothing written)" : "applied",
    legacy: Object.fromEntries(Object.entries(legacy).map(([k, v]) => [k, v.length])),
    imported: {}, skipped: {}, issues: [], duplicatePhones: [], unmappedStages: {}, recordingsPending: recordingRows,
  };
  const issue = (type, id, message) => report.issues.push({ type, id, message });
  const bump = (bucket, key, changes) => {
    report[bucket][key] = (report[bucket][key] || 0) + (changes > 0 ? 1 : 0);
    if (!changes) report.skipped[key] = (report.skipped[key] || 0) + (bucket === "imported" ? 1 : 0);
  };

  db.exec("BEGIN IMMEDIATE");
  try {
    // ---------------------------------------------------------------- users
    const userIds = new Set(db.prepare("SELECT id FROM users").all().map((u) => u.id));
    const addUser = db.prepare("INSERT OR IGNORE INTO users(id,name,role_id,active,legacy_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)");
    for (const u of legacy.users) {
      const role = authAdmins.has(u.id) ? "role_admin" : u.role === "Manager" ? "role_manager" : "role_caller";
      bump("imported", "users", addUser.run(u.id, u.name || "Unnamed", role, u.active === false ? 0 : 1, u.id, iso(u.createdAt, "1970-01-01T00:00:00.000Z"), iso(u.updatedAt, iso(u.createdAt, "1970-01-01T00:00:00.000Z"))).changes);
      userIds.add(u.id);
    }

    // ---------------------------------------------------------------- lists
    const addList = db.prepare("INSERT OR IGNORE INTO lists(id,name,kind,legacy_id,created_at) VALUES(?,?,'static',?,?)");
    const listIds = new Set(db.prepare("SELECT id FROM lists").all().map((l) => l.id));
    for (const l of legacy.lists) {
      bump("imported", "lists", addList.run(l.id, l.name || "Untitled list", l.id, iso(l.createdAt, "1970-01-01T00:00:00.000Z")).changes);
      listIds.add(l.id);
    }

    // ---------------------------------------------------------------- sources
    const sourceCache = new Map();
    const source = (label) => {
      const text = String(label ?? "").trim() || "Other";
      if (sourceCache.has(text)) return sourceCache.get(text);
      let row = db.prepare("SELECT id FROM lead_sources WHERE id=? OR label=? COLLATE NOCASE").get(text, text);
      if (!row) {
        const id = `src_${slug(text)}`;
        db.prepare("INSERT OR IGNORE INTO lead_sources(id,label,kind) VALUES(?,?,?)").run(id, text, "other");
        row = { id };
      }
      sourceCache.set(text, row.id);
      return row.id;
    };

    // ---------------------------------------------------------------- leads
    const connectedLeads = new Set();
    for (const a of legacy.activities)
      if (a.type === "Call" && a.outcome && a.outcome !== "No answer") connectedLeads.add(a.leadId);
    for (const c of legacy.mobileCalls)
      if (num(c.duration) > 0 && ["Incoming", "Outgoing"].includes(c.direction)) connectedLeads.add(c.leadId);
    const mapStatus = (lead) => {
      const stage = String(lead.stage ?? "");
      if (stage === "New") return ["st_new_lead", null];
      if (stage === "Prospecting") return [connectedLeads.has(lead.id) ? "st_requirement" : "st_contact_attempted", null];
      if (stage === "Opportunity") return ["st_interested", null];
      if (stage === "Closed") return lead.disposition === "Won" ? ["st_won", null] : ["st_lost", "lr_unknown"];
      report.unmappedStages[stage || "(empty)"] = (report.unmappedStages[stage || "(empty)"] || 0) + 1;
      issue("unmapped-stage", lead.id, `Stage "${stage}" is not known; imported as New Lead`);
      return ["st_new_lead", null];
    };
    const taken = new Map(db.prepare("SELECT phone_e164 p, id FROM leads WHERE phone_e164 IS NOT NULL").all().map((r) => [r.p, r.id]));
    const addLead = db.prepare(
      `INSERT OR IGNORE INTO leads(id,name,phone_e164,phone_display,email,company,city,first_source_id,latest_source_id,owner_id,
         status_id,lost_reason_id,expected_value,is_repeat,repeat_count,first_touch_at,captured_at,archived_at,duplicate_of,
         legacy_id,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const addMember = db.prepare("INSERT OR IGNORE INTO list_members(list_id,lead_id) VALUES(?,?)");
    const existingLeads = new Set(db.prepare("SELECT id FROM leads").all().map((r) => r.id));
    const importedLeadIds = new Set();
    const ordered = [...legacy.leads].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const groups = new Map();
    for (const lead of ordered) {
      const key = canonicalPhone(lead.phone);
      if (!/^[1-9]\d{7,14}$/.test(key)) {
        if (String(lead.phone ?? "").trim()) issue("invalid-phone", lead.id, `Phone "${lead.phone}" is not a valid number; imported without a phone key`);
        else issue("no-phone", lead.id, "Lead has no phone number");
        lead._key = null;
        lead._keeper = null;
      } else if (taken.has(key) && taken.get(key) !== lead.id) {
        lead._key = null;
        lead._keeper = taken.get(key);
      } else {
        taken.set(key, lead.id);
        lead._key = key;
        lead._keeper = null;
      }
      if (lead._keeper) {
        (groups.get(key) || groups.set(key, { phone: key, keeper: lead._keeper, others: [] }).get(key)).others.push(lead.id);
      }
    }
    for (const g of groups.values()) report.duplicatePhones.push(g);
    for (const lead of ordered) {
      const [status, reason] = mapStatus(lead);
      const created = iso(lead.createdAt, "1970-01-01T00:00:00.000Z");
      let owner = lead.owner || null;
      if (owner && !userIds.has(owner)) {
        issue("unknown-owner", lead.id, `Owner ${owner} does not exist; imported unassigned`);
        owner = null;
      }
      const sourceId = source(lead.source);
      const changes = addLead.run(
        lead.id, String(lead.name || "Unnamed lead").trim() || "Unnamed lead", lead._key, String(lead.phone ?? "").trim() || null,
        lead.email || null, lead.company || null, lead.city || null, sourceId, sourceId, owner, status, reason,
        Number.isFinite(Number(lead.value)) && lead.value !== "" && lead.value != null ? Math.max(0, Math.round(Number(lead.value))) : null,
        lead.repeat ? 1 : 0, lead.repeat ? 1 : 0, lead.firstTouchAt ? iso(lead.firstTouchAt, null) : null, created,
        lead.archived ? iso(lead.updatedAt, created) : null, lead._keeper, lead.id, created, iso(lead.updatedAt, created),
      ).changes;
      bump("imported", "leads", changes);
      importedLeadIds.add(lead.id);
      if (lead.list && listIds.has(lead.list)) addMember.run(lead.list, lead.id);
      else if (lead.list) issue("unknown-list", lead.id, `List ${lead.list} does not exist`);
    }
    const leadExists = (id) => importedLeadIds.has(id) || existingLeads.has(id);

    // ---------------------------------------------------------------- calls
    const addCall = db.prepare(
      `INSERT OR IGNORE INTO calls(id,lead_id,user_id,device_id,local_id,phone_e164,direction,started_at,duration_seconds,connected,
         source,match_mode,legacy_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const callByActivity = new Map();
    let orphanCalls = 0;
    let expectedSeconds = 0;
    for (const c of legacy.mobileCalls) {
      const key = canonicalPhone(c.phone);
      const duration = Math.max(0, Math.min(86400, Math.round(num(c.duration))));
      if (!leadExists(c.leadId) || !/^[1-9]\d{7,14}$/.test(key) || !["Incoming", "Outgoing", "Missed", "Rejected"].includes(c.direction)) {
        orphanCalls++;
        issue("orphan-call", c.id, "Call refers to a missing lead or has an invalid number/direction; not imported");
        continue;
      }
      expectedSeconds += duration;
      const connected = duration > 0 && ["Incoming", "Outgoing"].includes(c.direction) ? 1 : 0;
      const owner = devices.get(c.deviceId)?.owner;
      bump(
        "imported", "calls",
        addCall.run(c.id, c.leadId, owner && userIds.has(owner) ? owner : null, c.deviceId || null, c.localId || null, key, c.direction,
          iso(c.startedAt, "1970-01-01T00:00:00.000Z"), duration, connected, "phone", c.matchMode || null, c.id, iso(c.createdAt, "1970-01-01T00:00:00.000Z")).changes,
      );
      if (c.activityId) callByActivity.set(c.activityId, c.id);
    }

    // ---------------------------------------------------------------- activities
    const TYPES = { Call: "call", Note: "note", Message: "message", Visit: "visit", System: "system" };
    const addActivity = db.prepare(
      `INSERT OR IGNORE INTO activities(id,lead_id,type,direction,source,user_id,occurred_at,text,data,call_id,legacy_id,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    let orphanActivities = 0;
    for (const a of legacy.activities) {
      if (!leadExists(a.leadId)) {
        orphanActivities++;
        issue("orphan-activity", a.id, "Activity refers to a missing lead; not imported");
        continue;
      }
      const created = iso(a.createdAt, "1970-01-01T00:00:00.000Z");
      const data = {};
      for (const k of ["outcome", "duration", "provider", "providerId", "jid", "recordingId", "status"]) if (a[k] !== undefined) data[k] = a[k];
      const callId = callByActivity.get(a.id) ?? null;
      bump(
        "imported", "activities",
        addActivity.run(a.id, a.leadId, TYPES[a.type] || String(a.type || "note").toLowerCase(), ["Incoming", "Outgoing"].includes(a.direction) ? a.direction : null,
          callId || a.deviceId ? "phone" : a.provider ? a.provider : a.type === "System" ? "system" : "manual", userIds.has(a.userId) ? a.userId : null,
          iso(a.occurredAt, created), a.text ?? a.description ?? null, JSON.stringify(data), callId, a.id, created).changes,
      );
    }

    // ---------------------------------------------------------------- tasks
    const addTask = db.prepare(
      `INSERT OR IGNORE INTO tasks(id,lead_id,owner_id,title,due_at,status,origin,rule_id,legacy_id,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    );
    let orphanTasks = 0;
    for (const t of legacy.tasks) {
      if (t.leadId && !leadExists(t.leadId)) {
        orphanTasks++;
        issue("orphan-task", t.id, "Task refers to a missing lead; not imported");
        continue;
      }
      const created = iso(t.createdAt, "1970-01-01T00:00:00.000Z");
      bump(
        "imported", "tasks",
        addTask.run(t.id, t.leadId || null, t.owner && userIds.has(t.owner) ? t.owner : null, t.title || "Task", iso(t.due, created),
          ["Open", "In progress", "Done", "Cancelled"].includes(t.status) ? t.status : "Open", t.origin || "User", t.ruleId || null,
          t.id, created, iso(t.updatedAt, created)).changes,
      );
    }

    // ---------------------------------------------------------------- computed metrics (set-based)
    db.exec(`
      UPDATE leads SET
        call_count = (SELECT count(*) FROM calls WHERE lead_id = leads.id),
        connected_count = (SELECT coalesce(sum(connected),0) FROM calls WHERE lead_id = leads.id),
        total_call_seconds = (SELECT coalesce(sum(duration_seconds),0) FROM calls WHERE lead_id = leads.id),
        attempts = (SELECT count(*) FROM calls WHERE lead_id = leads.id AND direction='Outgoing'),
        last_call_at = (SELECT max(started_at) FROM calls WHERE lead_id = leads.id),
        last_activity_at = (SELECT max(occurred_at) FROM activities WHERE lead_id = leads.id),
        next_followup_at = (SELECT min(due_at) FROM tasks WHERE lead_id = leads.id AND status IN ('Open','In progress')),
        first_touch_at = coalesce(first_touch_at,
          (SELECT min(started_at) FROM calls WHERE lead_id = leads.id AND (direction='Outgoing' OR connected=1)))
      WHERE legacy_id IS NOT NULL`);

    // ---------------------------------------------------------------- verification
    const q = (sql) => db.prepare(sql).get();
    const checks = [];
    const check = (name, expected, actual) => checks.push({ name, expected, actual, ok: expected === actual });
    check("every legacy lead is present", legacy.leads.length, q(`SELECT count(*) c FROM leads WHERE legacy_id IS NOT NULL`).c);
    check(
      "leads split into phone-keyed, duplicate and phone-less add up",
      legacy.leads.length,
      q("SELECT count(*) c FROM leads WHERE legacy_id IS NOT NULL AND phone_e164 IS NOT NULL").c +
        q("SELECT count(*) c FROM leads WHERE legacy_id IS NOT NULL AND phone_e164 IS NULL").c,
    );
    check("calls imported + rejected = legacy calls", legacy.mobileCalls.length, q("SELECT count(*) c FROM calls WHERE legacy_id IS NOT NULL").c + orphanCalls);
    check("total call seconds match", expectedSeconds, q("SELECT coalesce(sum(duration_seconds),0) c FROM calls WHERE legacy_id IS NOT NULL").c);
    check("activities imported + rejected = legacy activities", legacy.activities.length, q("SELECT count(*) c FROM activities WHERE legacy_id IS NOT NULL").c + orphanActivities);
    check("tasks imported + rejected = legacy tasks", legacy.tasks.length, q("SELECT count(*) c FROM tasks WHERE legacy_id IS NOT NULL").c + orphanTasks);
    // Calls logged in the new app on an imported lead are real calls too, so compare against every call on those leads.
    check("lead call counters equal call rows", q("SELECT count(*) c FROM calls WHERE lead_id IN (SELECT id FROM leads WHERE legacy_id IS NOT NULL)").c, q("SELECT coalesce(sum(call_count),0) c FROM leads WHERE legacy_id IS NOT NULL").c);
    check("every lost lead has a reason", 0, q("SELECT count(*) c FROM leads l JOIN statuses s ON s.id=l.status_id WHERE s.stage_group='LOST' AND l.lost_reason_id IS NULL").c);
    check("no broken references", 0, db.prepare("PRAGMA foreign_key_check").all().length);
    report.verification = { ok: checks.every((c) => c.ok), checks };
    report.orphans = { calls: orphanCalls, activities: orphanActivities, tasks: orphanTasks };
    report.summary = { phoneKeyed: q("SELECT count(*) c FROM leads WHERE legacy_id IS NOT NULL AND phone_e164 IS NOT NULL").c, duplicatesNeedingReview: report.duplicatePhones.reduce((s, g) => s + g.others.length, 0) };

    if (dryRun || !report.verification.ok) {
      db.exec("ROLLBACK");
      if (!dryRun) {
        report.mode = "failed verification; rolled back, nothing written";
        report.applied = false;
      }
    } else {
      db.exec("COMMIT");
      report.applied = true;
    }
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
  return report;
}

// While the classic screens and the phone app still write to the old tables, copy what is new into the new tables
// on a timer. It only adds (leads, calls, notes, tasks); it never edits or removes anything, and it stops on a failed
// verification. Switch it on with V2_FOLLOW_LEGACY=true until the cutover.
export function startFollowingLegacy(db, { intervalMs = 60000, log = console.log } = {}) {
  const tick = () => {
    try {
      const report = importLegacy(db, { dryRun: false });
      const added = Object.values(report.imported).reduce((sum, n) => sum + n, 0);
      if (!report.applied) log("Following the old data failed verification; nothing was copied", report.verification.checks.filter((c) => !c.ok));
      else if (added) log("Copied from the old data:", report.imported);
      return report;
    } catch (error) {
      log("Following the old data failed:", error.message);
      return null;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return { tick, stop: () => clearInterval(timer) };
}
