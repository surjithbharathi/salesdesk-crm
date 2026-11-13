import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createAppUpdate, parseLatest } from "./app-update.mjs";
import { readGradleVersion } from "./scripts/publish-app-update.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const fakeApk = (size = 100 * 1024) => Buffer.concat([Buffer.from("PK\u0003\u0004"), randomBytes(size - 4)]);

test("no latest.json means no update", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "salesdesk-update-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const feed = createAppUpdate(dir);
  assert.deepEqual(await feed.info(), { available: false });
  assert.equal(await feed.apk(), null);
});

test("a valid feed reports version, size and the checksum it computed itself", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "salesdesk-update-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const apk = fakeApk();
  await writeFile(join(dir, "salesdesk.apk"), apk);
  await writeFile(join(dir, "latest.json"), JSON.stringify({ versionCode: 53, versionName: "0.24.0", notes: " Faster sync ", mandatory: true }));
  const feed = createAppUpdate(dir);
  assert.deepEqual(await feed.info(), {
    available: true, versionCode: 53, versionName: "0.24.0", notes: "Faster sync", mandatory: true, size: apk.length, sha256: sha(apk),
  });
  const got = await feed.apk();
  assert.equal(got.size, apk.length);
  assert.equal(got.sha256, sha(apk));
  const chunks = [];
  for await (const c of got.stream) chunks.push(c);
  assert.ok(Buffer.concat(chunks).equals(apk));
  // notes and mandatory are optional
  await writeFile(join(dir, "latest.json"), JSON.stringify({ versionCode: 54, versionName: "0.24.1" }));
  const plain = await feed.info();
  assert.equal(plain.notes, "");
  assert.equal(plain.mandatory, false);
});

test("the checksum refreshes when the APK is replaced", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "salesdesk-update-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "latest.json"), JSON.stringify({ versionCode: 53, versionName: "0.24.0" }));
  const first = fakeApk();
  await writeFile(join(dir, "salesdesk.apk"), first);
  const feed = createAppUpdate(dir);
  assert.equal((await feed.info()).sha256, sha(first));
  const second = fakeApk(); // same size, different bytes
  await writeFile(join(dir, "salesdesk.apk"), second);
  const later = new Date(Date.now() + 5000);
  await utimes(join(dir, "salesdesk.apk"), later, later);
  assert.equal((await feed.info()).sha256, sha(second));
  const third = fakeApk(200 * 1024); // different size
  await writeFile(join(dir, "salesdesk.apk"), third);
  assert.equal((await feed.info()).sha256, sha(third));
});

test("malformed metadata or a bad APK is rejected, never guessed", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "salesdesk-update-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const feed = createAppUpdate(dir);
  const bads = [
    "{not json", "[]", "null",
    JSON.stringify({ versionName: "0.24.0" }),
    JSON.stringify({ versionCode: 0, versionName: "0.24.0" }),
    JSON.stringify({ versionCode: 1.5, versionName: "0.24.0" }),
    JSON.stringify({ versionCode: "53", versionName: "0.24.0" }),
    JSON.stringify({ versionCode: 53 }),
    JSON.stringify({ versionCode: 53, versionName: "" }),
    JSON.stringify({ versionCode: 53, versionName: "0.24 <b>" }),
    JSON.stringify({ versionCode: 53, versionName: "0.24.0", notes: "x".repeat(601) }),
    JSON.stringify({ versionCode: 53, versionName: "0.24.0", notes: 5 }),
    JSON.stringify({ versionCode: 53, versionName: "0.24.0", mandatory: "yes" }),
    JSON.stringify({ versionCode: 53, versionName: "0.24.0", sha256: "abc" }),
  ];
  for (const text of bads) {
    assert.throws(() => parseLatest(text), /misconfigured/, text);
    await writeFile(join(dir, "latest.json"), text);
    await assert.rejects(feed.info(), (e) => e.status === 503, text);
  }
  assert.doesNotThrow(() => parseLatest(JSON.stringify({ versionCode: 53, versionName: "0.24.0", notes: "x".repeat(600) })));
  await writeFile(join(dir, "latest.json"), JSON.stringify({ versionCode: 53, versionName: "0.24.0" }));
  await assert.rejects(feed.info(), /salesdesk.apk is missing/);
  await writeFile(join(dir, "salesdesk.apk"), fakeApk(1024));
  await assert.rejects(feed.info(), /between 64 KB and 80 MB/);
});

