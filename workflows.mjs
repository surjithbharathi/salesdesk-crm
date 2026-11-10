// Workflows: flows that act on leads by themselves. A flow is a small graph drawn in Settings: one trigger box, then condition
// boxes (yes / no branches), wait boxes and action boxes joined by lines.
// The engine looks at the database every 30 seconds instead of hooking every place that writes a lead (the screens, the phone app,
// TeleCRM, IndiaMART, Meta, WhatsApp), so a lead from anywhere is covered. It remembers how far it has read (rowid cursors) and each
// lead's last stage, so a restart neither misses nor repeats events. The first run only takes that snapshot: flows never fire for
// history from before the engine was switched on. A wait is saved as a job and the flow carries on from there when it is due.
import { PIPELINE } from "./pipeline.mjs";

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const TRIGGERS = {
  lead_created: "A new lead comes in",
  stage_changed: "A lead's stage changes",
  call_missed: "A call from a lead is missed",
  no_activity: "A lead has no activity for some days",
};
export const FIELDS = { source: "Source", city: "City", owner: "Owner", stage: "Stage", company: "Company", name: "Name" };
export const OPS = { is: "is", is_not: "is not", contains: "contains", is_empty: "is empty", not_empty: "is not empty" };
export const ACTIONS = { assign: "Assign the lead", stage: "Change the stage", task: "Create a follow-up task", whatsapp: "Send a WhatsApp message", note: "Add a note" };
const STAGES = ["New", "Prospecting", "Opportunity", "Quotation given", "Closed", ...PIPELINE.map((p) => p.name)];
const FRESH_MS = 2 * 86400000; // events older than this (history arriving late, e.g. a TeleCRM full read) never fire
const QUIET_WINDOW_DAYS = 3; // "no activity for N days" fires for leads that went quiet N to N+3 days ago, not for years-old leads
const PER_LEAD_HOUR = 3; // a flow starts for one lead at most this often per hour, so two flows cannot ping-pong a stage forever
const MAX_EVENTS = 300; // per tick; a flood beyond this (a bulk import) is skipped and reported, not sent as hundreds of messages
const MAX_STEPS = 60; // boxes one run may pass through
const MAX_NODES = 40, MAX_EDGES = 80;
const PORTS = { trigger: ["out"], condition: ["yes", "no"], wait: ["out"], action: ["out"] };

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const stageOf = (l) => l.deal || l.stage || "New";
const coord = (v) => Math.max(0, Math.min(4000, Math.round(Number(v) || 0)));

