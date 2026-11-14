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

test("a member's screen gets only what changed, and only their own leads", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "salesdesk-member-delta-"));
  const base = "http://127.0.0.1:3495";
  const child = spawn(process.execPath, ["server.mjs"], { cwd: new URL(".", import.meta.url), env: { ...process.env, CRM_DB: join(dir, "test.sqlite"), PORT: "3495", MOBILE_PORT: "3494" }, stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; } await rm(dir, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Server timeout")), 10000);
    child.stdout.on("data", (d) => { if (String(d).includes("Salesdesk CRM:")) { clearTimeout(timer); resolve(); } });
  });
  const req = async (path, method = "GET", body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), Origin: base, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, json: await r.json().catch(() => null), cookie: r.headers.get("set-cookie") };
  };
  const users = (await req("/api/auth/status")).json.users;
  const boot = await req("/api/auth/bootstrap", "POST", { userId: users[0].id, username: "owner@example.test", password: "Owner-password-123", company: "Synthetic" });
  const admin = { Cookie: boot.cookie.split(";")[0] };
  const invited = (await req("/api/workspace/users", "POST", { name: "Synthetic caller", username: "caller", role: "member" }, admin)).json;
  const token = new URLSearchParams(new URL(invited.setupUrl, base).hash.slice(1)).get("token");
  await req("/api/auth/reset", "POST", { token, password: "Caller-password-123" });
  const login = await req("/api/auth/login", "POST", { username: "caller", password: "Caller-password-123" });
  const member = { Cookie: login.cookie.split(";")[0] }, me = login.json.user.id;
  const start = (await req("/api/state", "GET", undefined, member)).json.syncSeq;
  const mine = (await req("/api/leads", "POST", { name: "Mine", phone: "+919800000035", owner: me, source: "Test" }, admin)).json;
  const theirs = (await req("/api/leads", "POST", { name: "Theirs", phone: "+919800000036", owner: users[0].id, source: "Test" }, admin)).json;
  await req("/api/activities", "POST", { leadId: mine.id, type: "Note", text: "Called, wants a quote" }, member);
  const d = await req(`/api/state/changes?after=${start}`, "GET", undefined, member);
  assert.equal(d.status, 200);
  assert.notEqual(d.json.full, true, "a member is no longer sent the whole CRM again");
  assert.equal(d.json.scoped, true);
  assert.deepEqual(d.json.changes.leads.map((l) => l.name), ["Mine"]);
  assert.ok(d.json.changes.activities.some((a) => a.text === "Called, wants a quote"));
  assert.ok(!JSON.stringify(d.json.changes).includes("Theirs"), "nobody else's lead is sent");
  assert.ok(!(d.json.deleted.leads || []).includes(mine.id));
  assert.ok((d.json.deleted.leads || []).includes(theirs.id), "another person's lead is only named as not shown");
  // a member gives their own lead to a colleague, and cannot take someone else's
  assert.equal((await req(`/api/leads/${theirs.id}`, "PATCH", { owner: me }, member)).status, 403);
  const given = await req(`/api/leads/${mine.id}`, "PATCH", { owner: users[0].id }, member);
  assert.equal(given.status, 200);
  assert.equal(given.json.owner, users[0].id);
  assert.equal((await req(`/api/leads/${mine.id}`, "PATCH", { owner: me }, member)).status, 403, "once given away it is not theirs to take back");
  // an open lead nobody owns is shown to everyone and may be taken for oneself, but not handed to someone else
  const mark = (await req("/api/state", "GET", undefined, member)).json.syncSeq;
  const free = (await req("/api/leads", "POST", { name: "Free", phone: "+919800000037", owner: "", source: "Test" }, admin)).json;
  assert.ok((await req(`/api/state/changes?after=${mark}`, "GET", undefined, member)).json.changes.leads.some((l) => l.id === free.id), "an unassigned lead is shown");
  assert.equal((await req(`/api/leads/${free.id}`, "PATCH", { owner: users[0].id }, member)).status, 403);
  const took = await req(`/api/leads/${free.id}`, "PATCH", { owner: me }, member);
  assert.equal(took.status, 200);
  assert.equal(took.json.owner, me);
  // closing a lead as Lost needs the reason with that change; leaving Lost clears it
  const noReason = await req(`/api/leads/${free.id}`, "PATCH", { deal: "Lost" }, member);
  assert.equal(noReason.status, 400);
  assert.match(JSON.stringify(noReason.json), /why this lead was lost/);
  const lost = await req(`/api/leads/${free.id}`, "PATCH", { deal: "Lost", lostReason: "Price / Budget Issue" }, member);
  assert.equal(lost.status, 200);
  assert.deepEqual([lost.json.stage, lost.json.disposition, lost.json.lostReason], ["Closed", "Lost", "Price / Budget Issue"]);
  const reopened = await req(`/api/leads/${free.id}`, "PATCH", { deal: "Interested Customer" }, member);
  assert.equal(reopened.json.lostReason, "");
  // an AI task id arrives URL-encoded from the screen (sig:new:… as sig%3Anew%3A…): dismissing it works and it is gone from the list
  const sig = `sig:new:${free.id}`;
  const dismissed = await req(`/api/ai-tasks/${encodeURIComponent(sig)}/dismiss`, "POST", {}, member);
  assert.equal(dismissed.status, 200, JSON.stringify(dismissed.json));
  assert.ok(!(await req("/api/ai-tasks", "GET", undefined, member)).json.items.some((x) => x.id === sig));
  assert.equal((await req("/api/ai-tasks/sig%ZZ/dismiss", "POST", {}, member)).status, 404, "a broken id is no match");
  // done: already handled, it leaves the list the same way
  const sig2 = `sig:new:${mine.id}`;
  assert.equal((await req(`/api/ai-tasks/${encodeURIComponent(sig2)}/done`, "POST", {}, admin)).status, 200);
  assert.ok(!(await req("/api/ai-tasks", "GET", undefined, admin)).json.items.some((x) => x.id === sig2));
});