test("the publish script reads the version from build.gradle", () => {
  assert.deepEqual(
    readGradleVersion("defaultConfig { applicationId 'ai.salesdesk.companion'; minSdk 26; versionCode 52; versionName '0.23.0'; }"),
    { versionCode: 52, versionName: "0.23.0" },
  );
  assert.throws(() => readGradleVersion("defaultConfig {}"), /versionCode/);
});

test("device API: the update feed and the APK need a signed-in phone", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "salesdesk-update-http-"));
  const updates = join(dir, "updates");
  const port = 3431, base = `http://127.0.0.1:${port}`, deviceBase = `http://127.0.0.1:${port + 1}`;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL(".", import.meta.url),
    env: { ...process.env, CRM_DB: join(dir, "crm.sqlite"), PORT: String(port), MOBILE_PORT: String(port + 1), BIND_HOST: "127.0.0.1", APP_UPDATE_DIR: updates },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const done = once(child, "exit");
      child.kill("SIGTERM");
      await done;
    }
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(Error("server timeout: " + stderr)), 15000);
    child.stdout.on("data", (d) => {
      out += d;
      if (out.includes("Salesdesk CRM:") && out.includes("Device sync API:")) { clearTimeout(timer); resolve(); }
    });
    child.once("exit", (code) => { clearTimeout(timer); reject(Error(`server exited ${code}: ${stderr}`)); });
  });
  const state = await (await fetch(base + "/api/state")).json();
  const owner = state.users.find((u) => u.active).id;
  const issued = await fetch(base + "/api/mobile/devices", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ name: "Update test", owner }),
  });
  assert.equal(issued.status, 200);
  const { token } = await issued.json();
  const auth = { Authorization: `Bearer ${token}` };

  assert.equal((await fetch(deviceBase + "/v1/app/update")).status, 401);
  assert.equal((await fetch(deviceBase + "/v1/app/update/apk")).status, 401);
  assert.equal((await fetch(deviceBase + "/v1/app/update", { headers: { Authorization: "Bearer " + "x".repeat(43) } })).status, 401);

  const none = await fetch(deviceBase + "/v1/app/update", { headers: auth });
  assert.equal(none.status, 200);
  assert.deepEqual(await none.json(), { available: false });
  assert.equal((await fetch(deviceBase + "/v1/app/update/apk", { headers: auth })).status, 404);

  const { mkdir } = await import("node:fs/promises");
  await mkdir(updates, { recursive: true });
  const apk = fakeApk(300 * 1024);
  await writeFile(join(updates, "salesdesk.apk"), apk);
  await writeFile(join(updates, "latest.json"), JSON.stringify({ versionCode: 99, versionName: "9.9.0", notes: "Test" }));
  const info = await fetch(deviceBase + "/v1/app/update", { headers: auth });
  assert.equal(info.status, 200);
  const feed = await info.json();
  assert.equal(feed.available, true);
  assert.equal(feed.versionCode, 99);
  assert.equal(feed.size, apk.length);
  assert.equal(feed.sha256, sha(apk));

  const dl = await fetch(deviceBase + "/v1/app/update/apk", { headers: auth });
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get("content-type"), "application/vnd.android.package-archive");
  assert.equal(dl.headers.get("x-content-sha256"), sha(apk));
  assert.equal(Number(dl.headers.get("content-length")), apk.length);
  const body = Buffer.from(await dl.arrayBuffer());
  assert.equal(sha(body), feed.sha256);

  // broken metadata is a clear server error, not a silent "no update"
  await writeFile(join(updates, "latest.json"), "{oops");
  const broken = await fetch(deviceBase + "/v1/app/update", { headers: auth });
  assert.equal(broken.status, 503);
  assert.match((await broken.json()).error, /misconfigured/);
});