export function createWorkflows({ db, get, put, stamp, tx, log, users, sendWhatsApp = async () => fail("WhatsApp gateway is not connected"), now = () => Date.now(), report = () => {} }) {
  const rules = () => db.prepare("SELECT body FROM records WHERE kind='workflows' ORDER BY rowid").all().map((r) => JSON.parse(r.body));
  const userIds = () => new Set(users().map((u) => u.id));
  const userName = (id) => users().find((u) => u.id === id)?.name || "";

  // ---- checking what an admin drew ----
  function cleanTrigger(t = {}) {
    if (!TRIGGERS[t.type]) fail("Choose when the workflow runs");
    const trigger = { type: t.type };
    if (t.type === "stage_changed") {
      trigger.to = str(t.to, 80);
      trigger.from = str(t.from, 80);
      for (const s of [trigger.to, trigger.from]) if (s && !STAGES.includes(s)) fail("Unknown stage " + s);
    }
    if (t.type === "no_activity") {
      trigger.days = Number(t.days);
      if (!Number.isInteger(trigger.days) || trigger.days < 1 || trigger.days > 365) fail("Days without activity must be 1 to 365");
    }
    return trigger;
  }
  function cleanConditions(c = {}) {
    const ids = userIds();
    const list = (Array.isArray(c.conditions) ? c.conditions : []).slice(0, 10).map((x) => {
      if (!FIELDS[x.field] || !OPS[x.op]) fail("Each condition needs a field and a test");
      const blank = ["is_empty", "not_empty"].includes(x.op), value = blank ? "" : str(x.value, 200);
      if (!blank && !value) fail(`Fill in the value for "${FIELDS[x.field]}"`);
      if (x.field === "owner" && value && !ids.has(value)) fail("Unknown person in a condition");
      return { field: x.field, op: x.op, value };
    });
    if (!list.length) fail("A condition box needs at least one test");
    return { match: c.match === "any" ? "any" : "all", conditions: list };
  }
  function cleanAction(a = {}) {
    const ids = userIds();
    if (a.type === "assign") {
      const to = a.to === "round_robin" ? "round_robin" : str(a.to, 64);
      if (to === "round_robin") {
        const pool = [...new Set((Array.isArray(a.users) ? a.users : []).filter((u) => ids.has(u)))].slice(0, 50);
        if (pool.length < 2) fail("Pick at least two people to take turns");
        return { type: "assign", to, users: pool };
      }
      if (!ids.has(to)) fail("Choose who gets the lead");
      return { type: "assign", to };
    }
    if (a.type === "stage") {
      const stage = str(a.stage, 80);
      if (!PIPELINE.some((p) => p.name === stage)) fail("Choose the stage to move the lead to");
      return { type: "stage", stage };
    }
    if (a.type === "task") {
      const title = str(a.title, 300), hours = Number(a.hours);
      if (!title) fail("Write what the follow-up task is");
      if (!Number.isFinite(hours) || hours < 0 || hours > 24 * 90) fail("A task is due 0 to 2160 hours later");
      const owner = a.owner === "lead_owner" || !a.owner ? "lead_owner" : str(a.owner, 64);
      if (owner !== "lead_owner" && !ids.has(owner)) fail("Choose who does the task");
      return { type: "task", title, hours, owner };
    }
    if (a.type === "whatsapp") {
      const text = str(a.text, 1000), template = str(a.template, 80);
      if (!text && !template) fail("Write the WhatsApp message or name an approved template");
      if (template && !/^[a-z0-9_]{1,80}$/.test(template)) fail("A template name has only small letters, digits and _");
      return template ? { type: "whatsapp", template, language: str(a.language, 10) || "en" } : { type: "whatsapp", text };
    }
    if (a.type === "note") {
      const text = str(a.text, 2000);
      if (!text) fail("Write the note");
      return { type: "note", text };
    }
    fail("Unknown action");
  }
  function cleanFlow(flow) {
    if (!flow || !Array.isArray(flow.nodes) || !Array.isArray(flow.edges)) fail("Draw the workflow first");
    if (flow.nodes.length > MAX_NODES || flow.edges.length > MAX_EDGES) fail(`A workflow has at most ${MAX_NODES} boxes`);
    const nodes = [], seen = new Set();
    for (const n of flow.nodes) {
      const id = String(n?.id || "");
      if (!/^[\w-]{1,40}$/.test(id) || seen.has(id)) fail("Every box needs its own id");
      if (!PORTS[n.type]) fail("Unknown box");
      seen.add(id);
      const config = n.type === "trigger" ? cleanTrigger(n.config) : n.type === "condition" ? cleanConditions(n.config) : n.type === "wait" ? cleanWait(n.config) : cleanAction(n.config);
      nodes.push({ id, type: n.type, x: coord(n.x), y: coord(n.y), config });
    }
    const triggers = nodes.filter((n) => n.type === "trigger");
    if (triggers.length !== 1) fail("A workflow starts with exactly one trigger box");
    const byId = new Map(nodes.map((n) => [n.id, n])), edges = [], pairs = new Set();
    for (const e of flow.edges) {
      const from = byId.get(e?.from), to = byId.get(e?.to), port = String(e?.port || "out");
      if (!from || !to) fail("A line points at a box that is not there");
      if (!PORTS[from.type].includes(port)) fail("A line leaves from the wrong side of a box");
      if (to.type === "trigger") fail("Nothing can lead back into the trigger");
      if (from.id === to.id) fail("A box cannot lead to itself");
      const k = `${from.id}:${port}:${to.id}`;
      if (pairs.has(k)) continue;
      pairs.add(k);
      edges.push({ from: from.id, port, to: to.id });
    }
    // no loops: a run must always end
    const state = new Map();
    const visit = (id) => {
      if (state.get(id) === 1) fail("The lines go round in a loop; a workflow must always reach an end");
      if (state.get(id) === 2) return;
      state.set(id, 1);
      for (const e of edges) if (e.from === id) visit(e.to);
      state.set(id, 2);
    };
    nodes.forEach((n) => visit(n.id));
    const reach = new Set([triggers[0].id]);
    for (let grew = true; grew;) { grew = false; for (const e of edges) if (reach.has(e.from) && !reach.has(e.to)) { reach.add(e.to); grew = true; } }
    if (!nodes.some((n) => n.type === "action" && reach.has(n.id))) fail("Connect the trigger to at least one action");
    return { nodes, edges };
  }
  function cleanWait(w = {}) {
    const hours = Number(w.hours);
    if (!Number.isFinite(hours) || hours < 0.25 || hours > 24 * 90) fail("A wait is 15 minutes to 90 days");
    return { hours };
  }
  function clean(input, old = {}) {
    const name = str(input.name, 120);
    if (!name) fail("Give the workflow a name");
    const flow = cleanFlow(input.flow);
    const trigger = flow.nodes.find((n) => n.type === "trigger").config;
    return { ...old, name, enabled: input.enabled !== false, trigger, flow };
  }

  function list() {
    const runs = db.prepare("SELECT body FROM records WHERE kind='workflowRuns' AND COALESCE(json_extract(body,'$.empty'),0)=0 ORDER BY rowid DESC LIMIT 60").all().map((r) => JSON.parse(r.body));
    const waiting = Number(db.prepare("SELECT COUNT(*) n FROM records WHERE kind='workflowJobs'").get().n) || 0;
    return { rules: rules(), runs, waiting };
  }
  function create(input, by) {
    const rule = stamp({ ...clean(input), createdBy: by || "", runs: 0, rr: 0 });
    put("workflows", rule);
    return rule;
  }
  function update(id, input) {
    const old = get("workflows", id);
    if (!old) fail("Workflow not found", 404);
    const rule = { ...clean(input, old), updatedAt: new Date(now()).toISOString() };
    put("workflows", rule);
    return rule;
  }
  function remove(id) {
    if (!get("workflows", id)) fail("Workflow not found", 404);
    tx(() => {
      db.prepare("DELETE FROM records WHERE kind='workflows' AND id=?").run(id);
      db.prepare("DELETE FROM records WHERE kind='workflowJobs' AND json_extract(body,'$.ruleId')=?").run(id);
    });
    return { removed: id };
  }

  // ---- running a flow ----
  function matches(config, lead) {
    const test = (c) => {
      const actual = String(c.field === "stage" ? stageOf(lead) : lead[c.field] ?? "").trim(), a = actual.toLowerCase(), v = c.value.toLowerCase();
      if (c.op === "is_empty") return !actual;
      if (c.op === "not_empty") return Boolean(actual);
      if (c.op === "contains") return a.includes(v);
      // a basic stage also matches its pipeline steps, so "Stage is Closed" covers Won and Lost
      const same = a === v || (c.field === "stage" && String(lead.stage || "").toLowerCase() === v);
      return c.op === "is" ? same : !same;
    };
    return config.match === "any" ? config.conditions.some(test) : config.conditions.every(test);
  }
  const fill = (text, lead) => text.replace(/\{(name|company|city|source|owner)\}/g, (_, k) => (k === "owner" ? userName(lead.owner) : lead[k]) || "");

  // one action on the lead; returns what it did (or "" for nothing to change)
  function doAction(rule, lead, a) {
    const at = new Date(now()).toISOString();
    if (a.type === "assign") {
      let to = a.to;
      if (to === "round_robin") {
        const pool = a.users.filter((u) => userIds().has(u));
        if (!pool.length) return "";
        const fresh = get("workflows", rule.id) || rule;
        to = pool[(fresh.rr || 0) % pool.length];
        put("workflows", { ...fresh, rr: (fresh.rr || 0) + 1 });
      }
      if (lead.owner === to) return "";
      put("leads", { ...lead, owner: to, updatedAt: at });
      return "assigned to " + (userName(to) || "someone");
    }
    if (a.type === "stage") {
      const step = PIPELINE.find((p) => p.name === a.stage);
      if (!step || lead.deal === step.name) return "";
      put("leads", { ...lead, deal: step.name, stage: step.stage, disposition: step.disposition, updatedAt: at });
      return "moved to " + step.name;
    }
    if (a.type === "task") {
      put("tasks", stamp({ leadId: lead.id, title: fill(a.title, lead), owner: a.owner === "lead_owner" ? lead.owner || "" : a.owner, due: new Date(now() + a.hours * 3600000).toISOString(), status: "Open", origin: "Workflow", workflowId: rule.id }));
      return "task added";
    }
    if (a.type === "note") {
      log(lead.id, "Note", fill(a.text, lead), { userId: "", workflowId: rule.id });
      return "note added";
    }
    return "";
  }
  const next = (rule, id, port) => rule.flow.edges.filter((e) => e.from === id && e.port === port).map((e) => e.to);
  function addToRun(runId, items, ok = true) {
    const run = get("workflowRuns", runId);
    if (run && items.length) put("workflowRuns", { ...run, done: [...(run.done || []), ...items], ok: run.ok && ok });
  }

  // walks the flow from these boxes; a wait box saves a job and stops that branch until it is due
  async function walk(rule, leadId, start, runId, why) {
    const queue = [...start], did = [];
    let steps = 0, ok = true;
    while (queue.length && steps++ < MAX_STEPS) {
      const id = queue.shift(), node = rule.flow.nodes.find((n) => n.id === id);
      if (!node) continue;
      const lead = get("leads", leadId);
      if (!lead || lead.archived || lead.mergedInto) break;
      if (node.type === "trigger") { queue.push(...next(rule, node.id, "out")); continue; }
      if (node.type === "condition") { queue.push(...next(rule, node.id, matches(node.config, lead) ? "yes" : "no")); continue; }
      if (node.type === "wait") {
        const after = next(rule, node.id, "out");
        if (after.length) {
          const runAt = now() + node.config.hours * 3600000;
          put("workflowJobs", stamp({ ruleId: rule.id, leadId, nodes: after, runAt, runId, why }));
          did.push("waiting until " + new Date(runAt).toISOString());
        }
        continue;
      }
      const a = node.config;
      if (a.type === "whatsapp") {
        let note = "WhatsApp sent";
        try { await sendWhatsApp(leadId, a.template ? { template: a.template, language: a.language } : { text: fill(a.text, lead) }); }
        catch (e) { note = "WhatsApp not sent: " + String(e.message).slice(0, 160); ok = false; log(leadId, "System", `Workflow "${rule.name}": ${note}`, { workflowId: rule.id }); }
        did.push(note);
      } else {
        try {
          const done = tx(() => doAction(rule, lead, a));
          if (done) { did.push(done); log(leadId, "System", `Workflow "${rule.name}" (${why}): ${done}`, { workflowId: rule.id }); }
        } catch (e) { did.push(`${ACTIONS[a.type]} failed: ${String(e.message).slice(0, 160)}`); ok = false; }
      }
      queue.push(...next(rule, node.id, "out"));
    }
    addToRun(runId, did, ok);
    // a run that did nothing (a condition said no and that line has no box) is kept for once-only, but not listed
    const run = get("workflowRuns", runId);
    if (run && !run.done.length) put("workflowRuns", { ...run, empty: true });
    else if (run?.empty) put("workflowRuns", { ...run, empty: false });
  }

  function recentRuns(ruleId, leadId) {
    const since = new Date(now() - 3600000).toISOString();
    return Number(db.prepare("SELECT COUNT(*) n FROM records WHERE kind='workflowRuns' AND json_extract(body,'$.ruleId')=? AND json_extract(body,'$.leadId')=? AND json_extract(body,'$.at')>=?").get(ruleId, leadId, since).n) || 0;
  }

  // one event against every flow that listens for it; `key` makes each (flow, event) run once even after a restart
  async function fire(type, lead, key, why, extra = {}) {
    for (const rule of rules()) {
      if (!rule.enabled || rule.trigger.type !== type) continue;
      const t = rule.trigger;
      if (type === "stage_changed" && ((t.to && t.to !== extra.to && t.to !== extra.toStage) || (t.from && t.from !== extra.from && t.from !== extra.fromStage))) continue;
      if (type === "no_activity" && t.days !== extra.days) continue;
      const runId = rule.id + ":" + key;
      if (get("workflowRuns", runId)) continue;
      const fresh = get("leads", lead.id);
      if (!fresh || fresh.archived || fresh.mergedInto) continue;
      if (recentRuns(rule.id, lead.id) >= PER_LEAD_HOUR) continue;
      tx(() => {
        const latest = get("workflows", rule.id) || rule;
        put("workflows", { ...latest, runs: (latest.runs || 0) + 1, lastRunAt: new Date(now()).toISOString() });
        put("workflowRuns", { id: runId, ruleId: rule.id, rule: rule.name, leadId: lead.id, lead: fresh.name || "", why, at: new Date(now()).toISOString(), done: [], ok: true });
      });
      const start = rule.flow.nodes.find((n) => n.type === "trigger");
      await walk(rule, lead.id, [start.id], runId, why);
    }
  }

  // waits that are due carry on from where they stopped, with the flow as it is saved now
  async function resume() {
    const due = db.prepare("SELECT body FROM records WHERE kind='workflowJobs' AND json_extract(body,'$.runAt')<=? ORDER BY json_extract(body,'$.runAt') LIMIT 200").all(now()).map((r) => JSON.parse(r.body));
    for (const job of due) {
      db.prepare("DELETE FROM records WHERE kind='workflowJobs' AND id=?").run(job.id);
      const rule = get("workflows", job.ruleId);
      if (!rule || !rule.enabled) { addToRun(job.runId, ["stopped: the workflow was turned off"]); continue; }
      await walk(rule, job.leadId, job.nodes, job.runId, job.why);
    }
    return due.length;
  }

  // ---- reading what changed ----
  const STATE = "engine";
  const maxRow = (kind) => Number(db.prepare("SELECT COALESCE(MAX(rowid),0) n FROM records WHERE kind=?").get(kind).n) || 0;
  let running = null;
  function tick() {
    if (!running) running = tickNow().catch((e) => report("Workflows: " + e.message)).finally(() => { running = null; });
    return running;
  }
  async function tickNow() {
    const leads = db.prepare("SELECT rowid r, body FROM records WHERE kind='leads' ORDER BY rowid").all().map((x) => ({ r: x.r, ...JSON.parse(x.body) }));
    const state = get("workflowState", STATE);
    if (!state) {
      put("workflowState", { id: STATE, leadRow: maxRow("leads"), activityRow: maxRow("activities"), stages: Object.fromEntries(leads.map((l) => [l.id, stageOf(l)])), quietAt: 0 });
      return { events: 0 };
    }
    const active = rules().filter((r) => r.enabled);
    const events = [], t = now(), recent = (iso) => t - Date.parse(iso || 0) <= FRESH_MS;
    const stages = { ...state.stages };
    let leadRow = state.leadRow;
    for (const l of leads) {
      const stage = stageOf(l), before = stages[l.id];
      if (l.r > state.leadRow) {
        leadRow = Math.max(leadRow, l.r);
        if (before === undefined && recent(l.createdAt) && !l.archived && !l.mergedInto) events.push(["lead_created", l, "lead:" + l.id, "new lead"]);
      } else if (before !== undefined && before !== stage && !l.archived) {
        const old = PIPELINE.find((p) => p.name === before)?.stage || before;
        events.push(["stage_changed", l, `stage:${l.id}:${before}>${stage}:${l.updatedAt || ""}`, `${before} → ${stage}`, { from: before, fromStage: old, to: stage, toStage: l.stage }]);
      }
      stages[l.id] = stage;
    }
    const activities = db.prepare("SELECT rowid r, body FROM records WHERE kind='activities' AND rowid>? ORDER BY rowid LIMIT 5000").all(state.activityRow);
    let activityRow = state.activityRow;
    const byId = new Map(leads.map((l) => [l.id, l]));
    for (const row of activities) {
      activityRow = row.r;
      const a = JSON.parse(row.body);
      if (a.type === "Call" && ["Missed", "Rejected"].includes(a.direction) && recent(a.occurredAt || a.createdAt) && byId.has(a.leadId))
        events.push(["call_missed", byId.get(a.leadId), "missed:" + a.id, "missed call"]);
    }
    // "no activity for N days": a heavier read, so every 15 minutes and only when such a flow exists
    const quietRules = active.filter((r) => r.trigger.type === "no_activity");
    let quietAt = state.quietAt || 0;
    if (quietRules.length && t - quietAt >= 15 * 60000) {
      quietAt = t;
      const last = new Map(db.prepare("SELECT json_extract(body,'$.leadId') l, MAX(COALESCE(json_extract(body,'$.occurredAt'),json_extract(body,'$.createdAt'))) at FROM records WHERE kind='activities' AND json_extract(body,'$.type')<>'System' GROUP BY l").all().map((x) => [x.l, x.at]));
      for (const days of new Set(quietRules.map((r) => r.trigger.days))) {
        for (const l of leads) {
          if (l.archived || l.mergedInto || l.stage === "Closed") continue;
          const at = last.get(l.id) || l.createdAt, idle = (t - Date.parse(at || 0)) / 86400000;
          if (idle >= days && idle < days + QUIET_WINDOW_DAYS) events.push(["no_activity", l, `quiet:${days}:${l.id}:${at}`, `no activity for ${days} days`, { days }]);
        }
      }
    }
    put("workflowState", { ...state, leadRow, activityRow, stages, quietAt });
    await resume();
    if (!active.length) return { events: 0 };
    const wanted = events.filter(([type]) => active.some((r) => r.trigger.type === type));
    if (wanted.length > MAX_EVENTS) report(`Workflows: ${wanted.length - MAX_EVENTS} events skipped this time (more than ${MAX_EVENTS} at once)`);
    let fired = 0;
    for (const [type, lead, key, why, extra] of wanted.slice(0, MAX_EVENTS)) {
      await fire(type, lead, key, why, extra);
      fired++;
    }
    // runs older than 60 days are only history
    db.prepare("DELETE FROM records WHERE kind='workflowRuns' AND json_extract(body,'$.at')<?").run(new Date(t - 60 * 86400000).toISOString());
    return { events: fired };
  }

  return { list, create, update, remove, tick, meta: () => ({ triggers: TRIGGERS, fields: FIELDS, ops: OPS, actions: ACTIONS, stages: STAGES, pipeline: PIPELINE.map((p) => p.name) }) };
}
