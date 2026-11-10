import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { createWorkflows } from "./workflows.mjs";

// trigger → (a condition box, continuing on "yes") → actions one after another
function flow(trigger, conditions = [], actions = []) {
  const nodes = [{ id: "t", type: "trigger", x: 0, y: 0, config: trigger }], edges = [];
  let last = "t", port = "out";
  if (conditions.length) { nodes.push({ id: "c", type: "condition", x: 0, y: 100, config: { conditions } }); edges.push({ from: last, port, to: "c" }); last = "c"; port = "yes"; }
  actions.forEach((a, i) => { const id = "a" + i; nodes.push({ id, type: "action", x: 0, y: 200 + i * 100, config: a }); edges.push({ from: last, port, to: id }); last = id; port = "out"; });
  return { nodes, edges };
}
const rule = (name, trigger, conditions, actions) => ({ name, flow: flow(trigger, conditions, actions) });

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))");
  const get = (k, id) => { const r = db.prepare("SELECT body FROM records WHERE kind=? AND id=?").get(k, id); return r && JSON.parse(r.body); };
  const all = (k) => db.prepare("SELECT body FROM records WHERE kind=? ORDER BY rowid").all(k).map((r) => JSON.parse(r.body));
  const put = (k, v) => db.prepare("INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body").run(k, v.id, JSON.stringify(v));
  const tx = (fn) => { db.exec("BEGIN"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } };
  let clock = Date.UTC(2026, 10, 10, 6, 0);
  const iso = () => new Date(clock).toISOString();
  const stamp = (v) => ({ id: randomUUID(), createdAt: iso(), updatedAt: iso(), ...v });
  const log = (leadId, type, text, extra = {}) => { const a = stamp({ leadId, type, text, ...extra }); put("activities", a); return a; };
  const sent = [];
  const people = [{ id: "u1", name: "Priya" }, { id: "u2", name: "Arjun" }, { id: "u3", name: "Meera" }];
  const posted = [];
  const post = async (url, body) => { posted.push({ url, body }); if (url.includes("broken")) throw new Error("the API answered 500"); };
  const wf = createWorkflows({ db, get, put, stamp, tx, log, users: () => people, sendWhatsApp: async (leadId, m) => { sent.push({ leadId, ...m }); }, post, now: () => clock });
  const lead = (v) => { const l = stamp({ name: "Lead", phone: "", stage: "New", owner: "", source: "IndiaMART", city: "Coimbatore", ...v }); put("leads", l); return l; };
  return { db, get, all, put, wf, lead, log, sent, posted, advance: (ms) => { clock += ms; }, iso };
}

test("rules are checked: name, trigger, conditions and actions", () => {
  const { wf } = setup();
  assert.throws(() => wf.create({ trigger: { type: "lead_created" }, actions: [{ type: "note", text: "x" }] }), /name/);
  assert.throws(() => wf.create(rule("a", { type: "nope" }, [], [{ type: "note", text: "x" }])), /when/);
  assert.throws(() => wf.create(rule("a", { type: "lead_created" }, [], [])), /at least one action/);
  assert.throws(() => wf.create(rule("a", { type: "lead_created" }, [], [{ type: "assign", to: "nobody" }])), /who gets/);
  assert.throws(() => wf.create(rule("a", { type: "lead_created" }, [], [{ type: "assign", to: "round_robin", users: ["u1"] }])), /two people/);
  assert.throws(() => wf.create(rule("a", { type: "no_activity", days: 0 }, [], [{ type: "note", text: "x" }])), /1 to 365/);
  assert.throws(() => wf.create(rule("a", { type: "lead_created" }, [{ field: "city", op: "is", value: "" }], [{ type: "note", text: "x" }])), /value/);
  const ok = wf.create(rule("New IndiaMART leads", { type: "lead_created" }, [{ field: "source", op: "is", value: "IndiaMART" }], [{ type: "task", title: "Call {name}", hours: 1 }]), "u1");
  assert.equal(ok.enabled, true);
  assert.equal(wf.list().rules.length, 1);
  wf.update(ok.id, { ...ok, enabled: false });
  assert.equal(wf.list().rules[0].enabled, false);
  wf.remove(ok.id);
  assert.equal(wf.list().rules.length, 0);
});

