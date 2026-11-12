import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

// a signed-in member who refreshes the page gets the app, not "Administrator required"; admin APIs stay closed to them
test("a member's refresh loads the app pages while admin APIs stay closed", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "salesdesk-member-pages-"));
  const base = "http://127.0.0.1:3497";
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL(".", import.meta.url),
    env: { ...process.env, CRM_DB: join(dir, "test.sqlite"), PORT: "3497", MOBILE_PORT: "3496" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; }
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Server timeout")), 10000);
    child.stdout.on("data", (d) => { if (String(d).includes("Salesdesk CRM:")) { clearTimeout(timer); resolve(); } });
    child.once("exit", (code) => { clearTimeout(timer); reject(Error("Server exited " + code)); });
  });
  const req = async (path, method = "GET", body, headers = {}) => {
    const r = await fetch(base + path, { method, redirect: "manual", headers: { ...(body ? { "Content-Type": "application/json" } : {}), Origin: base, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, text: await r.text(), cookie: r.headers.get("set-cookie") };
  };
  const users = JSON.parse((await req("/api/auth/status")).text).users;
  const boot = await req("/api/auth/bootstrap", "POST", { userId: users[0].id, username: "owner@example.test", password: "Owner-password-123", company: "Synthetic" });
  const admin = { Cookie: boot.cookie.split(";")[0] };
  const invited = JSON.parse((await req("/api/workspace/users", "POST", { name: "Synthetic caller", username: "caller", role: "member" }, admin)).text);
  const token = new URLSearchParams(new URL(invited.setupUrl, base).hash.slice(1)).get("token");
  assert.equal((await req("/api/auth/reset", "POST", { token, password: "Caller-password-123" })).status, 200);
  const login = await req("/api/auth/login", "POST", { username: "caller", password: "Caller-password-123" });
  assert.equal(login.status, 200);
  const member = { Cookie: login.cookie.split(";")[0] };
  for (const page of ["/", "/next/"]) {
    const r = await req(page, "GET", undefined, member);
    assert.equal(r.status, 200, page);
    assert.match(r.text, /<!doctype html>/i, page);
  }
  assert.equal((await req("/api/state", "GET", undefined, member)).status, 200);
  assert.equal((await req("/api/marketplace/settings", "GET", undefined, member)).status, 403);
  assert.equal((await req("/api/workspace/user-links", "GET", undefined, member)).status, 403);
});
