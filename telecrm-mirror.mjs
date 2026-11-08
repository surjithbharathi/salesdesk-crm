// One-way mirror of the TeleCRM workspace into this CRM: team members (with their permission template), leads with every field,
// the activity timeline of each lead, and the follow-up of each lead as a task. TeleCRM stays the place where people work;
// nothing here ever writes back to TeleCRM.
// It talks to the TeleCRM Sync API (https://docs.telecrm.in/sync-api/overview) with a Sync token that is kept encrypted in the database.
// TeleCRM has no "changed since" filter, so a run is either full (every lead, first run and once a day) or a delta
// (leads that had activity since the last run, plus the newest leads). A lead whose modified/last-activity stamps did not move is skipped.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { phoneParts } from "./lead-phone.mjs";
import { PIPELINE } from "./pipeline.mjs";

const BASE = "https://next.telecrm.in/autoupdate/v2";
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
const DEFAULTS = { enabled: false, enterpriseId: "", token: "", intervalMinutes: 5, lastFullAt: 0, lastRun: null };
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// TeleCRM status label -> pipeline step of this CRM (spelling variations included); other labels fall back to a basic stage.
const STEP_BY_LABEL = new Map([
  ["intrested customer", "Interested Customer"], ["interested customer", "Interested Customer"],
  ["requirement discussion", "Requirement Discussion"], ["quotation shared", "Quotation Shared"],
  ["loan document collected", "Loan Document Collected"], ["loan in process", "Loan in Process"],
  ["advance received", "Advance Received"], ["machine dispatched", "Machine Dispatched"],
  ["machine delivered need to start", "Machine Delivered - Need to Start"], ["won", "Won"],
  ["later purchase", "Later Purchase"], ["lost", "Lost"],
]);
const STAGE_BY_LABEL = new Map([
  ["new lead", "New"], ["contact attempted", "Prospecting"], ["follow up negotiation", "Opportunity"],
  ["advance pending", "Quotation given"], ["payment received", "Quotation given"], ["regular customer", "Closed"],
]);
export const mapStatus = (label) => {
  const key = norm(label), step = STEP_BY_LABEL.get(key);
  if (step) { const p = PIPELINE.find((d) => d.name === step); return { deal: p.name, stage: p.stage, disposition: p.disposition }; }
  return { deal: "", stage: STAGE_BY_LABEL.get(key) || "Prospecting", disposition: "" };
};
const msOf = (v) => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v < 1e11 ? v * 1000 : v;
  if (/^\d+$/.test(String(v))) return msOf(Number(v));
  const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) - 19800000; // TeleCRM dates are India time
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
};
const text = (v, max = 4000) => (typeof v === "string" ? v : v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)).slice(0, max);