test("the first run only takes a snapshot; later new leads are assigned in turn, given a task and a WhatsApp", async () => {
  const s = setup();
  s.lead({ name: "Old lead" });
  s.wf.create(rule("Round robin", { type: "lead_created" }, [{ field: "source", op: "is", value: "indiamart" }], [{ type: "assign", to: "round_robin", users: ["u1", "u2"] }, { type: "task", title: "Call {name} from {city}", hours: 2 }, { type: "whatsapp", text: "Hello {name}, this is {owner} from Devi Industries" }]));
  await s.wf.tick();
  assert.equal(s.all("tasks").length, 0, "history does not fire");
  const a = s.lead({ name: "Ravi" }), b = s.lead({ name: "Kumar" }), c = s.lead({ name: "Web", source: "Website" });
  await s.wf.tick();
  assert.equal(s.get("leads", a.id).owner, "u1");
  assert.equal(s.get("leads", b.id).owner, "u2");
  assert.equal(s.get("leads", c.id).owner, "", "condition not met");
  const tasks = s.all("tasks");
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].title, "Call Ravi from Coimbatore");
  assert.equal(tasks[0].owner, "u1");
  assert.equal(tasks[0].origin, "Workflow");
  assert.deepEqual(s.sent.map((m) => m.text), ["Hello Ravi, this is Priya from Devi Industries", "Hello Kumar, this is Arjun from Devi Industries"]);
  await s.wf.tick();
  assert.equal(s.all("tasks").length, 2, "each event runs once");
  const runs = s.wf.list().runs;
  assert.equal(runs.length, 2);
  assert.ok(runs.every((r) => r.ok));
});

test("an old lead arriving late (a TeleCRM full read) does not count as new", async () => {
  const s = setup();
  s.wf.create(rule("Note", { type: "lead_created" }, [], [{ type: "note", text: "Welcome" }]));
  await s.wf.tick();
  s.lead({ name: "From 2024", createdAt: "2024-01-01T00:00:00.000Z" });
  await s.wf.tick();
  assert.equal(s.all("activities").length, 0);
});

test("a stage change to a chosen step fires; a missed call fires", async () => {
  const s = setup();
  const l = s.lead({ name: "Selvam", owner: "u3" });
  s.wf.create(rule("Quotation follow-up", { type: "stage_changed", to: "Quotation Shared" }, [], [{ type: "task", title: "Ask about the quotation", hours: 48, owner: "lead_owner" }]));
  s.wf.create(rule("Missed call", { type: "call_missed" }, [], [{ type: "task", title: "Call back {name}", hours: 0 }]));
  await s.wf.tick();
  s.put("leads", { ...s.get("leads", l.id), deal: "Requirement Discussion", stage: "Prospecting" });
  await s.wf.tick();
  assert.equal(s.all("tasks").length, 0, "other step");
  s.put("leads", { ...s.get("leads", l.id), deal: "Quotation Shared", stage: "Quotation given", updatedAt: "x" });
  s.log(l.id, "Call", "Missed", { direction: "Missed", occurredAt: s.iso() });
  await s.wf.tick();
  const titles = s.all("tasks").map((t) => t.title).sort();
  assert.deepEqual(titles, ["Ask about the quotation", "Call back Selvam"]);
  assert.ok(s.all("tasks").every((t) => t.owner === "u3"));
});

test("a stage action moves the lead; two rules cannot bounce a lead forever", async () => {
  const s = setup();
  const l = s.lead({ name: "Loop" });
  s.wf.create(rule("A", { type: "stage_changed", to: "Interested Customer" }, [], [{ type: "stage", stage: "Requirement Discussion" }]));
  s.wf.create(rule("B", { type: "stage_changed", to: "Requirement Discussion" }, [], [{ type: "stage", stage: "Interested Customer" }]));
  await s.wf.tick();
  s.put("leads", { ...s.get("leads", l.id), deal: "Interested Customer", stage: "Opportunity", updatedAt: "1" });
  for (let i = 0; i < 20; i++) { await s.wf.tick(); s.advance(1000); }
  const runs = s.wf.list().runs.filter((r) => r.leadId === l.id);
  assert.ok(runs.length <= 6, `stopped after ${runs.length} runs`);
});

