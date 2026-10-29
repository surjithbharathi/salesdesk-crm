import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { importLegacy } from "./legacy-import.mjs";

async function start(file, port, env = {}) {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL(".", import.meta.url),
    env: { ...process.env, CRM_DB: file, PORT: String(port), MOBILE_PORT: String(port + 1), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("server timeout: " + stderr)), 10000);
    child.stdout.on("data", (d) => String(d).includes("Salesdesk CRM:") && (clearTimeout(timer), resolve()));
    child.once("exit", (code) => reject(Error(`server exited ${code}: ${stderr}`)));
  });
  return child;
}
const stop = async (child) => {
  if (child.exitCode === null && child.signalCode === null) {
    const done = once(child, "exit");
    child.kill("SIGTERM");
    await done;
  }
};

test("v2 API: paging, detail, dashboard, source report, writes, member scope", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "salesdesk-v2-"));
  const file = join(dir, "crm.sqlite");
  const port = 3293, base = `http://127.0.0.1:${port}`;
  let server;
  t.after(async () => {
    if (server) await stop(server);
    await rm(dir, { recursive: true, force: true });
  });
  // 1) the old server creates the demo database; 2) v2 is off, so /api/v2 does not exist
  server = await start(file, port);
  assert.equal((await fetch(base + "/api/v2/meta")).status, 404);
  const legacy = await (await fetch(base + "/api/state")).json();
  const users = legacy.users;
  await stop(server);
  // 3) migrate + import a copy of that data, then start with ENABLE_V2
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys=ON");
  const { migrate } = await import("./db-migrate.mjs");
  const { fileURLToPath } = await import("node:url");
  migrate(db, fileURLToPath(new URL("./migrations/", import.meta.url)));
  const report = importLegacy(db, { dryRun: false });
  assert.equal(report.verification.ok, true);
  db.close();
  server = await start(file, port, { ENABLE_V2: "true" });
  const get = async (path, headers = {}) => {
    const r = await fetch(base + "/api/v2" + path, { headers });
    return { status: r.status, data: await r.json() };
  };
  const meta = await get("/meta");
  assert.equal(meta.status, 200);
  assert.equal(meta.data.statuses.length, 17);
  const first = await get("/leads?limit=3");
  assert.equal(first.data.total, legacy.leads.length);
  assert.equal(first.data.items.length, 3);
  const second = await get("/leads?limit=3&cursor=" + encodeURIComponent(first.data.nextCursor));
  assert.equal(second.data.items.some((l) => first.data.items.some((f) => f.id === l.id)), false);
  const id = first.data.items[0].id;
  const detail = await get("/leads/" + id);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.id, id);
  assert.equal((await get("/leads/" + id + "/activities")).status, 200);
  assert.equal((await get("/leads/missing")).status, 404);
  assert.equal((await get("/leads?cursor=garbage")).status, 400);
  assert.equal((await get("/dashboard")).data.byStatus.reduce((s, r) => s + r.count, 0), legacy.leads.length);
  const sources = await get("/reports/sources?from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z");
  assert.equal(sources.status, 200);
  assert.equal(sources.data.reconciled, true);
  assert.equal(sources.data.coverage.leads, legacy.leads.length);
  assert.equal((await get("/reports/sources")).status, 400);
  assert.equal((await get("/nothing")).status, 404);
  const write = await fetch(base + "/api/v2/leads", { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: "{}" });
  assert.equal(write.status, 400); // writes are open now; an empty lead is refused by the CRM rules, not by the API
  // legacy endpoints are untouched
  assert.equal((await (await fetch(base + "/api/state")).json()).leads.length, legacy.leads.length);

  // 4) members only ever see their own leads, and cannot read other people's detail
  const owner = users[0].id, member = users[1].id;
  const boot = await fetch(base + "/api/auth/bootstrap", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ userId: owner, username: "admin@example.test", password: "synthetic-password-123", company: "Test" }),
  });
  assert.equal(boot.status, 200);
  const adminCookie = boot.headers.get("set-cookie").split(";")[0];
  await fetch(base + "/api/auth/accounts", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: base, Cookie: adminCookie },
    body: JSON.stringify({ userId: member, username: "member@example.test", password: "synthetic-password-123" }),
  });
  const login = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ username: "member@example.test", password: "synthetic-password-123" }),
  });
  const memberCookie = login.headers.get("set-cookie").split(";")[0];
  assert.equal((await get("/leads", {})).status, 401); // login now required
  const mine = await get("/leads?owner=" + owner, { Cookie: memberCookie }); // asking for someone else's is ignored
  assert.ok(mine.data.total > 0);
  assert.ok(mine.data.items.every((l) => l.owner_id === member));
  assert.equal(mine.data.total, legacy.leads.filter((l) => l.owner === member).length);
  const others = legacy.leads.find((l) => l.owner === owner);
  assert.equal((await get("/leads/" + others.id, { Cookie: memberCookie })).status, 404);
  assert.equal((await get("/leads/" + others.id, { Cookie: adminCookie })).status, 200);
  const adminAll = await get("/leads", { Cookie: adminCookie });
  assert.equal(adminAll.data.total, legacy.leads.length);

  // 5) writes: same-origin and signed in; callers only on their own leads
  const post = (path, cookie, payload, origin = base) =>
    fetch(base + "/api/v2" + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(payload) });
  const own = legacy.leads.find((l) => l.owner === member);
  assert.equal((await post("/leads/" + own.id + "/notes", null, { text: "x" })).status, 401);
  assert.equal((await post("/leads/" + own.id + "/notes", memberCookie, { text: "x" }, "http://evil.example")).status, 403);
  assert.equal((await post("/leads/" + others.id + "/notes", memberCookie, { text: "x" })).status, 404);
  const noted = await post("/leads/" + own.id + "/notes", memberCookie, { text: "Called, wants 3-phase" });
  assert.equal(noted.status, 200);
  const timeline = await get("/leads/" + own.id + "/activities", { Cookie: memberCookie });
  assert.equal(timeline.data.items[0].text, "Called, wants 3-phase");
  const work = await get("/leads/" + own.id + "/work", { Cookie: memberCookie });
  assert.equal(work.status, 200);
  assert.ok(Array.isArray(work.data.calls) && Array.isArray(work.data.tasks));
});

test("the new web app is served under /next/ without exposing other files", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "salesdesk-next-"));
  const file = join(dir, "crm.sqlite");
  const port = 3291, base = `http://127.0.0.1:${port}`;
  const server = await start(file, port);
  t.after(async () => {
    await stop(server);
    await rm(dir, { recursive: true, force: true });
  });
  const redirect = await fetch(base + "/next", { redirect: "manual" });
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get("location"), "/next/");
  // Path traversal attempts must never reach files outside web/dist.
  for (const path of ["/next/../server.mjs", "/next/%2e%2e/server.mjs", "/next/..%2fserver.mjs", "/next/assets/../../package.json", "/next/%00", "/next/x.mjs"]) {
    const response = await fetch(base + path);
    const body = await response.text();
    assert.ok(response.status === 404 || response.status === 400, `${path} -> ${response.status}`);
    assert.ok(!body.includes("createServer") && !body.includes('"name": "salesdesk-crm"'), `${path} leaked a file`);
  }
  // Either the built app or a clear "not built" message, never a crash.
  const index = await fetch(base + "/next/");
  assert.ok([200, 404].includes(index.status));
  if (index.status === 404) assert.match(await index.text(), /npm run web:build/);
});
