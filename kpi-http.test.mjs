import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { existsSync } from "node:fs";

async function start(file, port) {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL(".", import.meta.url),
    env: { ...process.env, CRM_DB: file, PORT: String(port), MOBILE_PORT: String(port + 1), BIND_HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("server timeout: " + stderr)), 15000);
    child.stdout.on("data", (d) => String(d).includes("Salesdesk CRM:") && (clearTimeout(timer), resolve()));
    child.once("exit", (code) => reject(Error(`server exited ${code}: ${stderr}`)));
  });
  return child;
}
const stop = async (child) => {
  if (child.exitCode === null && child.signalCode === null) {
    const done = once(child, "exit");
    child.kill("SIGTERM");
    await done;
  }
};

test("KPI endpoints: team vs caller scope, goals need the owner, same-origin writes, and the app is served safely under /next/", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "salesdesk-kpi-"));
  const port = 3391, base = `http://127.0.0.1:${port}`;
  const server = await start(join(dir, "crm.sqlite"), port);
  t.after(async () => {
    await stop(server);
    await rm(dir, { recursive: true, force: true });
  });
  const json = async (path, init = {}) => {
    const r = await fetch(base + path, init);
    return { status: r.status, data: await r.json().catch(() => ({})), headers: r.headers };
  };
  const post = (path, payload, cookie, origin = base) =>
    json(path, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(payload) });

  // demo mode (no company login yet): the single user acts as the owner
  const me = await json("/api/kpi/me");
  assert.equal(me.status, 200);
  assert.equal(me.data.lead, true);
  assert.ok(me.data.users.length >= 2);
  const [first, second] = me.data.users;
  const day = await json(`/api/kpi/day?user=${first.id}&tz=330`);
  assert.equal(day.status, 200);
  assert.equal(day.data.goal.calls, 40);
  assert.equal((await json("/api/kpi/day")).status, 400); // owner must choose a person in demo mode
  assert.equal((await json("/api/kpi/team")).status, 200);
  assert.equal((await json("/api/kpi/leaderboard")).status, 200);
  assert.equal((await json("/api/kpi/business?monthStart=2026-10-01&prevStart=2026-09-01&nextStart=2026-11-01")).status, 200);
  assert.equal((await json("/api/kpi/business")).status, 400);
  assert.equal((await post("/api/kpi/targets", { metric: "calls", value: 30 }, null, "http://evil.example")).status, 403);
  assert.equal((await post("/api/kpi/targets", { metric: "calls", value: 30 })).status, 200);
  assert.equal((await json(`/api/kpi/day?user=${first.id}`)).data.goal.calls, 30);
  assert.equal((await post("/api/kpi/targets", { metric: "calls", value: -3 })).status, 400);

  // the new app is the front door; the earlier screens stay at /classic/
  // (the screens are built into web/dist; the container build does that, a bare checkout may not have it)
  if (existsSync(new URL("./web/dist/index.html", import.meta.url))) {
    const front = await fetch(base + "/");
    assert.equal(front.status, 200);
    assert.match(await front.text(), /id="root"/);
  }
  const classic = await fetch(base + "/classic/");
  assert.equal(classic.status, 200);
  assert.match(await classic.text(), /id="nav"/);
  // the new app is static, and traversal never reaches other files
  const redirect = await fetch(base + "/next", { redirect: "manual" });
  assert.equal(redirect.status, 301);
  for (const path of ["/next/../server.mjs", "/next/%2e%2e/server.mjs", "/next/..%2fserver.mjs", "/next/assets/../../package.json", "/next/%00", "/next/x.mjs"]) {
    const r = await fetch(base + path);
    assert.ok([400, 404].includes(r.status), `${path} -> ${r.status}`);
    assert.ok(!(await r.text()).includes("createServer"), path);
  }

  // company login: a caller sees only their own day and cannot read the team or change goals
  const boot = await post("/api/auth/bootstrap", { userId: first.id, username: "owner@example.test", password: "synthetic-password-123", company: "Test" });
  assert.equal(boot.status, 200);
  const ownerCookie = boot.headers.get("set-cookie").split(";")[0];
  const invite = await post("/api/workspace/users", { userId: second.id, name: second.name, username: "caller@example.test", role: "member" }, ownerCookie);
  assert.equal(invite.status, 201, JSON.stringify(invite.data));
  const token = decodeURIComponent(invite.data.setupUrl.split("token=")[1]);
  assert.equal((await post("/api/auth/reset", { token, password: "synthetic-password-123" })).status, 200);
  const login = await post("/api/auth/login", { username: "caller@example.test", password: "synthetic-password-123" });
  const callerCookie = login.headers.get("set-cookie").split(";")[0];
  assert.equal((await json("/api/kpi/me")).status, 401);
  const callerMe = await json("/api/kpi/me", { headers: { Cookie: callerCookie } });
  assert.equal(callerMe.data.lead, false, JSON.stringify([login.status, callerMe.status, callerMe.data]));
  const ownDay = await json(`/api/kpi/day?user=${first.id}`, { headers: { Cookie: callerCookie } }); // asking for someone else's day returns their own
  assert.equal(ownDay.status, 200);
  assert.equal((await json("/api/kpi/team", { headers: { Cookie: callerCookie } })).status, 403);
  assert.equal((await json("/api/kpi/business?monthStart=2026-10-01&prevStart=2026-09-01&nextStart=2026-11-01", { headers: { Cookie: callerCookie } })).status, 403);
  assert.equal((await post("/api/kpi/targets", { metric: "calls", value: 5 }, callerCookie)).status, 403);
  assert.equal((await post("/api/kpi/targets", { metric: "calls", value: 55 }, ownerCookie)).status, 200);
  assert.equal((await json("/api/kpi/team", { headers: { Cookie: ownerCookie } })).status, 200);
  // Settings screens use these: callers are refused, the owner is served
  for (const path of ["/api/workspace/users", "/api/email/settings"]) {
    assert.equal((await json(path, { headers: { Cookie: callerCookie } })).status, 403, path);
    assert.equal((await json(path, { headers: { Cookie: ownerCookie } })).status, 200, path);
  }
  assert.equal((await json("/api/workspace/access", { headers: { Cookie: callerCookie } })).status, 200);
  // WhatsApp, call AI and AI connections are administrator-only
  for (const path of ["/api/whatsapp/status", "/api/call-ai/settings", "/api/call-ai/keys", "/api/mcp/keys", "/api/mcp/approvals"]) {
    const asCaller = await json(path, { headers: { Cookie: callerCookie } });
    assert.equal(asCaller.status, 403, path); // a caller never gets the pairing code, keys or connections
    const owner = await json(path, { headers: { Cookie: ownerCookie } });
    assert.equal(owner.status, 200, `${path} ${JSON.stringify(owner.data)}`);
  }
  // keys: save, list without the secret, turn off
  const saved = await post("/api/call-ai/keys", { provider: "openai", label: "Test key", key: "sk-synthetic-test-key" }, ownerCookie);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const listed = await json("/api/call-ai/keys", { headers: { Cookie: ownerCookie } });
  assert.equal(JSON.stringify(listed.data).includes("sk-synthetic"), false);
  // MCP connection: created once with a token, then listed without it
  const conn = await post("/api/mcp/keys", { label: "Test connection", scopes: ["leads:read"] }, ownerCookie);
  assert.equal(conn.status, 201, JSON.stringify(conn.data));
  assert.match(conn.data.token, /^sdmcp_/);
  assert.equal(JSON.stringify((await json("/api/mcp/keys", { headers: { Cookie: ownerCookie } })).data).includes(conn.data.token), false);
});