export function createTelecrmMirror({ db, all, get, put, rawPut, tx, now = () => Date.now(), keyPath, fetchImpl = (...a) => globalThis.fetch(...a), log = () => {} }) {
  db.exec("CREATE TABLE IF NOT EXISTS telecrm_settings(id INTEGER PRIMARY KEY CHECK(id=1), body BLOB)");
  let key, running = null;
  function secretKey() {
    if (key) return key;
    mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
    try { writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 }); } catch (e) { if (e.code !== "EEXIST") throw e; }
    chmodSync(keyPath, 0o600);
    key = readFileSync(keyPath);
    if (key.length !== 32) fail("The settings key is unavailable", 503);
    return key;
  }
  function raw() {
    const row = db.prepare("SELECT body FROM telecrm_settings WHERE id=1").get();
    if (!row) return { ...DEFAULTS };
    const b = Buffer.from(row.body), d = createDecipheriv("aes-256-gcm", secretKey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return { ...DEFAULTS, ...JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8")) };
  }
  function store(s) {
    const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", secretKey(), iv), bytes = Buffer.concat([c.update(JSON.stringify(s)), c.final()]);
    db.prepare("INSERT INTO telecrm_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(Buffer.concat([iv, c.getAuthTag(), bytes]));
  }
  const status = () => { const s = raw(); return { enabled: s.enabled, enterpriseId: s.enterpriseId, hasToken: Boolean(s.token), intervalMinutes: s.intervalMinutes, running: Boolean(running), lastRun: s.lastRun, lastFullAt: s.lastFullAt || null }; };
  function save(input) {
    const s = raw();
    if ("enterpriseId" in input) { const id = String(input.enterpriseId || "").trim(); if (id && !/^[A-Za-z0-9_-]{8,64}$/.test(id)) fail("That workspace ID does not look right"); s.enterpriseId = id; }
    if (typeof input.token === "string" && input.token.trim()) { const t = input.token.trim(); if (t.length > 4000 || /\s/.test(t)) fail("That token does not look right"); s.token = t; }
    if ("intervalMinutes" in input) { const n = Number(input.intervalMinutes); if (!Number.isInteger(n) || n < 2 || n > 1440) fail("Choose between 2 and 1440 minutes"); s.intervalMinutes = n; }
    if ("enabled" in input) { if (input.enabled === true && !(s.enterpriseId && s.token)) fail("Add the workspace ID and the Sync token first"); s.enabled = input.enabled === true; }
    store(s);
    return status();
  }

  // ---------------------------------------------------------------- TeleCRM API
  async function api(s, method, path, body) {
    const url = `${BASE}/enterprise/${encodeURIComponent(s.enterpriseId)}${path}`;
    for (let attempt = 1; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(url, { method, headers: { Authorization: `Bearer ${s.token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
      } catch (e) {
        if (attempt < 3) { await new Promise((r) => setTimeout(r, 500 * attempt)); continue; }
        fail("TeleCRM did not answer: " + (e.message || "network error"), 502);
      }
      if (res.status === 401 || res.status === 403) fail("TeleCRM refused the token. Make a new Sync token under Settings, Website and API.", 502);
      if ((res.status === 429 || res.status >= 500) && attempt < 4) { await new Promise((r) => setTimeout(r, 1000 * attempt)); continue; }
      if (!res.ok) fail(`TeleCRM answered ${res.status} for ${method} ${path.split("?")[0]}`, 502);
      return res.json();
    }
  }

  // ---------------------------------------------------------------- people
  function syncUsers(members) {
    const existing = all("users"), byEmail = new Map(), byName = new Map();
    for (const u of existing) { if (u.telecrmEmail) byEmail.set(u.telecrmEmail, u); if (u.email) byEmail.set(String(u.email).toLowerCase(), u); byName.set(norm(u.name), u); }
    let added = 0, updated = 0;
    for (const m of members) {
      const email = String(m.email || "").toLowerCase();
      if (!email) continue;
      const template = text(m.permission_template_name, 100), role = /caller|agent/i.test(template) ? "Sales representative" : "Manager";
      const cur = byEmail.get(email) || (norm(m.name) && byName.get(norm(m.name)));
      const next = {
        ...(cur || { id: "tc-user-" + createHash("sha1").update(email).digest("hex").slice(0, 16), createdAt: new Date(now()).toISOString() }),
        name: text(m.name, 100) || email, email, phone: m.phone_number ? "+" + String(m.phone_number).replace(/\D/g, "") : cur?.phone || "",
        role: cur?.role && cur.telecrmEmail !== email && cur.role !== role && !cur.telecrmRole ? cur.role : role,
        active: m.status === "Working" || m.status === "On Leave", telecrmEmail: email, telecrmRole: template, telecrmStatus: text(m.status, 40),
        telecrmManager: m.manager_email || "", updatedAt: new Date(now()).toISOString(),
      };
      put("users", next);
      byEmail.set(email, next);
      cur ? updated++ : added++;
    }
    return { added, updated, byEmail };
  }

  // ---------------------------------------------------------------- one lead
  function activityOf(lead, a) {
    const f = a.fields && typeof a.fields === "object" ? a.fields : {};
    const type = String(a.type || "").toUpperCase(), at = msOf(a.performed_at || a.created_on || a.createdOn || a.timestamp || a.created_at || f.performed_at || f.created_on) || now();
    const base = { leadId: lead.id, source: "TeleCRM", telecrmType: type, occurredAt: new Date(at).toISOString() };
    const who = String(a.performed_by || a.performedBy || a.employeeid || f.performed_by || "").toLowerCase();
    const note = text(f.note ?? a.note ?? f.text ?? a.text ?? f.message ?? f.summary ?? f.description ?? "");
    const idKey = a.id || a._id || createHash("sha1").update(type + "|" + at + "|" + note + "|" + who + JSON.stringify(f)).digest("hex").slice(0, 20);
    let rec;
    if (/CALL/.test(type) && !/ACTION_/.test(type)) {
      const seconds = Number(f.duration ?? f.call_duration ?? a.duration ?? 0) || 0;
      rec = { ...base, type: "Call", direction: type.startsWith("INCOMING") ? "Incoming" : type.startsWith("MISSED") ? "Missed" : "Outgoing", duration: Math.max(0, seconds), text: note || `${type.replace("_", " ").toLowerCase()}${seconds ? ` (${seconds}s)` : ""}`, ...(f.recording || f.call_recording ? { recordingUrl: text(f.recording || f.call_recording, 1000) } : {}) };
    } else if (/WHATSAPP|SMS/.test(type)) rec = { ...base, type: "Message", direction: type.startsWith("INCOMING") ? "Incoming" : "Outgoing", text: note || type };
    else if (type === "USER_NOTE") rec = { ...base, type: "Note", text: note || "Note" };
    else if (type === "STATUS_CHANGE") rec = { ...base, type: "System", text: note || `Status changed${f.status ? " to " + text(f.status, 100) : ""}` };
    else if (type === "LEAD_ASSIGNMENT") rec = { ...base, type: "System", text: note || "Lead assigned" };
    else rec = { ...base, type: type.startsWith("ACTION_") ? "Note" : "System", text: note || (type.startsWith("ACTION_") ? `${type}: ${text(f, 600)}` : type.replace(/_/g, " ").toLowerCase()) };
    return { ...rec, id: "tca-" + lead.telecrm.id + "-" + idKey, createdAt: rec.occurredAt, updatedAt: rec.occurredAt, ...(who ? { telecrmBy: who } : {}) };
  }

  function writeLead(item, actions, ctx) {
    const f = item.fields || {}, tid = item.id, id = "tc-" + tid;
    const digits = String(f.phone || "").replace(/\D/g, "");
    let parts = { phone: "", countryCode: "", mobileNumber: "", phoneKey: "" };
    if (digits) { try { parts = phoneParts("+" + digits.replace(/^0+/, "")); } catch { /* keep the raw number inside telecrm.fields only */ } }
    let cur = ctx.byTid.get(tid) || (parts.phoneKey && ctx.byPhone.get(parts.phoneKey)) || null;
    if (cur && ctx.claimed.has(cur.id)) cur = null;
    const status = text(item.status || f.status, 100), map = mapStatus(status), owner = ctx.users.get(String(item.employeeid || f.assignee || "").toLowerCase())?.id || cur?.owner || "";
    const { name: _n, phone: _p, email, city, place, company, lead_source, expected_revenue, lost_reason, next_followup, ...rest } = f;
    const created = msOf(f.created_on);
    const lead = {
      ...(cur || {}), id: cur?.id || id, name: text(f.name, 200).trim() || (parts.phone && `+${parts.phoneKey}`) || "TeleCRM lead", company: text(company, 200) || cur?.company || "",
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "") ? email : cur?.email || "", city: text(city || place, 200) || cur?.city || "", source: text(lead_source, 200) || cur?.source || "TeleCRM",
      value: Number(String(expected_revenue ?? "").replace(/[^\d.]/g, "")) || cur?.value || 0, owner, ...parts,
      stage: map.stage, deal: map.deal, disposition: map.disposition, archived: false, repeat: norm(status) === "regular customer" || Boolean(cur?.repeat), list: cur?.list || "",
      firstTouchAt: cur?.firstTouchAt ?? (msOf(f.first_attempted_call || f.first_call) ? new Date(msOf(f.first_attempted_call || f.first_call)).toISOString() : null),
      createdAt: cur?.createdAt || (created ? new Date(created).toISOString() : new Date(now()).toISOString()), updatedAt: new Date(now()).toISOString(),
      telecrm: { id: tid, status, rating: item.rating ?? 0, score: item.score ?? 0, assignee: String(item.employeeid || "").toLowerCase(), lostReason: text(lost_reason, 200), nextFollowup: msOf(next_followup) || null, modifiedOn: Number(f.modified_on) || 0, lastActivityOn: Number(f.last_activity_on) || 0, syncedAt: now(), fields: rest, phoneRaw: f.phone ? text(f.phone, 40) : "" },
    };
    ctx.claimed.add(lead.id);
    try { rawPut("leads", lead); } catch (e) {
      if (!/UNIQUE/i.test(e.message)) throw e;
      Object.assign(lead, { phone: "", countryCode: "", mobileNumber: "", phoneKey: "" });
      rawPut("leads", lead);
      ctx.counts.phoneConflicts++;
    }
    ctx.byTid.set(tid, lead);
    if (lead.phoneKey) ctx.byPhone.set(lead.phoneKey, lead);
    for (const a of actions) { try { const rec = activityOf(lead, a); rawPut("activities", rec); ctx.counts.activities++; } catch { ctx.counts.errors++; } }
    // the follow-up date is the task: it stays open while the lead is live and is closed when TeleCRM clears it or the deal ends
    const due = msOf(next_followup), taskId = "tct-" + tid, oldTask = get("tasks", taskId), live = !map.disposition;
    if (due && live) {
      rawPut("tasks", { ...(oldTask || {}), id: taskId, title: `Follow up with ${lead.name}`, leadId: lead.id, owner, status: oldTask && oldTask.due === new Date(due).toISOString() && oldTask.status === "Done" ? "Done" : "Open", due: new Date(due).toISOString(), origin: "TeleCRM", createdAt: oldTask?.createdAt || new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString() });
      ctx.counts.tasks++;
    } else if (oldTask && oldTask.status !== "Done") rawPut("tasks", { ...oldTask, status: "Done", updatedAt: new Date(now()).toISOString() });
  }

  async function actionsOf(s, tid) {
    const out = [];
    for (let skip = 0; skip < 5000; skip += 100) {
      const r = await api(s, "GET", `/lead/${encodeURIComponent(tid)}?includeActions=true&skip=${skip}&limit=100`);
      const page = Array.isArray(r.actions) ? r.actions : [];
      out.push(...page);
      if (page.length < 100) break;
    }
    return out;
  }

  // ---------------------------------------------------------------- a run
  async function sync({ full = false } = {}) {
    if (running) return running;
    running = (async () => {
      await Promise.resolve(); // let `running` be set before anything can finish
      const s = raw(), started = now(), counts = { seen: 0, changed: 0, activities: 0, tasks: 0, errors: 0, phoneConflicts: 0, users: 0 };
      const result = { at: started, mode: "", ok: false, message: "", ...counts };
      try {
        if (!s.enterpriseId || !s.token) fail("Add the workspace ID and the Sync token first");
        const doFull = full || !s.lastFullAt || started - s.lastFullAt > 24 * 3600000;
        result.mode = doFull ? "full" : "delta";
        const members = [];
        for (let skip = 0; skip < 500; skip += 10) { const r = await api(s, "GET", `/team-members?skip=${skip}&limit=10`); members.push(...(r.data || [])); if ((r.data || []).length < 10) break; }
        const u = syncUsers(members);
        counts.users = members.length;
        const users = u.byEmail, byTid = new Map(), byPhone = new Map();
        for (const l of all("leads")) { if (l.telecrm?.id) byTid.set(l.telecrm.id, l); else if (l.phoneKey) byPhone.set(l.phoneKey, l); }
        const ctx = { users, byTid, byPhone, claimed: new Set(), counts };
        const since = Math.max(0, (s.lastRun?.at || 0) - 15 * 60000);
        const queries = doFull ? [{ body: {}, max: Infinity }] : [{ body: { actions: { performed_at: { from: since, to: started + 60000 } } }, max: Infinity }, { body: {}, max: 100 }];
        const done = new Set();
        for (const q of queries) {
          for (let skip = 0; skip < q.max && skip < 200000; skip += 100) {
            const page = await api(s, "POST", `/lead/search?skip=${skip}&limit=100`, q.body);
            const items = (page.data || []).filter((i) => i && i.id && !done.has(i.id));
            const todo = [];
            for (const it of items) {
              done.add(it.id);
              counts.seen++;
              const cur = byTid.get(it.id), f = it.fields || {};
              const same = cur && cur.telecrm.modifiedOn === (Number(f.modified_on) || 0) && cur.telecrm.lastActivityOn === (Number(f.last_activity_on) || 0) && cur.telecrm.status === text(it.status || f.status, 100) && cur.telecrm.assignee === String(it.employeeid || "").toLowerCase() && cur.telecrm.nextFollowup === (msOf(f.next_followup) || null);
              if (!same) todo.push(it);
            }
            const loaded = [];
            for (const it of todo) { try { loaded.push([it, await actionsOf(s, it.id)]); } catch (e) { if (e.status === 502 && /refused/.test(e.message)) throw e; counts.errors++; loaded.push([it, []]); } }
            if (loaded.length) tx(() => { for (const [it, acts] of loaded) { writeLead(it, acts, ctx); counts.changed++; } });
            if ((page.data || []).length < 100) break;
          }
        }
        Object.assign(result, counts, { ok: true, message: `${counts.changed} of ${counts.seen} leads updated` });
        const after = raw();
        after.lastRun = { ...result, took: now() - started };
        if (doFull) after.lastFullAt = started;
        store(after);
      } catch (e) {
        Object.assign(result, counts, { ok: false, message: e.message || "Sync failed" });
        const after = raw();
        after.lastRun = { ...result, took: now() - started };
        store(after);
        log("TeleCRM sync failed: " + result.message);
      } finally { running = null; }
      return result;
    })();
    return running;
  }
  return { settings: status, save, sync, isRunning: () => Boolean(running) };
}