test("no activity for N days fires once for leads that just went quiet, not for long-dead ones", async () => {
  const s = setup();
  const fresh = s.lead({ name: "Quiet" });
  s.log(fresh.id, "Call", "talked", { occurredAt: s.iso() });
  const dead = s.lead({ name: "Dead", createdAt: "2025-01-01T00:00:00.000Z" });
  const won = s.lead({ name: "Won", stage: "Closed", deal: "Won" });
  s.wf.create(rule("Nudge", { type: "no_activity", days: 3 }, [], [{ type: "task", title: "Check on {name}", hours: 0 }]));
  await s.wf.tick();
  s.advance(3.5 * 86400000);
  await s.wf.tick();
  assert.deepEqual(s.all("tasks").map((t) => t.title), ["Check on Quiet"]);
  s.advance(20 * 60000);
  await s.wf.tick();
  assert.equal(s.all("tasks").length, 1, "once per quiet spell");
  assert.ok(dead && won);
});

test("a WhatsApp that cannot be sent is noted on the lead and the run", async () => {
  const s = setup();
  const wf = createWorkflows({ db: s.db, get: s.get, put: s.put, stamp: (v) => ({ id: randomUUID(), createdAt: new Date().toISOString(), ...v }), tx: (f) => f(), log: s.log, users: () => [], sendWhatsApp: async () => { throw new Error("This lead has no valid phone number"); } });
  wf.create(rule("Hi", { type: "lead_created" }, [], [{ type: "whatsapp", text: "Hi" }]));
  await wf.tick();
  const l = s.lead({ name: "No phone", createdAt: new Date().toISOString() });
  await wf.tick();
  const run = wf.list().runs[0];
  assert.equal(run.ok, false);
  assert.match(run.done.join(), /no valid phone/);
  assert.ok(s.all("activities").some((a) => a.leadId === l.id && /WhatsApp not sent/.test(a.text)));
});

test("a condition box sends a lead down its yes or no line", async () => {
  const s = setup();
  s.wf.create({ name: "Split", flow: { nodes: [
    { id: "t", type: "trigger", config: { type: "lead_created" } },
    { id: "c", type: "condition", config: { match: "any", conditions: [{ field: "city", op: "is", value: "Erode" }, { field: "city", op: "is", value: "Salem" }] } },
    { id: "yes", type: "action", config: { type: "assign", to: "u1" } },
    { id: "no", type: "action", config: { type: "assign", to: "u2" } },
  ], edges: [{ from: "t", to: "c" }, { from: "c", port: "yes", to: "yes" }, { from: "c", port: "no", to: "no" }] } });
  await s.wf.tick();
  const salem = s.lead({ name: "S", city: "Salem" }), chennai = s.lead({ name: "C", city: "Chennai" });
  await s.wf.tick();
  assert.equal(s.get("leads", salem.id).owner, "u1");
  assert.equal(s.get("leads", chennai.id).owner, "u2");
});

test("a wait box holds the flow and carries on when it is due; turning the flow off stops it", async () => {
  const s = setup();
  const waitFlow = (name) => ({ name, flow: { nodes: [
    { id: "t", type: "trigger", config: { type: "lead_created" } },
    { id: "a1", type: "action", config: { type: "note", text: "Welcome {name}" } },
    { id: "w", type: "wait", config: { hours: 24 } },
    { id: "a2", type: "action", config: { type: "task", title: "Day 2: call {name}", hours: 0 } },
  ], edges: [{ from: "t", to: "a1" }, { from: "a1", to: "w" }, { from: "w", to: "a2" }] } });
  const r = s.wf.create(waitFlow("Drip"));
  await s.wf.tick();
  const l = s.lead({ name: "Mani" });
  await s.wf.tick();
  assert.ok(s.all("activities").some((a) => a.type === "Note" && a.text === "Welcome Mani"));
  assert.equal(s.all("tasks").length, 0);
  assert.equal(s.wf.list().waiting, 1);
  s.advance(23 * 3600000); await s.wf.tick();
  assert.equal(s.all("tasks").length, 0, "not yet");
  s.advance(2 * 3600000); await s.wf.tick();
  assert.deepEqual(s.all("tasks").map((t) => t.title), ["Day 2: call Mani"]);
  assert.equal(s.wf.list().waiting, 0);
  assert.match(s.wf.list().runs[0].done.join(), /note added.*waiting until.*task added/);
  // the same flow, turned off while a lead waits
  const second = s.lead({ name: "Velu" });
  await s.wf.tick();
  s.wf.update(r.id, { ...waitFlow("Drip"), enabled: false });
  s.advance(25 * 3600000); await s.wf.tick();
  assert.equal(s.all("tasks").length, 1);
  assert.ok(second);
});

