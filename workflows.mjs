// Workflows: flows that act on leads by themselves. A flow is a small graph drawn in Settings: one trigger box, then condition
// boxes (yes / no branches), wait boxes and action boxes joined by lines.
// The engine looks at the database every 30 seconds instead of hooking every place that writes a lead (the screens, the phone app,
// TeleCRM, IndiaMART, Meta, WhatsApp), so a lead from anywhere is covered. It remembers how far it has read (rowid cursors) and each
// lead's last stage, so a restart neither misses nor repeats events. The first run only takes that snapshot: flows never fire for
// history from before the engine was switched on. A wait is saved as a job and the flow carries on from there when it is due.
// Field, owner and rating changes are found the same way: the engine keeps the last value it saw of each watched field, for the
// fields some switched-on flow listens to, and fires when it differs.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { PIPELINE } from "./pipeline.mjs";
import { privateAddress } from "./wa-gateway.mjs";
import { cleanState, cleanLanguage, withRegion } from "./lead-region.mjs";

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const TRIGGERS = {
  lead_created: "A new lead comes in",
  owner_changed: "A lead is assigned to someone",
  stage_changed: "A lead's stage changes",
  field_changed: "A lead field changes",
  rating_changed: "A lead's rating changes",
  call_missed: "A call from a lead is missed",
  no_activity: "A lead has no activity for some days",
};
// fields of every lead; TeleCRM's own fields (State, Requirement…) are added as "tc:<name>"
export const FIELDS = { source: "Source", state: "State", probableState: "Probable state", language: "Language", city: "City", owner: "Owner", stage: "Stage", company: "Company", name: "Name", email: "Email", value: "Expected value", rating: "Rating" };
export const OPS = { is: "is", is_not: "is not", contains: "contains", is_empty: "is empty", not_empty: "is not empty", more: "is more than", less: "is less than" };
export const ACTIONS = { assign: "Assign the lead", stage: "Change the stage", field: "Update a lead field", task: "Create a follow-up task", whatsapp: "Send a WhatsApp message", notify: "Notify a team member", note: "Add a note", cancel_tasks: "Cancel open tasks", webhook: "Call an API (webhook)" };
// what the "Update a lead field" box may write; owner and stage have their own boxes, TeleCRM fields belong to TeleCRM
export const EDITABLE = { state: "State", language: "Language", company: "Company", city: "City", source: "Source", email: "Email", value: "Expected value" };
const CUSTOM = /^tc:[^:\s][^:]{0,59}$/;
const fieldOk = (k) => Boolean(FIELDS[k]) || CUSTOM.test(k);
const fieldLabel = (k) => FIELDS[k] || String(k).slice(3).replace(/_/g, " ");
const shown = (v) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)).trim().slice(0, 300);
// the value a flow sees for a field of a lead, always as text
export function valueOf(lead, key) {
  if (key === "stage") return stageOf(lead);
  if (key === "rating") return shown(lead.telecrm?.rating ?? lead.rating ?? "");
  if (key.startsWith("tc:")) return shown(lead.telecrm?.fields?.[key.slice(3)]);
  return shown(lead[key]);
}
// webhook addresses: https on the public internet only, so a flow cannot reach anything inside the server
function webhookUrl(value) {
  let u;
  try { u = new URL(String(value || "").trim()); } catch { fail("Enter the API address in full, like https://n8n.example.com/webhook/new-lead"); }
  if (u.protocol !== "https:" || u.username || u.password) fail("The API address must start with https:// and have no login in it");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$|\.local(host)?$|\.internal$/i.test(host) || (isIP(host) && privateAddress(host))) fail("The API address must be a public website");
  return u.href;
}
async function postJson(url, body) {
  const u = new URL(webhookUrl(url)), host = u.hostname.replace(/^\[|\]$/g, "");
  const found = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => fail("The API address could not be found"));
  if (!found.length || found.some((f) => privateAddress(f.address))) fail("The API address must be a public website");
  const res = await fetch(u, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/json", "User-Agent": "Salesdesk-Workflows" }, body: JSON.stringify(body) });
  if (!res.ok) fail(`the API answered ${res.status}`);
}
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
const coord = (v) => Math.max(-20000, Math.min(20000, Math.round(Number(v) || 0))); // the canvas has no edges

