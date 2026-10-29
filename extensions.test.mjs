import { test } from "node:test";
import assert from "node:assert/strict";
import { createExtensions } from "./extensions.mjs";
function fixture() {
  const records = new Map();
  let id = 0;
  const all = (k) => [...records.values()].filter((x) => x.kind === k).map((x) => x.value);
  const get = (k, id) => records.get(k + id)?.value;
  const put = (k, v) => records.set(k + v.id, { kind: k, value: v });
  const ext = createExtensions({
    all,
    get,
    put,
    tx: (fn) => fn(),
    stamp: (p) => ({ ...p, id: String(++id) }),
    log: () => {},
    bad: (m) => {
      throw Error(m);
    },
  });
  put("users", { id: "u", active: true });
  put("lists", { id: "list" });
  put("leads", { id: "l", source: "Web", owner: "", list: "list" });
  return { ext, all, put };
}
test("rules assign once and create system followup", async () => {
  const { ext, all, put } = fixture();
  put("automationRules", {
    id: "r",
    source: "Web",
    enabled: true,
    owner: "u",
    followupHours: 1,
    name: "Web queue",
  });
  let response;
  const run = () =>
    ext.handle(
      { method: "POST" },
      new URL("http://localhost/api/rules/run"),
      async () => ({}),
      (_, v) => (response = v),
    );
  await run();
  assert.deepEqual(response, { assigned: 1, tasks: 1 });
  assert.equal(all("tasks")[0].origin, "System");
  await run();
  assert.deepEqual(response, { assigned: 0, tasks: 0 });
});
test("campaign preparation makes drafts and is idempotent", async () => {
  const { ext, all, put } = fixture();
  put("campaigns", { id: "c", name: "Offer", listId: "list", text: "Hello" });
  const run = () =>
    ext.handle(
      { method: "POST" },
      new URL("http://localhost/api/campaigns/c/prepare"),
      async () => ({}),
      () => {},
    );
  await run();
  await run();
  assert.equal(all("messages").length, 1);
  assert.equal(all("messages")[0].status, "Draft");
});
test("validation rejects invalid references, content and attendance", () => {
  const { ext } = fixture();
  assert.throws(() => ext.validate("messages", { conversationId: "missing", text: "hello" }));
  assert.throws(() => ext.validate("documents", { name: "huge", content: "x".repeat(102401) }));
  assert.throws(() =>
    ext.validate("attendance", {
      userId: "u",
      date: "2026-02-30",
      checkIn: "2026-03-01T00:00:00Z",
    }),
  );
  assert.throws(() =>
    ext.validate("campaigns", { name: "a", listId: "list", text: "x", status: "Prepared" }),
  );
  assert.equal(
    ext.validate("documents", { name: "notes.txt", content: "hello" }).mime,
    "text/plain",
  );
});
test("download uses attachment and sanitized name", async () => {
  const { ext, put } = fixture();
  put("documents", { id: "d", name: 'bad"\r\n.txt', content: "hello" });
  let headers;
  await ext.handle(
    { method: "GET" },
    new URL("http://localhost/api/documents/d/download"),
    null,
    (_, v, h) => {
      assert.equal(v, "hello");
      headers = h;
    },
  );
  assert.equal(headers["Content-Disposition"], 'attachment; filename="bad___.txt"');
});
test("auto replies create local drafts once per event and ignore disabled rules", () => {
  const { ext, put, all } = fixture();
  put("autoReplies", {
    id: "r",
    name: "Welcome",
    trigger: "Lead created",
    text: "Welcome!",
    enabled: true,
  });
  put("autoReplies", {
    id: "disabled",
    name: "Off",
    trigger: "Lead created",
    text: "No",
    enabled: false,
  });
  ext.onEvent("Lead created", { leadId: "l", eventId: "first" });
  ext.onEvent("Lead created", { leadId: "l", eventId: "first" });
  assert.equal(all("messages").length, 1);
  assert.equal(all("messages")[0].status, "Draft");
  assert.equal(all("messages")[0].ruleId, "r");
  ext.onEvent("Lead created", { leadId: "l", eventId: "next" });
  assert.equal(all("messages").length, 2);
});
test("team messages require valid channel membership", () => {
  const { ext, put } = fixture();
  const c = ext.validate("teamChannels", { name: "Sales", memberIds: ["u", "u"] });
  assert.deepEqual(c.memberIds, ["u"]);
  put("teamChannels", { ...c, id: "c" });
  assert.equal(
    ext.validate("teamMessages", { channelId: "c", userId: "u", text: "Hello" }).text,
    "Hello",
  );
  put("users", { id: "other" });
  assert.throws(() =>
    ext.validate("teamMessages", { channelId: "c", userId: "other", text: "No" }),
  );
  assert.throws(() => ext.validate("teamChannels", { name: "Invalid", memberIds: ["missing"] }));
});
test("saved chart definitions validate measures and date windows", () => {
  const { ext } = fixture(),
    defaults = ext.validate("savedReports", { name: "Leads" });
  assert.equal(defaults.entity, "leads");
  assert.equal(defaults.measure, "count");
  assert.equal(defaults.days, 0);
  assert.equal(
    ext.validate("savedReports", {
      name: "Calls",
      entity: "calls",
      groupBy: "outcome",
      measure: "count",
      days: 30,
    }).days,
    30,
  );
  for (const days of [-1, 366, 1.5, "30"])
    assert.throws(() => ext.validate("savedReports", { name: "Bad", days }));
  assert.throws(() => ext.validate("savedReports", { name: "Bad", entity: "users" }));
  assert.throws(() => ext.validate("savedReports", { name: "Bad", measure: "total" }));
  assert.throws(() =>
    ext.validate("savedReports", { name: "Bad", entity: "calls", measure: "value" }),
  );
  assert.throws(() =>
    ext.validate("savedReports", { name: "Bad", entity: "payments", groupBy: "direction" }),
  );
});
test("binary documents require matching signature, extension and size", async () => {
  const { ext, put } = fixture();
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("data"),
  ]).toString("base64");
  const ok = ext.validate("documents", { name: "logo.PNG", mime: "image/png", content: png });
  assert.equal(ok.mime, "image/png");
  assert.throws(() => ext.validate("documents", { name: "logo.png", mime: "application/pdf", content: png }));
  assert.throws(() => ext.validate("documents", { name: "logo.pdf", mime: "image/png", content: png }));
  assert.throws(() => ext.validate("documents", { name: "a.png", mime: "image/png", content: "not base64!" }));
  assert.throws(() => ext.validate("documents", { name: "a.png", mime: "image/png", content: "" }));
  const big = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(524288)]).toString("base64");
  assert.throws(() => ext.validate("documents", { name: "big.pdf", mime: "application/pdf", content: big }));
  assert.throws(() => ext.validate("documents", { name: "x.svg", mime: "image/svg+xml", content: png }));
  put("documents", { id: "b", name: "logo.png", mime: "image/png", content: png });
  let body, headers;
  await ext.handle(
    { method: "GET" },
    new URL("http://localhost/api/documents/b/download"),
    null,
    (_, v, h) => ((body = v), (headers = h)),
  );
  assert.ok(Buffer.isBuffer(body));
  assert.equal(body.toString("base64"), png);
  assert.equal(headers["Content-Type"], "image/png");
});
