// Start both source-built services as one CRM deployment. Never expose the engine port.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = resolve(process.env.SALESDESK_AUTOMATION_DATA || resolve(root, "data/automation"));
await mkdir(data, { recursive: true, mode: 0o700 });
const credentialsFile = resolve(data, "operator.json");
let operator;
try {
  operator = JSON.parse(await readFile(credentialsFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  operator = {
    email: "operator@crm.internal.invalid",
    firstName: "Salesdesk",
    lastName: "Operator",
    password: randomBytes(32).toString("base64url") + "Aa1",
  };
  await writeFile(credentialsFile, JSON.stringify(operator), { mode: 0o600, flag: "wx" });
}
const port = process.env.PORT || "3100";
const runtimePort = process.env.SALESDESK_AUTOMATION_PORT || "5681";
const bridgeSecret = randomBytes(48).toString("base64url");
const publicOrigin = process.env.PUBLIC_ORIGIN || `http://localhost:${port}`;
const privateRuntime = `http://127.0.0.1:${runtimePort}`;
const shared = { ...process.env, SALESDESK_AUTOMATION_BRIDGE_SECRET: bridgeSecret };
const crm = spawn(
  process.env.SALESDESK_CRM_NODE || process.execPath,
  [resolve(root, "server.mjs")],
  {
    stdio: "inherit",
    env: {
      ...shared,
      SALESDESK_AUTOMATION_ENABLED: "true",
      SALESDESK_AUTOMATION_RUNTIME: privateRuntime,
    },
  },
);
const engine = spawn(
  process.env.SALESDESK_N8N_NODE || process.execPath,
  [process.env.SALESDESK_N8N_BIN || "/opt/n8n/bin/n8n", "start"],
  {
    stdio: "inherit",
    env: {
      ...shared,
      N8N_USER_FOLDER: data,
      N8N_LISTEN_ADDRESS: "127.0.0.1",
      N8N_PORT: runtimePort,
      N8N_PATH: "/automation/",
      N8N_EDITOR_BASE_URL: publicOrigin + "/automation/",
      WEBHOOK_URL: publicOrigin + "/automation/",
      N8N_PUSH_BACKEND: "sse",
      N8N_SECURE_COOKIE: String(publicOrigin.startsWith("https://")),
      N8N_DIAGNOSTICS_ENABLED: "false",
      N8N_PERSONALIZATION_ENABLED: "false",
      N8N_VERSION_NOTIFICATIONS_ENABLED: "false",
      N8N_COMMUNITY_PACKAGES_ENABLED: "false",
      N8N_UNVERIFIED_PACKAGES_ENABLED: "false",
      N8N_PUBLIC_API_DISABLED: "true",
      N8N_BLOCK_ENV_ACCESS_IN_NODE: "true",
      N8N_BLOCK_FILE_ACCESS_TO_N8N_FILES: "true",
      N8N_RESTRICT_FILE_ACCESS_TO: resolve(data, "workflow-files"),
      N8N_SSRF_PROTECTION_ENABLED: "true",
      NODES_EXCLUDE: JSON.stringify([
        "n8n-nodes-base.executeCommand",
        "n8n-nodes-base.localFileTrigger",
        "n8n-nodes-base.readWriteFile",
        "n8n-nodes-base.readBinaryFile",
        "n8n-nodes-base.writeBinaryFile",
        "n8n-nodes-base.ssh",
      ]),
      SALESDESK_BRIDGE_ENABLED: "true",
      SALESDESK_CRM_INTERNAL_ORIGIN: `http://127.0.0.1:${port}`,
    },
  },
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  crm.kill("SIGTERM");
  engine.kill("SIGTERM");
  const timer = setTimeout(() => {
    crm.kill("SIGKILL");
    engine.kill("SIGKILL");
    process.exit(code);
  }, 20000);
  timer.unref();
  Promise.all(
    [crm, engine].map((child) =>
      child.exitCode !== null ? Promise.resolve() : new Promise((ok) => child.once("exit", ok)),
    ),
  ).then(() => process.exit(code));
}
for (const child of [crm, engine]) {
  child.on("error", () => stop(1));
  child.on("exit", () => {
    if (!stopping) stop(1);
  });
}
process.on("SIGTERM", () => stop());
process.on("SIGINT", () => stop());
try {
  let settings;
  for (let attempt = 0; attempt < 120 && !stopping; attempt++) {
    try {
      const response = await fetch(privateRuntime + "/rest/settings", {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        settings = (await response.json()).data;
        if (settings?.userManagement) break;
      }
    } catch {}
    await new Promise((ok) => setTimeout(ok, 2000));
  }
  if (!settings?.userManagement) throw Error("Workflow engine startup timed out");
  if (settings.userManagement.showSetupOnFirstLoad) {
    const response = await fetch(privateRuntime + "/rest/owner/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...operator, password: operator.password.slice(0, 64) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error("Workflow operator setup failed");
  }
  console.log("Salesdesk source-built Automation runtime ready (selected CRM users only)");
} catch (error) {
  console.error(error.message);
  stop(1);
}
