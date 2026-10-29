// Read-side queries for the Phase 1 tables. Everything is paged or aggregated in SQL so that screens
// never need the whole database in memory. All numbers in reports come from here, never from AI.
import { canonicalPhone } from "./phone.mjs";

const POST_QUOTATION = [
  "st_quotation", "st_negotiation", "st_loan_docs", "st_loan_process", "st_advance_pending", "st_advance_received",
  "st_payment_received", "st_dispatched", "st_delivered", "st_regular_customer", "st_won",
];
const JUNK_REASONS = ["lr_wrong_number", "lr_duplicate"];
// Work-queue predicates shared by the dashboard counts and the lead list drill-down, so a card's number
// always equals the number of leads you see when you click it.
export const QUEUES = {
  new: () => ["st.stage_group='FRESH'", []],
  untouched: () => ["l.first_touch_at IS NULL", []],
  repeat: () => ["l.is_repeat=1", []],
  today: ({ dayStart, dayEnd }) => ["l.next_followup_at >= ? AND l.next_followup_at <= ?", [dayStart, dayEnd]],
  overdue: ({ dayStart }) => ["l.next_followup_at < ?", [dayStart]],
};
const ACTIVE = "l.archived_at IS NULL AND st.stage_group IN ('FRESH','ACTIVE')";
function dayBounds({ now = new Date().toISOString(), dayStart, dayEnd } = {}) {
  return {
    dayStart: dayStart ?? now.slice(0, 10) + "T00:00:00.000Z",
    dayEnd: dayEnd ?? now.slice(0, 10) + "T23:59:59.999Z",
  };
}
const clampLimit = (limit, fallback = 50) => Math.min(200, Math.max(1, Number.isInteger(limit) ? limit : fallback));
const encode = (a, b) => Buffer.from(`${a}|${b}`).toString("base64url");
function decode(cursor) {
  if (!cursor) return null;
  try {
    const [a, ...rest] = Buffer.from(String(cursor), "base64url").toString().split("|");
    const b = rest.join("|");
    if (!a || !b) throw Error();
    return [a, b];
  } catch {
    throw Object.assign(new Error("Invalid cursor"), { status: 400 });
  }
}
const like = (text) => `%${String(text).replace(/[\\%_]/g, (c) => "\\" + c)}%`;
const ratio = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 1000 : null);