test("loops, a second trigger and lines into the trigger are refused", () => {
  const { wf } = setup();
  const base = [{ id: "t", type: "trigger", config: { type: "lead_created" } }, { id: "a", type: "action", config: { type: "note", text: "x" } }, { id: "b", type: "action", config: { type: "note", text: "y" } }];
  assert.throws(() => wf.create({ name: "x", flow: { nodes: base, edges: [{ from: "t", to: "a" }, { from: "a", to: "b" }, { from: "b", to: "a" }] } }), /loop/);
  assert.throws(() => wf.create({ name: "x", flow: { nodes: [...base, { id: "t2", type: "trigger", config: { type: "call_missed" } }], edges: [{ from: "t", to: "a" }] } }), /exactly one trigger/);
  assert.throws(() => wf.create({ name: "x", flow: { nodes: base, edges: [{ from: "t", to: "a" }, { from: "a", to: "t" }] } }), /back into the trigger/);
  assert.throws(() => wf.create({ name: "x", flow: { nodes: base, edges: [] } }), /at least one action/);
  assert.throws(() => wf.create({ name: "x", flow: { nodes: base, edges: [{ from: "t", port: "yes", to: "a" }] } }), /wrong side/);
});

test("new boxes are checked: field trigger, field update, notify, webhook address", () => {
  const { wf } = setup();
  const note = [{ type: "note", text: "x" }];
  assert.throws(() => wf.create(rule("a", { type: "field_changed", field: "" }, [], note)), /field to watch/);
  assert.throws(() => wf.create(rule("a", { type: "field_changed", field: "stage" }, [], note)), /stage changes/);
  assert.throws(() => wf.create(rule("a", { type: "owner_changed", to: "ghost" }, [], note)), /Unknown person/);
  assert.throws(() => wf.create(rule("a", { type: "rating_changed", to: 9 }, [], note)), /0 to 5/);
  assert.throws(() => wf.create(rule("a", { type: "lead_created" }, [{ field: "value", op: "more", value: "lots" }], note)), /number/);
  assert.throws(() => wf.create(rule("a", { type: "lead_created" }, [], [{ type: "field", field: "owner", value: "x" }])), /field to update/);
  assert.throws(() => wf.create(rule("a", { type: "lead_created" }, [], [{ type: "field", field: "email", value: "not-mail" }])), /valid email/);
  assert.throws(() => wf.create(rule("a", { type: "lead_created" }, [], [{ type: "notify", to: "lead_owner", text: "" }])), /Write the notification/);
  for (const url of ["http://n8n.example.com/hook", "https://localhost/hook", "https://10.0.0.5/hook", "https://user:pw@n8n.example.com/x", "not a url"])
    assert.throws(() => wf.create(rule("a", { type: "lead_created" }, [], [{ type: "webhook", url }])), /API address/, url);
  const ok = wf.create(rule("a", { type: "field_changed", field: "tc:state", to: "Kerala" }, [{ field: "tc:requirement", op: "contains", value: "lathe" }], [{ type: "webhook", url: "https://n8n.example.com/webhook/lead" }]));
  assert.equal(ok.trigger.field, "tc:state");
});

