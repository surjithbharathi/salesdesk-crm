import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

test("the WhatsApp gateway link: settings are write-only for secrets, and the signed webhook makes leads", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "salesdesk-wagw-http-"));
  const base = "http://127.0.0.1:3297";
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL(".", import.meta.url),
    env: { ...process.env, CRM_DB: join(dir, "test.sqlite"), PORT: "3297", MOBILE_PORT: "3298" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stderr.on("data", (chunk) => { output += chunk; });
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
      if (stdout.includes("Salesdesk CRM:")) { clearTimeout(timer); resolve(); }
    });
    child.once("exit", (code) => { clearTimeout(timer); reject(Error(`Server exited ${code}: ${output}`)); });
  });
  const call = async (path, method = "GET", body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers }, ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const SECRET = "whsec_http_test_value";
  const signed = (payload) => { const raw = JSON.stringify(payload); return [raw, { "X-Devi-Signature": "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex") }]; };
  const message = { event: "message.received", delivery_id: "d1", sent_at: 1, data: { wa_id: "919876500123", name: "Test Customer", phone_id: "222", number_label: "Sales 2", kind: "text", text: "Hello from WhatsApp", message_id: "wamid.HTTP1", at: 1794000000 } };

  // nothing is open until the link is set up and turned on
  const [raw0, head0] = signed(message);
  assert.equal((await call("/hooks/wa-gateway", "POST", raw0, head0)).status, 404);
  assert.equal((await call("/api/wa-gateway/settings", "POST", { enabled: true }, { Origin: base })).status, 400);
  assert.equal((await call("/api/wa-gateway/settings", "POST", { baseUrl: "https://127.0.0.1", apiKey: "k" }, { Origin: base })).status, 400);
  assert.equal((await call("/api/wa-gateway/settings", "POST", { baseUrl: "https://93.184.216.34" })).status, 403); // browser requests need the same origin
  const saved = await call("/api/wa-gateway/settings", "POST", { baseUrl: "https://93.184.216.34", apiKey: "key-secret-1", webhookSecret: SECRET, enabled: true }, { Origin: base });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.enabled, true);
  assert.equal(saved.data.hasKey, true);
  assert.ok(!JSON.stringify(saved.data).includes("key-secret-1") && !JSON.stringify(saved.data).includes(SECRET));
  assert.equal(saved.data.hookUrl.endsWith("/hooks/wa-gateway"), true);
  assert.ok(!JSON.stringify((await call("/api/wa-gateway/settings")).data).includes(SECRET));

  // the webhook
  const [raw, head] = signed(message);
  assert.equal((await call("/hooks/wa-gateway", "POST", raw, { "X-Devi-Signature": "sha256=" + "0".repeat(64) })).status, 401);
  assert.equal((await call("/hooks/wa-gateway", "POST", raw, { ...head, Origin: "https://evil.example" })).status, 403);
  const first = await call("/hooks/wa-gateway", "POST", raw, head);
  assert.equal(first.status, 200);
  assert.equal(first.data.created, true);
  assert.equal((await call("/hooks/wa-gateway", "POST", raw, head)).data.duplicate, true);
  const state = (await call("/api/state")).data;
  const lead = state.leads.find((l) => l.id === first.data.leadId);
  assert.deepEqual([lead.name, lead.source, lead.stage], ["Test Customer", "WhatsApp", "New"]);
  assert.equal(state.messages.filter((m) => m.providerId === "wamid.HTTP1").length, 1);
  assert.equal(state.conversations.filter((c) => c.leadId === lead.id && c.channel === "WhatsApp").length, 1);

  // sending needs the gateway to answer; with nothing there the CRM says so plainly and saves nothing
  const sent = await call(`/api/wa-gateway/leads/${lead.id}/send`, "POST", { text: "Hi" }, { Origin: base });
  assert.equal(sent.status, 502);
  assert.equal((await call("/api/state")).data.messages.filter((m) => m.direction === "Outgoing").length, 0);
  assert.equal((await call(`/api/wa-gateway/leads/${lead.id}/send`, "POST", { text: "Hi" })).status, 403);
});
