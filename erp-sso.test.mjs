import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { createErpSso, erpSsoConfig } from "./erp-sso.mjs";
import { createUserAuth } from "./user-auth.mjs";

const config = erpSsoConfig({
  ERP_OAUTH_ORIGIN: "https://erp.example.com",
  ERP_OAUTH_CLIENT_ID: "cid",
  ERP_OAUTH_CLIENT_SECRET: "secret",
  ERP_OAUTH_USER_MAP: "Boss@Example.com=owner",
}, "https://crm.example.com");

test("config is disabled without credentials and builds redirect from public origin", () => {
  assert.equal(erpSsoConfig({}, "https://crm.example.com"), null);
  assert.equal(config.redirectUri, "https://crm.example.com/api/auth/erp/callback");
  assert.equal(config.userMap.get("boss@example.com"), "owner");
});

test("callback rejects state mismatch and exchanges code for email", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("get_token"))
      return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
    return new Response(JSON.stringify({ email: "Boss@Example.com", name: "Boss" }), { status: 200 });
  };
  const sso = createErpSso({ config, fetchImpl });
  const { state, location } = sso.start();
  assert.match(location, /^https:\/\/erp\.example\.com\/api\/method\/frappe\.integrations\.oauth2\.authorize\?/);
  assert.equal(new URL(location).searchParams.get("state"), state);
  await assert.rejects(sso.callback({ code: "c", state, cookieState: "other" }), /expired/);
  const second = sso.start();
  const result = await sso.callback({ code: "c", state: second.state, cookieState: second.state });
  assert.deepEqual(result, { email: "boss@example.com", username: "owner", name: "Boss" });
  assert.equal(new URLSearchParams(calls[0].options.body).get("client_secret"), "secret");
  assert.equal(calls[1].options.headers.Authorization, "Bearer tok");
  // State is single-use.
  await assert.rejects(sso.callback({ code: "c", state: second.state, cookieState: second.state }), /expired/);
});

test("ERP login over HTTP creates a CRM session for the matching username", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "salesdesk-erp-"));
  const dbPath = join(dir, "crm.sqlite");
  // Fake ERPNext provider.
  const erp = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url.includes("get_token")) return res.end(JSON.stringify({ access_token: "tok" }));
    if (req.url.includes("openid_profile"))
      return res.end(JSON.stringify({ email: "rep@devi.test", name: "Rep" }));
    res.statusCode = 404;
    res.end("{}");
  });
  erp.listen(0, "127.0.0.1");
  await once(erp, "listening");
  const erpOrigin = `http://127.0.0.1:${erp.address().port}`;
  // Seed DB: one CRM user with an account named after the ERP email.
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE IF NOT EXISTS records(kind TEXT, id TEXT, body TEXT, PRIMARY KEY(kind,id))");
  const userId = "11111111-1111-4111-8111-111111111111";
  db.prepare("INSERT INTO records VALUES('users',?,?)").run(
    userId,
    JSON.stringify({ id: userId, name: "Rep", role: "Manager", active: true }),
  );
  createUserAuth({ db, getUser: () => ({ id: userId, name: "Rep", active: true }) }).bootstrap({
    userId,
    username: "rep@devi.test",
    password: "a-long-password-1",
    company: "Devi",
  });
  db.close();
  const base = "http://127.0.0.1:3409";
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL(".", import.meta.url),
    env: {
      ...process.env,
      CRM_DB: dbPath,
      PORT: "3409",
      MOBILE_PORT: "3410",
      ERP_OAUTH_ORIGIN: erpOrigin,
      ERP_OAUTH_CLIENT_ID: "cid",
      ERP_OAUTH_CLIENT_SECRET: "secret",
      ERP_OAUTH_REDIRECT_URI: `${base}/api/auth/erp/callback`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    erp.close();
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(Error("timeout")), 10000);
    child.stdout.on("data", (d) => {
      out += d;
      if (out.includes("Device sync API:")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", (c) => reject(Error("exit " + c)));
  });
  const status = await (await fetch(base + "/api/auth/status")).json();
  assert.equal(status.erpLogin, true);
  const start = await fetch(base + "/api/auth/erp/start", { redirect: "manual" });
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  const stateCookie = start.headers.get("set-cookie").split(";")[0];
  const bad = await fetch(`${base}/api/auth/erp/callback?code=x&state=${state}`);
  assert.equal(bad.status, 401);
  const start2 = await fetch(base + "/api/auth/erp/start", { redirect: "manual" });
  const state2 = new URL(start2.headers.get("location")).searchParams.get("state");
  const cb = await fetch(`${base}/api/auth/erp/callback?code=x&state=${state2}`, {
    headers: { Cookie: start2.headers.get("set-cookie").split(";")[0] },
  });
  assert.equal(cb.status, 200);
  const session = cb.headers.getSetCookie().find((c) => c.startsWith("salesdesk_session="));
  assert.ok(session);
  const me = await (
    await fetch(base + "/api/auth/status", { headers: { Cookie: session.split(";")[0] } })
  ).json();
  assert.equal(me.user.username, "rep@devi.test");
  assert.ok(stateCookie);
});