test("owner, rating and field changes fire once, only after the flow was on, and only for the chosen value", async () => {
  const s = setup();
  const l = s.lead({ name: "Ravi", owner: "u1", telecrm: { rating: 2, fields: { state: "Tamil Nadu" } } });
  s.wf.create(rule("To Arjun", { type: "owner_changed", to: "u2" }, [], [{ type: "note", text: "now with {owner}" }]));
  s.wf.create(rule("Hot", { type: "rating_changed", to: "5" }, [], [{ type: "task", title: "Hot lead {name}", hours: 0 }]));
  s.wf.create(rule("Kerala", { type: "field_changed", field: "tc:state", to: "kerala" }, [], [{ type: "notify", to: "lead_owner", text: "{name} is from Kerala" }]));
  s.wf.create(rule("City", { type: "field_changed", field: "city" }, [], [{ type: "note", text: "city is {city}" }]));
  await s.wf.tick(); // snapshot of positions
  await s.wf.tick(); // first sight of the watched fields: remembered, nothing fires
  assert.equal(s.all("activities").length, 0);
  s.put("leads", { ...s.get("leads", l.id), owner: "u3", updatedAt: "a" });
  await s.wf.tick();
  assert.equal(s.all("activities").filter((a) => a.text.includes("now with")).length, 0, "u3 is not the chosen person");
  s.put("leads", { ...s.get("leads", l.id), owner: "u2", city: "Madurai", telecrm: { rating: 3, fields: { state: "Kerala" } }, updatedAt: "b" });
  await s.wf.tick();
  await s.wf.tick();
  const texts = s.all("activities").map((a) => a.text);
  assert.equal(texts.filter((t) => t.includes("now with Arjun")).length, 1);
  assert.equal(texts.filter((t) => t.includes("city is Madurai")).length, 1);
  assert.equal(s.all("tasks").length, 0, "rating 3 is not 5");
  const n = s.all("notifications");
  assert.equal(n.length, 1);
  assert.equal(n[0].userId, "u2");
  assert.equal(n[0].text, "Ravi is from Kerala");
  s.put("leads", { ...s.get("leads", l.id), telecrm: { rating: 5, fields: { state: "Kerala" } }, updatedAt: "c" });
  await s.wf.tick();
  assert.equal(s.all("tasks").length, 1);
});

test("a field watched only after it changed does not fire for the old change", async () => {
  const s = setup();
  const l = s.lead({ city: "Salem" });
  await s.wf.tick();
  s.put("leads", { ...s.get("leads", l.id), city: "Erode", updatedAt: "x" });
  s.wf.create(rule("City", { type: "field_changed", field: "city" }, [], [{ type: "note", text: "moved" }]));
  await s.wf.tick();
  assert.equal(s.all("activities").length, 0);
});

test("update a field, cancel tasks, call an API, numbers in conditions", async () => {
  const s = setup();
  await s.wf.tick();
  s.put("tasks", { id: "t1", leadId: "x", title: "manual", status: "Open" });
  s.wf.create(rule("Big", { type: "lead_created" }, [{ field: "value", op: "more", value: "100000" }], [
    { type: "field", field: "source", value: "Big order ({city})" },
    { type: "task", title: "Call {name}", hours: 1 },
    { type: "cancel_tasks", which: "workflow" },
    { type: "webhook", url: "https://n8n.example.com/webhook/big" },
    { type: "webhook", url: "https://broken.example.com/hook" },
  ]));
  const big = s.lead({ name: "Big", value: 250000, phone: "+919800000001" }), small = s.lead({ name: "Small", value: 5000 });
  s.put("tasks", { id: "t2", leadId: big.id, title: "manual", status: "Open" });
  await s.wf.tick();
  assert.equal(s.get("leads", big.id).source, "Big order (Coimbatore)");
  assert.equal(s.get("leads", small.id).source, "IndiaMART");
  const tasks = s.all("tasks").filter((t) => t.leadId === big.id);
  assert.equal(tasks.find((t) => t.origin === "Workflow").status, "Done", "the workflow's own task is cancelled");
  assert.equal(tasks.find((t) => t.id === "t2").status, "Open", "a person's task is kept");
  assert.equal(s.posted.length, 2);
  assert.equal(s.posted[0].body.lead.name, "Big");
  assert.equal(s.posted[0].body.lead.phone, "+919800000001");
  assert.equal(s.posted[0].body.event, "lead_created");
  const run = s.wf.list().runs.find((r) => r.leadId === big.id);
  assert.equal(run.ok, false);
  assert.ok(run.done.includes("API called"));
  assert.ok(run.done.some((d) => d.startsWith("API call failed: the API answered 500")));
});

