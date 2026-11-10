import {createSmtpEmail} from './smtp-email.mjs';
import { createWaGateway } from "./wa-gateway.mjs";
import { createTelecrmMirror } from "./telecrm-mirror.mjs";
import { createBlockedNumbers } from "./blocked-numbers.mjs";
import { createKpi } from "./kpi.mjs";
import { extname, resolve as resolvePath, sep } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import {createWorkspaceAccess} from './workspace-access.mjs';
import {createWorkspaceRegistry} from './workspace-registry.mjs';
import { createCrmMcp } from './crm-mcp.mjs';
import { createMcpAccess } from './mcp-access.mjs';
import { createMcpOAuth } from './mcp-oauth.mjs';
import { createCallAI } from './call-ai.mjs';
import { mergeLeads } from "./lead-merge.mjs";
import { phoneParts, phoneKeyOf, assertUniqueLead, initializeLeadPhoneIndex } from "./lead-phone.mjs";
import { readFile, mkdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { createExtensions } from "./extensions.mjs";
import { encryptedAuth } from "./whatsapp-auth.mjs";
import { createWhatsApp, phoneDigits } from "./whatsapp.mjs";
import { createMobileSync, MAX_AUDIO } from "./mobile-sync.mjs";
import { PIPELINE } from "./pipeline.mjs";
import { createUserAuth } from "./user-auth.mjs";
import { scopedState } from "./user-scope.mjs";
import { createClickToCall } from "./click-to-call.mjs";
import { bridgeConfig, createAutomationBridge } from "./automation-bridge.mjs";
import { createWorkflows } from "./workflows.mjs";
import { createSalesmaxImport } from "./salesmax-import.mjs";

const port = Number(process.env.PORT || 3100);
const publicOrigin = process.env.PUBLIC_ORIGIN || "";
if (
  publicOrigin &&
  (!publicOrigin.startsWith("https://") || new URL(publicOrigin).origin !== publicOrigin)
)
  throw Error("PUBLIC_ORIGIN must be an HTTPS origin");
const allowedOrigins = [
  "http://localhost:" + port,
  "http://127.0.0.1:" + port,
  ...(publicOrigin ? [publicOrigin] : []),
];
const bindHost = process.env.BIND_HOST || "127.0.0.1";
await mkdir(new URL("./data/", import.meta.url), { recursive: true });
const db = new DatabaseSync(
  process.env.CRM_DB || new URL("./data/crm.sqlite", import.meta.url).pathname,
);
db.exec(
  "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(kind TEXT, id TEXT, body TEXT, PRIMARY KEY(kind,id))",
);
initializeLeadPhoneIndex(db);
const kinds = ["leads", "activities", "tasks", "deals", "payments", "products", "users", "lists"];
const all = (kind) =>
  db
    .prepare("SELECT body FROM records WHERE kind=? ORDER BY rowid DESC")
    .all(kind)
    .map((r) => {const value=JSON.parse(r.body);if(kind==="leads")try{return {...value,...phoneParts(value.phone)};}catch{}return value;});
// what the screens load at once: history brought in from another CRM (importedFrom) stays out, except open tasks, and is read
// per lead when the lead is opened; otherwise a big import would make every page load download it all
db.exec("CREATE INDEX IF NOT EXISTS activities_by_lead ON records(json_extract(body,'$.leadId')) WHERE kind='activities'");
const stateAll = (kind) =>
  kind === "activities" ? db.prepare("SELECT body FROM records WHERE kind='activities' AND json_extract(body,'$.importedFrom') IS NULL ORDER BY rowid DESC").all().map((r) => JSON.parse(r.body))
  : kind === "tasks" ? db.prepare("SELECT body FROM records WHERE kind='tasks' AND (json_extract(body,'$.importedFrom') IS NULL OR json_extract(body,'$.status')<>'Done') ORDER BY rowid DESC").all().map((r) => JSON.parse(r.body))
  : kind === "leads" ? all("leads").map(({ salesmax, ...lead }) => lead)
  : all(kind);
const get = (kind, id) => {
  const r = db.prepare("SELECT body FROM records WHERE kind=? AND id=?").get(kind, id);
  if(!r&&kind==="leads"){const alias=db.prepare("SELECT body FROM records WHERE kind='leadAliases' AND id=?").get(id);if(alias)return get(kind,JSON.parse(alias.body).targetId);}
  const value=r?JSON.parse(r.body):null;if(value&&kind==="leads")try{return {...value,...phoneParts(value.phone)};}catch{}return value;
};
const put = (kind, v) => {
  if(kind === "leads"){Object.assign(v,phoneParts(v.phone)); const old=get("leads",v.id);if(!old||phoneKeyOf(old)!==phoneKeyOf(v))assertUniqueLead(all,v); }
  return db
    .prepare(
      "INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body",
    )
    .run(kind, v.id, JSON.stringify(v));
};
const now = () => new Date().toISOString();
const stamp = (p) => ({ ...p, id: randomUUID(), createdAt: now(), updatedAt: now() });
function tx(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const v = fn();
    db.exec("COMMIT");
    return v;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
function log(leadId, type, text, extra = {}) {
  const a = stamp({ leadId, type, text, ...extra });
  put("activities", a);
  return a;
}
if (!all("users").length)
  tx(() => {
    const users = ["Priya Nair", "Arjun Kumar", "Meera Shah"].map((name, i) =>
      stamp({ name, role: i ? "Sales representative" : "Manager", active: true }),
    );
    users.forEach((u) => put("users", u));
    const samples = [
      ["Rahul Sharma", "Sharma Engineering", "IndiaMART", 340000, "Opportunity"],
      ["Anjali Verma", "Greenline Foods", "Website", 125000, "New"],
      ["Karthik Kumar", "Kumar Industries", "Referral", 280000, "Prospecting"],
      ["Neha Patel", "Northstar Trading", "Google Ads", 195000, "Closed"],
      ["Vikram Singh", "Singh Exports", "IndiaMART", 420000, "Opportunity"],
      ["Divya Menon", "Coastal Foods", "WhatsApp", 180000, "New"],
      ["Rohit Jain", "Jain Enterprises", "TradeIndia", 95000, "Prospecting"],
      ["Sneha Rao", "Rao Trading", "Referral", 220000, "New"],
    ];
    samples.forEach(([name, company, source, value, stage], i) => {
      const l = stamp({
        name,
        company,
        source,
        value,
        stage,
        owner: users[i % 3].id,
        phone: "+91900000000" + i,
        email: `demo${i + 1}@example.com`,
        city: ["Coimbatore", "Chennai", "Bengaluru"][i % 3],
        archived: false,
        repeat: i === 4,
        firstTouchAt: stage === "New" ? null : now(),
        list: "",
        disposition: i === 3 ? "Won" : "",
      });
      put("leads", l);
      log(l.id, "System", "Lead captured from " + source);
      if (i % 2 === 0)
        put(
          "tasks",
          stamp({
            leadId: l.id,
            title: "Discuss requirements and pricing",
            owner: l.owner,
            due: new Date(
              Date.now() + (i === 0 ? -86400000 : i === 2 ? 3600000 : 172800000),
            ).toISOString(),
            status: "Open",
            origin: "User",
          }),
        );
      if (stage === "Opportunity" || i === 3)
        put(
          "deals",
          stamp({
            leadId: l.id,
            title: company + " equipment enquiry",
            value,
            stage: i === 3 ? "Won" : "Proposal",
            owner: l.owner,
            closeDate: new Date(Date.now() + 604800000).toISOString().slice(0, 10),
          }),
        );
      if (i === 2)
        log(l.id, "Call", "Connected — requested pricing", {
          outcome: "Interested",
          direction: "Outgoing",
          duration: 184,
        });
    });
    put(
      "products",
      stamp({ name: "Oil extraction machine", sku: "OE-100", price: 195000, stock: 8 }),
    );
    put(
      "products",
      stamp({ name: "Commercial cold press", sku: "CP-200", price: 340000, stock: 3 }),
    );
    put("lists", stamp({ name: "October enquiries" }));
  });
function bad(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
const string = (v, key, max = 2000) => {
  if (typeof v !== "string" || v.length > max) bad("Invalid " + key);
  return v.trim();
};
const num = (v, key) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e12) bad("Invalid " + key);
  return v;
};
const one = (v, values, key) => {
  if (!values.includes(v)) bad("Invalid " + key);
  return v;
};
const ref = (kind, v, optional = false) => {
  if (!v && optional) return "";
  if (typeof v !== "string" || !get(kind, v)) bad("Unknown " + kind + " reference");
  return v;
};
function validate(kind, p, old = {}) {
  if (extensions.kinds.includes(kind)) return extensions.validate(kind, p, old);
  const v = { ...old },
    field = (k, fn, def) => {
      v[k] = k in p ? fn(p[k]) : (v[k] ?? def);
    };
  const s = (k, max = 2000) => field(k, (x) => string(x, k, max), "");
  const n = (k) => field(k, (x) => num(x, k), 0);
  const r = (k, kind, optional = true) => field(k, (x) => ref(kind, x, optional), "");
  const c = (k, values) => field(k, (x) => one(x, values, k), values[0]);
  const b = (k) =>
    field(
      k,
      (x) => {
        if (typeof x !== "boolean") bad("Invalid " + k);
        return x;
      },
      false,
    );
  if (kind === "leads") {
    for (const k of ["name", "company", "phone", "email", "source", "city", "disposition"])
      s(k, 200);
    if (!v.name) bad("Lead name required");
    if(["phone","countryCode","mobileNumber"].some(k=>Object.hasOwn(p,k)))Object.assign(v,phoneParts(p.mobileNumber ?? p.phone ?? v.mobileNumber ?? v.phone,p.countryCode ?? (Object.hasOwn(p,"mobileNumber")?v.countryCode||"91":"")));
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) bad("Invalid email");
    n("value");
    r("owner", "users");
    r("list", "lists");
    c("stage", ["New", "Prospecting", "Opportunity", "Quotation given", "Closed"]);
    b("archived");
    b("repeat");
    b("noCallSync"); // phone calls with this lead are not copied into the CRM
    // the pipeline step; it decides the basic stage. A change of basic stage on its own (older screens, the phone app) clears the step.
    c("deal", ["", ...PIPELINE.map((d) => d.name)]);
    if (Object.hasOwn(p, "deal")) {
      const step = PIPELINE.find((d) => d.name === v.deal);
      if (step) {
        v.stage = step.stage;
        v.disposition = step.disposition;
      }
    } else if (old.stage !== undefined && v.stage !== old.stage) v.deal = "";
  }
  if (kind === "tasks") {
    s("title", 300);
    r("leadId", "leads");
    r("owner", "users");
    c("status", ["Open", "In progress", "Done"]);
    field(
      "due",
      (x) => {
        if (typeof x !== "string" || !Number.isFinite(Date.parse(x))) bad("Invalid due date");
        return new Date(x).toISOString();
      },
      "",
    );
    v.origin = old.origin || "User";
    if (!v.title || !v.due) bad("Task title and due date required");
  }
  if (kind === "deals") {
    s("title", 300);
    r("leadId", "leads", false);
    r("owner", "users");
    n("value");
    c("stage", ["Qualified", "Proposal", "Negotiation", "Won", "Lost"]);
    s("closeDate", 30);
    if (
      !v.title ||
      !v.leadId ||
      !/^\d{4}-\d{2}-\d{2}$/.test(v.closeDate) ||
      !Number.isFinite(Date.parse(v.closeDate))
    )
      bad("Deal title, lead and valid close date required");
  }
  if (kind === "payments") {
    r("dealId", "deals", false);
    n("amount");
    s("reference", 200);
    if (!v.dealId || !v.amount) bad("Deal and positive amount required");
  }
  if (kind === "products") {
    s("name", 200);
    s("sku", 100);
    n("price");
    n("stock");
    if (!v.name || !Number.isInteger(v.stock)) bad("Name and whole stock count required");
  }
  if (kind === "users") {
    s("name", 120);
    c("role", ["Manager", "Sales representative"]);
    field(
      "active",
      (x) => {
        if (typeof x !== "boolean") bad("Invalid active");
        return x;
      },
      true,
    );
    if (!v.name) bad("Name required");
  }
  if (kind === "lists") {
    s("name", 120);
    if (!v.name) bad("Name required");
  }
  return v;
}
async function rawBody(req) {
  let size = 0;
  const chunks = [];
  for await (const p of req) {
    size += p.length;
    if (size > 262144) bad("Request too large", 413);
    chunks.push(p);
  }
  return Buffer.concat(chunks);
}
async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const p of req) {
    size += p.length;
    if (size > 1048576) bad("Request too large", 413);
    chunks.push(p);
  }
  let p;
  try {
    p = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    bad("Invalid JSON");
  }
  if (!p || typeof p !== "object" || Array.isArray(p)) bad("Expected object");
  return p;
}
const extensions = createExtensions({ all, get, put, tx, stamp, log, bad });
kinds.push(...extensions.kinds);
const mobile = createMobileSync({
  db,
  all,
  get,
  put,
  stamp,
  tx,
  log,
  keyPath:
    (process.env.CRM_DB || new URL("./data/crm.sqlite", import.meta.url).pathname) + ".mobile-key",
});
const userAuth = createUserAuth({ db, getUser: (id) => get("users", id) });
const workspaceAccess=createWorkspaceAccess({db,get,put,userAuth,crmOwnerId:process.env.CRM_OWNER_CONTEXT==='1'?process.env.CRM_OWNER_USER_ID||'':'',origin:publicOrigin});
const workspaceRegistry=process.env.CRM_OWNER_CONTEXT==='1'?createWorkspaceRegistry({db,dbPath:process.env.CRM_DB||new URL('./data/crm.sqlite',import.meta.url).pathname,ownerId:process.env.CRM_OWNER_USER_ID||'',get,baseDomain:process.env.WORKSPACE_BASE_DOMAIN,mainOrigin:publicOrigin}):null;
// KPI scorecard (My day, Team, Business, goals). Counted from the existing records; only daily goals are stored.
const kpi = createKpi({
  db, all, get, put,
  deviceOwners: () => new Map(db.prepare("SELECT body FROM mobile_devices").all().map((r) => JSON.parse(r.body)).map((d) => [d.id, d.owner])),
});
function handleKpi(req, url, identity, send, body) {
  const p = url.searchParams;
  const number = (name) => (p.has(name) ? Number(p.get(name)) : undefined);
  const role = identity ? workspaceAccess.profile(identity.user.id).role : "owner";
  const lead = ["owner", "admin", "manager"].includes(role); // who may see the whole team
  const tz = Number.isFinite(number("tz")) ? number("tz") : 330;
  const path = url.pathname.slice("/api/kpi".length);
  if (req.method === "POST" && path === "/targets") {
    if (!["owner", "admin"].includes(role)) bad("Only the owner or an admin can change goals", 403);
    return body().then((input) => send(200, kpi.setTarget(input)));
  }
  if (req.method !== "GET") bad("Not found", 404);
  if (path === "/day") {
    const userId = lead ? p.get("user") || identity?.user.id : identity.user.id; // a caller only ever sees their own day
    if (!userId || !get("users", userId)) bad("Choose a person with ?user=", 400);
    return send(200, kpi.myDay({ userId, dayStart: number("dayStart"), dayEnd: number("dayEnd"), tz }));
  }
  if (path === "/leaderboard") return send(200, kpi.leaderboard({ tz, period: p.get("period") === "month" ? "month" : "week" }));
  if (path === "/team") {
    if (!lead) bad("Managers and owners only", 403);
    return send(200, kpi.team({ dayStart: number("dayStart"), dayEnd: number("dayEnd"), tz }));
  }
  if (path === "/targets") return send(200, { targets: kpi.allTargets() });
  if (path === "/business") {
    if (!lead) bad("Managers and owners only", 403);
    const [monthStart, prevStart, nextStart] = ["monthStart", "prevStart", "nextStart"].map((k) => Date.parse(p.get(k)));
    if (![monthStart, prevStart, nextStart].every(Number.isFinite)) bad("monthStart, prevStart and nextStart are required", 400);
    return send(200, kpi.business({ monthStart, prevStart, nextStart }));
  }
  if (path === "/me") return send(200, { id: identity?.user.id || null, role, lead, users: all("users").filter((u) => u.active !== false).map((u) => ({ id: u.id, name: u.name })) });
  bad("Not found", 404);
}
// The new web app (built into web/dist) is served under /next/. Static files only; its data comes from /api/kpi.
const WEB_ROOT = fileURLToPath(new URL("./web/dist/", import.meta.url));
const WEB_TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".woff": "font/woff" };
const GZ_TYPES = new Set([".html", ".js", ".css", ".svg", ".json", ".webmanifest"]);
const gzCache = new Map();
async function serveWebApp(pathname, res, req) {
  let relative;
  try {
    relative = decodeURIComponent(pathname.slice("/next/".length)) || "index.html";
  } catch {
    relative = "";
  }
  const root = WEB_ROOT.endsWith(sep) ? WEB_ROOT.slice(0, -1) : WEB_ROOT;
  const file = resolvePath(root, relative);
  const type = WEB_TYPES[extname(file)];
  if (!relative || !file.startsWith(root + sep) || !type) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not found");
  }
  try {
    const data = await readFile(file);
    const headers = { "Content-Type": type, "Cache-Control": relative.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-store" };
    // text files go out gzipped when the browser accepts it (the app script is about a third of its size then)
    if (GZ_TYPES.has(extname(file)) && data.length > 1024 && /gzip/.test(req?.headers["accept-encoding"] || "")) {
      let zipped = gzCache.get(file);
      if (!zipped || !zipped.raw.equals(data)) { zipped = { raw: data, body: gzipSync(data, { level: 9 }) }; gzCache.set(file, zipped); }
      res.writeHead(200, { ...headers, "Content-Encoding": "gzip", Vary: "Accept-Encoding" });
      return res.end(zipped.body);
    }
    res.writeHead(200, headers);
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("The new web app has not been built. Run: npm run web:build");
  }
}
// A short unique badge per person for chat bubbles, taken from their login username (unique by rule):
// the first two letters, or more letters when two people would otherwise share the same badge.
function withBadges(state) {
  if (!state || !Array.isArray(state.users)) return state;
  const names = new Map(userAuth.listAccounts().map((a) => [a.id, a.username]));
  const clean = (s) => String(s || "").replace(/[^\p{L}\p{N}]/gu, "").toUpperCase();
  const base = state.users.map((u) => clean(names.get(u.id) || u.email?.split("@")[0] || u.name) || "?");
  const badges = base.map((b) => b.slice(0, 2));
  // A badge fits a small circle: two letters, a third only when two clash, then a number (SU, SUR, SU2).
  const group = () => { const seen = new Map(); badges.forEach((b, i) => seen.set(b, [...(seen.get(b) || []), i])); return [...seen.values()].filter((idx) => idx.length > 1); };
  for (const idx of group()) for (const i of idx) if (base[i].length >= 3) badges[i] = base[i].slice(0, 3);
  for (const idx of group()) idx.forEach((i, n) => { if (n) badges[i] = base[i].slice(0, 2) + (n + 1); });
  return { ...state, users: state.users.map((u, i) => ({ ...u, badge: badges[i] })) };
}
function permittedState(value,id){
  if(!id)return value;const calls=workspaceAccess.can(id,'calls.read'),messages=workspaceAccess.can(id,'messages.read');
  return {...value,mobileCalls:calls?value.mobileCalls:[],activities:(value.activities||[]).filter(a=>(calls||a.type!=='Call')&&(messages||a.type!=='Message')),messages:messages?value.messages:[],conversations:messages?value.conversations:[]};
}
const callAI = createCallAI({db,all,get,playback:mobile.playback,keyPath:(process.env.CRM_DB || new URL('./data/crm.sqlite',import.meta.url).pathname)+'.ai-key'});
const smtpEmail=createSmtpEmail({db,keyPath:(process.env.CRM_DB||new URL('./data/crm.sqlite',import.meta.url).pathname)+'.smtp-key',origin:publicOrigin});
// the one-way mirror of TeleCRM: it writes records directly (no per-lead uniqueness scan), the unique phone index still protects against duplicates
const rawPut = (kind, v) => db.prepare("INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body").run(kind, v.id, JSON.stringify(v));
const salesmaxImport = createSalesmaxImport({ db, get, put: rawPut, tx, users: () => all("users") });
const telecrm = createTelecrmMirror({ db, all, get, put, rawPut, tx, attachRecording: (callId, bytes) => mobile.importRecording(callId, bytes), shareTwins: () => mobile.shareTwins(), keyPath: (process.env.CRM_DB || new URL("./data/crm.sqlite", import.meta.url).pathname) + ".telecrm-key", log: (m) => console.error(m) });
const waGateway = createWaGateway({ db, all, get, put, stamp, tx, log, systemUser: process.env.CRM_OWNER_USER_ID || "", keyPath: (process.env.CRM_DB || new URL("./data/crm.sqlite", import.meta.url).pathname) + ".wagw-key" });
const blocked = createBlockedNumbers(db);
// Workflows: admins' "when this happens, do that" rules, checked every 30 seconds; WhatsApp goes out through the gateway
const workflows = createWorkflows({ db, get, put, stamp, tx, log, users: () => all("users").filter((u) => u.active !== false), sendWhatsApp: (leadId, message) => waGateway.send(leadId, message, ""), gatewayOn: () => waGateway.settings().enabled, report: (m) => console.error(m) });
// Removes a lead and everything recorded against it (calls and their recordings, notes, messages, chats, follow-ups, deals).
// With block, its number is blocked first so no sync brings it back.
function deleteLead(id, { block = false, by = "" } = {}) {
  const lead = get("leads", id);
  if (!lead) bad("Lead not found", 404);
  return tx(() => {
    const blockedNumber = block ? blocked.add(lead.phoneKey || lead.phone, { name: lead.name, by }) : "";
    const audio = db.prepare("SELECT json_extract(body,'$.recordingId') r FROM records WHERE kind='mobileCalls' AND json_extract(body,'$.leadId')=?").all(id).map((x) => x.r).filter(Boolean);
    for (const r of audio) db.prepare("DELETE FROM mobile_audio WHERE id=?").run(r);
    const removed = Number(db.prepare("DELETE FROM records WHERE kind<>'leads' AND json_extract(body,'$.leadId')=?").run(id).changes);
    db.prepare("DELETE FROM records WHERE kind='leads' AND id=?").run(id);
    blocked.recordDeleted(lead, { by, blocked: block });
    return { deleted: true, name: lead.name, records: removed, recordings: audio.length, blocked: blockedNumber };
  });
}
const mcpAccess=createMcpAccess({db,get,canAdmin:id=>workspaceAccess.can(id,'integrations.manage')});
const mcpOAuth=createMcpOAuth({db,origin:publicOrigin||`http://localhost:${port}`,access:mcpAccess});
const mcpIdentity=owner=>({user:{id:owner,role:'admin'}});
const crmMcp=createCrmMcp({db,authorize:mcpAccess.authorize,all,get,put,validate,tx,log,
  authorizeOperation:(owner,tool)=>{
    const permission={lead_edit:'leads.write',lead_assign:'leads.write',daily_report:'reports.read',lead_insights:'calls.read',call_ai_get:'calls.read',transcription_process:'leads.write'}[tool];
    if(permission)workspaceAccess.requirePermission({user:{id:owner}},permission);
  },
  canTranscribe:()=>callAI.publicSettings().enabled,
  readRecording:(id,owner)=>callAI.result(id,mcpIdentity(owner)),
  processRecording:(id,owner)=>callAI.enqueue(id,mcpIdentity(owner)),
  callOwner:id=>mobile.devices().find(device=>device.id===id)?.owner||''});
