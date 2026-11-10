import { isBlocked } from "./blocked-numbers.mjs";
// Connects this CRM to the Devi WhatsApp gateway (Meta Cloud API, several Devi numbers).
//   The gateway tells us about every customer message with a signed POST (header X-Devi-Signature: "sha256=" + HMAC-SHA256 of the body),
//   and we send messages and read history through its REST API (header X-Api-Key). Nothing here stores a customer's WhatsApp login.
// Settings are kept encrypted in the CRM database (same way as the mail settings); the API key and the webhook secret are never sent back to the browser.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { dirname } from "node:path";
import { phoneKeyOf } from "./lead-phone.mjs";

const fail = (message, status = 400) => {
  throw Object.assign(Error(message), { status });
};
const DEFAULTS = { enabled: false, baseUrl: "", apiKey: "", webhookSecret: "", createLeads: true, defaultOwner: "", numberOwners: {}, defaultFromPhoneId: "", seenNumbers: {} };
const MAX_TEXT = 4000;

export function privateAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = address.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("::ffff:");
}
// Only public https addresses, so this cannot be used to reach anything inside the server.
export async function publicHttps(value, resolve = lookup) {
  let u;
  try {
    u = new URL(value);
  } catch {
    fail("Enter the gateway address in full, like https://wa.example.com");
  }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) fail("The gateway address must start with https:// and have no login or query in it");
  const host = u.hostname.replace(/^\[/, "").replace(/\]$/, "");
  const found = isIP(host) ? [{ address: host }] : await resolve(host, { all: true }).catch(() => fail("The gateway address could not be found"));
  if (!found.length || found.some((f) => privateAddress(f.address))) fail("The gateway address must be a public website");
  return u.origin;
}

const cleanName = (value) => {
  const name = Array.from(String(value || "").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim()).slice(0, 100).join("").trim();
  return /\p{L}/u.test(name) ? name : "";
};

