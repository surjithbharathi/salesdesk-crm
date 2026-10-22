// Run only against an isolated local test workspace, never a production database.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.env.AUTOMATION_TEST_ORIGIN || "http://localhost:3195";
if (!/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(base))
  throw Error("Use an isolated loopback test workspace");
const password = "LocalWorkflowFixture-Aa1!";
async function request(
  path,
  { method = "GET", body, cookie = "", browserId, expected = 200 } = {},
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: base,
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(browserId ? { "browser-id": browserId } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${text.slice(0, 500)}`);
  return {
    data: text ? JSON.parse(text) : null,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
const status = (await request("/api/auth/status")).data;
const admin = await request(status.configured ? "/api/auth/login" : "/api/auth/bootstrap", {
  method: "POST",
  body: status.configured
    ? { username: "workflow-admin@example.test", password }
    : {
        userId: status.users[0].id,
        username: "workflow-admin@example.test",
        password,
        company: "Workflow test",
      },
});
assert.equal(admin.data.company, "Workflow test", "Use only the test fixture company");
const accounts = (await request("/api/auth/accounts", { cookie: admin.cookie })).data;
const adminId = admin.data.user.id,
  memberId = accounts.users.find((u) => u.id !== adminId).id;
const grant = (userId, enabled) =>
  request("/api/automation/access", {
    method: "POST",
    cookie: admin.cookie,
    body: { userId, enabled },
  });
const browserId = randomUUID();
await grant(adminId, false);
await request("/api/automation/ticket", {
  method: "POST",
  cookie: admin.cookie,
  body: { browserId },
  expected: 403,
});
await grant(adminId, true);
const handoff = (
  await request("/api/automation/ticket", {
    method: "POST",
    cookie: admin.cookie,
    body: { browserId },
  })
).data;
const login = await request("/automation/rest/salesdesk/login", {
  method: "POST",
  cookie: admin.cookie,
  browserId,
  body: { ticket: handoff.ticket },
});
const cookie = admin.cookie + "; " + login.cookie;
const workflow = (
  await request("/automation/rest/workflows", {
    method: "POST",
    cookie,
    browserId,
    body: {
      name: "[Local test] Workflow builder ready",
      settings: { executionOrder: "v1" },
      nodes: [
        {
          id: randomUUID(),
          name: "Manual Trigger",
          type: "n8n-nodes-base.manualTrigger",
          typeVersion: 1,
          position: [0, 0],
          parameters: {},
        },
        {
          id: randomUUID(),
          name: "Edit Fields",
          type: "n8n-nodes-base.set",
          typeVersion: 3.4,
          position: [260, 0],
          parameters: {
            assignments: {
              assignments: [
                {
                  id: randomUUID(),
                  name: "message",
                  value: "Workflow builder ready",
                  type: "string",
                },
              ],
            },
            options: {},
          },
        },
      ],
      connections: {
        "Manual Trigger": { main: [[{ node: "Edit Fields", type: "main", index: 0 }]] },
      },
    },
  })
).data.data;
assert.ok(workflow.id);
const run = (
  await request(`/automation/rest/workflows/${workflow.id}/run`, {
    method: "POST",
    cookie,
    browserId,
    body: { triggerToStartFrom: { name: "Manual Trigger" } },
  })
).data.data;
assert.ok(run.executionId);
let execution;
for (let attempt = 0; attempt < 30; attempt++) {
  execution = (
    await request(`/automation/rest/executions/${run.executionId}`, { cookie, browserId })
  ).data.data;
  if (execution.finished || execution.status === "success" || execution.status === "error") break;
  await new Promise((ok) => setTimeout(ok, 1000));
}
assert.equal(execution.status, "success", JSON.stringify(execution).slice(0, 700));
if (!accounts.accounts.some((u) => u.id === memberId))
  await request("/api/auth/accounts", {
    method: "POST",
    cookie: admin.cookie,
    body: { userId: memberId, username: "workflow-member@example.test", password },
  });
await grant(memberId, true);
const member = await request("/api/auth/login", {
  method: "POST",
  body: { username: "workflow-member@example.test", password },
});
const memberBrowser = randomUUID();
const memberTicket = (
  await request("/api/automation/ticket", {
    method: "POST",
    cookie: member.cookie,
    body: { browserId: memberBrowser },
  })
).data;
const memberLogin = await request("/automation/rest/salesdesk/login", {
  method: "POST",
  cookie: member.cookie,
  browserId: memberBrowser,
  body: { ticket: memberTicket.ticket },
});
const memberCookie = member.cookie + "; " + memberLogin.cookie;
await request(`/automation/rest/workflows/${workflow.id}`, {
  cookie: memberCookie,
  browserId: memberBrowser,
  expected: 403,
});
await grant(adminId, false);
await request(`/automation/rest/workflows/${workflow.id}`, { cookie, browserId, expected: 403 });
const revokedRun = await fetch(`http://127.0.0.1:5681/rest/workflows/${workflow.id}/run`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: login.cookie, "browser-id": browserId },
  body: JSON.stringify({ triggerToStartFrom: { name: "Manual Trigger" } }),
});
assert.equal(
  revokedRun.status,
  403,
  "The engine must also check revocation before a new execution",
);
await grant(adminId, true);
console.log(
  JSON.stringify({
    savedWorkflow: true,
    executionStatus: execution.status,
    crossUserReadDenied: true,
    revokedSessionDenied: true,
    workflowId: workflow.id,
    executionId: run.executionId,
  }),
);
