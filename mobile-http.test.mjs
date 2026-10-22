import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

test("mobile HTTP sync authenticates devices and attaches private recordings to lead activity", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "salesdesk-mobile-http-"));
  const base = "http://127.0.0.1:3299",
    deviceBase = "http://127.0.0.1:3300";
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL(".", import.meta.url),
    env: { ...process.env, CRM_DB: join(dir, "test.sqlite"), PORT: "3299", MOBILE_PORT: "3300" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stderr.on("data", (chunk) => {
    output += chunk;
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
    const timer = setTimeout(() => reject(Error("Startup timed out: " + output)), 10000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
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
      reject(Error(`Server exited ${code}: ${output}`));
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
    return { status: response.status, data: await response.json() };
  };
  const admin = (path, method, body, headers) =>
    request(base, "/api/" + path, method, body, headers);
  const state = (await admin("state")).data;
  const owner = state.users.find((user) => user.active).id;
  const otherOwner = state.users.find((user) => user.active && user.id !== owner).id;
  const issue = { name: "HTTP test Android", owner };
  assert.equal((await admin("mobile/devices", "POST", issue)).status, 403);
  assert.equal(
    (await admin("mobile/devices", "POST", issue, { Origin: "https://example.com" })).status,
    403,
  );
  const issued = await admin("mobile/devices", "POST", issue, { Origin: base });
  assert.equal(issued.status, 200);
  assert.match(issued.data.token, /^[A-Za-z0-9_-]{43}$/);
  const { token, id: deviceId } = issued.data;
  const auth = { Authorization: `Bearer ${token}` };
  const listed = await admin("mobile/devices");
  assert.equal(listed.data[0].token, undefined);
  assert.ok(!JSON.stringify(listed.data).includes(token));
  assert.equal((await request(deviceBase, "/v1/targets")).status, 401);
  assert.equal(
    (await request(deviceBase, "/v1/targets", "GET", undefined, { ...auth, Origin: base })).status,
    403,
  );
  const lead = await admin("leads", "POST", {
    name: "Synthetic mobile contact",
    phone: "919123450001",
    owner,
    source: "Test",
  });
  assert.equal(lead.status, 200);
  const excluded = await admin("leads", "POST", {
    name: "Other owner's contact",
    phone: "919123450002",
    owner: otherOwner,
    source: "Test",
  });
  assert.equal(excluded.status, 200);
  const targets = await request(deviceBase, "/v1/targets", "GET", undefined, auth);
  assert.equal(targets.status, 200);
  assert.ok(targets.data.some((target) => target.id === lead.data.id));
  assert.ok(!targets.data.some((target) => target.id === excluded.data.id));
  const call = {
    localId: "http-call-1",
    phone: "919123450001",
    direction: "Incoming",
    duration: 30,
    startedAt: Date.now() - 60000,
  };
  const synced = await request(deviceBase, "/v1/calls", "POST", call, auth);
  assert.equal(synced.status, 200);
  const duplicate = await request(deviceBase, "/v1/calls", "POST", call, auth);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.data.id, synced.data.id);
  assert.equal(
    (
      await request(
        deviceBase,
        "/v1/calls",
        "POST",
        { ...call, localId: "other", phone: "919123450002" },
        auth,
      )
    ).status,
    403,
  );
  const audio = Buffer.alloc(48);
  audio.write("RIFF", 0);
  audio.writeUInt32LE(40, 4);
  audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24);
  audio.writeUInt32LE(16000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write("data", 36);
  audio.writeUInt32LE(4, 40);
  const upload = await fetch(`${deviceBase}/v1/calls/${synced.data.id}/recording`, {
    method: "PUT",
    body: audio,
    headers: {
      ...auth,
      "Content-Type": "audio/wav",
      "X-Match-Mode": "manual",
      "X-Audio-Duration": "30",
      "X-File-Modified": String(Date.now()),
    },
  });
  assert.equal(upload.status, 200);
  const recording = await upload.json();
  const playback = await fetch(`${base}/api/mobile/recordings/${recording.id}`);
  assert.equal(playback.status, 200);
  assert.equal(playback.headers.get("content-type"), "audio/wav");
  assert.equal(playback.headers.get("cache-control"), "no-store");
  assert.deepEqual(Buffer.from(await playback.arrayBuffer()), audio);
  const after = (await admin("state")).data;
  assert.equal(after.mobileCalls.length, 1);
  assert.equal(after.mobileCalls[0].recordingId, recording.id);
  assert.equal(
    after.activities.find((activity) => activity.id === synced.data.activityId).recordingId,
    recording.id,
  );
  assert.ok(!JSON.stringify(after).includes(token));
  assert.equal((await admin("mobileCalls", "POST", call, { Origin: base })).status, 404);
  assert.equal((await admin(`mobile/devices/${deviceId}/revoke`, "POST", {})).status, 403);
  assert.equal(
    (await admin(`mobile/devices/${deviceId}/revoke`, "POST", {}, { Origin: base })).status,
    200,
  );
  assert.equal((await request(deviceBase, "/v1/targets", "GET", undefined, auth)).status, 401);
});
