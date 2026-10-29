import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

async function startServer(t, port, env = {}) {
  const dir = await mkdtemp(join(tmpdir(), "salesdesk-phase0-http-"));
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL(".", import.meta.url),
    env: {
      ...process.env,
      CRM_DB: join(dir, "test.sqlite"),
      PORT: String(port),
      MOBILE_PORT: String(port + 1),
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (data) => (stderr += data));
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
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error(`Server exited ${code}: ${stderr}`));
    });
  });
  const base = `http://127.0.0.1:${port}`;
  const web = async (path, method = "GET", body, headers = {}) => {
    const response = await fetch(base + "/api/" + path, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: response.status, data, headers: response.headers };
  };
  return { base, web };
}

test("duplicate phone numbers are rejected however they are written; edits and imports stay safe", async (t) => {
  const { web } = await startServer(t, 3297);
  const users = (await web("state")).data.users;
  const owner = users[0].id;
  const create = (name, phone) => web("leads", "POST", { name, phone, owner, source: "Test" });
  const first = await create("First", "+91 91000 00001");
  assert.equal(first.status, 200);
  for (const phone of ["9100000001", "09100000001", "919100000001", "(+91) 91000-00001"]) {
    const duplicate = await create("Dup " + phone, phone);
    assert.equal(duplicate.status, 409, phone);
    assert.match(duplicate.data.error, /already exists: First/);
  }
  // Leads without a phone are allowed and do not collide with each other.
  assert.equal((await create("No phone A", "")).status, 200);
  assert.equal((await create("No phone B", "")).status, 200);
  const second = await create("Second", "9100000002");
  assert.equal(second.status, 200);
  // Changing a number onto another lead's number is refused; unrelated edits are fine.
  assert.equal((await web(`leads/${second.data.id}`, "PATCH", { phone: "9100000001" })).status, 409);
  assert.equal((await web(`leads/${second.data.id}`, "PATCH", { name: "Second renamed" })).status, 200);
  assert.equal((await web(`leads/${second.data.id}`, "PATCH", { phone: "+91 91000 00002" })).status, 200);
  // Archived leads still own their number: restore it instead of creating a clone.
  assert.equal((await web(`leads/${first.data.id}`, "PATCH", { archived: true })).status, 200);
  const clone = await create("Clone", "9100000001");
  assert.equal(clone.status, 409);
  assert.match(clone.data.error, /archived/);
  // Bulk import skips differently formatted duplicates instead of failing the batch.
  const imported = await web("import", "POST", {
    leads: [
      { name: "Imported dup", phone: "91000 00001", source: "Test" },
      { name: "Imported dup 2", phone: "+919100000002", source: "Test" },
      { name: "Imported new", phone: "9100000003", source: "Test" },
    ],
  });
  assert.deepEqual(imported.data, { added: 1, skipped: 2 });
});

test("members download documents on their own leads only; login throttling is per client", async (t) => {
  const { base, web } = await startServer(t, 3299, { TRUST_PROXY: "true" });
  const users = (await web("state")).data.users;
  const admin = users[0].id,
    member = users[1].id;
  const lead = async (name, owner, phone) =>
    (await web("leads", "POST", { name, owner, phone, source: "Test" })).data.id;
  const ownLead = await lead("Member lead", member, "9200000001");
  const otherLead = await lead("Admin lead", admin, "9200000002");
  const document = async (leadId, name) =>
    (await web("documents", "POST", { leadId, name, mime: "text/plain", content: "hello " + name }))
      .data.id;
  const ownDoc = await document(ownLead, "mine.txt");
  const otherDoc = await document(otherLead, "theirs.txt");
  const orphanDoc = await document("", "orphan.txt");
  const password = "synthetic-password-123";
  const origin = { Origin: base };
  const boot = await web(
    "auth/bootstrap",
    "POST",
    { userId: admin, username: "admin@example.test", password, company: "Test Co" },
    origin,
  );
  assert.equal(boot.status, 200);
  const adminCookie = boot.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (
      await web(
        "auth/accounts",
        "POST",
        { userId: member, username: "member@example.test", password },
        { ...origin, Cookie: adminCookie },
      )
    ).status,
    200,
  );
  const login = (username, pw, ip) =>
    web("auth/login", "POST", { username, password: pw }, { ...origin, "X-Forwarded-For": ip });
  // One client hammering a username is throttled; the same user from another client is not.
  for (let i = 0; i < 5; i++)
    assert.equal((await login("member@example.test", "wrong-password-1", "203.0.113.9")).status, 401);
  assert.equal((await login("member@example.test", password, "203.0.113.9")).status, 401);
  const session = await login("member@example.test", password, "198.51.100.7");
  assert.equal(session.status, 200);
  const cookie = session.headers.get("set-cookie").split(";")[0];
  const download = (id) => web(`documents/${id}/download`, "GET", undefined, { Cookie: cookie });
  const own = await download(ownDoc);
  assert.equal(own.status, 200);
  assert.equal(own.data, "hello mine.txt");
  assert.equal((await download(otherDoc)).status, 403);
  assert.equal((await download(orphanDoc)).status, 403);
  assert.equal((await download("00000000-0000-4000-8000-000000000000")).status, 404);
  // Admin can still download everything.
  const adminDownload = await web(`documents/${otherDoc}/download`, "GET", undefined, {
    Cookie: adminCookie,
  });
  assert.equal(adminDownload.status, 200);
  // Members still cannot reach other admin-only routes.
  assert.equal((await web("campaigns/x/prepare", "POST", {}, { ...origin, Cookie: cookie })).status, 403);
});
