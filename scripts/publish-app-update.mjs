#!/usr/bin/env node
// Prepares a private in-app update for the Salesdesk Android app (see APP_UPDATE.md).
//   node scripts/publish-app-update.mjs <signed.apk> [--notes "What changed"] [--mandatory] [--out dir]
// Reads versionCode / versionName from android-companion/app/build.gradle and writes
// <out>/salesdesk.apk and <out>/latest.json (default out: ./data/app-update/).
// It never uploads anything: copy salesdesk.apk first, then latest.json, to the server folder.
import { copyFile, mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_APK_BYTES, MIN_APK_BYTES, parseLatest } from "../app-update.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

export function readGradleVersion(text) {
  const code = /\bversionCode\s+(\d+)/.exec(text)?.[1];
  const name = /\bversionName\s+['"]([^'"]+)['"]/.exec(text)?.[1];
  if (!code || !name) throw Error("Could not find versionCode / versionName in build.gradle");
  return { versionCode: Number(code), versionName: name };
}

function parseArgs(argv) {
  const out = { apk: "", notes: "", mandatory: false, dir: join(root, "data", "app-update") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--notes") out.notes = argv[++i] ?? "";
    else if (a === "--mandatory") out.mandatory = true;
    else if (a === "--out") out.dir = resolve(argv[++i] ?? "");
    else if (a.startsWith("--")) throw Error(`Unknown option ${a}`);
    else if (!out.apk) out.apk = resolve(a);
    else throw Error(`Unexpected argument ${a}`);
  }
  if (!out.apk) throw Error('Usage: node scripts/publish-app-update.mjs <signed.apk> [--notes ".."] [--mandatory] [--out dir]');
  return out;
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const s = await stat(args.apk);
  if (s.size < MIN_APK_BYTES || s.size > MAX_APK_BYTES) throw Error(`APK must be between 64 KB and 80 MB (it is ${s.size} bytes)`);
  const head = Buffer.alloc(2);
  const fh = await open(args.apk, "r");
  try { await fh.read(head, 0, 2, 0); } finally { await fh.close(); }
  if (head.toString("latin1") !== "PK") throw Error("That file is not an APK (zip)");
  const version = readGradleVersion(await readFile(join(root, "android-companion", "app", "build.gradle"), "utf8"));
  const meta = { ...version, ...(args.notes ? { notes: args.notes } : {}), ...(args.mandatory ? { mandatory: true } : {}) };
  parseLatest(JSON.stringify(meta)); // same strict rules as the server
  await mkdir(args.dir, { recursive: true });
  const apkOut = join(args.dir, "salesdesk.apk");
  await copyFile(args.apk, apkOut + ".tmp");
  await rename(apkOut + ".tmp", apkOut);
  const jsonOut = join(args.dir, "latest.json");
  await writeFile(jsonOut + ".tmp", JSON.stringify(meta, null, 2) + "\n");
  await rename(jsonOut + ".tmp", jsonOut);
  console.log(`Prepared Salesdesk ${meta.versionName} (versionCode ${meta.versionCode})${meta.mandatory ? ", mandatory" : ""}`);
  console.log(`  ${apkOut}  ${s.size} bytes  sha256 ${await sha256(apkOut)}`);
  console.log(`  ${jsonOut}`);
  console.log("Check that the APK is signed with the SAME key as the installed app (apksigner verify --print-certs).");
  console.log("Copy salesdesk.apk first, then latest.json, into the server's app-update folder. No redeploy needed.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
