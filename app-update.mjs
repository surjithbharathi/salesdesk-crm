// Private in-app update feed for the Salesdesk Android app (no Play Store).
// An admin drops two files into one folder on the server:
//   salesdesk.apk  the signed APK (signed with the SAME key as the installed app)
//   latest.json    {versionCode, versionName, notes?, mandatory?}
// The phone asks GET /v1/app/update, and downloads GET /v1/app/update/apk when the feed is newer.
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const MIN_APK_BYTES = 64 * 1024;
export const MAX_APK_BYTES = 80 * 1024 * 1024;
export const MAX_NOTES = 600;
const KEYS = new Set(["versionCode", "versionName", "notes", "mandatory"]);

function invalid(message) {
  const e = new Error("App update is misconfigured: " + message);
  e.status = 503;
  return e;
}

// Strict: anything unexpected is an error, never a guess, so a typo cannot push a wrong update.
export function parseLatest(text) {
  let meta;
  try { meta = JSON.parse(text); } catch { throw invalid("latest.json is not valid JSON"); }
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw invalid("latest.json must be an object");
  for (const key of Object.keys(meta)) if (!KEYS.has(key)) throw invalid(`unknown field "${key}" in latest.json`);
  const { versionCode, versionName, notes = "", mandatory = false } = meta;
  if (!Number.isInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) throw invalid("versionCode must be a whole number from 1");
  if (typeof versionName !== "string" || !/^[0-9A-Za-z][0-9A-Za-z._+-]{0,39}$/.test(versionName)) throw invalid("versionName must be like 0.24.0");
  if (typeof notes !== "string" || notes.length > MAX_NOTES) throw invalid(`notes must be text of at most ${MAX_NOTES} characters`);
  if (typeof mandatory !== "boolean") throw invalid("mandatory must be true or false");
  return { versionCode, versionName, notes: notes.trim(), mandatory };
}

export function createAppUpdate(dir) {
  const metaFile = join(dir, "latest.json");
  const apkFile = join(dir, "salesdesk.apk");
  let cached = null; // {size, mtimeMs, sha256}

  async function apkStat() {
    let s;
    try { s = await stat(apkFile); } catch (e) {
      if (e.code === "ENOENT") throw invalid("salesdesk.apk is missing next to latest.json");
      throw e;
    }
    if (!s.isFile()) throw invalid("salesdesk.apk is not a file");
    if (s.size < MIN_APK_BYTES || s.size > MAX_APK_BYTES) throw invalid(`salesdesk.apk must be between 64 KB and 80 MB (it is ${s.size} bytes)`);
    return s;
  }

  // The checksum is worked out here, never trusted from the metadata, and recomputed whenever the file changes.
  async function checksum(s) {
    if (cached && cached.size === s.size && cached.mtimeMs === s.mtimeMs) return cached.sha256;
    const hash = createHash("sha256");
    let read = 0;
    for await (const chunk of createReadStream(apkFile)) { hash.update(chunk); read += chunk.length; }
    if (read !== s.size) throw invalid("salesdesk.apk changed while it was being read; try again");
    const sha256 = hash.digest("hex");
    cached = { size: s.size, mtimeMs: s.mtimeMs, sha256 };
    return sha256;
  }

  async function readMeta() {
    let text;
    try { text = await readFile(metaFile, "utf8"); } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
    return parseLatest(text);
  }

  return {
    dir,
    async info() {
      const meta = await readMeta();
      if (!meta) return { available: false };
      const s = await apkStat();
      return { available: true, ...meta, size: s.size, sha256: await checksum(s) };
    },
    async apk() {
      const meta = await readMeta();
      if (!meta) return null;
      const s = await apkStat();
      const sha256 = await checksum(s);
      return { size: s.size, sha256, stream: createReadStream(apkFile, { start: 0, end: s.size - 1 }) };
    },
  };
}
