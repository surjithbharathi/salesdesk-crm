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
    const secondDeal = await request("deals", "POST", {
      leadId: id,
      title: "Second opportunity",
      owner,
      value: 1000,
      closeDate: "2026-11-02",
      stage: "Proposal",
    });
    assert.equal(secondDeal.status, 200);
    await request("deals/" + deal.id, "PATCH", { stage: "Won" });
    assert.equal((await request("state")).data.leads.find((l) => l.id === id).stage, "Opportunity");
    await request("deals/" + secondDeal.data.id, "PATCH", { stage: "Lost" });
    assert.equal((await request("state")).data.leads.find((l) => l.id === id).disposition, "Won");
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
    const reply = await request("autoReplies", "POST", {
      name: "Conversation welcome",
      trigger: "Conversation opened",
      text: "Welcome — local draft",
      enabled: true,
    });
    assert.equal(reply.status, 200);
    const conversation = await request("conversations", "POST", {
      leadId: id,
      owner,
      subject: "QA enquiry",
      channel: "WhatsApp",
    });
    assert.equal(conversation.status, 200);
    s = (await request("state")).data;
    assert.equal(
      s.messages.filter((m) => m.ruleId === reply.data.id && m.status === "Draft").length,
      1,
    );
    const channel = await request("teamChannels", "POST", {
      name: "Sales team",
      memberIds: [owner],
    });
    assert.equal(channel.status, 200);
    assert.equal(
      (
        await request("teamMessages", "POST", {
          channelId: channel.data.id,
          userId: owner,
          text: "QA handoff",
        })
      ).status,
      200,
    );
    const ticket = await request("tickets", "POST", {
      leadId: id,
      subject: "Service enquiry",
      owner,
      category: "Service",
      priority: "High",
    });
    assert.equal(ticket.status, 200);
    assert.equal(
      (await request("tickets/" + ticket.data.id, "PATCH", { status: "Service Scheduled" })).status,
      200,
    );
    const doc = await request("documents", "POST", {
      leadId: id,
      name: "requirements.txt",
      content: "தமிழ் requirements\nSecond line",
      mime: "text/plain",
    });
    assert.equal(doc.status, 200);
    const download = await fetch(base + "/api/documents/" + doc.data.id + "/download");
    assert.equal(await download.text(), "தமிழ் requirements\nSecond line");
    assert.match(download.headers.get("content-disposition"), /^attachment;/);
    assert.equal(
      (
        await request("attendance", "POST", {
          userId: owner,
          date: "2026-10-22",
          checkIn: "2026-10-22T03:30:00Z",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request("savedReports", "POST", {
          name: "Calls by outcome",
          entity: "calls",
          groupBy: "outcome",
          measure: "count",
          days: 7,
        })
      ).status,
      200,
    );
    assert.equal((await fetch(base + "/csv.js")).status, 200);
    await stop();
    await start();
    s = (await request("state")).data;
    assert.ok(s.leads.some((l) => l.id === id));
    assert.ok(s.payments.some((p) => p.dealId === deal.id));
    assert.equal(s.leads.length, count + 1);
    assert.ok(s.teamMessages.some((m) => m.channelId === channel.data.id));
    assert.equal(s.tickets.find((t) => t.id === ticket.data.id).status, "Service Scheduled");
    assert.ok(s.documents.some((d) => d.id === doc.data.id));
  } finally {
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
});