export function createWorkflows({ db, get, put, stamp, tx, log, users, sendWhatsApp = async () => fail("WhatsApp gateway is not connected"), post = postJson, gatewayOn = () => true, now = () => Date.now(), report = () => {} }) {
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
    if (t.type === "owner_changed") {
      trigger.to = str(t.to, 64);
      if (trigger.to && !userIds().has(trigger.to)) fail("Unknown person in the trigger");
    }
    if (t.type === "field_changed") {
      trigger.field = str(t.field, 63);
      if (!fieldOk(trigger.field)) fail("Choose the field to watch");
      if (["stage", "owner", "rating"].includes(trigger.field)) fail(`Use the "${TRIGGERS[trigger.field === "stage" ? "stage_changed" : trigger.field === "owner" ? "owner_changed" : "rating_changed"]}" trigger for ${FIELDS[trigger.field]}`);
      trigger.to = str(t.to, 200);
    }
    if (t.type === "rating_changed") {
      trigger.to = t.to === "" || t.to === undefined || t.to === null ? "" : String(Number(t.to));
      if (trigger.to && !/^[0-5]$/.test(trigger.to)) fail("A rating is 0 to 5");
    }
    return trigger;
  }
  function cleanConditions(c = {}) {
    const ids = userIds();
    const list = (Array.isArray(c.conditions) ? c.conditions : []).slice(0, 10).map((x) => {
      if (!fieldOk(x.field) || !OPS[x.op]) fail("Each condition needs a field and a test");
      const blank = ["is_empty", "not_empty"].includes(x.op), value = blank ? "" : str(x.value, 200);
      if (!blank && !value) fail(`Fill in the value for "${fieldLabel(x.field)}"`);
      if (["more", "less"].includes(x.op) && !Number.isFinite(Number(value))) fail(`"${fieldLabel(x.field)} ${OPS[x.op]}" needs a number`);
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
    if (a.type === "field") {
      const field = str(a.field, 20), value = str(a.value, 200);
      if (!EDITABLE[field]) fail("Choose the field to update");
      if (field === "email" && value && !/\{\w+\}/.test(value) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail("Enter a valid email");
      if (field === "value" && value && !Number.isFinite(Number(value.replace(/[,\s₹]/g, "")))) fail("Expected value is a number");
      return { type: "field", field, value };
    }
    if (a.type === "notify") {
      const to = a.to === "lead_owner" || !a.to ? "lead_owner" : str(a.to, 64), text = str(a.text, 500);
      if (to !== "lead_owner" && !ids.has(to)) fail("Choose who gets the notification");
      if (!text) fail("Write the notification");
      return { type: "notify", to, text };
    }
    if (a.type === "cancel_tasks") return { type: "cancel_tasks", which: a.which === "all" ? "all" : "workflow" };
    if (a.type === "webhook") return { type: "webhook", url: webhookUrl(a.url) };
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
      const actual = c.field === "owner" ? String(lead.owner || "") : valueOf(lead, c.field), a = actual.toLowerCase(), v = c.value.toLowerCase();
      if (c.op === "is_empty") return !actual;
      if (c.op === "not_empty") return Boolean(actual);
      if (c.op === "more" || c.op === "less") {
        const n = Number(actual.replace(/[,\s₹]/g, ""));
        return actual !== "" && Number.isFinite(n) && (c.op === "more" ? n > Number(c.value) : n < Number(c.value));
      }
      if (c.op === "contains") return a.includes(v);
      // a basic stage also matches its pipeline steps, so "Stage is Closed" covers Won and Lost
      const same = a === v || (c.field === "stage" && String(lead.stage || "").toLowerCase() === v);
      return c.op === "is" ? same : !same;
    };
    return config.match === "any" ? config.conditions.some(test) : config.conditions.every(test);
  }
  const fill = (text, lead) => text.replace(/\{(name|company|city|source|owner|phone)\}/g, (_, k) => (k === "owner" ? userName(lead.owner) : lead[k]) || "");

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
    if (a.type === "field") {
      let value = fill(a.value, lead).trim();
      if (a.field === "value") value = Number(value.replace(/[,\s₹]/g, "")) || 0;
      if (a.field === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail(`"${value}" is not an email`);
      if (a.field === "state") value = cleanState(value);
      if (a.field === "language") value = cleanLanguage(value);
      if (String(lead[a.field] ?? "") === String(value)) return "";
      const next = { ...lead, [a.field]: value, updatedAt: at };
      if (a.field === "language") delete next.languageGuess;
      // a new state brings its language when the language was only a guess
      if (a.field === "state" && (lead.languageGuess || !lead.language)) { delete next.language; delete next.languageGuess; Object.assign(next, withRegion(next) || {}); }
      put("leads", next);
      return `${EDITABLE[a.field]} set to ${value === "" ? "empty" : value}`;
    }
    if (a.type === "notify") {
      const to = a.to === "lead_owner" ? lead.owner : a.to;
      if (!to || !userIds().has(to)) return "nobody to notify (the lead has no owner)";
      put("notifications", stamp({ userId: to, leadId: lead.id, text: fill(a.text, lead), workflowId: rule.id, read: false }));
      return "notified " + (userName(to) || "someone");
    }
    if (a.type === "cancel_tasks") {
      const open = db.prepare("SELECT body FROM records WHERE kind='tasks' AND json_extract(body,'$.leadId')=? AND COALESCE(json_extract(body,'$.status'),'Open')<>'Done'").all(lead.id).map((r) => JSON.parse(r.body))
        .filter((t) => a.which === "all" || t.origin === "Workflow");
      for (const t of open) put("tasks", { ...t, status: "Done", cancelled: true, cancelledBy: rule.id, updatedAt: at });
      return open.length ? `${open.length} open task${open.length === 1 ? "" : "s"} cancelled` : "";
    }
    return "";
  }
  // what the API (webhook) box sends
  const payload = (rule, lead, why) => ({
    event: rule.trigger.type, why, at: new Date(now()).toISOString(), workflow: { id: rule.id, name: rule.name },
    lead: { id: lead.id, name: lead.name || "", phone: lead.phone || "", email: lead.email || "", company: lead.company || "", city: lead.city || "", source: lead.source || "", stage: stageOf(lead), owner: userName(lead.owner), value: lead.value || 0, createdAt: lead.createdAt || "" },
  });
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
      } else if (a.type === "webhook") {
        let note = "API called";
        try { await post(a.url, payload(rule, lead, why)); }
        catch (e) { note = "API call failed: " + String(e.name === "TimeoutError" ? "no answer in 10 seconds" : e.message).slice(0, 160); ok = false; log(leadId, "System", `Workflow "${rule.name}": ${note}`, { workflowId: rule.id }); }
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
      if (type === "owner_changed" && (!extra.to || (t.to && t.to !== extra.to))) continue;
      if (type === "rating_changed" && t.to && t.to !== String(Number(extra.to) || 0)) continue;
      if (type === "field_changed" && (t.field !== extra.field || (t.to && t.to.toLowerCase() !== String(extra.to).toLowerCase()))) continue;
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
    // fields some switched-on flow listens to; only these are remembered, so a field nobody watches costs nothing and a flow
    // switched on later starts from what the lead holds then, never from an old remembered value
    const watch = new Set(active.map((r) => (r.trigger.type === "owner_changed" ? "owner" : r.trigger.type === "rating_changed" ? "rating" : r.trigger.type === "field_changed" ? r.trigger.field : "")).filter(Boolean));
    const seen = state.vals || {}, vals = {};
    let leadRow = state.leadRow;
    for (const l of leads) {
      if (watch.size && !l.archived && !l.mergedInto) {
        const was = seen[l.id] || {}, cur = {};
        for (const k of watch) {
          const v = k === "owner" ? String(l.owner || "") : valueOf(l, k);
          cur[k] = v;
          // a change written by an import in the last 10 minutes is remembered but starts nothing
          if (l.r > state.leadRow || !Object.hasOwn(was, k) || was[k] === v || (l.importTouch && t - Date.parse(l.importTouch) < 600000)) continue;
          const tag = `${l.id}:${was[k].slice(0, 40)}>${v.slice(0, 40)}:${l.updatedAt || ""}`;
          if (k === "owner") events.push(["owner_changed", l, "owner:" + tag, `assigned to ${userName(v) || "nobody"}`, { to: v }]);
          else if (k === "rating") events.push(["rating_changed", l, "rating:" + tag, `rating ${was[k] || 0} → ${v || 0}`, { to: v }]);
          else events.push(["field_changed", l, `field:${k}:${tag}`, `${fieldLabel(k)}: ${was[k] || "empty"} → ${v || "empty"}`, { field: k, to: v }]);
        }
        vals[l.id] = cur;
      }
      const stage = stageOf(l), before = stages[l.id];
      if (l.r > state.leadRow) {
        leadRow = Math.max(leadRow, l.r);
        if (before === undefined && recent(l.createdAt) && !l.archived && !l.mergedInto && !l.importedFrom) events.push(["lead_created", l, "lead:" + l.id, "new lead"]);
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
      if (a.type === "Call" && ["Missed", "Rejected"].includes(a.direction) && !a.importedFrom && recent(a.occurredAt || a.createdAt) && byId.has(a.leadId))
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
    put("workflowState", { ...state, leadRow, activityRow, stages, quietAt, vals });
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
    db.prepare("DELETE FROM records WHERE kind='notifications' AND json_extract(body,'$.createdAt')<?").run(new Date(t - 30 * 86400000).toISOString());
    return { events: fired };
  }

  // "Test workflow": walks the drawn flow (saved or not) for one lead and says what each box would do, without doing it.
  // Waits are passed straight through; what the next boxes see is the lead as it is now.
  function dryRun(input, leadId) {
    const flow = cleanFlow(input?.flow);
    const lead = get("leads", String(leadId || ""));
    if (!lead || lead.archived || lead.mergedInto) fail("Choose a lead to test with");
    const rule = { id: input.id || "test", name: str(input.name, 120) || "Test", trigger: flow.nodes.find((n) => n.type === "trigger").config, flow };
    const steps = {}, lines = [];
    const queue = [flow.nodes.find((n) => n.type === "trigger").id];
    let count = 0, turn = (get("workflows", rule.id)?.rr) || 0;
    while (queue.length && count++ < MAX_STEPS) {
      const id = queue.shift(), n = flow.nodes.find((x) => x.id === id);
      if (!n || steps[id]) continue;
      let ports = ["out"], status = "ok", text = "";
      if (n.type === "trigger") text = `Starts for ${lead.name || "this lead"} (${triggerWhy(n.config)})`;
      else if (n.type === "condition") { const yes = matches(n.config, lead); ports = [yes ? "yes" : "no"]; text = yes ? "Yes: the lead passes" : "No: the lead does not pass"; }
      else if (n.type === "wait") text = `Would wait ${n.config.hours >= 24 && n.config.hours % 24 === 0 ? n.config.hours / 24 + " day(s)" : n.config.hours + " hour(s)"}, then carry on`;
      else {
        const a = n.config;
        if (a.type === "assign") {
          let to = a.to;
          if (to === "round_robin") { const pool = a.users.filter((u) => userIds().has(u)); to = pool.length ? pool[turn++ % pool.length] : ""; }
          text = !to ? "Nobody to assign to" : lead.owner === to ? `Already with ${userName(to)}: nothing to change` : `Would assign to ${userName(to)}`;
          if (!to) status = "error";
        } else if (a.type === "stage") text = lead.deal === a.stage ? `Already at ${a.stage}: nothing to change` : `Would move to ${a.stage}`;
        else if (a.type === "field") {
          const v = fill(a.value, lead).trim();
          text = `Would set ${EDITABLE[a.field]} to ${v || "empty"}`;
          if (a.field === "email" && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { status = "error"; text = `"${v}" is not an email`; }
        } else if (a.type === "task") text = `Would add the task "${fill(a.title, lead)}" for ${a.owner === "lead_owner" ? userName(lead.owner) || "nobody (no owner)" : userName(a.owner)}`;
        else if (a.type === "whatsapp") {
          if (!gatewayOn()) { status = "error"; text = "Would not send: the WhatsApp gateway is not turned on"; }
          else if (!lead.phone) { status = "error"; text = "Would not send: the lead has no phone number"; }
          else text = a.template ? `Would send the template ${a.template} to ${lead.phone}` : `Would send to ${lead.phone}: ${fill(a.text, lead)}`;
        } else if (a.type === "notify") {
          const to = a.to === "lead_owner" ? lead.owner : a.to;
          if (!to || !userIds().has(to)) { status = "error"; text = "Nobody to notify: the lead has no owner"; }
          else text = `Would tell ${userName(to)}: ${fill(a.text, lead)}`;
        } else if (a.type === "cancel_tasks") {
          const open = db.prepare("SELECT body FROM records WHERE kind='tasks' AND json_extract(body,'$.leadId')=? AND COALESCE(json_extract(body,'$.status'),'Open')<>'Done'").all(lead.id).map((r) => JSON.parse(r.body)).filter((t) => a.which === "all" || t.origin === "Workflow");
          text = open.length ? `Would cancel ${open.length} open task(s)` : "No open tasks to cancel";
        } else if (a.type === "webhook") text = `Would send the lead to ${new URL(a.url).host} (not sent in a test)`;
        else if (a.type === "note") text = `Would add the note: ${fill(a.text, lead)}`;
      }
      steps[id] = { status, text };
      for (const p of ports) for (const e of flow.edges.filter((x) => x.from === id && x.port === p)) { lines.push(`${e.from}:${e.port}:${e.to}`); queue.push(e.to); }
    }
    return { lead: { id: lead.id, name: lead.name || "" }, steps, lines };
  }
  function triggerWhy(t) {
    if (t.type === "stage_changed") return `when it moves${t.from ? " from " + t.from : ""} to ${t.to || "any stage"}`;
    if (t.type === "field_changed") return `when ${fieldLabel(t.field)} changes${t.to ? " to " + t.to : ""}`;
    if (t.type === "owner_changed") return t.to ? `when assigned to ${userName(t.to)}` : "when assigned";
    if (t.type === "rating_changed") return t.to ? `when the rating becomes ${t.to}` : "when the rating changes";
    if (t.type === "no_activity") return `after ${t.days} quiet days`;
    return TRIGGERS[t.type].toLowerCase();
  }
  // TeleCRM's own fields (State, Requirement…) as found on the newest synced leads, most used first
  function customFields() {
    const count = new Map();
    for (const r of db.prepare("SELECT json_extract(body,'$.telecrm.fields') f FROM records WHERE kind='leads' AND json_extract(body,'$.telecrm.fields') IS NOT NULL ORDER BY rowid DESC LIMIT 500").all()) {
      let f; try { f = JSON.parse(r.f); } catch { continue; }
      for (const [k, v] of Object.entries(f || {})) if (k.length <= 60 && !k.includes(":") && (typeof v !== "object" || v === null)) count.set(k, (count.get(k) || 0) + 1);
    }
    return Object.fromEntries([...count].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k]) => ["tc:" + k, k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())]));
  }
  const meta = () => ({ triggers: TRIGGERS, fields: FIELDS, custom: customFields(), ops: OPS, actions: ACTIONS, editable: EDITABLE, stages: STAGES, pipeline: PIPELINE.map((p) => p.name) });
  return { list, create, update, remove, tick, meta, dryRun };
}
