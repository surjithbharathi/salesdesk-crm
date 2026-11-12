import { isBlocked } from "./blocked-numbers.mjs";
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
import { withRegion, regionHints } from "./lead-region.mjs";

const BASE = "https://next.telecrm.in/autoupdate/v2";
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
const DEFAULTS = { enabled: false, enterpriseId: "", token: "", intervalMinutes: 5, lastFullAt: 0, lastRun: null, uidMap: {}, importVersion: 0 };
const MAX_AUDIO = 20 * 1024 * 1024;
// Bump when the way things are mapped changes: the next run then reads every lead again instead of skipping the ones TeleCRM has not touched.
const IMPORT_VERSION = 2;
const RECORDINGS_PER_RUN = 150;
const RECORDING_DOWNLOADS = 4;
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
// TeleCRM's follow-up date is "next_follow-up_on". "next_followup" is a column from an old Excel upload with stale dates
// that TeleCRM itself ignores, so it is not a follow-up here either.
const followupOf = (f) => f["next_follow-up_on"];
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

export function createTelecrmMirror({ db, all, get, put, rawPut, tx, attachRecording = () => null, shareTwins = () => 0, now = () => Date.now(), keyPath, fetchImpl = (...a) => globalThis.fetch(...a), log = () => {} }) {
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
      // The file download answers 403 when a path is not an attachment of the lead, which is how it treats call recordings.
      if (res.status === 403 && path.includes("/file/download-url")) fail("TeleCRM does not share this recording through its API", 403);
      if (res.status === 401 || res.status === 403) fail("TeleCRM refused the token. Make a new Sync token under Settings, Website and API.", 502);
      if ((res.status === 429 || res.status >= 500) && attempt < 4) { await new Promise((r) => setTimeout(r, 1000 * attempt)); continue; }
      if (!res.ok) fail(`TeleCRM answered ${res.status} for ${method} ${path.split("?")[0]}`, 502);
      return res.json();
    }
  }

  // ---------------------------------------------------------------- back to TeleCRM
  // What a person (or a workflow) changes here on a lead that came from TeleCRM goes back to TeleCRM: name, email, city,
  // state, language, assignee, status, the follow-up date (moved or done) and notes typed here. Changes wait in an outbox
  // and go out within a minute; TeleCRM's answer (with any field it turned down) is kept on each entry. While a lead still
  // has changes waiting, a read from TeleCRM does not overwrite it, so the latest change wins on both sides.
  db.exec(`CREATE TABLE IF NOT EXISTS telecrm_outbox(id INTEGER PRIMARY KEY AUTOINCREMENT, tid TEXT NOT NULL, lead_id TEXT, kind TEXT NOT NULL, body TEXT NOT NULL,
    at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, error TEXT, done INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS telecrm_push_state(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT)`);
  const pushState = () => { const r = db.prepare("SELECT body FROM telecrm_push_state WHERE id=1").get(); return r ? JSON.parse(r.body) : {}; };
  const savePushState = (v) => db.prepare("INSERT INTO telecrm_push_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(JSON.stringify(v));
  const pending = (tid) => Boolean(db.prepare("SELECT 1 FROM telecrm_outbox WHERE tid=? AND done=0 AND kind='fields' LIMIT 1").get(tid));
  const tidOfLead = (leadId) => { const l = leadId && get("leads", leadId); return l?.telecrm?.id ? String(l.telecrm.id) : ""; };
  const istStamp = (iso) => { const d = new Date(Date.parse(iso) + 19800000), p = (n) => String(n).padStart(2, "0"); return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`; };
  function enqueue(tid, leadId, kind, body) {
    if (!raw().enabled) return;
    if (kind === "fields") {
      // fields waiting for the same lead are merged, so a quick run of edits goes out as one update with the latest values
      const open = db.prepare("SELECT id, body FROM telecrm_outbox WHERE tid=? AND kind='fields' AND done=0 AND tries=0 ORDER BY id DESC LIMIT 1").get(tid);
      if (open) { db.prepare("UPDATE telecrm_outbox SET body=?, at=? WHERE id=?").run(JSON.stringify({ ...JSON.parse(open.body), ...body }), now(), open.id); return; }
    }
    db.prepare("INSERT INTO telecrm_outbox(tid, lead_id, kind, body, at) VALUES(?,?,?,?,?)").run(tid, leadId || "", kind, JSON.stringify(body), now());
  }
  const userEmail = (id) => { const u = id && get("users", id); return u?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email) ? u.email.toLowerCase() : ""; };
  // this CRM's pipeline step (or a basic stage) as the TeleCRM status label it came from
  const STATUS_OUT = { "Interested Customer": "Intrested Customer", "Loan in Process": "Loan In Process", "Machine Delivered - Need to Start": "Machine Delivered - Need To Start" };
  const statusOut = (l) => (l.deal ? STATUS_OUT[l.deal] || l.deal : l.stage === "New" ? "New Lead" : "");
  // called after a record is saved here (never for what the TeleCRM read itself writes)
  function queueChange(kind, old, next) {
    try {
      if (kind === "leads") {
        const tid = next?.telecrm?.id ? String(next.telecrm.id) : "";
        if (!tid || !old || next.mergedInto) return;
        const fields = {};
        for (const k of ["name", "email", "city", "state"]) if ((next[k] || "") !== (old[k] || "") && next[k]) fields[k] = String(next[k]);
        if ((next.language || "") !== (old.language || "") && next.language) fields.customer_primary_language = next.language;
        if ((next.owner || "") !== (old.owner || "")) { const e = userEmail(next.owner); if (e) fields.assignee = e; }
        const st = statusOut(next);
        if (st && st !== statusOut(old)) fields.status = st;
        if (Object.keys(fields).length) enqueue(tid, next.id, "fields", fields);
      } else if (kind === "tasks") {
        if (!/^tct-/.test(next?.id || "") || !old) return;
        const tid = tidOfLead(next.leadId) || next.id.slice(4);
        if (next.status === "Done" && old.status !== "Done") enqueue(tid, next.leadId, "fields", { "next_follow-up_on": "" });
        else if (next.status !== "Done" && next.due && next.due !== old.due) enqueue(tid, next.leadId, "fields", { "next_follow-up_on": istStamp(next.due) });
      } else if (kind === "activities") {
        // a note typed here by a person; imports, workflow notes and system lines stay here
        if (old || next?.type !== "Note" || next.source || next.importedFrom || next.integrationSource || next.workflowId || !next.text) return;
        const tid = tidOfLead(next.leadId);
        if (tid) enqueue(tid, next.leadId, "note", { text: String(next.text).slice(0, 3900), by: get("users", next.userId)?.name || "", byEmail: userEmail(next.userId), at: next.createdAt || new Date(now()).toISOString(), activityId: next.id });
      }
    } catch (e) { log("TeleCRM outbox: " + e.message); }
  }
  // the TeleCRM custom action that carries notes from here ("Salesdesk Note"), found once by its name
  async function noteAction(s) {
    const st = pushState();
    if (st.noteAction) return st.noteAction;
    const r = await api(s, "GET", "/custom-actions?detail=true");
    const list = Array.isArray(r) ? r : r.data || r.actions || [];
    const hit = list.find((a) => /^salesdesk note$/i.test(String(a.displayName || a.name || "").trim()));
    if (!hit) fail('Add a custom action named "Salesdesk Note" in TeleCRM (Settings, Custom Actions) with a text field', 409);
    // its fields: an array, or kept under fieldSchema (as a list or keyed by api name)
    const schema = hit.fieldSchema ?? hit.fields ?? [];
    const fields = Array.isArray(schema) ? schema : Array.isArray(schema.customFieldDefinitions) ? schema.customFieldDefinitions : Array.isArray(schema.fields) ? schema.fields : [];
    const field = fields.find((f) => /text|note/i.test(String(f.type || f.apiName || f.name || ""))) || fields[0];
    const out = { code: String(hit.code || hit.type || hit.id), field: field?.apiName || field?.name || "note" };
    savePushState({ ...st, noteAction: out });
    return out;
  }
  let pushing = null;
  async function push() {
    if (pushing) return pushing;
    pushing = (async () => {
      const s = raw();
      if (!s.enabled || !s.enterpriseId || !s.token) return { sent: 0 };
      const rows = db.prepare("SELECT * FROM telecrm_outbox WHERE done=0 AND tries<5 ORDER BY id LIMIT 40").all();
      let sent = 0;
      for (const row of rows) {
        const body = JSON.parse(row.body);
        try {
          if (row.kind === "fields") {
            const r = await api(s, "POST", `/lead/${encodeURIComponent(row.tid)}`, { fields: body });
            const turnedDown = (r?.remarks || []).filter((x) => x && x.status !== "UPDATED").map((x) => `${String(x.field || "").replace(/^fields\./, "")}: ${x.remark || x.status}`);
            db.prepare("UPDATE telecrm_outbox SET done=1, tries=tries+1, error=? WHERE id=?").run(turnedDown.length ? turnedDown.join("; ").slice(0, 500) : null, row.id);
          } else {
            const a = await noteAction(s);
            const text = `${body.text}${body.by ? `\n— ${body.by}, Salesdesk` : "\n— Salesdesk"}`;
            // TeleCRM takes the action's number without "ACTION_", and who wrote it as their e-mail
            const r = await api(s, "POST", `/lead/${encodeURIComponent(row.tid)}/action`, { actions: [{ type: a.code.replace(/^ACTION_/i, ""), created_on: istStamp(body.at), ...(body.byEmail ? { employeeid: body.byEmail } : {}), fields: { [a.field]: text } }] });
            if (r?.actions?.[0]?.status === "IGNORED") fail("TeleCRM did not take the note: " + ((r.remarks || []).map((x) => x.remark).filter(Boolean).join("; ") || "ignored"));
            db.prepare("UPDATE telecrm_outbox SET done=1, tries=tries+1, error=NULL WHERE id=?").run(row.id);
          }
          sent++;
        } catch (e) {
          const gone = /answered 404/.test(e.message || "");
          db.prepare("UPDATE telecrm_outbox SET tries=?, error=? WHERE id=?").run(gone ? 5 : row.tries + 1, String(e.message || e).slice(0, 500), row.id);
          if (/refused the token/.test(e.message || "")) break;
        }
      }
      // what went out more than 30 days ago is only history
      db.prepare("DELETE FROM telecrm_outbox WHERE done=1 AND at<?").run(now() - 30 * 86400000);
      return { sent };
    })().finally(() => { pushing = null; });
    return pushing;
  }
  function outbox() {
    const c = db.prepare("SELECT SUM(done=0 AND tries<5) waiting, SUM(done=0 AND tries>=5) failed, SUM(done=1) sent, SUM(done=1 AND error IS NOT NULL) partly FROM telecrm_outbox").get();
    const recent = db.prepare("SELECT tid, lead_id leadId, kind, body, at, tries, error, done FROM telecrm_outbox ORDER BY id DESC LIMIT 20").all().map((r) => ({ ...r, body: JSON.parse(r.body) }));
    return { waiting: c.waiting || 0, failed: c.failed || 0, sent: c.sent || 0, partly: c.partly || 0, recent };
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
  // TeleCRM names people by e-mail, or by an app id for the phone app. The app id is learned from Call IQ notes, which name the caller's e-mail
  // and point at the call they belong to.
  const personOf = (ctx, raw) => {
    const id = String(raw || "");
    if (!id || id.startsWith("__")) return "";
    const email = id.includes("@") ? id.toLowerCase() : ctx.uidMap[id] || "";
    return ctx.users.get(email)?.id || "";
  };
  function learnPeople(actions, ctx) {
    for (const a of actions) {
      if (a.type !== "ACTION_1002") continue;
      const caller = String(a.fields?.telecrm_lead_caller || "").toLowerCase(), call = actions.find((x) => x.id === a.automationInfo?.triggerActionid);
      const uid = call && String(call.employeeid || "");
      if (caller.includes("@") && uid && !uid.includes("@") && ctx.uidMap[uid] !== caller) { ctx.uidMap[uid] = caller; ctx.uidDirty = true; }
    }
  }
  const outcomeOf = (feedback, duration) => {
    const f = String(feedback || "").toUpperCase();
    if (f === "CONNECTED") return "Connected";
    if (f === "NA" || f === "" || !duration) return "No answer";
    return f.charAt(0) + f.slice(1).toLowerCase().replace(/_/g, " ");
  };
  const WA = /^(Customer|Sent from [^|\n]{1,40}?)\s*\|\s*([^\n]*)\n?([\s\S]*)$/;
  const nameOf = (ctx, id) => ([...ctx.users.values()].find((u) => u.id === id)?.name) || "";

  function importActions(lead, actions, ctx) {
    const tid = lead.telecrm.id, iso = (ms) => new Date(ms).toISOString();
    learnPeople(actions, ctx);
    for (const a of actions) {
      try {
        const type = String(a.type || "").toUpperCase(), f = a.fields && typeof a.fields === "object" ? a.fields : {}, at = msOf(a.creationTimestamp || a.created_on || a.performed_at) || now();
        // a note sent from here comes back as TeleCRM's "Salesdesk Note" action: the note is already on the timeline here
        if (ctx.noteCode && type === String(ctx.noteCode).toUpperCase()) continue;
        const person = personOf(ctx, a.employeeid), base = { leadId: lead.id, source: "TeleCRM", telecrmType: type, occurredAt: iso(at), createdAt: iso(at), updatedAt: iso(at) };
        const notes = text(f.notes ?? a.text ?? a.note ?? f.note ?? f.text ?? f.message ?? "");
        const wa = WA.exec(notes);
        if (/^(INCOMING|MISSED|OUTGOING)_CALL$/.test(type)) {
          const direction = type.startsWith("INCOMING") ? "Incoming" : type.startsWith("MISSED") ? "Missed" : "Outgoing", duration = Math.max(0, Number(a.duration ?? f.duration) || 0);
          const owner = person || lead.owner || "", callId = "tcc-" + a.id, actId = "tca-" + tid + "-" + a.id, prior = get("mobileCalls", callId);
          const rec = a.callRecording && typeof a.callRecording === "object" ? a.callRecording : null;
          rawPut("activities", { ...base, id: actId, type: "Call", direction, duration, outcome: outcomeOf(a.feedback, duration), userId: owner, deviceId: "telecrm", text: text(a.note || f.note || "") || `${direction} call · ${duration}s`, ...(prior?.recordingId ? { recordingId: prior.recordingId } : {}) });
          rawPut("mobileCalls", { ...(prior || {}), id: callId, localId: a.id, phone: lead.phoneKey || "", direction, startedAt: at, duration, deviceId: "telecrm", leadId: lead.id, owner, accountId: "", activityId: actId, source: "TeleCRM", telecrmLeadId: tid, feedback: text(a.feedback, 40), recordingPath: rec?.filePath || prior?.recordingPath || "", recordingName: rec?.name || prior?.recordingName || "", createdAt: prior?.createdAt || iso(at), updatedAt: iso(at) });
          ctx.counts.calls++;
          if (rec?.filePath && !prior?.recordingId) ctx.counts.recordingsWaiting++;
        } else if (wa || /WHATSAPP/.test(type)) {
          const incoming = wa ? wa[1] === "Customer" : type.startsWith("INCOMING"), via = wa && !incoming ? (/gateway/i.test(wa[1]) ? "Gateway" : /whatsapp/i.test(wa[1]) ? "WhatsApp" : wa[1].replace(/^Sent from\s+/i, "")) : "", label = wa ? wa[2].trim() : "", body = text(wa ? wa[3] : notes);
          const convId = "tcv-" + tid;
          if (!get("conversations", convId)) rawPut("conversations", { id: convId, leadId: lead.id, subject: "WhatsApp · TeleCRM", channel: "WhatsApp", provider: "telecrm", status: "Open", owner: lead.owner || "", createdAt: iso(at), updatedAt: iso(at) });
          const sender = incoming ? "" : person || lead.owner || "", senderName = incoming ? lead.name : nameOf(ctx, sender) || "Team";
          rawPut("messages", { ...base, id: "tcm-" + a.id, provider: "telecrm", providerId: a.id, jid: lead.phoneKey ? lead.phoneKey + "@s.whatsapp.net" : "", conversationId: convId, direction: incoming ? "Incoming" : "Outgoing", text: body, status: incoming ? "Received" : "Sent", sender: senderName, senderId: sender, numberLabel: label, via });
          rawPut("activities", { ...base, id: "tca-" + tid + "-" + a.id, type: "Message", direction: incoming ? "Incoming" : "Outgoing", text: body, userId: sender, sender: senderName, numberLabel: label, via });
          const conv = get("conversations", convId);
          if (conv && (!conv.lastAt || conv.lastAt < at)) rawPut("conversations", { ...conv, lastAt: at, updatedAt: iso(at) });
          ctx.counts.messages++;
        } else if (type === "ACTION_1002") {
          rawPut("activities", { ...base, id: "tca-" + tid + "-" + a.id, type: "Note", userId: "", text: `Call IQ: ${text(f.summary, 1500)}${f["next_action_and_follow-up"] ? "\nNext: " + text(f["next_action_and_follow-up"], 800) : ""}` });
        } else if (type === "USER_NOTE" || type === "SYSTEM_NOTE") {
          rawPut("activities", { ...base, id: "tca-" + tid + "-" + a.id, type: type === "USER_NOTE" ? "Note" : "System", userId: person, text: notes || "Note" });
        } else if (type === "AUTO_UPDATE_LEAD_ACTION" || type === "FIELD_CHANGE" || type === "STATUS_CHANGE" || type === "LEAD_ASSIGNMENT") {
          const changes = (Array.isArray(a.fieldsInfo) ? a.fieldsInfo : []).slice(0, 6).map((c) => `${c.apiName}: ${text(c.currentVal, 80)}`).join(", ");
          rawPut("activities", { ...base, id: "tca-" + tid + "-" + a.id, type: "System", userId: person, text: notes || (type === "STATUS_CHANGE" ? "Status changed" : type === "LEAD_ASSIGNMENT" ? "Lead assigned" : "Details updated") + (changes ? ": " + changes : "") });
        } else {
          rawPut("activities", { ...base, id: "tca-" + tid + "-" + a.id, type: type === "OUTGOING_EMAIL" ? "Email" : "Note", userId: person, text: notes || (type.startsWith("ACTION_") ? `${type}: ${text(f, 2500)}` : type.replace(/_/g, " ").toLowerCase()) });
        }
        ctx.counts.activities++;
      } catch {
        ctx.counts.errors++;
      }
    }
  }

  // Recordings are real audio files kept encrypted in this CRM, not links. They come after the leads, a limited number per run,
  // and the ones still waiting are picked up again on the next run.
  // Recordings also run on their own short timer (copyRecordings), so a long full read of every lead does not hold them back.
  // One copy at a time: a sync that ends while a copy is running waits for it instead of starting another.
  let copying = null;
  function fetchRecordings(s, counts) {
    if (copying) return copying;
    copying = fetchRecordingsNow(s, counts).finally(() => { copying = null; });
    return copying;
  }
  async function copyRecordings() {
    const s = raw(), counts = { recordings: 0, recordingsWaiting: 0, errors: 0, fromPhone: 0 };
    // the phone app's recording of the same call comes first: TeleCRM does not share its own through the API
    try { counts.fromPhone = shareTwins(); } catch (e) { log("Phone recordings for TeleCRM calls: " + e.message); }
    if (!s.enabled || !s.enterpriseId || !s.token) return counts;
    try { await fetchRecordings(s, counts); } catch (e) { log("TeleCRM recordings: " + e.message); }
    return counts;
  }
  // Newest calls first, so today's calls are not stuck behind an old backlog; a few downloads run side by side.
  async function fetchRecordingsNow(s, counts) {
    const where = "kind='mobileCalls' AND json_extract(body,'$.recordingPath')<>'' AND json_extract(body,'$.recordingId') IS NULL AND COALESCE(json_extract(body,'$.recordingTries'),0)<4";
    const waiting = db.prepare(`SELECT body FROM records WHERE ${where} ORDER BY json_extract(body,'$.startedAt') DESC LIMIT ?`).all(RECORDINGS_PER_RUN).map((r) => JSON.parse(r.body));
    const total = Number(db.prepare(`SELECT COUNT(*) n FROM records WHERE ${where}`).get().n) || 0;
    let refused = null, next = 0;
    const worker = async () => {
      while (next < waiting.length && !refused) {
        const call = waiting[next++];
        try { await fetchOne(s, call, counts); } catch (e) { refused = e; }
      }
    };
    await Promise.all(Array.from({ length: RECORDING_DOWNLOADS }, worker));
    if (refused) throw refused;
    counts.recordingsWaiting = Math.max(0, total - counts.recordings);
  }
  async function fetchOne(s, call, counts) {
    try {
      const meta = await api(s, "GET", `/lead/${encodeURIComponent(call.telecrmLeadId)}/file/download-url?path=${encodeURIComponent(call.recordingPath)}`);
      if (!/^https:\/\//.test(meta.download_url || "")) fail("No download address", 502);
      if (Number(meta.size) > MAX_AUDIO) { rawPut("mobileCalls", { ...(get("mobileCalls", call.id) || call), recordingTries: 9, recordingNote: "Larger than 20 MB" }); return; }
      const res = await fetchImpl(meta.download_url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) fail("Recording download failed", 502);
      const bytes = Buffer.from(await res.arrayBuffer());
      attachRecording(call.id, bytes);
      counts.recordings++;
    } catch (e) {
      if (/refused the token/.test(e.message)) throw e;
      const cur = get("mobileCalls", call.id) || call;
      // a 403 will not change on a retry: give up on it at once
      if (!cur.recordingId) rawPut("mobileCalls", { ...cur, recordingTries: e.status === 403 ? 9 : (cur.recordingTries || 0) + 1, recordingNote: text(e.message, 120) });
      counts.errors++;
    }
  }

  function writeLead(item, actions, ctx) {
    const f = item.fields || {}, tid = item.id, id = "tc-" + tid;
    const digits = String(f.phone || "").replace(/\D/g, "");
    let parts = { phone: "", countryCode: "", mobileNumber: "", phoneKey: "" };
    if (digits) { try { parts = phoneParts("+" + digits.replace(/^0+/, "")); } catch { /* keep the raw number inside telecrm.fields only */ } }
    if (parts.phoneKey && isBlocked(db, parts.phoneKey)) { ctx.counts.blocked = (ctx.counts.blocked || 0) + 1; return; }
    let cur = ctx.byTid.get(tid) || (parts.phoneKey && ctx.byPhone.get(parts.phoneKey)) || null;
    if (cur && ctx.claimed.has(cur.id)) cur = null;
    // changes made here are still on their way to TeleCRM: the CRM's values are the latest, so this read leaves the lead alone
    if (cur && pending(String(tid))) { ctx.claimed.add(cur.id); ctx.counts.waitingPush = (ctx.counts.waitingPush || 0) + 1; return; }
    const status = text(item.status || f.status, 100), map = mapStatus(status), owner = ctx.users.get(String(item.employeeid || f.assignee || "").toLowerCase())?.id || cur?.owner || "";
    const { name: _n, phone: _p, email, city, place, company, lead_source, expected_revenue, lost_reason, next_followup: _nf, "next_follow-up_on": _nfo, ...rest } = f;
    const next_followup = followupOf(f);
    const created = msOf(f.created_on);
    const lead = {
      ...(cur || {}), id: cur?.id || id, name: text(f.name, 200).trim() || (parts.phone && `+${parts.phoneKey}`) || "TeleCRM lead", company: text(company, 200) || cur?.company || "",
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "") ? email : cur?.email || "", city: text(city || place, 200) || cur?.city || "",
      // "Excel" only says the lead was uploaded from a sheet; a real source found here earlier (e.g. by the Salesmax import) stays
      source: (/^excel$/i.test(text(lead_source, 200)) && cur?.source && !/^(excel|telecrm)$/i.test(cur.source) ? cur.source : text(lead_source, 200)) || cur?.source || "TeleCRM",
      value: Number(String(expected_revenue ?? "").replace(/[^\d.]/g, "")) || cur?.value || 0, owner, ...parts,
      stage: map.stage, deal: map.deal, disposition: map.disposition, archived: false, repeat: norm(status) === "regular customer" || Boolean(cur?.repeat), list: cur?.list || "",
      firstTouchAt: cur?.firstTouchAt ?? (msOf(f.first_attempted_call || f.first_call) ? new Date(msOf(f.first_attempted_call || f.first_call)).toISOString() : null),
      createdAt: cur?.createdAt || (created ? new Date(created).toISOString() : new Date(now()).toISOString()), updatedAt: new Date(now()).toISOString(),
      telecrm: { id: tid, status, rating: item.rating ?? 0, score: item.score ?? 0, assignee: String(item.employeeid || "").toLowerCase(), lostReason: text(lost_reason, 200), nextFollowup: msOf(next_followup) || null, modifiedOn: Number(f.modified_on) || 0, lastActivityOn: Number(f.last_activity_on) || 0, syncedAt: now(), fields: rest, phoneRaw: f.phone ? text(f.phone, 40) : "" },
    };
    ctx.claimed.add(lead.id);
    // TeleCRM's State (and a language field, if one exists) fill an empty state / language here; what a person set stays
    Object.assign(lead, withRegion(lead, regionHints(lead)) || {});
    try { rawPut("leads", lead); } catch (e) {
      if (!/UNIQUE/i.test(e.message)) throw e;
      Object.assign(lead, { phone: "", countryCode: "", mobileNumber: "", phoneKey: "" });
      rawPut("leads", lead);
      ctx.counts.phoneConflicts++;
    }
    ctx.byTid.set(tid, lead);
    if (lead.phoneKey) ctx.byPhone.set(lead.phoneKey, lead);
    importActions(lead, actions, ctx);
    // the follow-up date is the task: it stays open while the lead is live and is closed when TeleCRM clears it or the deal ends
    const due = msOf(next_followup), taskId = "tct-" + tid, oldTask = get("tasks", taskId), live = !map.disposition;
    // a follow-up changed in the CRM (new date, done) keeps that change while TeleCRM still holds the date it had then;
    // a new date set in TeleCRM itself takes over again
    if (due && live && oldTask?.tcDue && oldTask.tcDue === new Date(due).toISOString()) {
      if (oldTask.leadId !== lead.id || oldTask.owner !== owner) rawPut("tasks", { ...oldTask, leadId: lead.id, owner, updatedAt: new Date(now()).toISOString() });
      ctx.counts.tasks++;
    } else if (due && live) {
      if (oldTask?.tcDue) delete oldTask.tcDue;
      rawPut("tasks", { ...(oldTask || {}), id: taskId, title: `Follow up with ${lead.name}`, leadId: lead.id, owner, status: oldTask && oldTask.due === new Date(due).toISOString() && oldTask.status === "Done" ? "Done" : "Open", due: new Date(due).toISOString(), origin: "TeleCRM", createdAt: oldTask?.createdAt || new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString() });
      ctx.counts.tasks++;
    } else if (oldTask && oldTask.status !== "Done") {
      // one that was already late before today is closed as of its own date, so it does not show up as "done today"
      const today = new Date(now()); today.setHours(0, 0, 0, 0);
      const stamp = new Date(now()).toISOString(), was = Date.parse(oldTask.due);
      rawPut("tasks", { ...oldTask, status: "Done", completedAt: was < today.getTime() ? oldTask.due : stamp, updatedAt: stamp });
    }
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
      const s = raw(), started = now(), counts = { seen: 0, changed: 0, activities: 0, tasks: 0, errors: 0, phoneConflicts: 0, users: 0, calls: 0, messages: 0, recordings: 0, recordingsWaiting: 0 };
      const result = { at: started, mode: "", ok: false, message: "", ...counts };
      try {
        if (!s.enterpriseId || !s.token) fail("Add the workspace ID and the Sync token first");
        const redo = (s.importVersion || 0) < IMPORT_VERSION, doFull = full || redo || !s.lastFullAt || started - s.lastFullAt > 24 * 3600000;
        result.mode = doFull ? "full" : "delta";
        const members = [];
        for (let skip = 0; skip < 500; skip += 10) { const r = await api(s, "GET", `/team-members?skip=${skip}&limit=10`); members.push(...(r.data || [])); if ((r.data || []).length < 10) break; }
        const u = syncUsers(members);
        counts.users = members.length;
        const users = u.byEmail, byTid = new Map(), byPhone = new Map();
        for (const l of all("leads")) { if (l.telecrm?.id) byTid.set(l.telecrm.id, l); else if (l.phoneKey) byPhone.set(l.phoneKey, l); }
        const ctx = { users, byTid, byPhone, claimed: new Set(), counts, uidMap: { ...(s.uidMap || {}) }, uidDirty: false, noteCode: pushState().noteAction?.code || "" };
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
              const same = cur && cur.telecrm.modifiedOn === (Number(f.modified_on) || 0) && cur.telecrm.lastActivityOn === (Number(f.last_activity_on) || 0) && cur.telecrm.status === text(it.status || f.status, 100) && cur.telecrm.assignee === String(it.employeeid || "").toLowerCase() && cur.telecrm.nextFollowup === (msOf(followupOf(f)) || null);
              if (!same || redo) todo.push(it);
            }
            const loaded = [];
            for (const it of todo) { try { loaded.push([it, await actionsOf(s, it.id)]); } catch (e) { if (e.status === 502 && /refused/.test(e.message)) throw e; counts.errors++; loaded.push([it, []]); } }
            if (loaded.length) tx(() => { for (const [it, acts] of loaded) { writeLead(it, acts, ctx); counts.changed++; } });
            if ((page.data || []).length < 100) break;
          }
        }
        await fetchRecordings(s, counts);
        Object.assign(result, counts, { ok: true, message: `${counts.changed} of ${counts.seen} leads updated` });
        const after = raw();
        after.lastRun = { ...result, took: now() - started };
        if (ctx.uidDirty) after.uidMap = ctx.uidMap;
        if (doFull) after.lastFullAt = started;
        if (redo) after.importVersion = IMPORT_VERSION;
        store(after);
      } catch (e) {
        // a lead page that failed should not hold back recordings already known (unless TeleCRM refused the token)
        if (!/refused the token|Add the workspace ID/.test(e.message || "")) { try { await fetchRecordings(s, counts); } catch { /* reported with the run */ } }
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
  return { settings: () => ({ ...status(), outbox: outbox() }), save, sync, copyRecordings, queueChange, push, isRunning: () => Boolean(running) };
}