const automation = createAutomationBridge({
  db,
  getUser: (id) => get("users", id),
  config: bridgeConfig(),
});
if (publicOrigin && !userAuth.configured())
  throw Error(
    "Public deployment requires an existing company account database; refusing unauthenticated setup",
  );
const clickToCall = createClickToCall({
  db,
  getLead: (id) => get("leads", id),
  getDevice: (id) => mobile.devices().find((d) => d.id === id),
});
function sessionToken(req) {
  return (
    /(?:^|;\s*)salesdesk_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie || "")?.[1] ||
    ""
  );
}
function ownLead(userId, leadId) {
  if (typeof leadId !== "string" || get("leads", leadId)?.owner !== userId)
    bad("Lead not accessible", 403);
  return get("leads", leadId);
}
function loginDevice(identity) {
  if (!/^[a-f0-9-]{36}$/i.test(identity.deviceId || ""))
    bad("Mobile login requires a valid device ID", 401);
  let device = mobile
    .devices()
    .find((d) => d.clientId === identity.deviceId && d.owner === identity.user.id);
  if (device?.revoked) bad("Device access revoked", 401);
  if (!device) {
    const issued = mobile.issue({
      name: `${identity.user.name} · mobile`,
      owner: identity.user.id,
    });
    device = {
      id: issued.id,
      name: issued.name,
      owner: issued.owner,
      createdAt: issued.createdAt,
      updatedAt: issued.updatedAt,
      revoked: false,
      clientId: identity.deviceId,
    };
    db.prepare("UPDATE mobile_devices SET body=?, token_hash=NULL WHERE id=?").run(
      JSON.stringify(device),
      device.id,
    );
  }
  return device;
}
// Separate device-only listener: never proxies the unauthenticated web/admin app.
const mobilePort = Number(process.env.MOBILE_PORT || port + 1);
const mobileServer = http.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const reply = (status, value) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(value));
  };
  try {
    if (req.headers.origin) bad("Browser access is not supported on the device API", 403);
    const url = new URL(req.url, "http://localhost");
    if (req.method === "POST" && url.pathname === "/v1/login") {
      if (!userAuth.configured()) bad("Create the shared company login in the web CRM first", 503);
      if (req.headers["content-type"]?.split(";")[0] !== "application/json")
        bad("JSON required", 415);
      const p = await body(req);
      if (typeof p.deviceId !== "string" || !/^[a-f0-9-]{36}$/i.test(p.deviceId))
        bad("Valid mobile device ID required");
      const result = userAuth.login(p);
      loginDevice(result);
      reply(200, result);
      return;
    }
    const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || "")?.[1] || "";
    const identity = userAuth.configured() ? userAuth.authenticate(bearer) : null;
    const device = identity
      ? loginDevice(identity)
      : mobile.authenticate(req.headers.authorization);
    if(url.pathname.startsWith('/v1/recordings/'))workspaceAccess.requirePermission(identity||{user:{id:device.owner}},'calls.read');
    if(!['GET','HEAD'].includes(req.method)&&url.pathname!=='/v1/logout'){
      const actor=identity||{user:{id:device.owner}};
      if(url.pathname.startsWith('/v1/leads'))workspaceAccess.requirePermission(actor,'leads.write');
      else if(url.pathname.startsWith('/v1/tasks'))workspaceAccess.requirePermission(actor,'tasks.write');
      else workspaceAccess.requirePermission(actor,'calls.sync');
    }
    if (url.pathname === "/v1/logout" && req.method === "POST") {
      if (identity) userAuth.revoke(bearer);
      reply(200, { loggedOut: true });
      return;
    }
    if(url.pathname === "/v1/leads/merge" && req.method === "POST" && identity){const p=await body(req);reply(200,mergeLeads({db,targetId:p.targetId,sourceIds:p.sourceIds,actorId:identity.user.id,admin:identity.user.role==="admin"}));return;}
    if (url.pathname === "/v1/tracking-preferences" && identity) {
      if (req.method === "GET") reply(200, mobile.preferences(device));
      else if (req.method === "PUT") {
        if (req.headers["content-type"]?.split(";")[0] !== "application/json") bad("JSON required", 415);
        reply(200, mobile.preferences(device, await body(req)));
      } else bad("Method not allowed", 405);
      return;
    }
    if(url.pathname === "/v1/admin/users" && req.method === "GET" && identity){
      if(identity.user.role !== "admin")bad("Administrator required",403);
      workspaceAccess.requirePermission(identity,'users.manage');
      reply(200,{users:userAuth.listAccounts()});return;
    }
    const phoneBoard = /^\/v1\/kpi\/leaderboard\/(week|month)\/(-?\d{1,4})$/.exec(url.pathname);
    if (phoneBoard && req.method === "GET") {
      if (!identity) bad("Shared user login required", 401);
      reply(200, { rows: kpi.leaderboard({ period: phoneBoard[1], tz: Number(phoneBoard[2]) }) });
      return;
    }
    const phoneDay = /^\/v1\/kpi\/day(?:\/(-?\d{1,4})\/(\d{10,14})\/(\d{10,14}))?$/.exec(url.pathname);
    if (phoneDay && req.method === "GET") {
      // The phone shows the signed-in person's own day: goals, streak, badges and who to call next.
      // It sends its own time zone and day bounds in the path, because the app refuses query strings.
      if (!identity) bad("Shared user login required", 401);
      const [, tz, dayStart, dayEnd] = phoneDay;
      reply(200, kpi.myDay({ userId: identity.user.id, tz: tz === undefined ? 330 : Number(tz), dayStart: dayStart === undefined ? undefined : Number(dayStart), dayEnd: dayEnd === undefined ? undefined : Number(dayEnd) }));
      return;
    }
    if (url.pathname === "/v1/workspace" && req.method === "GET") {
      if (!identity) bad("Shared user login required", 401);
      reply(200, {
        ...permittedState(scopedState(all, identity.user.id),identity.user.id),
        user: identity.user,
        company: identity.company,
      });
      return;
    }
    if (
      identity &&
      ["POST", "PATCH"].includes(req.method) &&
      /^\/v1\/(leads|tasks|notes)(?:\/[a-f0-9-]{36})?$/.test(url.pathname)
    ) {
      if (req.headers["content-type"]?.split(";")[0] !== "application/json")
        bad("JSON required", 415);
      const [, , kind, id] = url.pathname.split("/");
      const p = await body(req),
        userId = identity.user.id;
      const result = tx(() => {
        if (kind === "notes") {
          if (req.method !== "POST" || id) bad("Unsupported route", 405);
          ownLead(userId, p.leadId);
          const text = string(p.text, "text", 4000);
          if (!text) bad("Note text required");
          return log(p.leadId, "Note", text, { userId });
        }
        if ((req.method === "PATCH") !== Boolean(id)) bad("Unsupported route", 405);
        const old = id ? get(kind, id) : null;
        if (id && !old) bad("Record not found", 404);
        if (kind === "leads") {
          if (old) ownLead(userId, id);
          const allowed = ["name", "phone", "countryCode", "mobileNumber", "company", "email", "city", "stage", "value"];
          if (Object.keys(p).some((k) => !allowed.includes(k))) bad("Unsupported lead field");
          const value = validate("leads", { ...p, owner: userId }, old || {}),
            record = old ? { ...value, updatedAt: now() } : stamp({ ...value, firstTouchAt: null });
          put("leads", record);
          log(record.id, "System", old ? "Lead updated from mobile" : "Lead created from mobile", {
            userId,
          });
          return record;
        }
        if (old && old.owner !== userId) bad("Task not accessible", 403);
        if (old && Object.keys(p).some((k) => k !== "status"))
          bad("Only task status can be changed here");
        if (p.leadId) ownLead(userId, p.leadId);
        if (old?.leadId) ownLead(userId, old.leadId);
        const value = validate("tasks", { ...p, owner: userId }, old || {}),
          record = old ? { ...value, updatedAt: now() } : stamp(value);
        put("tasks", record);
        if (record.leadId)
          log(record.leadId, "System", `Task ${record.status}: ${record.title}`, { userId });
        return record;
      });
      reply(200, result);
      return;
    }
    const playback = /^\/v1\/recordings\/([a-f0-9-]{36})$/.exec(url.pathname);
    if (identity && playback && req.method === "GET") {
      const call = all("mobileCalls").find((c) => c.recordingId === playback[1]);
      if (!call) bad("Recording not found", 404);
      const lead=get("leads",call.leadId);
      if(!(lead?.owner === "" && lead.createdBy === identity.user.id && call.owner === identity.user.id))ownLead(identity.user.id, call.leadId);
      const audio = mobile.playback(playback[1]);
      res.writeHead(200, { "Content-Type": audio.mime, "Content-Length": audio.bytes.length });
      res.end(audio.bytes);
      return;
    }
    if (identity && url.pathname.startsWith("/v1/click-to-call/") && req.method === "POST") {
      if (req.headers["content-type"]?.split(";")[0] !== "application/json")
        bad("JSON required", 415);
      const p = await body(req);
      if (url.pathname === "/v1/click-to-call/poll")
        reply(200, clickToCall.poll(identity.user.id, device.id, p.armed));
      else if (url.pathname === "/v1/click-to-call/ack")
        reply(200, clickToCall.acknowledge(identity.user.id, device.id, p.id, p.status));
      else bad("Not found", 404);
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/targets") {
      reply(200, mobile.targets(device));
      return;
    }
    const targetName = /^\/v1\/targets\/([A-Za-z0-9-]{1,64})\/name$/.exec(url.pathname);
    if (req.method === "POST" && targetName) {
      if (req.headers["content-type"]?.split(";")[0] !== "application/json")
        bad("JSON required", 415);
      reply(200, mobile.nameLead(device, targetName[1], (await body(req)).name));
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/calls") {
      if (req.headers["content-type"]?.split(";")[0] !== "application/json")
        bad("JSON required", 415);
      reply(200, mobile.call(device, await body(req)));
      return;
    }
    const feedback = /^\/v1\/calls\/([a-f0-9-]{36})\/feedback$/.exec(url.pathname);
    if (identity && feedback && ["POST","PUT"].includes(req.method)) {
      if(req.method === "POST") { const p=await body(req); reply(200,mobile.feedback(device,feedback[1],p.clientId,p.text)); }
      else { let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>MAX_AUDIO)bad("Voice feedback too large",413);chunks.push(chunk);}reply(200,mobile.feedback(device,feedback[1],req.headers["x-feedback-id"],"",Buffer.concat(chunks))); }
      return;
    }
    const voiceNote = /^\/v1\/voice-notes\/([a-f0-9-]{36})$/.exec(url.pathname);
    if(identity && voiceNote && req.method === "GET") {
      const activity=all("activities").find(a=>a.voiceNoteId===voiceNote[1]);
      if(!activity)bad("Voice note not found",404);
      const lead=get("leads",activity.leadId);if(!(lead?.owner === "" && lead.createdBy === identity.user.id && activity.userId === identity.user.id))ownLead(identity.user.id,activity.leadId);
      const audio=mobile.playback(voiceNote[1]);res.writeHead(200,{"Content-Type":audio.mime,"Content-Length":audio.bytes.length});res.end(audio.bytes);return;
    }
    const match = /^\/v1\/calls\/([a-f0-9-]{36})\/recording$/.exec(url.pathname);
    if (req.method === "PUT" && match) {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_AUDIO) bad("Recording too large", 413);
        chunks.push(chunk);
      }
      reply(
        200,
        mobile.recording(device, match[1], Buffer.concat(chunks), {
          mode: req.headers["x-match-mode"],
          duration: req.headers["x-audio-duration"],
          modified: req.headers["x-file-modified"],
        }),
      );
      return;
    }
    bad("Not found", 404);
  } catch (e) {
    reply(e.status || 500, { error: e.status ? e.message : "Device sync failed" });
  }
});
mobileServer.requestTimeout = 60000;
mobileServer.listen(mobilePort, bindHost, () =>
  console.log(`Device sync API: http://127.0.0.1:${mobilePort}`),
);
function waConversation(leadId) {
  let conversation = all("conversations").find(
    (c) => c.leadId === leadId && c.channel === "WhatsApp" && c.provider === "baileys",
  );
  if (!conversation) {
    conversation = stamp({
      leadId,
      subject: "WhatsApp · Baileys sync",
      channel: "WhatsApp",
      provider: "baileys",
      status: "Open",
      owner: get("leads", leadId)?.owner || "",
    });
    put("conversations", conversation);
  }
  return conversation;
}
const whatsapp = createWhatsApp({
  async load() {
    const [baileys, { default: QRCode }, { default: pino }] = await Promise.all([
      import("baileys"),
      import("qrcode"),
      import("pino"),
    ]);
    return {
      makeSocket: baileys.default,
      logger: pino({ level: "silent" }),
      qr: (value) => QRCode.toDataURL(value, { width: 280, margin: 2 }),
      loggedOut: baileys.DisconnectReason.loggedOut,
      restartRequired: baileys.DisconnectReason.restartRequired,
      auth: () =>
        encryptedAuth({
          db,
          keyPath:
            (process.env.CRM_DB || new URL("./data/crm.sqlite", import.meta.url).pathname) +
            ".wa-key",
          BufferJSON: baileys.BufferJSON,
          initAuthCreds: baileys.initAuthCreds,
          proto: baileys.proto,
        }),
    };
  },
  receive(message) {
    const matches = all("leads").filter(
      (l) => !l.archived && phoneKeyOf(l) === phoneKeyOf({phone:message.phone}),
    );
    if (matches.length !== 1) return false;
    const lead = matches[0];
    if (
      all("messages").some(
        (m) =>
          m.provider === "baileys" && m.providerId === message.providerId && m.jid === message.jid,
      )
    )
      return true;
    tx(() => {
      const conversation = waConversation(lead.id);
      put(
        "messages",
        stamp({
          ...message,
          provider: "baileys",
          leadId: lead.id,
          conversationId: conversation.id,
          direction: message.direction,
          status: message.direction === "Outgoing" ? "Synced from WhatsApp" : "Received",
        }),
      );
      put("conversations", { ...conversation, status: "Open", updatedAt: now() });
      log(lead.id, "Message", message.text, {
        direction: message.direction,
        provider: "baileys",
        occurredAt: message.occurredAt,
      });
    });
    return true;
  },
});
db.exec("CREATE TABLE IF NOT EXISTS whatsapp_control (id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL)");
const waControl = db.prepare("SELECT enabled FROM whatsapp_control WHERE id=1").get();
const hasWaCredentials = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='whatsapp_auth'").get() && db.prepare("SELECT 1 FROM whatsapp_auth WHERE id='creds'").get();
if (!waControl) db.prepare("INSERT INTO whatsapp_control VALUES(1,?)").run(hasWaCredentials ? 1 : 0);
if (waControl?.enabled || (!waControl && hasWaCredentials)) void whatsapp.connect();
const files = {
  "/": ["public/index.html", "text/html"],
  "/app.js": ["public/app.js", "text/javascript"],
  "/csv.js": ["public/csv.js", "text/javascript"],
  "/reports.js": ["public/reports.js", "text/javascript"],
  "/lead-views.js": ["public/lead-views.js", "text/javascript"],
  "/auth.js": ["public/auth.js", "text/javascript"],
  "/reset-password.html": ["public/reset-password.html", "text/html"],
  "/reset-password.js": ["public/reset-password.js", "text/javascript"],
  "/style.css": ["public/style.css", "text/css"],
};
const oauthRate=new Map();
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  const send = (status, v, headers) => {
    if (headers) {
      res.writeHead(status, headers);
      res.end(v);
      return;
    }
    // JSON answers can be many megabytes (the whole CRM state); gzip them when the browser accepts it,
    // which makes them about ten times smaller on a phone connection.
    const body = JSON.stringify(v);
    if (body.length > 2048 && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
      res.writeHead(status, { "Content-Type": "application/json", "Content-Encoding": "gzip", Vary: "Accept-Encoding" });
      res.end(gzipSync(body, { level: 6 }));
      return;
    }
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body);
  };
  try {
    const url = new URL(req.url, "http://localhost");
    if (
      ![
        `localhost:${port}`,
        `127.0.0.1:${port}`,
        ...(publicOrigin ? [new URL(publicOrigin).host] : []),
      ].includes(req.headers.host)
    )
      bad("Unrecognized host", 403);
    if(url.pathname.startsWith('/.well-known/')){
      res.setHeader('Access-Control-Allow-Origin','*');
      if(!['GET','HEAD'].includes(req.method))bad('Method not allowed',405);
      if(url.pathname==='/.well-known/oauth-authorization-server')send(200,mcpOAuth.metadata());
      else if(['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'].includes(url.pathname))send(200,mcpOAuth.resourceMetadata());
      else bad('Not found',404);return;
    }
    if(url.pathname==='/oauth/register'||url.pathname==='/oauth/token'){
      res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
      if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
      if(req.method!=='POST')bad('Method not allowed',405);
      const rateKey=(req.socket.remoteAddress||'unknown')+url.pathname,window=Math.floor(Date.now()/60000),previous=oauthRate.get(rateKey);
      if(previous?.window===window){if(previous.count++>=60)bad('OAuth request rate limit',429);}else oauthRate.set(rateKey,{window,count:1});
      try{
        let input;
        if(url.pathname==='/oauth/token'&&req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')){
          let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>16000)bad('Request too large',413);}input=Object.fromEntries(new URLSearchParams(raw));
        }else{if(!req.headers['content-type']?.startsWith('application/json'))bad('JSON content type required',415);input=await body(req);}
        send(url.pathname==='/oauth/register'?201:200,url.pathname==='/oauth/register'?mcpOAuth.register(input):mcpOAuth.token(input,req.headers.authorization));
      }catch(error){send(error.status||400,{error:['invalid_client','invalid_grant','invalid_scope','unsupported_grant_type'].includes(error.message)?error.message:'invalid_request',error_description:error.status?error.message:'OAuth request failed'});}return;
    }
    if(url.pathname==='/oauth/authorize'){
      if(req.method!=='GET')bad('Method not allowed',405);
      res.writeHead(302,{Location:mcpOAuth.authorize(Object.fromEntries(url.searchParams))});res.end();return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      if (req.headers.origin && !allowedOrigins.includes(req.headers.origin))
        bad("Cross-origin write refused", 403);
      if (req.headers["content-type"]?.split(";")[0] !== "application/json")
        bad("JSON content type required", 415);
    }
    const authRoute = url.pathname.startsWith("/api/auth/");
    if(url.pathname==='/mcp'){
      if(req.headers.origin&&!allowedOrigins.includes(req.headers.origin))bad('Origin refused',403);
      try{mcpAccess.authorize(req.headers.authorization);}catch(error){res.setHeader('WWW-Authenticate',`Bearer realm="salesdesk-mcp", resource_metadata="${publicOrigin}/.well-known/oauth-protected-resource/mcp"`);throw error;}
      if(req.method!=='POST'){res.setHeader('Allow','POST');bad('MCP uses POST JSON-RPC; SSE is not offered',405);}
      const result=await crmMcp.rpc(req.headers.authorization,await body(req));
      if(result===null){res.writeHead(202);res.end();}else send(200,result);return;
    }
    // the WhatsApp gateway posts customer messages here, signed with a secret both sides know; no browser session
    if (url.pathname === "/hooks/wa-gateway" && req.method === "POST") {
      if (req.headers.origin) bad("Browser access is not supported here", 403);
      send(200, waGateway.receive(await rawBody(req), req.headers["x-devi-signature"]));
      return;
    }
    let identity = null;
    if (userAuth.configured() && sessionToken(req)) {
      try {
        identity = userAuth.authenticate(sessionToken(req));
      } catch {}
    }
    if (url.pathname === "/api/automation/consume" && req.method === "POST") {
      if (req.headers.origin) bad("Browser access is not supported here", 403);
      send(200, automation.consume((await body(req)).ticket));
      return;
    }
    if (url.pathname === "/api/automation/authorize" && req.method === "POST") {
      send(200, automation.authorize(req, await body(req)));
      return;
    }
    if (url.pathname.startsWith("/automation/")) {
      if (!identity) bad("Sign in to CRM first", 401);
      if (!["GET", "HEAD"].includes(req.method) && !allowedOrigins.includes(req.headers.origin))
        bad("Same-origin request required", 403);
      automation.proxy(req, res, identity);
      return;
    }
    const sameOrigin = () => {
      if (!allowedOrigins.includes(req.headers.origin))
        bad("Same-origin browser request required", 403);
    };
    const cookie = (token) =>
      res.setHeader(
        "Set-Cookie",
        `salesdesk_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 43200 : 0}${publicOrigin ? "; Secure" : ""}`,
      );
    if (authRoute) {
      const action = url.pathname.slice("/api/auth/".length);
      if (action === "status" && req.method === "GET") {
        send(200, {
          configured: userAuth.configured(),
          user: identity?.user || null,
          company: identity?.company || "",
          ...(!userAuth.configured()
            ? {
                users: all("users")
                  .filter((u) => u.active)
                  .map((u) => ({ id: u.id, name: u.name })),
              }
            : {}),
        });
        return;
      }
      if (["bootstrap", "login"].includes(action) && req.method === "POST") {
        sameOrigin();
        const result = userAuth[action](await body(req));
        cookie(result.token);
        send(200, { user: result.user, company: result.company });
        return;
      }
      if (action === "reset" && req.method === "POST") {
        sameOrigin();
        send(200, userAuth.resetPassword(await body(req)));
        return;
      }
      if (!identity) bad("Login required", 401);
      if (action === "logout" && req.method === "POST") {
        sameOrigin();
        userAuth.revoke(sessionToken(req));
        cookie("");
        send(200, { ok: true });
        return;
      }
      if (action === "accounts") {
        if (identity.user.role !== "admin") bad("Administrator required", 403);
        workspaceAccess.requirePermission(identity,'users.manage');
        if (req.method === "GET") {
          send(200, {
            accounts: userAuth.listAccounts(),
            users: all("users")
              .filter((u) => u.active)
              .map((u) => ({ id: u.id, name: u.name })),
          });
          return;
        }
        if (req.method === "POST") {
          sameOrigin();
          bad('Use Users & permissions to invite accounts',409);
        }
      }
      bad("Not found", 404);
    }
    if (url.pathname.startsWith("/api/") && userAuth.configured()) {
      if (!identity) bad("Login required", 401);
      if (!["GET", "HEAD"].includes(req.method)) sameOrigin();
    }
    if(identity){
      if(url.pathname.startsWith('/api/automation/')||url.pathname.startsWith('/api/mcp/')||/^\/api\/call-ai\/(keys|models|settings)$/.test(url.pathname))workspaceAccess.requirePermission(identity,'integrations.manage');
      if(url.pathname.startsWith('/api/call-ai/recordings/')){workspaceAccess.requirePermission(identity,'calls.read');if(req.method==='POST')workspaceAccess.requirePermission(identity,'leads.write');}
    }
    if (url.pathname.startsWith("/api/automation/")) {
      if (!identity) bad("Set up company login first", 401);
      if (url.pathname === "/api/automation/status" && req.method === "GET")
        send(200, automation.status(identity.user.id));
      else if (url.pathname === "/api/automation/access" && req.method === "GET")
        send(200, automation.accessList(identity.user.id));
      else if (url.pathname === "/api/automation/access" && req.method === "POST") {
        sameOrigin();
        send(200, automation.setAccess(identity.user.id, await body(req)));
      } else if (url.pathname === "/api/automation/ticket" && req.method === "POST") {
        sameOrigin();
        send(200, automation.issue(identity, sessionToken(req), (await body(req)).browserId));
      } else bad("Not found", 404);
      return;
    }
    if (url.pathname.startsWith('/api/call-ai/')) {
      if(!identity)bad('Sign in first',401);
      if(url.pathname==='/api/call-ai/keys') {
        if(identity.user.role!=='admin')bad('Administrator required',403);
        if(req.method==='GET')send(200,callAI.vaultList());
        else if(req.method==='POST'){sameOrigin();send(200,callAI.saveKey(await body(req)));}
        else bad('Method not allowed',405);
      } else if(url.pathname==='/api/call-ai/models') {
        if(identity.user.role!=='admin')bad('Administrator required',403);
        if(req.method!=='POST')bad('Method not allowed',405);
        sameOrigin();send(200,await callAI.models(await body(req)));
      } else if(url.pathname==='/api/call-ai/settings') {
        if(identity.user.role!=='admin')bad('Administrator required',403);
        if(req.method==='GET')send(200,callAI.publicSettings());
        else if(req.method==='POST'){sameOrigin();send(200,callAI.save(await body(req)));}
        else bad('Method not allowed',405);
      } else {
        const match=/^\/api\/call-ai\/recordings\/([a-f0-9-]{36})$/.exec(url.pathname);
        if(!match)bad('Not found',404);
        if(req.method==='GET')send(200,callAI.result(match[1],identity));
        else if(req.method==='POST'){sameOrigin();send(202,callAI.enqueue(match[1],identity));}
        else bad('Method not allowed',405);
      }
      return;
    }
    if(url.pathname.startsWith('/api/mcp/')){
      if(!identity||identity.user.role!=='admin')bad('Administrator required',403);
      const oauthRequest=/^\/api\/mcp\/oauth\/([a-f0-9-]{36})$/.exec(url.pathname);
      if(oauthRequest&&req.method==='GET')send(200,mcpOAuth.consent(identity,oauthRequest[1]));
      else if(oauthRequest&&req.method==='POST'){sameOrigin();const p=await body(req);if(typeof p.approved!=='boolean')bad('Consent decision required');send(200,mcpOAuth.decide(identity,oauthRequest[1],p.approved));}
      else if(url.pathname==='/api/mcp/keys'&&req.method==='GET')send(200,mcpAccess.list(identity));
      else if(url.pathname==='/api/mcp/keys'&&req.method==='POST'){sameOrigin();send(201,mcpAccess.issue(identity,await body(req)));}
      else if(url.pathname==='/api/mcp/approvals'&&req.method==='GET')send(200,crmMcp.pending(identity));
      else if(req.method==='POST'){
        sameOrigin();const revoke=/^\/api\/mcp\/keys\/([a-f0-9-]{36})\/revoke$/.exec(url.pathname),approve=/^\/api\/mcp\/approvals\/([a-f0-9-]{36})$/.exec(url.pathname);
        if(revoke)send(200,mcpAccess.revoke(identity,revoke[1]));else if(approve)send(200,crmMcp.approve(identity,approve[1]));else bad('Not found',404);
      }else bad('Method not allowed',405);
      return;
    }
    const member = identity && identity.user.role !== "admin";
    if(identity){
      if(url.pathname==='/api/email/settings'){workspaceAccess.requirePermission(identity,'integrations.manage');if(req.method==='GET')send(200,smtpEmail.settings());else if(req.method==='POST'){sameOrigin();send(200,smtpEmail.save(await body(req)));}else bad('Method not allowed',405);return;}
      if(url.pathname==='/api/email/test'&&req.method==='POST'){workspaceAccess.requirePermission(identity,'integrations.manage');sameOrigin();send(200,await smtpEmail.send({to:(await body(req)).to,purpose:'test',actor:identity.user.id}));return;}
      const emailUser=/^\/api\/workspace\/users\/([a-f0-9-]{36})\/email-setup$/.exec(url.pathname);
      if(emailUser&&req.method==='POST'){sameOrigin();workspaceAccess.requirePermission(identity,'users.manage');const target=get('users',emailUser[1]);if(!target?.email)bad('Add an email address for this user first');const reset=workspaceAccess.reset(identity,emailUser[1]);send(200,await smtpEmail.send({to:target.email,purpose:'reset',setupUrl:reset.setupUrl,actor:identity.user.id}));return;}
      if(url.pathname==='/api/workspace/access'&&req.method==='GET'){send(200,{...workspaceAccess.profile(identity.user.id),name:db.prepare("SELECT value FROM auth_settings WHERE key='company'").get()?.value||'Workspace'});return;}
      if(url.pathname==='/api/workspace/users'&&req.method==='GET'){send(200,workspaceAccess.list(identity));return;}
      if(url.pathname==='/api/workspace/users'&&req.method==='POST'){sameOrigin();const input=await body(req);if(input.sendEmail&&!smtpEmail.settings().enabled)bad('Configure and enable SMTP before sending invitations');const result=workspaceAccess.invite(identity,input);if(input.sendEmail){try{await smtpEmail.send({to:input.email,purpose:'invitation',setupUrl:result.setupUrl,actor:identity.user.id});result.emailStatus='accepted';}catch{result.emailStatus='failed';}}send(201,result);return;}
      const accessUser=/^\/api\/workspace\/users\/([a-f0-9-]{36})(?:\/(setup-link))?$/.exec(url.pathname);
      if(accessUser&&['PATCH','POST'].includes(req.method)){sameOrigin();send(200,accessUser[2]?workspaceAccess.reset(identity,accessUser[1]):workspaceAccess.update(identity,accessUser[1],await body(req)));return;}
      const numbersUser=/^\/api\/workspace\/users\/([\w-]{1,64})\/numbers$/.exec(url.pathname);
      if(numbersUser&&req.method==='PUT'){sameOrigin();send(200,workspaceAccess.setNumbers(identity,numbersUser[1],await body(req)));return;}
      const removeUser=/^\/api\/workspace\/users\/([\w-]{1,64})$/.exec(url.pathname);
      if(removeUser&&req.method==='DELETE'){sameOrigin();send(200,workspaceAccess.remove(identity,removeUser[1]));return;}
      if(url.pathname==='/api/workspaces'&&req.method==='GET'){if(!workspaceRegistry)bad('CRM Owner access required',403);send(200,workspaceRegistry.list(identity));return;}
      if(url.pathname==='/api/workspaces'&&req.method==='POST'){sameOrigin();if(!workspaceRegistry)bad('CRM Owner access required',403);send(201,workspaceRegistry.create(identity,await body(req)));return;}
      const workspaceUsers=/^\/api\/workspaces\/([a-f0-9-]{36})\/users(?:\/([a-f0-9-]{36})(?:\/(setup-link))?)?$/.exec(url.pathname);
      if(workspaceUsers){if(!workspaceRegistry)bad('CRM Owner access required',403);if(req.method!=='GET')sameOrigin();const operation=req.method==='GET'?'list':workspaceUsers[3]?'reset':workspaceUsers[2]?'update':'invite';if(!['GET','POST','PATCH'].includes(req.method))bad('Method not allowed',405);send(200,workspaceRegistry.manage(identity,workspaceUsers[1],operation,['invite','update'].includes(operation)?await body(req):{},workspaceUsers[2]));return;}
      const workspaceState=/^\/api\/workspaces\/([a-f0-9-]{36})$/.exec(url.pathname);
      if(workspaceState&&req.method==='PATCH'){sameOrigin();if(!workspaceRegistry)bad('CRM Owner access required',403);send(200,workspaceRegistry.setState(identity,workspaceState[1],(await body(req)).state));return;}
      const write=!['GET','HEAD'].includes(req.method);
      if(/^\/api\/users(?:\/|$)/.test(url.pathname)){workspaceAccess.requirePermission(identity,'users.manage');if(write)bad('Use Users & permissions to manage user access',409);}
      if(/^\/api\/(leads|import|click-to-call)(?:\/|$)/.test(url.pathname)&&write)workspaceAccess.requirePermission(identity,'leads.write');
      if(/^\/api\/tasks(?:\/|$)/.test(url.pathname)&&write)workspaceAccess.requirePermission(identity,'tasks.write');
      if(/^\/api\/activities(?:\/|$)/.test(url.pathname)&&write)workspaceAccess.requirePermission(identity,'leads.write');
      if(/^\/api\/mobile\/recordings\//.test(url.pathname))workspaceAccess.requirePermission(identity,'calls.read');
      if(/^\/api\/whatsapp\//.test(url.pathname))workspaceAccess.requirePermission(identity,'integrations.manage');
    }
    if (url.pathname.startsWith("/api/kpi/")) {
      if (req.method !== "GET") sameOrigin();
      await handleKpi(req, url, identity, send, () => body(req));
      return;
    }
    if (member) {
      const allowedRead =
        [
          "/api/state",
          "/api/mobile/devices",
          "/api/wa-gateway/status",
          "/api/whatsapp/status",
          "/api/click-to-call/devices",
          "/api/notifications",
        ].includes(url.pathname) || /^\/api\/mobile\/recordings\/[a-f0-9-]{36}$/.test(url.pathname) || /^\/api\/leads\/[\w-]{1,80}\/history$/.test(url.pathname);
      const allowedWrite =
        (url.pathname === "/api/click-to-call/request" && req.method === "POST") ||
        (url.pathname === "/api/notifications/read" && req.method === "POST") ||
        (/^\/api\/wa-gateway\/leads\/[\w-]{1,64}\/(send|history)$/.test(url.pathname) && req.method === "POST") ||
        (/^\/api\/(leads|tasks|activities)(?:\/[a-zA-Z0-9-]+)?$/.test(url.pathname) &&
          ["POST", "PATCH"].includes(req.method));
      if (!(req.method === "GET" ? allowedRead : allowedWrite)) bad("Administrator required", 403);
    }
    // the WhatsApp gateway link: settings are for administrators; sending and reading a lead chat are for whoever can reach that lead
    {
      const hookUrl = `${publicOrigin || ""}/hooks/wa-gateway`;
      const needs = (permission) => identity && workspaceAccess.requirePermission(identity, permission);
      if (url.pathname === "/api/wa-gateway/status" && req.method === "GET") { send(200, { enabled: waGateway.settings().enabled }); return; }
      if (url.pathname === "/api/wa-gateway/settings") {
        needs("integrations.manage");
        if (req.method === "GET") send(200, { ...waGateway.settings(), hookUrl });
        else if (req.method === "POST") { sameOrigin(); send(200, { ...(await waGateway.save(await body(req))), hookUrl }); }
        else bad("Method not allowed", 405);
        return;
      }
      if (url.pathname === "/api/wa-gateway/test" && req.method === "POST") { needs("integrations.manage"); sameOrigin(); send(200, await waGateway.test()); return; }
      const waLead = /^\/api\/wa-gateway\/leads\/([\w-]{1,64})\/(send|history)$/.exec(url.pathname);
      if (waLead && req.method === "POST") {
        sameOrigin(); needs("leads.write");
        if (identity) ownLead(identity.user.id, waLead[1]);
        const input = await body(req);
        send(200, waLead[2] === "send" ? await waGateway.send(waLead[1], input, identity?.user.id || "") : await waGateway.history(waLead[1]));
        return;
      }
    }
    // the TeleCRM mirror: administrators only
    if (url.pathname.startsWith("/api/telecrm/")) {
      if (identity) workspaceAccess.requirePermission(identity, "integrations.manage");
      if (url.pathname === "/api/telecrm/settings" && req.method === "GET") { send(200, telecrm.settings()); return; }
      if (url.pathname === "/api/telecrm/settings" && req.method === "POST") { sameOrigin(); const out = telecrm.save(await body(req)); scheduleTelecrm(); send(200, out); return; }
      if (url.pathname === "/api/telecrm/sync" && req.method === "POST") { sameOrigin(); const p = await body(req); telecrm.sync({ full: p.full === true }).catch(() => {}); send(202, telecrm.settings()); return; }
      bad("Not found", 404);
    }
    if (url.pathname.startsWith("/api/click-to-call/")) {
      if (!identity) bad("Set up shared login and sign in first", 401);
      if (url.pathname === "/api/click-to-call/devices" && req.method === "GET") {
        send(200, clickToCall.receivers(identity.user.id));
        return;
      }
      if (url.pathname === "/api/click-to-call/request" && req.method === "POST") {
        sameOrigin();
        send(200, clickToCall.request(identity.user.id, await body(req)));
        return;
      }
      bad("Not found", 404);
    }
    if (url.pathname === "/api/state" && req.method === "GET") {
      if (member) {
        send(200, withBadges(permittedState(scopedState(stateAll, identity.user.id),identity.user.id)));
        return;
      }
      send(200, withBadges(permittedState({
        ...Object.fromEntries(kinds.map((k) => [k, stateAll(k)])),
        mobileCalls: all("mobileCalls"),
      },identity?.user.id)));
      return;
    }
    // the imported history of one lead (left out of /api/state)
    const historyOf = url.pathname.match(/^\/api\/leads\/([\w-]{1,80})\/history$/);
    if (historyOf && req.method === "GET") {
      const lead = member ? ownLead(identity.user.id, historyOf[1]) : get("leads", historyOf[1]);
      if (!lead) bad("Lead not found", 404);
      const activities = db.prepare("SELECT body FROM records WHERE kind='activities' AND json_extract(body,'$.leadId')=? AND json_extract(body,'$.importedFrom') IS NOT NULL ORDER BY json_extract(body,'$.occurredAt') DESC LIMIT 2000").all(lead.id).map((r) => JSON.parse(r.body));
      send(200, { activities: permittedState({ activities, mobileCalls: [], messages: [], conversations: [] }, identity?.user.id).activities, salesmax: lead.salesmax || null });
      return;
    }
    if (url.pathname === "/api/mobile/devices" && req.method === "GET") {
      send(
        200,
        mobile.devices().filter((d) => !member || d.owner === identity.user.id),
      );
      return;
    }
    if (url.pathname === "/api/mobile/devices" && req.method === "POST") {
      if (userAuth.configured())
        bad("Use the same CRM username and password on mobile; manual tokens are disabled", 409);
      if (!allowedOrigins.includes(req.headers.origin))
        bad("Local same-origin request required", 403);
      send(200, mobile.issue(await body(req)));
      return;
    }
    const revokeDevice = /^\/api\/mobile\/devices\/([a-f0-9-]{36})\/revoke$/.exec(url.pathname);
    if (revokeDevice && req.method === "POST") {
      if (!allowedOrigins.includes(req.headers.origin))
        bad("Local same-origin request required", 403);
      mobile.revoke(revokeDevice[1]);
      send(200, { revoked: true });
      return;
    }
    const recording = /^\/api\/mobile\/recordings\/([a-f0-9-]{36})$/.exec(url.pathname);
    if (recording && req.method === "GET") {
      if (member) {
        const call = all("mobileCalls").find((c) => c.recordingId === recording[1]);
        const feedback=all("activities").find(a=>a.voiceNoteId===recording[1]);
        if (!call && !feedback) bad("Not found", 404);
        ownLead(identity.user.id, (call||feedback).leadId);
      }
      const audio = mobile.playback(recording[1]);
      send(200, audio.bytes, {
        "Content-Type": audio.mime,
        "Content-Length": audio.bytes.length,
        "Content-Disposition": "inline",
      });
      return;
    }
    if (url.pathname === "/api/whatsapp/status" && req.method === "GET") {
      send(
        200,
        member
          ? { status: "admin_required", error: "Administrator manages WhatsApp" }
          : whatsapp.snapshot(),
      );
      return;
    }
    if (url.pathname.startsWith("/api/whatsapp/") && req.method === "POST") {
      // These actions can expose a linked account or transmit a real message.
      if (!allowedOrigins.includes(req.headers.origin))
        bad("Same-origin browser request required", 403);
      const p = await body(req);
      if (url.pathname === "/api/whatsapp/connect") {
        if (p.acknowledged !== true)
          bad("Acknowledge the unofficial-client and local message-storage risks first");
        db.prepare("UPDATE whatsapp_control SET enabled=1 WHERE id=1").run();
        send(200, await whatsapp.connect());
        return;
      }
      if (url.pathname === "/api/whatsapp/disconnect") {
        db.prepare("UPDATE whatsapp_control SET enabled=0 WHERE id=1").run();
        whatsapp.stop();
        send(200, whatsapp.snapshot());
        return;
      }
      if (["/api/whatsapp/logout", "/api/whatsapp/repair"].includes(url.pathname)) {
        if (p.confirmed !== true) bad("Confirm clearing the linked session first");
        if (url.pathname.endsWith("repair") && p.acknowledged !== true) bad("Acknowledge WhatsApp pairing first");
        db.prepare("UPDATE whatsapp_control SET enabled=0 WHERE id=1").run();
        const signedOut = await whatsapp.logout();
        if (url.pathname.endsWith("repair")) {
          db.prepare("UPDATE whatsapp_control SET enabled=1 WHERE id=1").run();
          send(200, await whatsapp.connect());
        } else send(200, signedOut);
        return;
      }
      if (url.pathname === "/api/whatsapp/send") {
        bad("WhatsApp is sync-only. Open WhatsApp Web and send manually.", 405);
      }
      bad("Unknown WhatsApp operation", 404);
    }
    if(url.pathname === "/api/leads/merge" && req.method === "POST"){
      if(!allowedOrigins.includes(req.headers.origin))bad("Same-origin request required",403);
      const p=await body(req);send(200,mergeLeads({db,targetId:p.targetId,sourceIds:p.sourceIds,actorId:identity?.user.id||"local-admin",admin:!identity||identity.user.role==="admin"}));return;
    }
    if (url.pathname === "/api/import" && req.method === "POST") {
      const p = await body(req);
      if (!Array.isArray(p.leads) || !p.leads.length || p.leads.length > 500)
        bad("Import 1–500 leads");
      const result = tx(() => {
        let added = 0,
          skipped = 0;
        const phones = new Set(all("leads").map(phoneKeyOf).filter(Boolean));
        // which file the leads came from, so the leads list can be filtered by upload
        const upload = { name: String(p.fileName || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 120) || "File upload", at: now() };
        for (const row of p.leads) {
          if (!row || typeof row !== "object" || Array.isArray(row)) bad("Invalid row");
          const v = validate("leads", row),
            phone = phoneKeyOf(v);
          if (phone && phones.has(phone)) {
            skipped++;
            continue;
          }
          const l = stamp({ ...v, firstTouchAt: null, upload });
          put("leads", l);
          log(l.id, "System", `Lead imported from ${upload.name}`);
          extensions.onEvent("Lead created", { leadId: l.id, eventId: l.id });
          if (phone) phones.add(phone);
          added++;
        }
        return { added, skipped };
      });
      send(200, result);
      return;
    }
    // Blocked numbers and deleting a lead for good (admins only). A blocked number is skipped by phone call sync,
    // the TeleCRM copy and the WhatsApp gateway, so a deleted lead does not come back.
    if (url.pathname === "/api/blocked-numbers" || url.pathname.startsWith("/api/blocked-numbers/")) {
      if (identity && !["owner", "admin"].includes(workspaceAccess.profile(identity.user.id).role)) bad("Only an admin can block numbers", 403);
      const one = decodeURIComponent(url.pathname.slice("/api/blocked-numbers/".length) || "");
      if (req.method === "GET" && url.pathname === "/api/blocked-numbers") return send(200, blocked.list());
      sameOrigin();
      if (req.method === "POST" && url.pathname === "/api/blocked-numbers") { const p = await body(req); return send(200, { phone: blocked.add(p.phone, { name: p.name || "", by: identity?.user.id || "" }) }); }
      if (req.method === "DELETE" && one) return send(200, { removed: blocked.remove(one) });
      bad("Method not allowed", 405);
    }
    // Workflows (admins only)
    if (url.pathname === "/api/workflows" || url.pathname.startsWith("/api/workflows/")) {
      if (identity && !["owner", "admin"].includes(workspaceAccess.profile(identity.user.id).role)) bad("Only an admin can manage workflows", 403);
      const one = decodeURIComponent(url.pathname.slice("/api/workflows/".length) || "");
      if (req.method === "GET" && url.pathname === "/api/workflows") return send(200, { ...workflows.list(), meta: workflows.meta(), gateway: waGateway.settings().enabled });
      sameOrigin();
      if (req.method === "POST" && url.pathname === "/api/workflows") return send(200, workflows.create(await body(req), identity?.user.id || ""));
      if (req.method === "POST" && url.pathname === "/api/workflows/test") { const p = await body(req); return send(200, workflows.dryRun(p, p.leadId)); }
      if (req.method === "PUT" && one) return send(200, workflows.update(one, await body(req)));
      if (req.method === "DELETE" && one) return send(200, workflows.remove(one));
      bad("Method not allowed", 405);
    }
    // Import of a Salesmax account's export files (admins only); the browser sends the rows in batches
    if (url.pathname === "/api/import/salesmax" && req.method === "POST") {
      if (identity && !["owner", "admin"].includes(workspaceAccess.profile(identity.user.id).role)) bad("Only an admin can import", 403);
      sameOrigin();
      const p = await body(req);
      return send(200, salesmaxImport.importBatch(String(p.kind || ""), p.rows));
    }
    // Notifications a workflow sent to this person (the bell in the top bar)
    if (url.pathname === "/api/notifications" || url.pathname === "/api/notifications/read") {
      const me = identity?.user.id || "";
      const mine = () => me ? db.prepare("SELECT body FROM records WHERE kind='notifications' AND json_extract(body,'$.userId')=? ORDER BY rowid DESC LIMIT 30").all(me).map((r) => JSON.parse(r.body)) : [];
      if (req.method === "GET" && url.pathname === "/api/notifications") { const list = mine(); return send(200, { notifications: list, unread: list.filter((n) => !n.read).length }); }
      if (req.method === "POST" && url.pathname === "/api/notifications/read") {
        sameOrigin();
        tx(() => { for (const n of mine()) if (!n.read) put("notifications", { ...n, read: true }); });
        return send(200, { unread: 0 });
      }
      bad("Method not allowed", 405);
    }
    if (url.pathname === "/api/deleted-leads" && req.method === "GET") {
      if (identity && !["owner", "admin"].includes(workspaceAccess.profile(identity.user.id).role)) bad("Only an admin can see deleted leads", 403);
      return send(200, blocked.deleted());
    }
    const leadDelete = req.method === "DELETE" && /^\/api\/leads\/([a-zA-Z0-9-]+)$/.exec(url.pathname);
    if (leadDelete) {
      if (identity && !["owner", "admin"].includes(workspaceAccess.profile(identity.user.id).role)) bad("Only an admin can delete a lead", 403);
      sameOrigin();
      send(200, deleteLead(leadDelete[1], { block: url.searchParams.get("block") === "1", by: identity?.user.id || "" }));
      return;
    }
    if (!member && (await extensions.handle(req, url, body, send))) return;
    const match = url.pathname.match(/^\/api\/([a-zA-Z]+)(?:\/([a-zA-Z0-9-]+))?$/);
    if (match && !kinds.includes(match[1])) bad("Not found", 404);
    if (match && ["POST", "PATCH"].includes(req.method)) {
      const [, kind, id] = match;
      if ((req.method === "POST" && id) || (req.method === "PATCH" && !id))
        bad("Unsupported route", 405);
      const p = await body(req);
      if (member) {
        const existing = id ? get(kind, id) : null;
        if (id && !existing) bad("Record not found", 404);
        if (kind === "leads") {
          if (id) ownLead(identity.user.id, id);
          p.owner = identity.user.id;
        } else if (kind === "tasks") {
          if (existing && existing.owner !== identity.user.id) bad("Task not accessible", 403);
          if (p.leadId || existing?.leadId) ownLead(identity.user.id, p.leadId || existing.leadId);
          p.owner = identity.user.id;
        } else if (kind === "activities") ownLead(identity.user.id, p.leadId);
      }
      const result = tx(() => {
        if (kind === "activities") {
          if (id) bad("Activities are immutable");
          const leadId = ref("leads", p.leadId),
            type = one(p.type, ["Note", "Call", "Message", "Visit"], "activity type"),
            content = string(p.text, "text", 4000);
          if (!content) bad("Activity text required");
          const extra = {};
          if (type === "Call") {
            extra.outcome = one(
              p.outcome,
              ["Interested", "Callback", "No answer", "Not interested", "Connected"],
              "outcome",
            );
            extra.direction = one(p.direction, ["Incoming", "Outgoing"], "direction");
            extra.duration = num(p.duration, "duration");
            if (extra.duration > 86400) bad("Duration exceeds one day");
          }
          const a = log(leadId, type, content, extra),
            l = get("leads", leadId);
          l.firstTouchAt ||= now();
          if (
            type === "Call" &&
            ["Interested", "Connected"].includes(extra.outcome) &&
            l.stage === "New"
          )
            l.stage = "Prospecting";
          l.updatedAt = now();
          put("leads", l);
          if (type === "Call") {
            extensions.onEvent("Call outcome", { leadId, eventId: a.id });
            if (extra.outcome === "No answer" && extra.direction === "Incoming")
              extensions.onEvent("Missed call", { leadId, eventId: a.id });
          }
          if (type === "Visit") extensions.onEvent("Visit recorded", { leadId, eventId: a.id });
          return a;
        }
        const old = id ? get(kind, id) : null;
        if (id && !old) bad("Record not found", 404);
        const v = validate(kind, p, old || {}),
          record = id ? { ...v, updatedAt: now() } : stamp(v);
        if (kind === "leads" && !id) record.firstTouchAt = null;
        put(kind, record);
        const eventId = randomUUID();
        const event = (trigger, leadId = record.leadId) =>
          extensions.onEvent(trigger, { leadId, eventId });
        if (kind === "leads") {
          if (!old) event("Lead created", record.id);
          if (record.owner && record.owner !== old?.owner) event("Lead assigned", record.id);
          if (record.repeat && !old?.repeat) event("Repeat enquiry", record.id);
          if (record.stage === "Closed" && old?.stage !== "Closed") event("Lead closed", record.id);
        }
        if (kind === "tasks" && !old) event("Task created");
        if (kind === "tasks" && record.status === "Done" && old?.status !== "Done")
          event("Task completed");
        if (kind === "deals" && record.stage !== old?.stage) event("Deal stage changed");
        if (kind === "payments" && !old)
          event("Payment received", get("deals", record.dealId)?.leadId);
        if (kind === "conversations" && !old) event("Conversation opened");
        if (kind === "conversations" && record.status === "Resolved" && old?.status !== "Resolved")
          event("Conversation resolved");
        if (kind === "leads") {
          const stepChanged = old && (old.deal || "") !== (record.deal || "") && record.deal;
          log(
            record.id,
            "System",
            old && old.stage !== record.stage
              ? `Lead stage changed: ${old.stage} → ${record.stage}`
              : stepChanged
                ? `Pipeline step changed: ${old.deal || "none"} → ${record.deal}`
                : old
                  ? "Lead details updated"
                  : "Lead created",
          );
          if (stepChanged && old.stage !== record.stage) log(record.id, "System", `Pipeline step changed: ${old.deal || "none"} → ${record.deal}`);
        }
        if (kind === "tasks" && record.leadId)
          log(
            record.leadId,
            "System",
            `Task ${record.status === "Done" ? "completed" : old ? "updated" : "scheduled"}: ${record.title}`,
          );
        if (kind === "deals") {
          log(record.leadId, "System", `Deal ${record.stage}: ${record.title}`);
          for (const leadId of new Set([record.leadId, old?.leadId].filter(Boolean))) {
            const l = get("leads", leadId),
              related = all("deals").filter((d) => d.leadId === leadId),
              previous = l.stage;
            if (related.some((d) => !["Won", "Lost"].includes(d.stage))) {
              l.stage = "Opportunity";
              l.disposition = "";
            } else if (related.length) {
              l.stage = "Closed";
              l.disposition = related.some((d) => d.stage === "Won") ? "Won" : "Lost";
            } else {
              l.stage = "Prospecting";
              l.disposition = "";
            }
            if (l.stage !== previous) l.deal = "";
            l.updatedAt = now();
            put("leads", l);
            if (l.stage === "Closed" && previous !== "Closed") event("Lead closed", leadId);
          }
        }
        return record;
      });
      send(200, result);
      return;
    }
    // The new app is the front door. The earlier screens stay reachable at /classic/ for settings not rebuilt yet.
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) return serveWebApp("/next/", res, req);
    if (req.method === "GET" && (url.pathname === "/classic" || url.pathname === "/classic/")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(await readFile(new URL("public/index.html", import.meta.url)));
      return;
    }
    if (req.method === "GET" && (url.pathname === "/next" || url.pathname.startsWith("/next/"))) {
      if (url.pathname === "/next") {
        res.writeHead(301, { Location: "/next/" });
        return res.end();
      }
      return serveWebApp(url.pathname, res, req);
    }
    if (req.method === "GET" && files[url.pathname]) {
      const [path, type] = files[url.pathname];
      res.writeHead(200, { "Content-Type": type + "; charset=utf-8" });
      res.end(await readFile(new URL(path, import.meta.url)));
      return;
    }
    send(404, { error: "Not found" });
  } catch (e) {
    send(e.status || 500, { error: e.status ? e.message : "Unable to complete request" });
    if (!e.status) console.error(e);
  }
});
let telecrmTimer = null, telecrmRecTimer = null;
function scheduleTelecrm() {
  clearInterval(telecrmTimer);
  clearInterval(telecrmRecTimer);
  const s = telecrm.settings();
  if (s.enabled) {
    telecrmTimer = setInterval(() => telecrm.sync().catch(() => {}), s.intervalMinutes * 60000).unref();
    // recordings of calls already copied come every 2 minutes, even while a long full read of every lead is running
    telecrmRecTimer = setInterval(() => telecrm.copyRecordings().catch(() => {}), 2 * 60000).unref();
  }
}
scheduleTelecrm();
workflows.tick();
setInterval(() => workflows.tick(), 30000).unref();
server.listen(port, bindHost, () =>
  console.log(`Salesdesk CRM: ${publicOrigin || `http://localhost:${port}`}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    callAI.close();
    mobileServer.close();
    whatsapp.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
