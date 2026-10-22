import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

test("CRM lifecycle, transaction rollback, validation, and persistent storage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "salesdesk-test-"));
  const port = 3199,
    base = `http://127.0.0.1:${port}`;
  let child;
  const start = async () => {
    child = spawn(process.execPath, ["server.mjs"], {
      cwd: new URL(".", import.meta.url),
      env: { ...process.env, PORT: String(port), CRM_DB: join(dir, "test.sqlite") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("Server startup timeout")), 10000);
      child.stdout.on("data", (data) => {
        if (String(data).includes("Salesdesk CRM:")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(Error("Server exited " + code));
      });
    });
  };
  const stop = async () => {
    if (child && child.exitCode === null) {
      const done = once(child, "exit");
      child.kill("SIGTERM");
      await done;
    }
  };
  const request = async (path, method = "GET", body, headers = {}) => {
    const response = await fetch(base + "/api/" + path, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  try {
    await start();
    let s = (await request("state")).data;
    assert.equal(s.leads.length, 8);
    const owner = s.users[0].id;
    const created = await request("leads", "POST", {
      name: "QA contact",
      company: "QA business",
      phone: "+919111112222",
      owner,
      source: "Test",
      value: 5000,
    });
    assert.equal(created.status, 200);
    const id = created.data.id;
    assert.equal(
      (
        await request("activities", "POST", {
          leadId: id,
          type: "Call",
          text: "Asked for a quotation",
          outcome: "Interested",
          direction: "Outgoing",
          duration: 125,
        })
      ).status,
      200,
    );
    const task = (
      await request("tasks", "POST", {
        leadId: id,
        owner,
        title: "Send quotation",
        due: new Date(Date.now() + 86400000).toISOString(),
      })
    ).data;
    assert.equal((await request("tasks/" + task.id, "PATCH", { status: "Done" })).status, 200);
    const deal = (
      await request("deals", "POST", {
        leadId: id,
        title: "QA deal",
        owner,
        value: 5000,
        closeDate: "2026-11-01",
        stage: "Proposal",
      })
    ).data;
    await request("deals/" + deal.id, "PATCH", { stage: "Won" });
    assert.equal(
      (
        await request("payments", "POST", {
          dealId: deal.id,
          amount: 5000,
          reference: "QA receipt",
        })
      ).status,
      200,
    );
    s = (await request("state")).data;
    assert.equal(s.leads.find((l) => l.id === id).stage, "Closed");
    assert.equal(s.leads.find((l) => l.id === id).disposition, "Won");
    assert.equal(s.tasks.find((t) => t.id === task.id).status, "Done");
    assert.ok(s.activities.some((a) => a.leadId === id && a.type === "Call"));
    assert.equal((await request("leads/" + id, "PATCH", { stage: "Unknown" })).status, 400);
    assert.equal(
      (
        await request("tasks", "POST", {
          title: "Bad owner",
          owner: "missing",
          due: new Date().toISOString(),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          "leads",
          "POST",
          { name: "Cross-origin" },
          { Origin: "https://untrusted.example" },
        )
      ).status,
      403,
    );
    const count = s.leads.length;
    assert.equal(
      (
        await request("import", "POST", {
          leads: [{ name: "Must roll back", phone: "+919333334444" }, { name: "" }],
        })
      ).status,
      400,
    );
    assert.equal((await request("state")).data.leads.length, count);
    const imported = await request("import", "POST", {
      leads: [
        { name: "Duplicate", phone: "+919111112222" },
        { name: "New import", phone: "+919555556666" },
      ],
    });
    assert.deepEqual(imported.data, { added: 1, skipped: 1 });
    await stop();
    await start();
    s = (await request("state")).data;
    assert.ok(s.leads.some((l) => l.id === id));
    assert.ok(s.payments.some((p) => p.dealId === deal.id));
    assert.equal(s.leads.length, count + 1);
  } finally {
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
});
