import { createHash, randomBytes, randomUUID, createCipheriv, createDecipheriv } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { phoneKeyOf } from "./lead-phone.mjs";
const hash = (data) => createHash("sha256").update(data).digest("hex");
const fail = (message, status = 400) => {
  throw Object.assign(Error(message), { status });
};
const digits = (value) => String(value || "").replace(/\D/g, "");
export const MAX_AUDIO = 20 * 1024 * 1024;
export function audioType(bytes) {
  if (bytes.subarray(0, 4).toString() === "OggS") return "audio/ogg";
  if (bytes.subarray(0, 5).toString() === "#!AMR") return "audio/amr";
  if (bytes.subarray(4, 8).toString() === "ftyp") return "audio/mp4";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WAVE")
    return "audio/wav";
  if (bytes.subarray(0, 3).toString() === "ID3" || (bytes[0] === 255 && (bytes[1] & 224) === 224))
    return "audio/mpeg";
  fail("Unsupported recording format");
}
export function createMobileSync({ db, all, get, put, stamp, tx, log, keyPath, onRecording = () => null }) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS mobile_devices(id TEXT PRIMARY KEY, token_hash TEXT UNIQUE, body TEXT); CREATE TABLE IF NOT EXISTS mobile_audio(id TEXT PRIMARY KEY, device_id TEXT, call_id TEXT UNIQUE, sha TEXT, mime TEXT, bytes BLOB, UNIQUE(device_id,sha))",
  );
  let key;
  function audioKey() {
    if (key) return key;
    mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    chmodSync(keyPath, 0o600);
    key = readFileSync(keyPath);
    if (key.length !== 32) fail("Recording encryption key unavailable", 503);
    return key;
  }
  const devices = () =>
    db
      .prepare("SELECT body FROM mobile_devices")
      .all()
      .map((r) => JSON.parse(r.body));
  function issue({ name, owner }) {
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 100 ||
      typeof owner !== "string" ||
      !get("users", owner)?.active
    )
      fail("Select an active owner and device name");
    const token = randomBytes(32).toString("base64url"),
      device = stamp({ name: name.trim(), owner, revoked: false });
    db.prepare("INSERT INTO mobile_devices VALUES(?,?,?)").run(
      device.id,
      hash(token),
      JSON.stringify(device),
    );
    return { ...device, token };
  }
  function revoke(id) {
    const d = devices().find((d) => d.id === id);
    if (!d) fail("Device not found", 404);
    db.prepare("UPDATE mobile_devices SET body=?, token_hash=NULL WHERE id=?").run(
      JSON.stringify({ ...d, revoked: true }),
      id,
    );
  }
  function authenticate(header) {
    if (typeof header !== "string" || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header))
      fail("Device token required", 401);
    const row = db
      .prepare("SELECT body FROM mobile_devices WHERE token_hash=?")
      .get(hash(header.slice(7)));
    const d = row && JSON.parse(row.body);
    if (!d || d.revoked || !get("users", d.owner)?.active)
      fail("Device token revoked or invalid", 401);
    return d;
  }
  const targets = (d) =>
    all("leads")
      .filter((l) => !l.archived && l.owner === d.owner)
      .map((l) => ({ id: l.id, phone: phoneKeyOf(l) }))
      .filter((l) => /^[1-9]\d{7,14}$/.test(l.phone));
  function preferences(d, value) {
    const row = db.prepare("SELECT body FROM mobile_devices WHERE id=?").get(d.id);
    if (!row) fail("Device unavailable", 403);
    const current = JSON.parse(row.body);
    if (value === undefined) return current.tracking || { sims: {}, assignment: "self" };
    if (!value || !value.sims || typeof value.sims !== "object" || Array.isArray(value.sims) ||
        Object.keys(value.sims).length > 8 || !["self", "unassigned"].includes(value.assignment)) fail("Invalid tracking preferences");
    const sims = {};
    for (const [account, mode] of Object.entries(value.sims)) {
      if (!/^[a-f0-9]{64}$/.test(account) || !["all", "leads", "off"].includes(mode)) fail("Invalid SIM policy");
      sims[account] = mode;
    }
    if (Object.values(sims).includes("all") && value.consent !== true) fail("Explicit all-call sync consent required");
    const tracking = { sims, assignment: value.assignment, updatedAt: new Date().toISOString() };
    db.prepare("UPDATE mobile_devices SET body=? WHERE id=?").run(JSON.stringify({ ...current, tracking }), d.id);
    return tracking;
  }
  function call(d, p) {
    if (
      typeof p.localId !== "string" ||
      !/^[\w.-]{1,100}$/.test(p.localId) ||
      !/^[1-9]\d{7,14}$/.test(p.phone || "") ||
      !["Incoming", "Outgoing", "Missed", "Rejected"].includes(p.direction) ||
      !Number.isSafeInteger(p.startedAt) ||
      p.startedAt < Date.now() - 366 * 86400000 ||
      p.startedAt > Date.now() + 300000 ||
      !Number.isSafeInteger(p.duration) ||
      p.duration < 0 ||
      p.duration > 86400
    )
      fail("Invalid call metadata");
    const existing = all("mobileCalls").find((c) => c.deviceId === d.id && c.localId === p.localId);
    const policy = preferences(d);
    const configured = Object.keys(policy.sims).length > 0;
    const mode = configured ? policy.sims[p.accountId] || "off" : "leads";
    if (mode === "off") fail("SIM tracking disabled", 403);
    const matches = targets(d).filter((l) => l.phone === p.phone);
    if(mode === "all")matches.push(...all("leads").filter(l=>l.owner === "" && l.createdBy === d.owner && !l.archived && phoneKeyOf(l) === p.phone).map(l=>({id:l.id,phone:digits(l.phone)})));
    const ownUnassigned = existing && get("leads", existing.leadId)?.owner === "" && existing.owner === d.owner;
    if (matches.length !== 1 && !(mode === "all" && ownUnassigned)) {
      if (mode !== "all" || all("leads").some((l) => phoneKeyOf(l) === p.phone))
        fail("Call does not match one accessible business lead", 403);
    }
    if (existing) {
      if (
        existing.phone !== p.phone ||
        existing.startedAt !== p.startedAt ||
        existing.duration !== p.duration ||
        existing.direction !== p.direction
      )
        fail("Call ID conflict", 409);
      return existing;
    }
    return tx(() => {
      const lead = matches[0] || stamp({ name: p.phone, phone: p.phone, company: "", email: "", source: "Phone call", stage: "New", owner: policy.assignment === "unassigned" ? "" : d.owner, createdBy: d.owner });
      if (!matches[0]) put("leads", lead);
      const activity = log(lead.id, "Call", `Phone sync · ${p.direction} · ${p.duration}s`, {
        direction: p.direction,
        duration: p.duration,
        outcome: ["Missed", "Rejected"].includes(p.direction) ? "No answer" : "Recorded",
        occurredAt: new Date(p.startedAt).toISOString(),
        deviceId: d.id,
        userId: d.owner,
      });
      const record = stamp({
        localId: p.localId,
        phone: p.phone,
        direction: p.direction,
        startedAt: p.startedAt,
        duration: p.duration,
        deviceId: d.id,
        leadId: lead.id,
        owner: d.owner,
        accountId: configured ? p.accountId : "",
        activityId: activity.id,
      });
      put("mobileCalls", record);
      return record;
    });
  }
  function recording(d, callId, bytes, meta) {
    const c = get("mobileCalls", callId);
    const policy=preferences(d);
    if(c && Object.keys(policy.sims).length && (!policy.sims[c.accountId] || policy.sims[c.accountId] === "off"))fail("SIM tracking disabled",403);
    if(c && policy.sims[c.accountId] === "leads" && !targets(d).some(l=>l.id===c.leadId))fail("Call not accessible",403);
    const lead = c && get("leads", c.leadId);
    if (!c || c.deviceId !== d.id || (!targets(d).some((l) => l.id === c.leadId) && !(c.owner === d.owner && lead?.owner === "" && lead.createdBy === d.owner)))
      fail("Call not accessible", 403);
    if (!bytes.length || bytes.length > MAX_AUDIO) fail("Recording must be 1 byte–20 MiB", 413);
    const sha = hash(bytes),
      existing = db.prepare("SELECT id,sha FROM mobile_audio WHERE call_id=?").get(c.id);
    if (existing) {
      if (existing.sha !== sha) fail("A different recording is already attached", 409);
      return { id: existing.id, duplicate: true };
    }
    if (db.prepare("SELECT id FROM mobile_audio WHERE device_id=? AND sha=?").get(d.id, sha))
      fail("Recording already attached to another call", 409);
    const duration = Number(meta.duration),
      modified = Number(meta.modified);
    if (
      !["auto", "manual"].includes(meta.mode) ||
      !Number.isFinite(duration) ||
      duration < 1 ||
      duration > 86400 ||
      !Number.isFinite(modified)
    )
      fail("Invalid recording match metadata");
    if (
      meta.mode === "auto" &&
      (c.duration < 1 ||
        Math.abs(duration - c.duration) > Math.max(10, c.duration * 0.2) ||
        Math.abs(modified - (c.startedAt + c.duration * 1000)) > 120000)
    )
      fail("Recording needs manual match review", 409);
    if (
      meta.mode === "auto" &&
      all("mobileCalls").filter(
        (other) =>
          other.deviceId === d.id &&
          other.phone === c.phone &&
          other.duration > 0 &&
          Math.abs(duration - other.duration) <= Math.max(10, other.duration * 0.2) &&
          Math.abs(modified - (other.startedAt + other.duration * 1000)) <= 120000,
      ).length !== 1
    )
      fail("Ambiguous recording match; review manually", 409);
    const mime = audioType(bytes),
      id = randomUUID(),
      iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", audioKey(), iv);
    cipher.setAAD(Buffer.from(id));
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    let assistantJob;
    tx(() => {
      db.prepare("INSERT INTO mobile_audio VALUES(?,?,?,?,?,?)").run(
        id,
        d.id,
        c.id,
        sha,
        mime,
        Buffer.concat([iv, cipher.getAuthTag(), encrypted]),
      );
      put("mobileCalls", { ...c, recordingId: id, matchMode: meta.mode });
      const activity = get("activities", c.activityId);
      put("activities", { ...activity, recordingId: id });
      log(
        c.leadId,
        "System",
        `Phone recording attached · ${meta.mode === "manual" ? "user-reviewed" : "automatic match"}`,
      );
      assistantJob = onRecording({ recordingId: id, callId: c.id });
    });
    return { id, duplicate: false, ...(assistantJob ? { assistantJobId: assistantJob.id } : {}) };
  }
  function playback(id) {
    const r = db.prepare("SELECT bytes,mime FROM mobile_audio WHERE id=?").get(id);
    if (!r) fail("Recording not found", 404);
    const data = Buffer.from(r.bytes),
      decipher = createDecipheriv("aes-256-gcm", audioKey(), data.subarray(0, 12));
    decipher.setAAD(Buffer.from(id));
    decipher.setAuthTag(data.subarray(12, 28));
    return {
      bytes: Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]),
      mime: r.mime,
    };
  }
  function feedback(d, callId, clientId, text, bytes) {
    const call = get("mobileCalls", callId), lead = call && get("leads", call.leadId);
    if (!call || !lead || (lead.owner !== d.owner && !(lead.owner === "" && lead.createdBy === d.owner && call.owner === d.owner))) fail("Call not accessible", 403);
    if (!/^[a-f0-9-]{36}$/.test(clientId || "") || typeof text !== "string" || text.length > 4000 || (!text.trim() && !bytes)) fail("Invalid feedback");
    const sha = hash(bytes || Buffer.from(text));
    const previous = all("activities").find((a) => a.feedbackId === clientId && a.userId === d.owner);
    if (previous) { if (previous.callId !== callId || previous.feedbackSha !== sha) fail("Feedback ID conflict", 409); return previous; }
    if (bytes && (!bytes.length || bytes.length > MAX_AUDIO)) fail("Voice feedback too large", 413);
    const mime = bytes ? audioType(bytes) : null;
    return tx(() => {
      let voiceNoteId;
      if (bytes) {
        voiceNoteId = randomUUID(); const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", audioKey(), iv); cipher.setAAD(Buffer.from(voiceNoteId));
        const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
        db.prepare("INSERT INTO mobile_audio VALUES(?,?,?,?,?,?)").run(voiceNoteId,d.id,"feedback:"+callId+":"+clientId,sha,mime,Buffer.concat([iv,cipher.getAuthTag(),encrypted]));
      }
      return log(call.leadId,"Note",text.trim() || "Post-call voice feedback",{userId:d.owner,callId,feedbackId:clientId,feedbackSha:sha,...(voiceNoteId?{voiceNoteId}:{})});
    });
  }
  return { devices, issue, revoke, authenticate, targets, preferences, call, recording, playback, feedback };
}