export function createQueries(db) {
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const one = (sql, ...args) => db.prepare(sql).get(...args);

  function meta() {
    return {
      statuses: all("SELECT id,label,stage_group,lifecycle,sort FROM statuses WHERE archived=0 ORDER BY sort"),
      lostReasons: all("SELECT id,label,is_default FROM lost_reasons WHERE archived=0 ORDER BY sort"),
      sources: all("SELECT id,label,kind FROM lead_sources WHERE archived=0 ORDER BY label"),
      tags: all("SELECT id,label,color FROM tags ORDER BY label"),
      callOutcomes: all("SELECT id,label,polarity,effect FROM call_outcomes ORDER BY sort"),
      fields: all("SELECT id,api_name,label,type,options,group_name,sort,searchable,required FROM field_defs WHERE archived=0 ORDER BY group_name,sort"),
      users: all("SELECT id,name,role_id,active FROM users ORDER BY name"),
    };
  }

  // Newest-updated first; cursor continues exactly where the previous page ended.
  function listLeads({ ownerId, statusId, group, sourceId, tagId, q, queue, dayStart, dayEnd, archived = false, limit, cursor } = {}) {
    const where = [archived ? "l.archived_at IS NOT NULL" : "l.archived_at IS NULL"];
    const args = [];
    if (queue) {
      if (!QUEUES[queue]) throw Object.assign(new Error("Unknown queue: " + queue), { status: 400 });
      const [cond, queueArgs] = QUEUES[queue](dayBounds({ dayStart, dayEnd }));
      where.push("st.stage_group IN ('FRESH','ACTIVE')", cond);
      args.push(...queueArgs);
    }
    if (ownerId === null) where.push("l.owner_id IS NULL");
    else if (ownerId) (where.push("l.owner_id=?"), args.push(ownerId));
    if (statusId) (where.push("l.status_id=?"), args.push(statusId));
    if (group) (where.push("st.stage_group=?"), args.push(group));
    if (sourceId) (where.push("l.first_source_id=?"), args.push(sourceId));
    if (tagId) (where.push("EXISTS (SELECT 1 FROM lead_tags lt WHERE lt.lead_id=l.id AND lt.tag_id=?)"), args.push(tagId));
    const text = String(q ?? "").trim();
    if (text) {
      const digits = canonicalPhone(text);
      const parts = ["l.name LIKE ? ESCAPE '\\'", "l.company LIKE ? ESCAPE '\\'", "l.phone_display LIKE ? ESCAPE '\\'"];
      args.push(like(text), like(text), like(text));
      if (/^\d{4,}$/.test(text.replace(/\D/g, "")) && digits) (parts.push("l.phone_e164 LIKE ?"), args.push(digits + "%"));
      where.push(`(${parts.join(" OR ")})`);
    }
    const base = `FROM leads l JOIN statuses st ON st.id=l.status_id WHERE ${where.join(" AND ")}`;
    const total = one(`SELECT count(*) c ${base}`, ...args).c;
    const after = decode(cursor);
    const pageWhere = after ? " AND (l.updated_at < ? OR (l.updated_at = ? AND l.id < ?))" : "";
    const pageArgs = after ? [after[0], after[0], after[1]] : [];
    const size = clampLimit(limit);
    const rows = all(
      `SELECT l.id,l.name,l.phone_e164,l.phone_display,l.company,l.city,l.owner_id,l.status_id,st.label status,st.stage_group,
              st.lifecycle,l.lost_reason_id,l.first_source_id,l.rating,l.expected_value,l.is_repeat,l.first_touch_at,l.last_activity_at,
              l.last_call_at,l.call_count,l.connected_count,l.next_followup_at,l.created_at,l.updated_at
       ${base}${pageWhere} ORDER BY l.updated_at DESC, l.id DESC LIMIT ?`,
      ...args, ...pageArgs, size + 1,
    );
    const items = rows.slice(0, size);
    const last = items[items.length - 1];
    return { items, total, nextCursor: rows.length > size && last ? encode(last.updated_at, last.id) : null };
  }

  function getLead(id) {
    const lead = one(
      `SELECT l.*, st.label status, st.stage_group, st.lifecycle, lr.label lost_reason, s.label first_source, u.name owner_name
       FROM leads l JOIN statuses st ON st.id=l.status_id LEFT JOIN lost_reasons lr ON lr.id=l.lost_reason_id
       LEFT JOIN lead_sources s ON s.id=l.first_source_id LEFT JOIN users u ON u.id=l.owner_id WHERE l.id=?`, id,
    );
    if (!lead) return null;
    return {
      ...lead,
      custom: JSON.parse(lead.custom),
      tags: all("SELECT t.id,t.label,t.color FROM lead_tags lt JOIN tags t ON t.id=lt.tag_id WHERE lt.lead_id=? ORDER BY t.label", id),
      phones: all("SELECT phone_e164,kind FROM lead_phones WHERE lead_id=?", id),
    };
  }

  // Orders won and their value in two months side by side, and the same per person for the current month.
  // An order is the moment a lead moved to a Won stage, so a lead is counted in the month it was closed.
  function business({ monthStart, prevStart, nextStart }) {
    const orders = (from, to) =>
      one(`SELECT count(DISTINCT a.lead_id) n, coalesce(sum(l.expected_value),0) value FROM activities a JOIN leads l ON l.id=a.lead_id
            WHERE a.type='status_change' AND json_extract(a.data,'$.to') IN (SELECT id FROM statuses WHERE stage_group='WON')
              AND a.occurred_at>=? AND a.occurred_at<?`, from, to);
    const people = all(
      `SELECT u.id,u.name,
              (SELECT count(*) FROM calls c WHERE c.user_id=u.id AND c.direction='Outgoing' AND c.started_at>=? AND c.started_at<?) calls,
              (SELECT count(DISTINCT a.lead_id) FROM activities a JOIN leads l ON l.id=a.lead_id WHERE l.owner_id=u.id AND a.type='status_change'
                  AND json_extract(a.data,'$.to')='st_quotation' AND a.occurred_at>=? AND a.occurred_at<?) quotations,
              (SELECT count(DISTINCT a.lead_id) FROM activities a JOIN leads l ON l.id=a.lead_id WHERE l.owner_id=u.id AND a.type='status_change'
                  AND json_extract(a.data,'$.to') IN (SELECT id FROM statuses WHERE stage_group='WON') AND a.occurred_at>=? AND a.occurred_at<?) orders,
              (SELECT coalesce(sum(l.expected_value),0) FROM leads l WHERE l.owner_id=u.id AND l.id IN (
                  SELECT a.lead_id FROM activities a WHERE a.type='status_change' AND json_extract(a.data,'$.to') IN (SELECT id FROM statuses WHERE stage_group='WON')
                  AND a.occurred_at>=? AND a.occurred_at<?)) value
         FROM users u WHERE u.active=1 ORDER BY value DESC, orders DESC, u.name`,
      monthStart, nextStart, monthStart, nextStart, monthStart, nextStart, monthStart, nextStart);
    return { thisMonth: orders(monthStart, nextStart), lastMonth: orders(prevStart, monthStart), people };
  }

  // Calls (to record what happened) and open tasks (what is promised next) for the lead panel.
  function leadWork(leadId) {
    return {
      calls: all(
        `SELECT c.id,c.direction,c.started_at,c.duration_seconds,c.connected,c.outcome_id,o.label outcome,c.note,u.name caller
           FROM calls c LEFT JOIN call_outcomes o ON o.id=c.outcome_id LEFT JOIN users u ON u.id=c.user_id
          WHERE c.lead_id=? ORDER BY c.started_at DESC LIMIT 20`, leadId),
      tasks: all("SELECT id,title,due_at,status,owner_id FROM tasks WHERE lead_id=? AND status NOT IN ('Done','Cancelled') ORDER BY due_at", leadId),
    };
  }

  function activities(leadId, { limit, cursor, type } = {}) {
    const after = decode(cursor);
    const size = clampLimit(limit);
    const rows = all(
      `SELECT id,type,direction,source,user_id,occurred_at,text,data,call_id FROM activities
       WHERE lead_id=?${type ? " AND type=?" : ""}${after ? " AND (occurred_at < ? OR (occurred_at = ? AND id < ?))" : ""}
       ORDER BY occurred_at DESC, id DESC LIMIT ?`,
      leadId, ...(type ? [type] : []), ...(after ? [after[0], after[0], after[1]] : []), size + 1,
    );
    const items = rows.slice(0, size).map((r) => ({ ...r, data: JSON.parse(r.data) }));
    const last = items[items.length - 1];
    return { items, nextCursor: rows.length > size && last ? encode(last.occurred_at, last.id) : null };
  }

  // Work queues for the owner dashboard. `now`, `dayStart`, `dayEnd` are ISO strings supplied by the caller
  // so "today" follows the business's local day, not the server's.
  function dashboard({ ownerId, now = new Date().toISOString(), dayStart, dayEnd } = {}) {
    const day = dayBounds({ now, dayStart, dayEnd });
    const scope = ownerId ? " AND l.owner_id=?" : "";
    const sargs = ownerId ? [ownerId] : [];
    const active = ACTIVE;
    const queueCount = (name) => {
      const [cond, args] = QUEUES[name](day);
      return one(`SELECT count(*) c FROM leads l JOIN statuses st ON st.id=l.status_id WHERE ${active}${scope} AND ${cond}`, ...sargs, ...args).c;
    };
    const callScope = ownerId ? " AND c.user_id=?" : "";
    return {
      newLeads: queueCount("new"),
      awaitingFirstTouch: queueCount("untouched"),
      repeatEnquiries: queueCount("repeat"),
      followupsToday: queueCount("today"),
      overdueFollowups: queueCount("overdue"),
      unassigned: one(`SELECT count(*) c FROM leads l JOIN statuses st ON st.id=l.status_id WHERE ${active} AND l.owner_id IS NULL`).c,
      missedCallsToReturn: one(
        `SELECT count(DISTINCT c.lead_id) c FROM calls c JOIN leads l ON l.id=c.lead_id JOIN statuses st ON st.id=l.status_id
         WHERE c.direction='Missed' AND ${active}${scope}
           AND NOT EXISTS (SELECT 1 FROM calls o WHERE o.lead_id=c.lead_id AND o.direction='Outgoing' AND o.started_at > c.started_at)`,
        ...sargs,
      ).c,
      callsNeedingOutcome: one(
        `SELECT count(*) c FROM calls c WHERE c.connected=1 AND c.outcome_id IS NULL${callScope}`, ...sargs,
      ).c,
      byStatus: all(
        `SELECT st.id,st.label,st.stage_group,count(*) count FROM leads l JOIN statuses st ON st.id=l.status_id
         WHERE l.archived_at IS NULL${scope} GROUP BY st.id ORDER BY st.sort`, ...sargs,
      ),
      won: one(`SELECT count(*) c FROM leads l WHERE l.status_id='st_won' AND l.archived_at IS NULL${scope}`, ...sargs).c,
    };
  }

  // Lead-source performance. `from` inclusive, `to` exclusive (ISO timestamps) on the lead's creation time.
  function sourceReport({ from, to, ownerId, minSample = 20 } = {}) {
    if (!from || !to || !(Date.parse(from) < Date.parse(to))) throw Object.assign(new Error("from and to required (from < to)"), { status: 400 });
    const scope = ownerId ? " AND l.owner_id=?" : "";
    const marks = POST_QUOTATION.map(() => "?").join(",");
    const junk = JUNK_REASONS.map(() => "?").join(",");
    const args = [...POST_QUOTATION, ...POST_QUOTATION, ...JUNK_REASONS, from, to, ...(ownerId ? [ownerId] : [])];
    const rows = all(
      `SELECT s.id source_id, s.label source, count(*) leads,
              coalesce(sum(l.repeat_count),0) repeat_enquiries,
              sum(l.first_touch_at IS NOT NULL) contacted,
              sum(l.connected_count > 0) connected,
              avg(CASE WHEN l.first_touch_at IS NOT NULL THEN max(0,(julianday(l.first_touch_at)-julianday(l.created_at))*1440) END) avg_minutes_to_first_touch,
              sum(l.status_id IN (${marks}) OR EXISTS (SELECT 1 FROM activities a WHERE a.lead_id=l.id AND a.type='status_change'
                    AND json_extract(a.data,'$.to') IN (${marks}))) reached_quotation,
              sum(st.stage_group='LOST' AND l.lost_reason_id IN (${junk})) junk,
              sum(st.stage_group='LOST') lost,
              sum(l.status_id='st_won') won,
              coalesce(sum(CASE WHEN l.status_id='st_won' THEN l.expected_value END),0) revenue
       FROM leads l JOIN lead_sources s ON s.id=l.first_source_id JOIN statuses st ON st.id=l.status_id
       WHERE l.created_at >= ? AND l.created_at < ?${scope} GROUP BY s.id ORDER BY leads DESC`,
      ...args,
    );
    const reasons = all(
      `SELECT l.first_source_id source_id, lr.id reason_id, lr.label reason, count(*) count
       FROM leads l JOIN statuses st ON st.id=l.status_id JOIN lost_reasons lr ON lr.id=l.lost_reason_id
       WHERE st.stage_group='LOST' AND l.created_at >= ? AND l.created_at < ?${scope} GROUP BY l.first_source_id, lr.id ORDER BY count DESC`,
      from, to, ...(ownerId ? [ownerId] : []),
    );
    const sources = rows.map((r) => ({
      ...r,
      avg_minutes_to_first_touch: r.avg_minutes_to_first_touch == null ? null : Math.round(r.avg_minutes_to_first_touch),
      rates: {
        contact: ratio(r.contacted, r.leads), connected: ratio(r.connected, r.leads), quotation: ratio(r.reached_quotation, r.leads),
        won: ratio(r.won, r.leads), junk: ratio(r.junk, r.leads),
      },
      sampleSize: r.leads < minSample ? "too_small" : "ok",
      lostReasons: reasons.filter((x) => x.source_id === r.source_id).map(({ reason_id, reason, count }) => ({ reason_id, reason, count })),
    }));
    const total = sources.reduce((s, r) => s + r.leads, 0);
    const coverage = one(
      `SELECT count(*) leads, sum(l.first_source_id='src_other') unknown_source, sum(l.phone_e164 IS NULL) without_phone,
              sum(l.owner_id IS NULL) unassigned
       FROM leads l WHERE l.created_at >= ? AND l.created_at < ?${scope}`,
      from, to, ...(ownerId ? [ownerId] : []),
    );
    return {
      period: { from, to },
      definitions: {
        contacted: "first outgoing or connected call recorded", connected: "at least one answered call",
        reached_quotation: "ever reached Quotation Shared or any later stage", junk: `lost with reason wrong number or duplicate`,
        won: "current status Won", revenue: "expected value of Won leads",
      },
      coverage: { leads: coverage.leads ?? 0, unknownSource: coverage.unknown_source ?? 0, withoutPhone: coverage.without_phone ?? 0, unassigned: coverage.unassigned ?? 0 },
      reconciled: total === (coverage.leads ?? 0),
      sources,
    };
  }

  return { meta, listLeads, getLead, leadWork, business, activities, dashboard, sourceReport };
}