test("a test run says what each box would do and changes nothing", async () => {
  const s = setup();
  const l = s.lead({ name: "Ravi", owner: "u1", value: 500000, phone: "+919800000002" });
  const input = { flow: {
    nodes: [
      { id: "t", type: "trigger", x: 0, y: 0, config: { type: "lead_created" } },
      { id: "c", type: "condition", x: 0, y: 0, config: { conditions: [{ field: "value", op: "more", value: "100000" }] } },
      { id: "a", type: "action", x: 0, y: 0, config: { type: "assign", to: "u2" } },
      { id: "n", type: "action", x: 0, y: 0, config: { type: "note", text: "small one" } },
      { id: "w", type: "wait", x: 0, y: 0, config: { hours: 24 } },
      { id: "h", type: "action", x: 0, y: 0, config: { type: "webhook", url: "https://n8n.example.com/x" } },
    ],
    edges: [{ from: "t", port: "out", to: "c" }, { from: "c", port: "yes", to: "a" }, { from: "c", port: "no", to: "n" }, { from: "a", port: "out", to: "w" }, { from: "w", port: "out", to: "h" }],
  } };
  const r = s.wf.dryRun(input, l.id);
  assert.equal(r.steps.c.text, "Yes: the lead passes");
  assert.equal(r.steps.a.text, "Would assign to Arjun");
  assert.equal(r.steps.n, undefined, "the no branch is not taken");
  assert.match(r.steps.h.text, /n8n\.example\.com/);
  assert.ok(r.lines.includes("c:yes:a"));
  assert.equal(s.get("leads", l.id).owner, "u1", "nothing changed");
  assert.equal(s.posted.length, 0, "no API call in a test");
  assert.equal(s.all("activities").length, 0);
  assert.throws(() => s.wf.dryRun(input, "nope"), /lead to test/);
});

test("a field changed by an import a moment ago starts nothing; a later change by a person does", async () => {
  const s = setup();
  const l = s.lead({ source: "Excel" });
  s.wf.create(rule("Source", { type: "field_changed", field: "source" }, [], [{ type: "note", text: "source now {source}" }]));
  await s.wf.tick();
  await s.wf.tick();
  s.put("leads", { ...s.get("leads", l.id), source: "IndiaMART", importTouch: s.iso(), updatedAt: s.iso() });
  await s.wf.tick();
  assert.equal(s.all("activities").length, 0);
  s.advance(3600000);
  s.put("leads", { ...s.get("leads", l.id), source: "TradeIndia", updatedAt: s.iso() });
  await s.wf.tick();
  assert.equal(s.all("activities").filter((a) => a.text === "source now TradeIndia").length, 1);
});

test("a flow can check state and language and route a lead to the right people", async () => {
  const s = setup();
  await s.wf.tick();
  s.wf.create(rule("Tamil leads", { type: "lead_created" }, [{ field: "language", op: "is", value: "Tamil" }], [{ type: "assign", to: "round_robin", users: ["u1", "u3"] }]));
  s.wf.create(rule("Fix state", { type: "lead_created" }, [{ field: "state", op: "is_empty" }], [{ type: "field", field: "state", value: "karnataka" }]));
  const a = s.lead({ state: "Tamil Nadu", language: "Tamil" }), b = s.lead({ state: "Kerala", language: "Malayalam" }), c = s.lead({});
  await s.wf.tick();
  assert.equal(s.get("leads", a.id).owner, "u1");
  assert.equal(s.get("leads", b.id).owner, "");
  assert.deepEqual([s.get("leads", c.id).state, s.get("leads", c.id).language, s.get("leads", c.id).languageGuess], ["Karnataka", "Kannada", true]);
});
