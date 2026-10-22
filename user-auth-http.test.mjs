import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

test("shared company login protects browser and mobile data with user scoping", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "salesdesk-auth-http-"));
  const base = "http://127.0.0.1:3399",
    mobile = "http://127.0.0.1:3400";
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL(".", import.meta.url),
    env: { ...process.env, CRM_DB: join(dir, "test.sqlite"), PORT: "3399", MOBILE_PORT: "3400" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    let stdout = "";
    const timer = setTimeout(() => reject(Error("Server timeout: " + stderr)), 10000);
    child.stdout.on("data", (data) => {
      stdout += data;
      if (stdout.includes("Salesdesk CRM:") && stdout.includes("Device sync API:")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error(`Server exited ${code}: ${stderr}`));
    });
  });
  const request = async (origin, path, method = "GET", body, headers = {}) => {
    const response = await fetch(origin + path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie"),
    };
  };
  const web = (path, method, body, headers) => request(base, "/api/" + path, method, body, headers);
  const initial = await web("auth/status");
  assert.equal(initial.status, 200);
  assert.equal(initial.data.configured, false);
  assert.ok(initial.data.users.length >= 2);
  const owner = initial.data.users[0].id,
    member = initial.data.users[1].id;
  const legacy = await web(
    "mobile/devices",
    "POST",
    { name: "Legacy phone", owner: member },
    { Origin: base },
  );
  assert.equal(legacy.status, 200);
  const ownLead = await web("leads", "POST", {
    name: "Member synthetic lead",
    owner: member,
    phone: "919123450099",
    source: "Test",
  });
  const excludedLead = await web("leads", "POST", {
    name: "Admin private lead",
    owner,
    phone: "919123450098",
    source: "Test",
  });
  assert.equal(ownLead.status, 200);
  assert.equal(excludedLead.status, 200);
  const setup = {
    userId: owner,
    username: "owner@example.test",
    password: "owner-password-123",
    company: "Synthetic Test Company",
  };
  assert.equal((await web("auth/bootstrap", "POST", setup)).status, 403);
  assert.equal(
    (await web("auth/bootstrap", "POST", setup, { Origin: "https://wrong.example" })).status,
    403,
  );
  const boot = await web("auth/bootstrap", "POST", setup, { Origin: base });
  assert.equal(boot.status, 200);
  assert.equal(boot.data.user.id, owner);
  assert.equal(boot.data.company, setup.company);
  assert.equal(boot.data.token, undefined);
  assert.match(boot.cookie, /HttpOnly/i);
  assert.match(boot.cookie, /SameSite=Strict/i);
  const adminCookie = { Cookie: boot.cookie.split(";")[0], Origin: base };
  assert.equal((await web("auth/bootstrap", "POST", setup, { Origin: base })).status, 409);
  assert.equal((await web("state")).status, 401);
  assert.equal((await web("state", "GET", undefined, adminCookie)).status, 200);
  const configured = await web("auth/status");
  assert.equal(configured.data.configured, true);
  assert.ok(!configured.data.users?.length);
  assert.equal(
    (
      await request(mobile, "/v1/targets", "GET", undefined, {
        Authorization: `Bearer ${legacy.data.token}`,
      })
    ).status,
    401,
  );
  assert.equal((await web("auth/accounts")).status, 401);
  const memberCredentials = {
    userId: member,
    username: "member@example.test",
    password: "member-password-123",
  };
  const created = await web("auth/accounts", "POST", memberCredentials, adminCookie);
  assert.equal(created.status, 200);
  assert.equal(created.data.user.role, "member");
  const accounts = await web("auth/accounts", "GET", undefined, adminCookie);
  assert.equal(accounts.status, 200);
  assert.equal(accounts.data.accounts.length, 2);
  assert.ok(!JSON.stringify(accounts.data).includes("password"));
  assert.equal((await web("auth/login", "POST", memberCredentials)).status, 403);
  assert.equal(
    (await web("auth/login", "POST", { ...memberCredentials, password: "wrong" }, { Origin: base }))
      .status,
    401,
  );
  const login = await web("auth/login", "POST", memberCredentials, { Origin: base });
  assert.equal(login.status, 200);
  assert.equal(login.data.token, undefined);
  const memberCookie = { Cookie: login.cookie.split(";")[0], Origin: base };
  const scoped = await web("state", "GET", undefined, memberCookie);
  assert.equal(scoped.status, 200);
  assert.ok(scoped.data.leads.some((lead) => lead.id === ownLead.data.id));
  assert.ok(!scoped.data.leads.some((lead) => lead.id === excludedLead.data.id));
  assert.equal((await web("auth/accounts", "GET", undefined, memberCookie)).status, 403);
  assert.equal(
    (
      await web(
        "auth/accounts",
        "POST",
        { ...memberCredentials, username: "escalate@example.test" },
        memberCookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (await request(mobile, "/v1/login", "POST", { ...memberCredentials, deviceId: "invalid" }))
      .status,
    400,
  );
  const deviceId = randomUUID();
  const phoneLogin = await request(mobile, "/v1/login", "POST", { ...memberCredentials, deviceId });
  assert.equal(phoneLogin.status, 200);
  assert.match(phoneLogin.data.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(phoneLogin.data.user.id, member);
  assert.equal(phoneLogin.data.deviceId, deviceId);
  const auth = { Authorization: `Bearer ${phoneLogin.data.token}` };
  const workspace = await request(mobile, "/v1/workspace", "GET", undefined, auth);
  assert.equal(workspace.status, 200);
  assert.equal(workspace.data.company, setup.company);
  assert.ok(workspace.data.leads.some((lead) => lead.id === ownLead.data.id));
  assert.ok(!workspace.data.leads.some((lead) => lead.id === excludedLead.data.id));
  const targets = await request(mobile, "/v1/targets", "GET", undefined, auth);
  assert.equal(targets.status, 200);
  assert.ok(targets.data.some((lead) => lead.id === ownLead.data.id));
  assert.ok(!targets.data.some((lead) => lead.id === excludedLead.data.id));
  const call = await request(
    mobile,
    "/v1/calls",
    "POST",
    {
      localId: "shared-login-call",
      phone: "919123450099",
      startedAt: Date.now() - 60000,
      duration: 30,
      direction: "Outgoing",
    },
    auth,
  );
  assert.equal(call.status, 200);
  assert.equal(call.data.leadId, ownLead.data.id);
  const createdLead = await request(
    mobile,
    "/v1/leads",
    "POST",
    { name: "Created on mobile", phone: "919123450097" },
    auth,
  );
  assert.equal(createdLead.status, 200);
  assert.equal(createdLead.data.owner, member);
  assert.equal(
    (await request(mobile, `/v1/leads/${excludedLead.data.id}`, "PATCH", { name: "Hijack" }, auth))
      .status,
    403,
  );
  assert.equal(
    (await request(mobile, `/v1/leads/${createdLead.data.id}`, "PATCH", { owner }, auth)).status,
    400,
  );
  assert.equal(
    (
      await request(
        mobile,
        `/v1/leads/${createdLead.data.id}`,
        "PATCH",
        { stage: "Opportunity" },
        auth,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        mobile,
        "/v1/notes",
        "POST",
        { leadId: excludedLead.data.id, text: "Forbidden" },
        auth,
      )
    ).status,
    403,
  );
  const note = await request(
    mobile,
    "/v1/notes",
    "POST",
    { leadId: createdLead.data.id, text: "Mobile follow-up note" },
    auth,
  );
  assert.equal(note.status, 200);
  const task = await request(
    mobile,
    "/v1/tasks",
    "POST",
    {
      leadId: createdLead.data.id,
      title: "Call tomorrow",
      due: new Date(Date.now() + 86400000).toISOString(),
    },
    auth,
  );
  assert.equal(task.status, 200);
  assert.equal(task.data.owner, member);
  assert.equal(
    (await request(mobile, `/v1/tasks/${task.data.id}`, "PATCH", { status: "Done" }, auth)).status,
    200,
  );
  assert.equal(
    (await request(mobile, `/v1/tasks/${task.data.id}`, "PATCH", { owner }, auth)).status,
    400,
  );
  const ownWorkspace = await request(mobile, "/v1/workspace", "GET", undefined, auth);
  assert.ok(ownWorkspace.data.activities.some((activity) => activity.id === note.data.id));
  assert.equal(
    (await request(mobile, "/v1/click-to-call/poll", "POST", { armed: true }, auth)).status,
    200,
  );
  const ready = await web("click-to-call/devices", "GET", undefined, memberCookie);
  assert.equal(ready.status, 200);
  assert.equal(ready.data.length, 1);
  assert.equal(ready.data[0].ready, true);
  const command = {
    leadId: createdLead.data.id,
    deviceId: ready.data[0].id,
    requestId: randomUUID(),
    confirmed: true,
  };
  assert.equal(
    (
      await web(
        "click-to-call/request",
        "POST",
        { ...command, leadId: excludedLead.data.id },
        memberCookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (await web("click-to-call/request", "POST", command, { Cookie: memberCookie.Cookie })).status,
    403,
  );
  const queued = await web("click-to-call/request", "POST", command, memberCookie);
  assert.equal(queued.status, 200);
  const claim = await request(mobile, "/v1/click-to-call/poll", "POST", { armed: true }, auth);
  assert.equal(claim.data.command.id, queued.data.id);
  assert.equal(
    (await request(mobile, "/v1/click-to-call/poll", "POST", { armed: true }, auth)).data.command,
    null,
  );
  assert.equal(
    (
      await request(
        mobile,
        "/v1/click-to-call/ack",
        "POST",
        { id: queued.data.id, status: "Dialer launched" },
        auth,
      )
    ).status,
    200,
  );
  assert.equal((await request(mobile, "/v1/logout", "POST", {}, auth)).status, 200);
  assert.equal(
    (await request(mobile, "/v1/click-to-call/poll", "POST", { armed: true }, auth)).status,
    401,
  );
  assert.equal((await request(mobile, "/v1/workspace", "GET", undefined, auth)).status, 401);
  assert.equal((await request(mobile, "/v1/targets", "GET", undefined, auth)).status, 401);
});
