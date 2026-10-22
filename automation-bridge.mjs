import http from "node:http";
import { createHash, randomBytes } from "node:crypto";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
export function engineUserId(userId) {
  const bytes = Buffer.from(hash("salesdesk-automation-v1/" + userId).slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = bytes.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function bridgeConfig(env = process.env) {
  const enabled = env.SALESDESK_AUTOMATION_ENABLED === "true";
  const target = new URL(env.SALESDESK_AUTOMATION_RUNTIME || "http://127.0.0.1:5681");
  if (
    target.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "salesdesk-automation"].includes(target.hostname) ||
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash
  )
    throw Error("Automation runtime must be a private, bare HTTP origin");
  return { enabled, target: target.origin };
}
export function createAutomationBridge({ db, getUser, config, now = () => Date.now() }) {
  const streams = new Map();
  db.exec(
    "CREATE TABLE IF NOT EXISTS automation_access(user_id TEXT PRIMARY KEY,granted_by TEXT NOT NULL,granted_at INTEGER NOT NULL)",
  );
  const allowed = (id) =>
    Boolean(
      getUser(id)?.active &&
      db.prepare("SELECT 1 FROM auth_accounts WHERE user_id=?").get(id) &&
      db.prepare("SELECT 1 FROM automation_access WHERE user_id=?").get(id),
    );
  const isAdmin = (id) =>
    Boolean(
      getUser(id)?.active &&
      db.prepare("SELECT role FROM auth_accounts WHERE user_id=?").get(id)?.role === "admin",
    );
  function accessList(actorId) {
    if (!isAdmin(actorId)) fail("Administrator required", 403);
    return db
      .prepare("SELECT user_id FROM auth_accounts ORDER BY user_id")
      .all()
      .map(({ user_id }) => ({
        userId: user_id,
        name: getUser(user_id)?.name || user_id,
        active: Boolean(getUser(user_id)?.active),
        allowed: allowed(user_id),
      }));
  }
  function setAccess(actorId, { userId, enabled } = {}) {
    if (!isAdmin(actorId)) fail("Administrator required", 403);
    if (
      typeof enabled !== "boolean" ||
      typeof userId !== "string" ||
      !db.prepare("SELECT 1 FROM auth_accounts WHERE user_id=?").get(userId)
    )
      fail("Valid CRM account and access choice required");
    if (enabled) {
      if (!getUser(userId)?.active) fail("User must be active");
      db.prepare(
        "INSERT INTO automation_access VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET granted_by=excluded.granted_by,granted_at=excluded.granted_at",
      ).run(userId, actorId, now());
    } else {
      db.prepare("DELETE FROM automation_access WHERE user_id=?").run(userId);
      db.prepare("DELETE FROM automation_tickets WHERE user_id=?").run(userId);
      for (const close of streams.get(userId) || []) close();
    }
    return { userId, allowed: allowed(userId) };
  }
  db.exec(
    "CREATE TABLE IF NOT EXISTS automation_tickets(token_hash TEXT PRIMARY KEY,session_hash TEXT NOT NULL,user_id TEXT NOT NULL,browser_id TEXT NOT NULL,expires_at INTEGER NOT NULL)",
  );
  function sessionAlive(sessionHash, userId) {
    const row = db
      .prepare("SELECT user_id,expires_at FROM auth_sessions WHERE token_hash=?")
      .get(sessionHash);
    return (
      row?.user_id === userId &&
      row.expires_at > now() &&
      getUser(userId)?.active &&
      Boolean(db.prepare("SELECT user_id FROM auth_accounts WHERE user_id=?").get(userId))
    );
  }
  function issue(identity, session, browserId) {
    if (!config.enabled) fail("Automation runtime is not enabled", 503);
    if (!identity?.user?.id || !sessionAlive(hash(session || ""), identity.user.id))
      fail("Sign in to CRM first", 401);
    if (!allowed(identity.user.id)) fail("Automation access has not been granted", 403);
    if (typeof browserId !== "string" || !/^[a-f0-9-]{36}$/i.test(browserId))
      fail("Valid browser ID required");
    db.prepare("DELETE FROM automation_tickets WHERE expires_at<=? OR session_hash=?").run(
      now(),
      hash(session),
    );
    const ticket = randomBytes(32).toString("base64url"),
      expiresAt = now() + 30000;
    db.prepare("INSERT INTO automation_tickets VALUES(?,?,?,?,?)").run(
      hash(ticket),
      hash(session),
      identity.user.id,
      browserId,
      expiresAt,
    );
    return { ticket, expiresAt, engineUserId: engineUserId(identity.user.id) };
  }
  function consume(ticket) {
    if (!config.enabled) fail("Automation runtime is not enabled", 503);
    if (typeof ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(ticket))
      fail("Invalid handoff", 401);
    // DELETE RETURNING makes the handoff single-use across concurrent requests/processes.
    const row = db
      .prepare("DELETE FROM automation_tickets WHERE token_hash=? RETURNING *")
      .get(hash(ticket));
    if (
      !row ||
      row.expires_at <= now() ||
      !sessionAlive(row.session_hash, row.user_id) ||
      !allowed(row.user_id)
    )
      fail("Expired or revoked handoff", 401);
    const user = getUser(row.user_id);
    return {
      userId: row.user_id,
      engineUserId: engineUserId(row.user_id),
      name: user.name,
      browserId: row.browser_id,
    };
  }
  function cookieFor(req, userId) {
    const cookie = /(?:^|;\s*)n8n-auth=([^;\s]+)(?:;|$)/.exec(req.headers.cookie || "")?.[1];
    if (!cookie || cookie.length > 8192) return "";
    try {
      const parts = cookie.split(".");
      if (parts.length !== 3) return "";
      const claim = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      // The engine validates the signature. This gate also prevents account switching
      // from reusing a different employee's otherwise valid engine session.
      if (claim.id !== engineUserId(userId) || claim.exp * 1000 <= now()) return "";
      return "n8n-auth=" + cookie;
    } catch {
      return "";
    }
  }
  function pathOf(raw) {
    if (!raw.startsWith("/automation/") || /%(?:2e|2f|5c)/i.test(raw) || raw.includes("\\"))
      fail("Invalid automation path", 400);
    return raw.slice("/automation".length);
  }
  function proxy(req, res, identity) {
    if (!config.enabled) fail("Automation runtime is not enabled", 503);
    if (!identity?.user) fail("Sign in to CRM first", 401);
    if (!allowed(identity.user.id)) fail("Automation access has not been granted", 403);
    const path = pathOf(req.url),
      login = path.split("?")[0] === "/rest/salesdesk/login";
    const cookie = cookieFor(req, identity.user.id);
    if (!login && !cookie) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Open Automation from CRM to start your session" }));
      return;
    }
    const headers = { ...req.headers, host: new URL(config.target).host };
    for (const key of [
      "cookie",
      "authorization",
      "proxy-authorization",
      "x-forwarded-host",
      "x-forwarded-proto",
      "x-forwarded-for",
      "forwarded",
      "connection",
      "upgrade",
    ])
      delete headers[key];
    if (cookie) headers.cookie = cookie;
    // Retain same-origin validation in CRM. The private runtime sees its own origin.
    if (headers.origin) headers.origin = config.target;
    const upstream = http.request(
      config.target + path,
      { method: req.method, headers },
      (response) => {
        const out = { ...response.headers };
        delete out["connection"];
        delete out["transfer-encoding"];
        if (out.location) {
          const location = new URL(out.location, config.target);
          if (location.origin === config.target)
            out.location = "/automation" + location.pathname + location.search + location.hash;
          else {
            response.destroy();
            res.writeHead(502);
            res.end("Unexpected automation redirect");
            return;
          }
        }
        // Only the native auth cookie is forwarded, confined to the workspace.
        if (out["set-cookie"])
          out["set-cookie"] = out["set-cookie"]
            .filter((c) => c.startsWith("n8n-auth="))
            .map((c) => c.replace(/;\s*Path=[^;]*/i, "") + "; Path=/automation/");
        res.writeHead(response.statusCode || 502, out);
        response.pipe(res);
      },
    );
    upstream.setTimeout(120000, () => upstream.destroy());
    const close = () => {
      upstream.destroy();
      res.destroy();
    };
    const active = streams.get(identity.user.id) || new Set();
    streams.set(identity.user.id, active);
    active.add(close);
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Automation runtime unavailable" }));
    });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => {
      active.delete(close);
      if (!active.size) streams.delete(identity.user.id);
      if (!res.writableEnded) upstream.destroy();
    });
    req.pipe(upstream);
  }
  return {
    issue,
    consume,
    proxy,
    cookieFor,
    accessList,
    setAccess,
    status: (userId) => ({
      enabled: config.enabled,
      canAccess: allowed(userId),
      canManageAccess: isAdmin(userId),
      sourceBased: true,
      workspace: "/automation/",
      audience: "selected-users-only",
    }),
  };
}