export function createWaGateway({ db, all, get, put, stamp, tx, log, keyPath, systemUser = "", checkUrl = publicHttps, fetchImpl = (...a) => globalThis.fetch(...a), now = () => Date.now() }) {
  db.exec("CREATE TABLE IF NOT EXISTS wagw_settings(id INTEGER PRIMARY KEY CHECK(id=1), body BLOB)");
  let key;
  function secretKey() {
    if (key) return key;
    mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    chmodSync(keyPath, 0o600);
    key = readFileSync(keyPath);
    if (key.length !== 32) fail("The settings key is unavailable", 503);
    return key;
  }
  function raw() {
    const row = db.prepare("SELECT body FROM wagw_settings WHERE id=1").get();
    if (!row) return { ...DEFAULTS };
    const b = Buffer.from(row.body), d = createDecipheriv("aes-256-gcm", secretKey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return { ...DEFAULTS, ...JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8")) };
  }
  function store(settings) {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
    const bytes = Buffer.concat([cipher.update(JSON.stringify(settings)), cipher.final()]);
    db.prepare("INSERT INTO wagw_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(Buffer.concat([iv, cipher.getAuthTag(), bytes]));
  }
  const settings = () => {
    const s = raw();
    return { enabled: s.enabled, baseUrl: s.baseUrl, hasKey: Boolean(s.apiKey), hasSecret: Boolean(s.webhookSecret), createLeads: s.createLeads, defaultOwner: s.defaultOwner, numberOwners: s.numberOwners, defaultFromPhoneId: s.defaultFromPhoneId, seenNumbers: s.seenNumbers };
  };
  async function save(input) {
    const s = raw();
    if ("baseUrl" in input) s.baseUrl = input.baseUrl ? await checkUrl(String(input.baseUrl).trim().replace(/\/+$/, "")) : "";
    if (typeof input.apiKey === "string" && input.apiKey.trim()) {
      if (input.apiKey.length > 300 || /\s/.test(input.apiKey.trim())) fail("That API key does not look right");
      s.apiKey = input.apiKey.trim();
    }
    if (typeof input.webhookSecret === "string" && input.webhookSecret.trim()) {
      if (input.webhookSecret.length > 300 || /\s/.test(input.webhookSecret.trim())) fail("That webhook secret does not look right");
      s.webhookSecret = input.webhookSecret.trim();
    }
    if ("createLeads" in input) s.createLeads = input.createLeads === true;
    if ("defaultOwner" in input) {
      if (input.defaultOwner && !get("users", input.defaultOwner)?.active) fail("Choose an active person as the default owner");
      s.defaultOwner = input.defaultOwner || "";
    }
    if ("defaultFromPhoneId" in input) s.defaultFromPhoneId = /^\d{0,40}$/.test(input.defaultFromPhoneId || "") ? input.defaultFromPhoneId || "" : fail("Invalid number ID");
    if (input.numberOwners && typeof input.numberOwners === "object" && !Array.isArray(input.numberOwners)) {
      const owners = {};
      for (const [phoneId, owner] of Object.entries(input.numberOwners)) {
        if (!/^\d{1,40}$/.test(phoneId)) fail("Invalid number ID");
        if (owner && !get("users", owner)?.active) fail("Choose active people as owners");
        if (owner) owners[phoneId] = owner;
      }
      s.numberOwners = owners;
    }
    if ("enabled" in input) {
      if (input.enabled === true && !(s.baseUrl && s.apiKey && s.webhookSecret)) fail("Add the gateway address, the API key and the webhook secret first");
      s.enabled = input.enabled === true;
    }
    store(s);
    return settings();
  }

  // ---------------------------------------------------------------- customer messages coming in
  function conversationOf(leadId) {
    let c = all("conversations").find((x) => x.leadId === leadId && x.channel === "WhatsApp" && x.provider === "gateway");
    if (!c) {
      c = stamp({ leadId, subject: "WhatsApp · Devi gateway", channel: "WhatsApp", provider: "gateway", status: "Open", owner: get("leads", leadId)?.owner || "" });
      put("conversations", c);
    }
    return c;
  }
  function leadFor(phone) {
    const found = all("leads").filter((l) => !l.archived && phoneKeyOf(l) === phoneKeyOf({ phone }));
    return found.find((l) => l.stage !== "Closed") || found[0] || null;
  }
  function record(lead, m, seen) {
    if (all("messages").some((x) => x.provider === "gateway" && x.providerId === m.providerId)) return { duplicate: true };
    const conversation = conversationOf(lead.id);
    const message = stamp({ ...m, provider: "gateway", leadId: lead.id, conversationId: conversation.id });
    put("messages", message);
    put("conversations", { ...conversation, status: "Open", updatedAt: new Date(now()).toISOString() });
    log(lead.id, "Message", m.text, { direction: m.direction, provider: "gateway", occurredAt: m.occurredAt, ...(m.userId ? { userId: m.userId } : {}) });
    if (seen) noteNumber(seen.phoneId, seen.label);
    return { id: message.id };
  }
  function noteNumber(phoneId, label) {
    if (!phoneId) return;
    const s = raw();
    if (s.seenNumbers[phoneId] === (label || phoneId)) return;
    s.seenNumbers = { ...s.seenNumbers, [phoneId]: label || phoneId };
    store(s);
  }
  // `rawBody` is the exact bytes that were signed; the signature header is "sha256=<hex>".
  function receive(rawBody, signature) {
    const s = raw();
    if (!s.enabled || !s.webhookSecret) fail("Not found", 404);
    const given = Buffer.from(String(signature || "").replace(/^sha256=/, ""), "hex");
    const expected = createHmac("sha256", s.webhookSecret).update(rawBody).digest();
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) fail("Bad signature", 401);
    let event;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      fail("Invalid JSON");
    }
    if (!["customer.new", "message.received"].includes(event.event) || !event.data || typeof event.data !== "object") return { ignored: "event not used here" };
    const d = event.data;
    const phone = String(d.wa_id || "");
    if (!/^[1-9]\d{7,14}$/.test(phone)) return { ignored: "no phone number for this customer" };
    if (typeof d.message_id !== "string" || !d.message_id) return { ignored: "no message id" };
    if (isBlocked(db, phone)) return { ignored: "number is blocked in the CRM" };
    const text = String(d.text || "").slice(0, MAX_TEXT) || `[${String(d.kind || "message").slice(0, 30)}${d.has_file ? ", file in the gateway inbox" : ""}]`;
    const at = Number.isFinite(d.at) ? new Date(d.at * 1000).toISOString() : new Date(now()).toISOString();
    return tx(() => {
      let lead = leadFor(phone);
      let created = false;
      if (!lead) {
        if (!s.createLeads) return { ignored: "no lead for this number" };
        const owner = s.numberOwners[d.phone_id] || s.defaultOwner || "";
        lead = stamp({ name: cleanName(d.name) || phone, phone, company: "", email: "", source: "WhatsApp", stage: "New", owner, createdBy: systemUser });
        try {
          put("leads", lead);
        } catch (e) {
          lead = leadFor(phone);
          if (!lead) throw e;
        }
        created = true;
        log(lead.id, "System", `Lead created from WhatsApp${d.number_label ? ` on ${d.number_label}` : ""}`);
      }
      const result = record(lead, { providerId: d.message_id, jid: phone, direction: "Incoming", kind: String(d.kind || "text").slice(0, 30), text, occurredAt: at, status: "Received", phoneId: String(d.phone_id || ""), numberLabel: String(d.number_label || ""), hasFile: Boolean(d.has_file) }, { phoneId: String(d.phone_id || ""), label: String(d.number_label || "") });
      return { ...result, leadId: lead.id, created };
    });
  }

  // ---------------------------------------------------------------- going out
  async function call(path, init = {}) {
    const s = raw();
    if (!s.enabled || !s.baseUrl || !s.apiKey) fail("The WhatsApp gateway is not turned on", 409);
    const base = await checkUrl(s.baseUrl);
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, { ...init, redirect: "manual", signal: AbortSignal.timeout(15000), headers: { "X-Api-Key": s.apiKey, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
    } catch {
      fail("The WhatsApp gateway did not answer", 502);
    }
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* not JSON */
    }
    if (!res.ok) fail(typeof data.detail === "string" ? `WhatsApp gateway: ${data.detail.slice(0, 200)}` : `The WhatsApp gateway answered ${res.status}`, res.status === 401 ? 502 : 502);
    return data;
  }
  function fromNumber(lead, requested) {
    const s = raw();
    if (requested) return String(requested);
    const last = all("messages").filter((m) => m.provider === "gateway" && m.leadId === lead.id && m.direction === "Incoming" && m.phoneId).sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)))[0];
    if (last) return last.phoneId;
    const mine = Object.entries(s.numberOwners).find(([, owner]) => owner && owner === lead.owner);
    return mine?.[0] || s.defaultFromPhoneId || "";
  }
  // text goes inside WhatsApp's 24-hour window; outside it, send an approved template
  async function send(leadId, input, actor) {
    const lead = get("leads", leadId);
    if (!lead || lead.archived) fail("Lead not found", 404);
    const text = typeof input.text === "string" ? input.text.trim() : "";
    const template = typeof input.template === "string" ? input.template.trim() : "";
    if (!text && !template) fail("Write a message or choose a template");
    if (text.length > MAX_TEXT) fail("The message is too long");
    if (template && !/^[a-z0-9_]{1,80}$/.test(template)) fail("Invalid template name");
    const params = Array.isArray(input.params) ? input.params.map((p) => String(p).slice(0, 500)).slice(0, 20) : [];
    const key2 = phoneKeyOf(lead);
    if (!/^[1-9]\d{7,14}$/.test(key2)) fail("This lead has no valid phone number");
    const id = randomUUID();
    const sent = await call("/api/send", { method: "POST", body: JSON.stringify({ to: key2, ...(template ? { template, params, language: input.language || "en" } : { text }), from_phone_id: fromNumber(lead, input.fromPhoneId) || undefined, idempotency_key: `salesdesk:${id}` }) });
    const when = new Date(now()).toISOString();
    tx(() => record(lead, { providerId: sent.message_id || `salesdesk:${id}`, jid: key2, direction: "Outgoing", kind: template ? "template" : "text", text: template ? `Template ${template}${params.length ? `: ${params.join(", ")}` : ""}` : text, occurredAt: when, status: "Sent", userId: actor, phoneId: fromNumber(lead, input.fromPhoneId) }));
    return { id, messageId: sent.message_id || "" };
  }
  // pulls the chat the gateway holds for this lead's number, both directions, and adds what is missing
  async function history(leadId) {
    const lead = get("leads", leadId);
    if (!lead) fail("Lead not found", 404);
    const phone = phoneKeyOf(lead);
    if (!/^[1-9]\d{7,14}$/.test(phone)) fail("This lead has no valid phone number");
    const rows = await call(`/api/messages?phone=${encodeURIComponent(phone)}&limit=200`);
    if (!Array.isArray(rows)) fail("The WhatsApp gateway answered with something unexpected", 502);
    let added = 0;
    tx(() => {
      for (const r of rows.sort((a, b) => a.created_at - b.created_at)) {
        const providerId = r.meta_msg_id || `gw:${r.id}`;
        const incoming = r.direction === "in";
        const text = String(r.body || "").slice(0, MAX_TEXT) || `[${String(r.kind || "message").slice(0, 30)}]`;
        const result = record(lead, { providerId, jid: phone, direction: incoming ? "Incoming" : "Outgoing", kind: String(r.kind || "text").slice(0, 30), text, occurredAt: new Date(Number(r.created_at) * 1000).toISOString(), status: incoming ? "Received" : String(r.status || "Synced"), phoneId: String(r.phone_id || ""), source: String(r.source || "") });
        if (!result.duplicate) added++;
      }
    });
    return { added, total: rows.length };
  }
  async function test() {
    const s = raw();
    if (!s.baseUrl) fail("Add the gateway address first");
    const base = await checkUrl(s.baseUrl);
    let health;
    try {
      const res = await fetchImpl(`${base}/health`, { redirect: "manual", signal: AbortSignal.timeout(10000) });
      health = await res.json();
    } catch {
      fail("The WhatsApp gateway did not answer", 502);
    }
    let keyOk = false;
    if (s.apiKey) {
      try {
        const res = await fetchImpl(`${base}/api/messages?limit=1`, { redirect: "manual", signal: AbortSignal.timeout(10000), headers: { "X-Api-Key": s.apiKey } });
        keyOk = res.ok;
      } catch {
        keyOk = false;
      }
    }
    return { reachable: Boolean(health?.ok), keyOk, numbers: health?.connected_numbers ?? null, aiMode: health?.agent_mode ?? null, pendingAlerts: health?.pending_owner_alerts ?? null };
  }
  return { settings, save, receive, send, history, test };
}
