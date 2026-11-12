import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

test("Do Not Track numbers block lead creation and import, and can be managed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "salesdesk-dnt-"));
  const port = 3197,
    base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL(".", import.meta.url),
    env: { ...process.env, PORT: String(port), CRM_DB: join(dir, "t.sqlite") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("startup timeout")), 10000);
      child.stdout.on("data", (d) => {
        if (String(d).includes("Salesdesk CRM:")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on("exit", (c) => reject(Error("exited " + c)));
    });
    const req = async (path, method = "GET", body) => {
      const r = await fetch(base + "/api/" + path, {
        method,
        headers: body ? { "Content-Type": "application/json", Origin: base } : {},
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, data: await r.json() };
    };
    let r = await req("dnt", "POST", { numbers: ["+919894817860", "04471074705", "x"], source: "Salesmax" });
    assert.deepEqual([r.status, r.data.added, r.data.invalid.length], [200, 2, 1]);
    r = await req("dnt", "POST", { numbers: ["9894817860"] });
    assert.equal(r.data.existing, 1);
    // Lead creation blocked on any phone formatting
    r = await req("leads", "POST", { name: "Office", phone: "98948 17860" });
    assert.equal(r.status, 422);
    r = await req("leads", "POST", { name: "Ok", phone: "+919000011111" });
    assert.equal(r.status, 200);
    // Import skips DNT numbers
    r = await req("import", "POST", {
      leads: [
        { name: "A", phone: "+914471074705" },
        { name: "B", phone: "+919000022222" },
      ],
    });
    assert.deepEqual(r.data, { added: 1, skipped: 0, dntBlocked: 1 });
    // Admin list + search
    r = await req("dnt?q=4471");
    assert.equal(r.data.total, 1);
    assert.equal(r.data.count, 2);
    // Remove, then creation works
    assert.equal((await req("dnt/remove", "POST", { numbers: ["+919894817860"] })).data.removed, 1);
    r = await req("leads", "POST", { name: "Office", phone: "+919894817860" });
    assert.equal(r.status, 200);
    // Cross-origin writes refused
    const bad = await fetch(base + "/api/dnt", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify({ numbers: ["+919111111111"] }),
    });
    assert.equal(bad.status, 403);
  } finally {
    if (child.exitCode === null) {
      const done = once(child, "exit");
      child.kill("SIGTERM");
      await done;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
