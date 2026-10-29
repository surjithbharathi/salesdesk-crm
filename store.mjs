// Data-access layer for the Phase 1 schema (migrations/001-003). Every business rule that keeps
// lead data accurate lives here, inside one transaction per operation, so web, mobile, webhooks,
// WhatsApp and AI agents all write the same way. See docs/PHASE1_SCHEMA.md section 6.
import { randomUUID } from "node:crypto";
import { canonicalPhone } from "./phone.mjs";

export class StoreError extends Error {
  constructor(message, status = 400, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
const fail = (message, status, details) => {
  throw new StoreError(message, status, details);
};
const DIRECTIONS = ["Incoming", "Outgoing", "Missed", "Rejected"];
const EDITABLE = new Set([
  "name", "email", "company", "city", "state", "place", "business_id", "lead_type", "rating",
  "expected_value", "product_interested", "product_name", "required_capacity", "purchase_timeline",
  "customer_type", "customer_language", "preferred_language", "lead_protection", "do_not_call",
  "do_not_email", "do_not_track", "whatsapp_opt_out", "summary",
]);
const slug = (text) =>
  String(text).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "other";
const later = (a, b) => (!a || b > a ? b : a);
const earlier = (a, b) => (!a || b < a ? b : a);

export function createStore(db, { now = () => new Date().toISOString(), newId = randomUUID } = {}) {
  let depth = 0;
  function tx(fn) {
    const level = depth;
    if (level === 0) db.exec("BEGIN IMMEDIATE");
    else db.exec(`SAVEPOINT sp${level}`);
    depth = level + 1;
    try {
      const value = fn();
      depth = level;
      db.exec(level === 0 ? "COMMIT" : `RELEASE sp${level}`);
      return value;
    } catch (error) {
      depth = level;
      db.exec(level === 0 ? "ROLLBACK" : `ROLLBACK TO sp${level}; RELEASE sp${level}`);
      throw error;
    }
  }
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);

  // ------------------------------------------------------------ reference lookups
  function statusOf(ref) {
    const row =
      one("SELECT * FROM statuses WHERE id=? OR label=? COLLATE NOCASE", ref, ref) ||
      one("SELECT s.* FROM status_aliases a JOIN statuses s ON s.id=a.status_id WHERE a.alias=?", ref);
    return row || fail(`Unknown status: ${ref}`, 400);
  }
  function lostReasonOf(ref) {
    if (!ref) return one("SELECT * FROM lost_reasons WHERE is_default=1");
    const row =
      one("SELECT * FROM lost_reasons WHERE id=? OR label=? COLLATE NOCASE", ref, ref) ||
      one("SELECT r.* FROM lost_reason_aliases a JOIN lost_reasons r ON r.id=a.lost_reason_id WHERE a.alias=?", ref);
    return row || fail(`Unknown lost reason: ${ref}`, 400);
  }
  function sourceOf(ref, { create = true } = {}) {
    const text = String(ref ?? "").trim();
    if (!text) return one("SELECT * FROM lead_sources WHERE id='src_other'");
    const row = one("SELECT * FROM lead_sources WHERE id=? OR label=? COLLATE NOCASE", text, text);
    if (row) return row;
    if (!create) fail(`Unknown lead source: ${text}`, 400);
    const id = `src_${slug(text)}`;
    run("INSERT OR IGNORE INTO lead_sources(id,label,kind) VALUES(?,?,?)", id, text, "other");
    return one("SELECT * FROM lead_sources WHERE id=?", id);
  }
  function outcomeOf(ref) {
    return (
      one("SELECT * FROM call_outcomes WHERE id=? OR label=? COLLATE NOCASE", ref, ref) ||
      fail(`Unknown call outcome: ${ref}`, 400)
    );
  }
  function activeUser(id) {
    const user = one("SELECT * FROM users WHERE id=?", id);
    if (!user || !user.active) fail("Choose an active user", 400);
    return user;
  }

  // ------------------------------------------------------------ small helpers
  function emit(type, entity, entityId, data) {
    run(
      "INSERT INTO events(type,entity,entity_id,data,created_at) VALUES(?,?,?,?,?)",
      type, entity, entityId, data ? JSON.stringify(data) : null, now(),
    );
  }
  function addActivity(leadId, type, text, o = {}) {
    const at = o.occurredAt || now();
    const id = newId();
    run(
      "INSERT INTO activities(id,lead_id,type,direction,source,user_id,occurred_at,text,data,call_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      id, leadId, type, o.direction ?? null, o.source ?? "system", o.userId ?? null, at, text ?? null,
      JSON.stringify(o.data ?? {}), o.callId ?? null, now(),
    );
    run("UPDATE leads SET last_activity_at = CASE WHEN last_activity_at IS NULL OR last_activity_at < ? THEN ? ELSE last_activity_at END WHERE id=?", at, at, leadId);
    return id;
  }
  function getLead(id) {
    const lead = one("SELECT * FROM leads WHERE id=?", id);
    if (!lead) return null;
    return {
      ...lead,
      custom: JSON.parse(lead.custom),
      tags: all("SELECT t.id,t.label FROM lead_tags lt JOIN tags t ON t.id=lt.tag_id WHERE lt.lead_id=? ORDER BY t.label", id),
      phones: all("SELECT phone_e164,kind FROM lead_phones WHERE lead_id=? ORDER BY created_at", id),
    };
  }
  const mustLead = (id) => getLead(id) || fail("Lead not found", 404);
  function findByPhone(phone) {
    const key = canonicalPhone(phone);
    if (!key) return null;
    const id =
      one("SELECT id FROM leads WHERE phone_e164=?", key)?.id ||
      one("SELECT lead_id id FROM lead_phones WHERE phone_e164=?", key)?.id;
    return id ? getLead(id) : null;
  }
  function checkPhone(key) {
    if (!/^[1-9]\d{7,14}$/.test(key)) fail("Enter a valid phone number (8–15 digits with country code)", 400);
  }
  function duplicate(existing) {
    fail(`A lead with this phone number already exists: ${existing.name}${existing.archived_at ? " (archived, restore it instead)" : ""}`, 409, {
      existingId: existing.id,
    });
  }

  // ------------------------------------------------------------ leads
  function createLead(input, ctx = {}) {
    return tx(() => {
      const name = String(input.name ?? "").trim();
      if (!name) fail("Lead name required");
      const key = canonicalPhone(input.phone);
      if (key || !ctx.allowNoPhone) {
        if (!key) fail("Phone number is required");
        checkPhone(key);
        const existing = findByPhone(key);
        if (existing) duplicate(existing);
      }
      const status = statusOf(input.status ?? "st_new_lead");
      const source = sourceOf(input.source);
      if (input.owner) activeUser(input.owner);
      const id = input.id || newId();
      const at = now();
      run(
        `INSERT INTO leads(id,name,phone_e164,phone_display,email,company,city,state,place,first_source_id,latest_source_id,
           owner_id,status_id,expected_value,product_interested,required_capacity,purchase_timeline,customer_language,
           captured_at,assigned_at,assigned_by,status_changed_at,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, name, key || null, String(input.phone ?? "").trim() || null, input.email ?? null, input.company ?? null,
        input.city ?? null, input.state ?? null, input.place ?? null, source.id, source.id,
        input.owner ?? null, status.id, input.expectedValue ?? null, input.productInterested ?? null,
        input.requiredCapacity ?? null, input.purchaseTimeline ?? null, input.customerLanguage ?? null,
        at, input.owner ? at : null, input.owner ? (ctx.userId ?? null) : null, at, at, at,
      );
      addActivity(id, "system", `Lead created from ${source.label}`, { source: ctx.source ?? "system", userId: ctx.userId });
      emit("lead.created", "lead", id, { source: source.id });
      return getLead(id);
    });
  }

  // An enquiry that arrives from any source: a new lead, or a repeat enquiry on an existing number.
  function captureLead(input, ctx = {}) {
    return tx(() => {
      const existing = findByPhone(input.phone);
      if (!existing) return { lead: createLead(input, ctx), created: true };
      const source = sourceOf(input.source);
      const at = now();
      run(
        "UPDATE leads SET is_repeat=1, repeat_count=repeat_count+1, capture_count=capture_count+1, latest_source_id=?, updated_at=? WHERE id=?",
        source.id, at, existing.id,
      );
      const status = one("SELECT stage_group FROM statuses WHERE id=?", existing.status_id);
      addActivity(existing.id, "repeat_enquiry", `Repeat enquiry from ${source.label}`, {
        source: ctx.source ?? "system",
        data: { source: source.id, message: input.message ?? null, reopenSuggested: status.stage_group !== "ACTIVE" && status.stage_group !== "FRESH" },
      });
      emit("lead.repeat_enquiry", "lead", existing.id, { source: source.id });
      return { lead: getLead(existing.id), created: false };
    });
  }

  function updateLead(id, patch, ctx = {}) {
    return tx(() => {
      const old = mustLead(id);
      const changes = {};
      const sets = [];
      const args = [];
      for (const [field, value] of Object.entries(patch)) {
        if (field === "phone") {
          const key = canonicalPhone(value);
          if (!key) fail("Phone number is required");
          checkPhone(key);
          if (key !== old.phone_e164) {
            const other = findByPhone(key);
            if (other && other.id !== id) duplicate(other);
            changes.phone_e164 = [old.phone_e164, key];
            sets.push("phone_e164=?", "phone_display=?");
            args.push(key, String(value).trim());
          }
        } else if (field === "custom") {
          if (!value || typeof value !== "object" || Array.isArray(value)) fail("custom must be an object");
          const merged = { ...old.custom, ...value };
          changes.custom = [old.custom, merged];
          sets.push("custom=?");
          args.push(JSON.stringify(merged));
        } else if (EDITABLE.has(field)) {
          if (field === "name" && !String(value ?? "").trim()) fail("Lead name required");
          if (value !== old[field]) {
            changes[field] = [old[field], value];
            sets.push(`${field}=?`);
            args.push(typeof value === "boolean" ? Number(value) : value);
          }
        } else fail(`Field cannot be edited here: ${field}`, 400);
      }
      if (!sets.length) return old;
      run(`UPDATE leads SET ${sets.join(",")}, updated_at=? WHERE id=?`, ...args, now(), id);
      addActivity(id, "field_change", `Updated ${Object.keys(changes).join(", ")}`, { userId: ctx.userId, source: ctx.source ?? "manual", data: { changes } });
      emit("lead.updated", "lead", id, { fields: Object.keys(changes) });
      return getLead(id);
    });
  }

  function setStatus(leadId, ref, ctx = {}) {
    return tx(() => {
      const lead = mustLead(leadId);
      const next = statusOf(ref);
      if (next.id === lead.status_id) return lead;
      const previous = one("SELECT * FROM statuses WHERE id=?", lead.status_id);
      const reason = next.stage_group === "LOST" ? lostReasonOf(ctx.lostReason) : null;
      const at = ctx.at || now();
      run("UPDATE leads SET status_id=?, lost_reason_id=?, status_changed_at=?, updated_at=? WHERE id=?", next.id, reason?.id ?? null, at, now(), leadId);
      addActivity(leadId, "status_change", `${previous.label} → ${next.label}${reason ? ` (${reason.label})` : ""}`, {
        userId: ctx.userId, source: ctx.source ?? "manual", occurredAt: at,
        data: { from: previous.id, to: next.id, lostReason: reason?.id ?? null, note: ctx.note ?? null },
      });
      emit("lead.status_changed", "lead", leadId, { from: previous.id, to: next.id });
      return getLead(leadId);
    });
  }

  function assign(leadId, ownerId, ctx = {}) {
    return tx(() => {
      const lead = mustLead(leadId);
      if (ownerId) activeUser(ownerId);
      if ((ownerId ?? null) === lead.owner_id) return lead;
      if (ctx.automatic && lead.lead_protection === "Protected")
        fail("This lead is protected from automatic reassignment", 409);
      const at = now();
      run(
        "UPDATE leads SET owner_id=?, previous_owner_id=?, assigned_at=?, assigned_by=?, updated_at=? WHERE id=?",
        ownerId ?? null, lead.owner_id, at, ctx.by ?? null, at, leadId,
      );
      addActivity(leadId, "assignment", ownerId ? "Lead assigned" : "Lead unassigned", {
        userId: ctx.by, source: ctx.automatic ? "rule" : "manual", data: { from: lead.owner_id, to: ownerId ?? null, automatic: Boolean(ctx.automatic) },
      });
      emit("lead.assigned", "lead", leadId, { from: lead.owner_id, to: ownerId ?? null });
      return getLead(leadId);
    });
  }

  function addTag(leadId, ref) {
    return tx(() => {
      mustLead(leadId);
      const text = String(ref ?? "").trim();
      if (!text) fail("Tag required");
      let tag = one("SELECT * FROM tags WHERE id=? OR label=? COLLATE NOCASE", text, text);
      if (!tag) {
        const id = `tag_${slug(text)}`;
        run("INSERT INTO tags(id,label) VALUES(?,?)", id, text);
        tag = one("SELECT * FROM tags WHERE id=?", id);
      }
      run("INSERT OR IGNORE INTO lead_tags(lead_id,tag_id) VALUES(?,?)", leadId, tag.id);
      return getLead(leadId);
    });
  }
  function removeTag(leadId, ref) {
    return tx(() => {
      run("DELETE FROM lead_tags WHERE lead_id=? AND tag_id IN (SELECT id FROM tags WHERE id=? OR label=? COLLATE NOCASE)", leadId, ref, ref);
      return mustLead(leadId);
    });
  }
  function addAlternatePhone(leadId, phone) {
    return tx(() => {
      mustLead(leadId);
      const key = canonicalPhone(phone);
      checkPhone(key);
      const other = findByPhone(key);
      if (other && other.id !== leadId) duplicate(other);
      run("INSERT OR IGNORE INTO lead_phones(phone_e164,lead_id,created_at) VALUES(?,?,?)", key, leadId, now());
      return getLead(leadId);
    });
  }

  // ------------------------------------------------------------ calls
  function logCall(input, ctx = {}) {
    return tx(() => {
      const key = canonicalPhone(input.phone);
      checkPhone(key);
      if (!DIRECTIONS.includes(input.direction)) fail("Invalid call direction");
      const startedAt = typeof input.startedAt === "number" ? new Date(input.startedAt).toISOString() : String(input.startedAt ?? "");
      if (!Number.isFinite(Date.parse(startedAt))) fail("Invalid call start time");
      const seconds = input.duration;
      if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 86400) fail("Invalid call duration");
      if (input.deviceId && input.localId) {
        const prior = one("SELECT * FROM calls WHERE device_id=? AND local_id=?", input.deviceId, input.localId);
        if (prior) {
          if (prior.phone_e164 !== key || prior.started_at !== startedAt || prior.duration_seconds !== seconds || prior.direction !== input.direction)
            fail("Call ID conflict", 409);
          return { call: prior, duplicate: true };
        }
      }
      const lead = findByPhone(key);
      if (!lead) fail("No lead has this phone number", 404);
      const connected = seconds > 0 && (input.direction === "Incoming" || input.direction === "Outgoing") ? 1 : 0;
      const id = input.id || newId();
      run(
        "INSERT INTO calls(id,lead_id,user_id,device_id,local_id,phone_e164,direction,started_at,duration_seconds,connected,source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        id, lead.id, input.userId ?? ctx.userId ?? null, input.deviceId ?? null, input.localId ?? null, key,
        input.direction, startedAt, seconds, connected, input.source ?? "phone", now(),
      );
      addActivity(lead.id, "call", `${input.direction} call · ${seconds}s`, {
        callId: id, userId: input.userId ?? ctx.userId, source: input.source ?? "phone", occurredAt: startedAt,
        direction: input.direction === "Outgoing" ? "Outgoing" : "Incoming", data: { duration: seconds, direction: input.direction, connected: Boolean(connected) },
      });
      const outgoing = input.direction === "Outgoing";
      const touched = outgoing || connected;
      run(
        `UPDATE leads SET call_count=call_count+1, connected_count=connected_count+?, total_call_seconds=total_call_seconds+?,
           attempts=attempts+?, last_call_at=?, first_touch_at=?, updated_at=? WHERE id=?`,
        connected, seconds, outgoing ? 1 : 0, later(lead.last_call_at, startedAt),
        touched ? earlier(lead.first_touch_at, startedAt) : lead.first_touch_at, now(), lead.id,
      );
      // First real work on a new lead moves it out of "New Lead".
      if (touched && lead.status_id === "st_new_lead") setStatus(lead.id, "st_contact_attempted", { source: "phone", at: startedAt });
      emit("call.logged", "call", id, { leadId: lead.id, connected: Boolean(connected) });
      return { call: one("SELECT * FROM calls WHERE id=?", id), duplicate: false };
    });
  }

  const OUTCOME_REASON = { co_not_interested: "lr_no_need", co_wrong_number: "lr_wrong_number" };
  function setCallOutcome(callId, ref, ctx = {}) {
    return tx(() => {
      const call = one("SELECT * FROM calls WHERE id=?", callId) || fail("Call not found", 404);
      const outcome = outcomeOf(ref);
      if (call.outcome_id === outcome.id && (ctx.note ?? null) === (call.note ?? null)) return one("SELECT * FROM calls WHERE id=?", callId);
      run("UPDATE calls SET outcome_id=?, note=? WHERE id=?", outcome.id, ctx.note ?? call.note ?? null, callId);
      addActivity(call.lead_id, "call_outcome", `Call outcome: ${outcome.label}${ctx.note ? ` — ${ctx.note}` : ""}`, {
        callId, userId: ctx.userId, source: ctx.source ?? "manual", data: { outcome: outcome.id },
      });
      const lead = mustLead(call.lead_id);
      const status = one("SELECT * FROM statuses WHERE id=?", lead.status_id);
      if (outcome.effect === "open_opportunity" && ["new", "prospecting"].includes(status.lifecycle))
        setStatus(lead.id, "st_interested", { userId: ctx.userId, source: "outcome" });
      else if (outcome.effect === "close_lead" && status.stage_group !== "WON")
        setStatus(lead.id, "st_lost", { userId: ctx.userId, source: "outcome", lostReason: ctx.lostReason ?? OUTCOME_REASON[outcome.id] });
      else if (outcome.effect === "keep_prospecting" && lead.status_id === "st_new_lead")
        setStatus(lead.id, "st_contact_attempted", { userId: ctx.userId, source: "outcome" });
      emit("call.outcome_set", "call", callId, { leadId: call.lead_id, outcome: outcome.id });
      return one("SELECT * FROM calls WHERE id=?", callId);
    });
  }

  // ------------------------------------------------------------ tasks
  function refreshFollowup(leadId) {
    if (!leadId) return;
    run(
      "UPDATE leads SET next_followup_at=(SELECT min(due_at) FROM tasks WHERE lead_id=? AND status IN ('Open','In progress')) WHERE id=?",
      leadId, leadId,
    );
  }
  function addTask(input, ctx = {}) {
    return tx(() => {
      const title = String(input.title ?? "").trim();
      if (!title) fail("Task title required");
      if (!Number.isFinite(Date.parse(input.dueAt))) fail("Valid due date required");
      if (input.leadId) mustLead(input.leadId);
      if (input.ownerId) activeUser(input.ownerId);
      const id = input.id || newId();
      run(
        "INSERT INTO tasks(id,lead_id,owner_id,type_id,title,due_at,status,origin,rule_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        id, input.leadId ?? null, input.ownerId ?? null, input.typeId ?? null, title, new Date(input.dueAt).toISOString(),
        "Open", input.origin ?? "User", input.ruleId ?? null, now(), now(),
      );
      refreshFollowup(input.leadId);
      if (input.leadId) addActivity(input.leadId, "task", `Task scheduled: ${title}`, { userId: ctx.userId, data: { taskId: id } });
      emit("task.created", "task", id, { leadId: input.leadId ?? null });
      return one("SELECT * FROM tasks WHERE id=?", id);
    });
  }
  function closeTask(taskId, status, ctx = {}) {
    return tx(() => {
      const task = one("SELECT * FROM tasks WHERE id=?", taskId) || fail("Task not found", 404);
      if (["Done", "Cancelled"].includes(task.status)) return task;
      run("UPDATE tasks SET status=?, completed_at=?, updated_at=? WHERE id=?", status, now(), now(), taskId);
      refreshFollowup(task.lead_id);
      if (task.lead_id) addActivity(task.lead_id, "task", `Task ${status.toLowerCase()}: ${task.title}`, { userId: ctx.userId, data: { taskId } });
      emit(`task.${status.toLowerCase()}`, "task", taskId, { leadId: task.lead_id });
      return one("SELECT * FROM tasks WHERE id=?", taskId);
    });
  }
  const completeTask = (id, ctx) => closeTask(id, "Done", ctx);
  const cancelTask = (id, ctx) => closeTask(id, "Cancelled", ctx);

  // Rebuild every computed counter of a lead from the underlying rows (used by migration and audits).
  function recomputeMetrics(leadId) {
    return tx(() => {
      const c = one(
        `SELECT count(*) calls, coalesce(sum(connected),0) connected, coalesce(sum(duration_seconds),0) seconds,
                sum(direction='Outgoing') outgoing, max(started_at) last_call,
                min(CASE WHEN direction='Outgoing' OR connected=1 THEN started_at END) first_touch
         FROM calls WHERE lead_id=?`, leadId,
      );
      const last = one("SELECT max(occurred_at) at FROM activities WHERE lead_id=?", leadId)?.at ?? null;
      run(
        `UPDATE leads SET call_count=?, connected_count=?, total_call_seconds=?, attempts=?, last_call_at=?,
           first_touch_at=CASE WHEN ? IS NULL THEN first_touch_at
                               WHEN first_touch_at IS NULL OR first_touch_at > ? THEN ?
                               ELSE first_touch_at END,
           last_activity_at=? WHERE id=?`,
        c.calls, c.connected, c.seconds, c.outgoing ?? 0, c.last_call, c.first_touch, c.first_touch, c.first_touch, last, leadId,
      );
      refreshFollowup(leadId);
      return getLead(leadId);
    });
  }

  return {
    tx, getLead, findByPhone, statusOf, lostReasonOf, sourceOf, createLead, captureLead, updateLead, setStatus,
    assign, addTag, removeTag, addAlternatePhone, logCall, setCallOutcome, addTask, completeTask, cancelTask,
    recomputeMetrics, addActivity, emit,
  };
}
