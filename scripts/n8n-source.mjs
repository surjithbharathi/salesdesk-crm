import { readFileSync, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(resolve(root, "automation/source.lock.json"), "utf8"));
const source = resolve(process.env.N8N_SOURCE_DIR || resolve(root, ".automation-source/n8n"));
const command = process.argv[2] || "status";
const run = (file, args, cwd = source) =>
  execFileSync(file, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function verify() {
  if (!existsSync(resolve(source, ".git")))
    throw Error("Source checkout missing. Run the prepare command first.");
  const commit = run("git", ["rev-parse", "HEAD"]);
  if (commit !== lock.commit)
    throw Error("Source revision differs from source.lock.json. No files were reset.");
  const manifest = JSON.parse(readFileSync(resolve(source, "package.json"), "utf8"));
  if (manifest.name !== "n8n-monorepo" || manifest.version !== lock.tag.replace("n8n@", ""))
    throw Error("Unexpected source package");
  return {
    source,
    commit,
    version: manifest.version,
    modifications: run("git", ["status", "--short"]),
    integrated: false,
  };
}
async function prepare() {
  if (!existsSync(source)) {
    await mkdir(dirname(source), { recursive: true });
    const child = spawn(
      "git",
      ["clone", "--depth", "1", "--single-branch", "--branch", lock.tag, lock.repository, source],
      { stdio: "inherit" },
    );
    const code = await new Promise((ok, no) => {
      child.once("error", no);
      child.once("exit", ok);
    });
    if (code !== 0) throw Error("Source clone failed. Existing files were not reset.");
  }
  console.log(JSON.stringify(verify(), null, 2));
}
async function setup(step) {
  verify();
  applySourcePatch();
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw Error(
      "The pinned source needs Node 24. Keep the CRM runtime unchanged; use the isolated build tools.",
    );
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  if (run(pnpm, ["--version"]) !== lock.pnpm) throw Error(`Use pnpm ${lock.pnpm} for this source`);
  const child = spawn(
    pnpm,
    ["agent:setup", step, "--mem", "4096", "--concurrency", "2", "--tail", "25"],
    {
      cwd: source,
      stdio: "inherit",
      env: {
        ...process.env,
        N8N_DIAGNOSTICS_ENABLED: "false",
        N8N_PERSONALIZATION_ENABLED: "false",
        VUE_APP_SALESDESK_INTERNAL: "true",
      },
    },
  );
  const code = await new Promise((ok, no) => {
    child.once("error", no);
    child.once("exit", ok);
  });
  if (code !== 0) process.exitCode = typeof code === "number" ? code : 1;
}
function applySourcePatch() {
  verify();
  const patch = resolve(root, "automation/source.patch");
  try {
    run("git", ["apply", "--reverse", "--check", patch]);
    return;
  } catch {}
  run("git", ["apply", "--check", patch]);
  run("git", ["apply", patch]);
}
try {
  if (command === "prepare") await prepare();
  else if (command === "status") console.log(JSON.stringify(verify(), null, 2));
  else if (command === "patch") {
    applySourcePatch();
    console.log("Salesdesk source patch is applied");
  } else if (["install", "build"].includes(command)) await setup(command);
  else
    throw Error(
      "Use prepare, status, install or build. This tool does not deploy or start an editor.",
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
