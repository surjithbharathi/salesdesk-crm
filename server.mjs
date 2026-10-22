import http from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { createExtensions } from "./extensions.mjs";
import { encryptedAuth } from "./whatsapp-auth.mjs";
import { createWhatsApp, phoneDigits } from "./whatsapp.mjs";
import { createMobileSync, MAX_AUDIO } from "./mobile-sync.mjs";
import { createUserAuth } from "./user-auth.mjs";
import { scopedState } from "./user-scope.mjs";
import { createClickToCall } from "./click-to-call.mjs";
import { bridgeConfig, createAutomationBridge } from "./automation-bridge.mjs";

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
const kinds = ["leads", "activities", "tasks", "deals", "payments", "products", "users", "lists"];
const all = (kind) =>
  db
    .prepare("SELECT body FROM records WHERE kind=? ORDER BY rowid DESC")
    .all(kind)
    .map((r) => JSON.parse(r.body));
const get = (kind, id) => {
  const r = db.prepare("SELECT body FROM records WHERE kind=? AND id=?").get(kind, id);
  return r ? JSON.parse(r.body) : null;
};
const put = (kind, v) =>
  db
    .prepare(
      "INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body",
    )
    .run(kind, v.id, JSON.stringify(v));
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
    if (v.phone && !/^[+\d ()-]{7,30}$/.test(v.phone)) bad("Invalid phone");
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) bad("Invalid email");
    n("value");
    r("owner", "users");
    r("list", "lists");
    c("stage", ["New", "Prospecting", "Opportunity", "Closed"]);
    b("archived");
    b("repeat");
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
    if (url.pathname === "/v1/logout" && req.method === "POST") {
      if (identity) userAuth.revoke(bearer);
      reply(200, { loggedOut: true });
      return;
    }
    if (url.pathname === "/v1/workspace" && req.method === "GET") {
      if (!identity) bad("Shared user login required", 401);
      reply(200, {
        ...scopedState(all, identity.user.id),
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
          const allowed = ["name", "phone", "company", "email", "city", "stage", "value"];
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
      ownLead(identity.user.id, call.leadId);
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
    if (req.method === "POST" && url.pathname === "/v1/calls") {
      if (req.headers["content-type"]?.split(";")[0] !== "application/json")
        bad("JSON required", 415);
      reply(200, mobile.call(device, await body(req)));
      return;
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
      (l) => !l.archived && phoneDigits(l.phone) === message.phone,
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
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  const send = (status, v, headers) => {
    res.writeHead(status, headers || { "Content-Type": "application/json" });
    res.end(headers ? v : JSON.stringify(v));
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
    if (!["GET", "HEAD"].includes(req.method)) {
      if (req.headers.origin && !allowedOrigins.includes(req.headers.origin))
        bad("Cross-origin write refused", 403);
      if (req.headers["content-type"]?.split(";")[0] !== "application/json")
        bad("JSON content type required", 415);
    }
    const authRoute = url.pathname.startsWith("/api/auth/");
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
          send(200, userAuth.createAccount(identity, await body(req)));
          return;
        }
      }
      bad("Not found", 404);
    }
    if (url.pathname.startsWith("/api/") && userAuth.configured()) {
      if (!identity) bad("Login required", 401);
      if (!["GET", "HEAD"].includes(req.method)) sameOrigin();
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
    const member = identity && identity.user.role !== "admin";
    if (member) {
      const allowedRead =
        [
          "/api/state",
          "/api/mobile/devices",
          "/api/whatsapp/status",
          "/api/click-to-call/devices",
        ].includes(url.pathname) || /^\/api\/mobile\/recordings\/[a-f0-9-]{36}$/.test(url.pathname);
      const allowedWrite =
        (url.pathname === "/api/click-to-call/request" && req.method === "POST") ||
        (/^\/api\/(leads|tasks|activities)(?:\/[a-zA-Z0-9-]+)?$/.test(url.pathname) &&
          ["POST", "PATCH"].includes(req.method));
      if (!(req.method === "GET" ? allowedRead : allowedWrite)) bad("Administrator required", 403);
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
        send(200, scopedState(all, identity.user.id));
        return;
      }
      send(200, {
        ...Object.fromEntries(kinds.map((k) => [k, all(k)])),
        mobileCalls: all("mobileCalls"),
      });
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
        if (!call) bad("Not found", 404);
        ownLead(identity.user.id, call.leadId);
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
        send(200, await whatsapp.connect());
        return;
      }
      if (url.pathname === "/api/whatsapp/disconnect") {
        whatsapp.stop();
        send(200, whatsapp.snapshot());
        return;
      }
      if (url.pathname === "/api/whatsapp/send") {
        bad("WhatsApp is sync-only. Open WhatsApp Web and send manually.", 405);
      }
      bad("Unknown WhatsApp operation", 404);
    }
    if (url.pathname === "/api/import" && req.method === "POST") {
      const p = await body(req);
      if (!Array.isArray(p.leads) || !p.leads.length || p.leads.length > 500)
        bad("Import 1–500 leads");
      const result = tx(() => {
        let added = 0,
          skipped = 0;
        const phones = new Set(all("leads").map((l) => l.phone.replace(/\D/g, "")));
        for (const row of p.leads) {
          if (!row || typeof row !== "object" || Array.isArray(row)) bad("Invalid row");
          const v = validate("leads", row),
            phone = v.phone.replace(/\D/g, "");
          if (phone && phones.has(phone)) {
            skipped++;
            continue;
          }
          const l = stamp({ ...v, firstTouchAt: null });
          put("leads", l);
          log(l.id, "System", "Lead imported");
          extensions.onEvent("Lead created", { leadId: l.id, eventId: l.id });
          if (phone) phones.add(phone);
          added++;
        }
        return { added, skipped };
      });
      send(200, result);
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
        if (kind === "leads")
          log(
            record.id,
            "System",
            old && old.stage !== record.stage
              ? `Lead stage changed: ${old.stage} → ${record.stage}`
              : old
                ? "Lead details updated"
                : "Lead created",
          );
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
server.listen(port, bindHost, () =>
  console.log(`Salesdesk CRM: ${publicOrigin || `http://localhost:${port}`}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    mobileServer.close();
    whatsapp.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
