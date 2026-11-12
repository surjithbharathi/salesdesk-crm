import React, { useEffect, useRef, useState } from "react";
import { crmGet, crmSend } from "../../api.js";
import { useLoad } from "../../hooks.js";
import { useToast } from "../../toast.jsx";
import { hashFor } from "../../format.js";
import { TIcon, ICONS } from "../../cwt/icons.jsx";
import { useCrm } from "../../crm.jsx";
import { Section, Note, Loading, Failed } from "./Parts.jsx";

// Workflows are drawn as flows, n8n style: a trigger node, then If (yes / no), Wait and action nodes joined by lines.
// Every free output has a + that opens a searchable list of steps; a line has a + to put a step in between.
// The canvas has no edges: drag the background to move around, Ctrl + scroll (or the buttons) to zoom, Fit to see it all.
// It is plain SVG with no inline styles (the CSP allows only stylesheets): nodes move by their x / y attributes.
const S = 92; // a node is a square this big; its name is written under it
const PORT_Y = { out: S / 2, yes: S * 0.3, no: S * 0.7 };
const PORTS = { trigger: ["out"], condition: ["yes", "no"], wait: ["out"], action: ["out"] };
const GAP = 150; // from one node to the next, left to right
const PLACEHOLDERS = "Use {name}, {phone}, {company}, {city}, {source} or {owner} to fill in the lead's details.";
const newId = () => "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const when = (iso) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// triggers: [type, name, icon, starting settings, what it means]
const EVENTS = [
  ["lead_created", "New lead", "addUser", {}, "A lead comes in from any source: IndiaMART, TeleCRM, the website, a person"],
  ["owner_changed", "Lead assigned", "user", { to: "" }, "The lead gets a new owner"],
  ["stage_changed", "Stage changed", "flow", { to: "", from: "" }, "The lead moves to another pipeline stage"],
  ["field_changed", "Field changed", "gear", { field: "city", to: "" }, "City, source, email or a TeleCRM field like State changes"],
  ["rating_changed", "Rating changed", "star", { to: "" }, "The lead's TeleCRM rating changes"],
  ["call_missed", "Missed call", "phone", {}, "A call from the lead is missed or rejected"],
  ["no_activity", "No activity", "clock", { days: 3 }, "No call, message or note for some days"],
];
// steps: [node type, name, icon, starting settings, what it does]
const ADD = [
  ["action", "Assign lead", "addUser", { type: "assign", to: "" }, "Give the lead to a person, or share leads out in turn"],
  ["action", "Change stage", "flow", { type: "stage", stage: "" }, "Move the lead to a pipeline stage"],
  ["action", "Update field", "gear", { type: "field", field: "city", value: "" }, "Set the company, city, source, email or value"],
  ["action", "Follow-up task", "alarm", { type: "task", title: "Call {name}", hours: 1, owner: "lead_owner" }, "Add a call or follow-up to someone's list"],
  ["action", "Send WhatsApp", "whatsapp", { type: "whatsapp", text: "" }, "Message the customer through the WhatsApp gateway"],
  ["action", "Notify team member", "bell", { type: "notify", to: "lead_owner", text: "{name} needs your attention" }, "A message under the bell in Salesdesk"],
  ["action", "Add note", "notePlus", { type: "note", text: "" }, "Write a note on the lead's timeline"],
  ["action", "Cancel tasks", "x", { type: "cancel_tasks", which: "workflow" }, "Close the lead's open follow-ups"],
  ["action", "Call API", "webhook", { type: "webhook", url: "" }, "Send the lead to n8n or any https webhook"],
];
const FLOW = [
  ["condition", "If", "filter", { match: "all", conditions: [{ field: "source", op: "contains", value: "" }] }, "Split into yes and no by the lead's details"],
  ["wait", "Wait", "clock", { hours: 24 }, "Hold the lead for a while, then carry on"],
];
const ICON = Object.fromEntries(ADD.map(([, , icon, cfg]) => [cfg.type, icon]));
const iconOf = (n) => (n.type === "trigger" ? EVENTS.find(([t]) => t === n.config.type)?.[2] || "flow" : n.type === "condition" ? "filter" : n.type === "wait" ? "clock" : ICON[n.config.type] || "gear");

// examples, laid out left to right
const node = (id, type, x, y, config) => ({ id, type, x, y, config });
const line = (from, to, port = "out") => ({ from, port, to });
const EXAMPLES = [
  ["New IndiaMART lead: share it out, call within an hour", { name: "New IndiaMART leads", flow: {
    nodes: [node("t", "trigger", 40, 160, { type: "lead_created" }), node("c", "condition", 300, 160, { match: "all", conditions: [{ field: "source", op: "contains", value: "IndiaMART" }] }),
      node("a", "action", 560, 80, { type: "assign", to: "round_robin", users: [] }), node("b", "action", 820, 80, { type: "task", title: "Call {name} ({city})", hours: 1, owner: "lead_owner" })],
    edges: [line("t", "c"), line("c", "a", "yes"), line("a", "b")] } }],
  ["Welcome on WhatsApp, then call next day if still new", { name: "Welcome and call next day", flow: {
    nodes: [node("t", "trigger", 40, 160, { type: "lead_created" }), node("m", "action", 300, 160, { type: "whatsapp", template: "", text: "Hello {name}, thank you for your enquiry with Devi Industries. {owner} will call you shortly." }),
      node("w", "wait", 560, 160, { hours: 24 }), node("c", "condition", 820, 160, { match: "all", conditions: [{ field: "stage", op: "is", value: "New" }] }),
      node("k", "action", 1080, 80, { type: "task", title: "Day 2: call {name}", hours: 0, owner: "lead_owner" })],
    edges: [line("t", "m"), line("m", "w"), line("w", "c"), line("c", "k", "yes")] } }],
  ["Missed call: call back in 15 minutes", { name: "Call back missed calls", flow: {
    nodes: [node("t", "trigger", 40, 160, { type: "call_missed" }), node("k", "action", 300, 160, { type: "task", title: "Call back {name}", hours: 0.25, owner: "lead_owner" })],
    edges: [line("t", "k")] } }],
  ["Lead reassigned: tell the new owner, drop old reminders", { name: "Hand over a lead", flow: {
    nodes: [node("t", "trigger", 40, 160, { type: "owner_changed", to: "" }), node("x", "action", 300, 160, { type: "cancel_tasks", which: "workflow" }),
      node("n", "action", 560, 160, { type: "notify", to: "lead_owner", text: "{name} ({city}) is now yours. Call today." })],
    edges: [line("t", "x"), line("x", "n")] } }],
  ["Quotation shared: follow up after 2 days", { name: "Quotation follow-up", flow: {
    nodes: [node("t", "trigger", 40, 160, { type: "stage_changed", to: "Quotation Shared", from: "" }), node("w", "wait", 300, 160, { hours: 48 }),
      node("c", "condition", 560, 160, { match: "all", conditions: [{ field: "stage", op: "is", value: "Quotation Shared" }] }),
      node("k", "action", 820, 80, { type: "task", title: "Ask {name} about the quotation", hours: 0, owner: "lead_owner" })],
    edges: [line("t", "w"), line("w", "c"), line("c", "k", "yes")] } }],
  ["Quiet for 3 days: remind the owner", { name: "Quiet leads", flow: {
    nodes: [node("t", "trigger", 40, 160, { type: "no_activity", days: 3 }), node("k", "action", 300, 160, { type: "task", title: "{name} has gone quiet. Call today", hours: 0, owner: "lead_owner" })],
    edges: [line("t", "k")] } }],
];

function hoursText(h) {
  if (h < 1) return `${Math.round(h * 60)} minutes`;
  if (h % 24 === 0) return `${h / 24} day${h === 24 ? "" : "s"}`;
  return `${h} hour${h === 1 ? "" : "s"}`;
}
const fieldsOf = (meta) => ({ ...meta.fields, ...(meta.custom || {}) });
const fieldName = (meta, k) => fieldsOf(meta)[k] || String(k).replace(/^tc:/, "");
function triggerText(t, meta, nameOf = (x) => x) {
  if (t.type === "stage_changed") return `Moves${t.from ? ` from ${t.from}` : ""} to ${t.to || "any stage"}`;
  if (t.type === "no_activity") return `No activity for ${t.days} day${t.days === 1 ? "" : "s"}`;
  if (t.type === "owner_changed") return t.to ? `Assigned to ${nameOf(t.to)}` : "Assigned to someone";
  if (t.type === "field_changed") return `${fieldName(meta, t.field)} changes${t.to ? ` to ${t.to}` : ""}`;
  if (t.type === "rating_changed") return t.to ? `Rating becomes ${t.to}` : "Rating changes";
  return meta.triggers[t.type] || t.type;
}
const hostOf = (url) => { try { return new URL(url).host; } catch { return ""; } };
// the two lines a box shows: what kind of box, and what it does
function label(n, meta, nameOf) {
  const c = n.config;
  if (n.type === "trigger") return ["When", triggerText(c, meta, nameOf)];
  if (n.type === "wait") return ["Wait", hoursText(c.hours || 0)];
  if (n.type === "condition") {
    const parts = (c.conditions || []).map((x) => `${fieldName(meta, x.field)} ${meta.ops[x.op]}${x.value ? " " + (x.field === "owner" ? nameOf(x.value) : x.value) : ""}`);
    return ["If", parts.join(c.match === "any" ? " or " : " and ") || "No test yet"];
  }
  if (c.type === "assign") return ["Assign", c.to === "round_robin" ? `In turn: ${(c.users || []).map(nameOf).join(", ") || "pick people"}` : c.to ? nameOf(c.to) : "Choose a person"];
  if (c.type === "stage") return ["Change stage", c.stage || "Choose a stage"];
  if (c.type === "field") return ["Update field", `${meta.editable?.[c.field] || c.field} = ${c.value || "empty"}`];
  if (c.type === "task") return ["Task", c.title ? `${c.title}${c.hours ? ` · in ${hoursText(c.hours)}` : ""}` : "Write the task"];
  if (c.type === "whatsapp") return ["WhatsApp", c.template ? `Template ${c.template}` : c.text || "Write the message"];
  if (c.type === "notify") return ["Notify", `${c.to === "lead_owner" ? "Lead owner" : nameOf(c.to)}: ${c.text || "write it"}`];
  if (c.type === "cancel_tasks") return ["Cancel tasks", c.which === "all" ? "All open tasks" : "Tasks made by workflows"];
  if (c.type === "webhook") return ["Call API", hostOf(c.url) || "Enter the address"];
  return ["Note", c.text || "Write the note"];
}
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const kindClass = (n) => (n.type === "action" ? `wfn-action wfn-${n.config.type}` : `wfn-${n.type}`);
const doneText = (r) => (r.done || []).map((d) => (d.startsWith("waiting until ") ? "waiting till " + when(d.slice(14)) : d)).join(", ") || "Nothing to change";

function RunsTable({ runs, showRule = true }) {
  if (!runs.length) return <p className="muted">Nothing yet.</p>;
  return (
    <div className="table-frame">
      <table className="grid">
        <thead><tr><th>When</th>{showRule && <th>Workflow</th>}<th>Lead</th><th>Why</th><th>What it did</th></tr></thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td>{when(r.at)}</td>
              {showRule && <td>{r.rule}</td>}
              <td><a href={hashFor("/leads", { lead: r.leadId })}>{r.lead || "Lead"}</a></td>
              <td>{r.why}</td>
              <td className={r.ok ? "" : "error"}>{doneText(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Workflows({ users }) {
  const notify = useToast();
  const [version, setVersion] = useState(0);
  const { data, error } = useLoad(() => crmGet("workflows"), [version]);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const nameOf = (id) => users.find((u) => u.id === id)?.name || "Someone removed";
  const reload = () => setVersion((v) => v + 1);
  async function act(fn, done) {
    setBusy(true);
    try { const r = await fn(); notify(done); reload(); return r || true; } catch (e) { notify(e.message); return false; } finally { setBusy(false); }
  }
  if (error) return <Failed>{error.message}</Failed>;
  if (!data) return <Loading>Loading workflows…</Loading>;
  const { rules, runs, meta, gateway, waiting } = data;
  const on = rules.filter((r) => r.enabled).length;

  if (editing) return <Builder start={editing} meta={meta} users={users} nameOf={nameOf} gateway={gateway} busy={busy} runs={runs.filter((r) => r.ruleId === editing.id)} onCancel={() => setEditing(null)}
    onSave={async (rule, done) => { const saved = await act(() => (rule.id ? crmSend("PUT", `workflows/${rule.id}`, rule) : crmSend("POST", "workflows", rule)), done); if (saved) setEditing(null); }} />;

  const blank = () => setEditing({ name: "", enabled: false, flow: { nodes: [node("t", "trigger", 60, 200, { type: "lead_created" })], edges: [] } });
  return (
    <>
      <Section title="Your workflows" desc="Each workflow starts when something happens to a lead (one or more When boxes; any of them starts it), then follows the boxes you joined: checks, waits and actions. A draft does nothing until you publish it, and a published workflow never acts on things that happened before." status={rules.length ? `${on} of ${rules.length} live` : "None yet"} tone={on ? "ok" : "off"}>
        {rules.length ? (
          <ul className="wf-list">
            {rules.map((r) => {
              const steps = r.flow.nodes.filter((n) => n.type !== "trigger").map((n) => label(n, meta, nameOf)[0]);
              return (
                <li key={r.id} className={r.enabled ? "wf-rule" : "wf-rule wf-off"}>
                  <div className="wf-text">
                    <b>{r.name} <span className={r.enabled ? "wf-pill wf-pill-live" : "wf-pill"}>{r.enabled ? "Live" : "Draft"}</span></b>
                    <p><span className="wf-k">When</span> {r.flow.nodes.filter((n) => n.type === "trigger").map((n) => triggerText(n.config, meta, nameOf)).join(", or ") || triggerText(r.trigger, meta, nameOf)}</p>
                    <p><span className="wf-k">Then</span> {steps.join(" → ")}</p>
                    <p className="muted">{r.runs ? `Started ${r.runs} time${r.runs === 1 ? "" : "s"}, last on ${when(r.lastRunAt)}` : "Has not run yet"}</p>
                  </div>
                  <div className="wf-buttons">
                    <button className="btn" disabled={busy} onClick={() => act(() => crmSend("PUT", `workflows/${r.id}`, { ...r, enabled: !r.enabled }), r.enabled ? `"${r.name}" is a draft again` : `"${r.name}" is live`)}>{r.enabled ? "Unpublish" : "Publish"}</button>
                    <button className="btn" disabled={busy} onClick={() => setEditing(structuredClone(r))}>Open</button>
                    <button className="btn btn-quiet" disabled={busy} onClick={() => confirm(`Delete the workflow "${r.name}"? Leads waiting in it stop; tasks and messages it already made stay.`) && act(() => crmSend("DELETE", `workflows/${r.id}`), "Workflow deleted")}>Delete</button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <p className="muted">No workflows yet. Start from an example below or draw your own.</p>}
        {waiting > 0 && <p className="muted">{waiting} lead{waiting === 1 ? " is" : "s are"} in a wait box right now.</p>}
        <div className="newlead-actions"><button className="btn btn-primary" onClick={blank}>New workflow</button></div>
      </Section>
      <Section title="Start from an example" desc="Opens the example on the canvas as a draft so you can change it before publishing.">
        <div className="wf-examples">
          {EXAMPLES.map(([text, rule]) => <button key={text} className="btn" onClick={() => setEditing(structuredClone({ enabled: false, ...rule }))}>{text}</button>)}
        </div>
      </Section>
      <Section title="Recent runs" desc="What the workflows did in the last 60 days, newest first.">
        <RunsTable runs={runs} />
      </Section>
    </>
  );
}

// the searchable list of steps (n8n's node creator); for the trigger it lists events instead
function Picker({ mode, onPick, onClose, joinTo = [], onJoin }) {
  const [q, setQ] = useState("");
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, [mode]);
  const groups = mode.kind === "trigger" ? [["When this happens", EVENTS.map(([t, name, icon, cfg, desc]) => ["trigger", name, icon, { type: t, ...cfg }, desc])]] : [["Actions", ADD], ["Flow", FLOW]];
  const want = q.trim().toLowerCase();
  const shown = groups.map(([title, items]) => [title, items.filter(([, name, , , desc]) => !want || `${name} ${desc}`.toLowerCase().includes(want))]).filter(([, items]) => items.length);
  return (
    <div className="wfd-inner">
      <div className="wfd-head">
        <h3>{mode.kind === "trigger" ? "Choose what starts the workflow" : mode.kind === "insert" ? "Put a step in between" : "What happens next?"}</h3>
        <button type="button" className="wfd-close" aria-label="Close" onClick={onClose}><TIcon name="x" size={18} /></button>
      </div>
      <input ref={input} className="field-input wfd-search" type="search" placeholder="Search steps…" aria-label="Search steps" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && shown[0]) { const [type, , , cfg] = shown[0][1][0]; onPick(type, cfg); } }} />
      {/* a line to a box already on the canvas (another When box joining the same steps, for example) */}
      {(() => {
        const joins = joinTo.filter(([, kind, text]) => !want || `${kind} ${text}`.toLowerCase().includes(want));
        return joins.length > 0 && (
          <div className="wfd-group">
            <div className="wfd-group-title">Join to a step already here</div>
            {joins.map(([id, kind, text, icon, cls]) => (
              <button key={id} type="button" className={`wfd-item ${cls}`} onClick={() => onJoin(id)}>
                <span className="wfd-icon"><TIcon name={icon} size={22} /></span>
                <span className="wfd-text"><b>{kind}</b><small>{text}</small></span>
              </button>
            ))}
          </div>
        );
      })()}
      {shown.map(([title, items]) => (
        <div key={title} className="wfd-group">
          <div className="wfd-group-title">{title}</div>
          {items.map(([type, name, icon, cfg, desc]) => (
            <button key={name} type="button" className={`wfd-item ${type === "action" ? `wfn-action wfn-${cfg.type}` : `wfn-${type}`}`} onClick={() => onPick(type, cfg)}>
              <span className="wfd-icon"><TIcon name={icon} size={22} /></span>
              <span className="wfd-text"><b>{name}</b><small>{desc}</small></span>
            </button>
          ))}
        </div>
      ))}
      {!shown.length && <p className="muted">No step matches “{q}”.</p>}
    </div>
  );
}

// "Test workflow": pick a lead, the server walks the flow for it without doing anything
function TestPanel({ leads, result, busy, onRun, onClose, onClear }) {
  const [q, setQ] = useState("");
  const want = q.trim().toLowerCase(), digits = want.replace(/\D/g, "");
  const found = want ? leads.filter((l) => !l.archived && (String(l.name || "").toLowerCase().includes(want) || (digits.length >= 3 && String(l.phone || "").includes(digits)))).slice(0, 8) : [];
  return (
    <div className="wfd-inner">
      <div className="wfd-head">
        <h3>Test workflow</h3>
        <button type="button" className="wfd-close" aria-label="Close" onClick={onClose}><TIcon name="x" size={18} /></button>
      </div>
      <p className="muted">Runs the workflow as drawn for one lead and shows what each step would do. Nothing is changed, sent or called.</p>
      <input className="field-input wfd-search" type="search" placeholder="Search a lead by name or phone" aria-label="Lead to test with" value={q} onChange={(e) => setQ(e.target.value)} />
      {found.map((l) => (
        <button key={l.id} type="button" className="wfd-lead" disabled={busy} onClick={() => onRun(l.id)}>
          <b>{l.name}</b><small>{[l.phone, l.city, l.source].filter(Boolean).join(" · ")}</small>
        </button>
      ))}
      {want && !found.length && <p className="muted">No lead matches.</p>}
      {result && <div className="wfd-result">
        <div className="wfd-group-title">Tested with {result.lead.name}</div>
        <p className="muted">Green steps would run, red ones would fail, grey ones are not reached. Click a step to see it.</p>
        <button type="button" className="btn btn-quiet" onClick={onClear}>Clear the test</button>
      </div>}
    </div>
  );
}

function Builder({ start, meta, users, nameOf, gateway, busy, runs, onSave, onCancel }) {
  const crm = useCrm();
  const notify = useToast();
  const [name, setName] = useState(start.name);
  const [nodes, setNodes] = useState(start.flow.nodes);
  const [edges, setEdges] = useState(start.flow.edges);
  const [selected, setSelected] = useState(""); // a node id, or "edge:<index>"
  const [drawer, setDrawer] = useState(null); // { kind: "settings" } | { kind: "add", from, port } | { kind: "insert", edge } | { kind: "trigger" } | { kind: "test" }
  const [tab, setTab] = useState("editor");
  const [full, setFull] = useState(false);
  const [view, setView] = useState({ x: 40, y: 40, k: 1 });
  const [drag, setDrag] = useState(null); // { kind: "pan" | "move" | "link", … }
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);
  const box = useRef(null);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sel = byId.get(selected);
  const triggers = nodes.filter((n) => n.type === "trigger");
  const MAX_WHEN = 5;
  const [testFrom, setTestFrom] = useState("");
  const live = Boolean(start.id && start.enabled);

  // a test result belongs to the flow it was run on; changing a step or a line drops it (moving nodes does not)
  const shape = JSON.stringify([nodes.map((n) => [n.id, n.config]), edges]);
  const tested = useRef("");
  useEffect(() => { if (test && tested.current !== shape) setTest(null); }, [shape]);

  const world = (e) => { const r = box.current.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k }; };
  const hit = (p) => nodes.find((n) => p.x >= n.x - 8 && p.x <= n.x + S + 8 && p.y >= n.y - 8 && p.y <= n.y + S + 8);
  const setConfig = (id, patch) => setNodes((all) => all.map((n) => (n.id === id ? { ...n, config: { ...n.config, ...patch } } : n)));
  const free = (x, y, skip = "") => { while (nodes.some((n) => n.id !== skip && Math.abs(n.x - x) < S + 40 && Math.abs(n.y - y) < S + 60)) y += S + 80; return y; };

  // ---- view ----
  const zoomAt = (k, cx, cy) => setView((v) => { const nk = Math.max(0.25, Math.min(1.6, k)); return { k: nk, x: cx - ((cx - v.x) / v.k) * nk, y: cy - ((cy - v.y) / v.k) * nk }; });
  const zoomBy = (f) => { const r = box.current.getBoundingClientRect(); zoomAt(view.k * f, r.width / 2, r.height / 2); };
  function fit() {
    const el = box.current;
    if (!el || !nodes.length) return;
    const r = el.getBoundingClientRect();
    const x0 = Math.min(...nodes.map((n) => n.x)) - 30, y0 = Math.min(...nodes.map((n) => n.y)) - 30;
    const x1 = Math.max(...nodes.map((n) => n.x)) + S + 90, y1 = Math.max(...nodes.map((n) => n.y)) + S + 60;
    const k = Math.max(0.25, Math.min(1.1, Math.min(r.width / (x1 - x0), r.height / (y1 - y0))));
    setView({ k, x: (r.width - (x1 - x0) * k) / 2 - x0 * k, y: (r.height - (y1 - y0) * k) / 2 - y0 * k });
  }
  // fit the flow on screen when the editor opens and while the page around it is still settling its size
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const t0 = Date.now();
    const ro = new ResizeObserver(() => { if (Date.now() - t0 < 1200 && el.clientWidth > 50) fitRef.current(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [full, tab]);
  // scroll moves the canvas; Ctrl (or ⌘) + scroll, or a pinch on a touchpad, zooms where the pointer is
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { const r = el.getBoundingClientRect(); setView((v) => { const nk = Math.max(0.25, Math.min(1.6, v.k * Math.exp(-e.deltaY / 300))), cx = e.clientX - r.left, cy = e.clientY - r.top; return { k: nk, x: cx - ((cx - v.x) / v.k) * nk, y: cy - ((cy - v.y) / v.k) * nk }; }); }
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [tab]);

  // ---- editing ----
  function place(type, config, from, port) {
    const id = newId();
    const x = from ? from.x + S + GAP : 60;
    const y = free(x, from ? from.y + (PORT_Y[port] - S / 2) * 2.2 : 200);
    setNodes((all) => [...all, { id, type, x, y, config: structuredClone(config) }]);
    if (from) setEdges((all) => [...all, { from: from.id, port, to: id }]);
    return id;
  }
  function pick(type, config) {
    const m = drawer;
    if (m.kind === "trigger") {
      const { type: t, ...rest } = config, next = { type: t, ...structuredClone(rest) };
      // a new When box goes under the others, on the left; otherwise the chosen When box changes
      if (m.add) {
        const id = newId(), x = Math.min(...triggers.map((n) => n.x), 60), y = free(x, Math.max(...triggers.map((n) => n.y), 80) + S + 80);
        setNodes((all) => [...all, { id, type: "trigger", x, y, config: next }]);
        setSelected(id); setDrawer({ kind: "settings" });
        return;
      }
      const target = m.node || (sel?.type === "trigger" ? sel.id : triggers[0].id);
      setNodes((all) => all.map((n) => (n.id === target ? { ...n, config: next } : n)));
      setSelected(target); setDrawer({ kind: "settings" });
      return;
    }
    let id;
    if (m.kind === "insert") {
      const e = edges[m.edge], a = byId.get(e.from), b = byId.get(e.to);
      id = newId();
      // make room: the later part of the flow moves right
      const later = new Set([b.id]);
      for (let grew = true; grew;) { grew = false; for (const x of edges) if (later.has(x.from) && !later.has(x.to)) { later.add(x.to); grew = true; } }
      const x = a.x + S + GAP, y = a.y + (PORT_Y[e.port] - S / 2) * 2.2;
      const shift = Math.max(0, x + S + GAP - b.x);
      setNodes((all) => [...all.map((n) => (later.has(n.id) ? { ...n, x: n.x + shift } : n)), { id, type, x, y, config: structuredClone(config) }]);
      setEdges((all) => [...all.filter((_, i) => i !== m.edge), { from: e.from, port: e.port, to: id }, { from: id, port: PORTS[type][0], to: e.to }]);
    } else {
      const from = m.from ? byId.get(m.from) : sel && sel.type !== undefined ? sel : nodes[nodes.length - 1];
      const port = m.port || (from ? PORTS[from.type].find((p) => !edges.some((x) => x.from === from.id && x.port === p)) || PORTS[from.type][0] : "out");
      id = place(type, config, from, port);
    }
    setSelected(id); setDrawer({ kind: "settings" });
  }
  function remove(which = selected) {
    if (which.startsWith("edge:")) { const i = Number(which.slice(5)); setEdges((all) => all.filter((_, j) => j !== i)); setSelected(""); return; }
    const n = byId.get(which);
    if (!n || (n.type === "trigger" && triggers.length < 2)) return;
    // like n8n: the step before is joined straight to the step after when there is only one of each
    const ins = edges.filter((e) => e.to === which), outs = edges.filter((e) => e.from === which);
    setEdges((all) => [...all.filter((e) => e.from !== which && e.to !== which), ...(ins.length === 1 && outs.length === 1 ? [{ from: ins[0].from, port: ins[0].port, to: outs[0].to }] : [])]);
    setNodes((all) => all.filter((x) => x.id !== which));
    setSelected(""); setDrawer(null);
  }
  useEffect(() => {
    const key = (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) return;
      if (e.key === "Escape") { if (drawer) setDrawer(null); else setFull(false); return; }
      if (["Delete", "Backspace"].includes(e.key) && selected) { e.preventDefault(); remove(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  // ---- pointer: pan the background, move a node, or pull a line out of an output ----
  function down(e, kind, extra = {}) {
    e.stopPropagation();
    if (e.button !== undefined && e.button !== 0) return;
    box.current.setPointerCapture?.(e.pointerId);
    const p = world(e);
    setDrag({ kind, sx: e.clientX, sy: e.clientY, moved: false, vx: view.x, vy: view.y, ...p, ...extra });
  }
  function move(e) {
    if (!drag) return;
    const moved = drag.moved || Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4;
    if (drag.kind === "pan") { setView((v) => ({ ...v, x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy })); setDrag({ ...drag, moved }); return; }
    const p = world(e);
    if (drag.kind === "move" && moved) setNodes((all) => all.map((n) => (n.id === drag.id ? { ...n, x: Math.round(p.x - drag.dx), y: Math.round(p.y - drag.dy) } : n)));
    setDrag({ ...drag, moved, px: p.x, py: p.y });
  }
  function up(e) {
    if (!drag) return;
    if (drag.kind === "pan" && !drag.moved) { setSelected(""); if (drawer?.kind === "settings") setDrawer(null); }
    if (drag.kind === "move" && !drag.moved) { setSelected(drag.id); setDrawer({ kind: "settings" }); }
    if (drag.kind === "link") {
      const target = drag.moved && hit(world(e));
      if (target && target.id !== drag.id && target.type !== "trigger") setEdges((all) => (all.some((x) => x.from === drag.id && x.port === drag.port && x.to === target.id) ? all : [...all, { from: drag.id, port: drag.port, to: target.id }]));
      else if (!drag.moved || !target) { setSelected(drag.id); setDrawer({ kind: "add", from: drag.id, port: drag.port }); }
    }
    setDrag(null);
  }

  // boxes a "+" can join to instead of adding a new one: not a When box, not itself, not already joined from this side,
  // and not a box that leads back to it (that would make a loop)
  function joinChoices(m) {
    if (m.kind !== "add" || !m.from || !byId.get(m.from)) return [];
    const before = new Set([m.from]);
    for (let grew = true; grew;) { grew = false; for (const e of edges) if (before.has(e.to) && !before.has(e.from)) { before.add(e.from); grew = true; } }
    return nodes.filter((n) => n.type !== "trigger" && !before.has(n.id) && !edges.some((e) => e.from === m.from && (!m.port || e.port === m.port) && e.to === n.id))
      .map((n) => { const [kind, text] = label(n, meta, nameOf); return [n.id, kind, text, iconOf(n), kindClass(n)]; });
  }

  async function runTest(leadId) {
    setTesting(true);
    try {
      const r = await crmSend("POST", "workflows/test", { ...(start.id ? { id: start.id } : {}), name, flow: { nodes, edges }, leadId, from: testFrom || triggers[0]?.id || "" });
      tested.current = shape;
      setTest(r);
      const bad = Object.values(r.steps).filter((s) => s.status === "error").length;
      notify(bad ? `Test: ${bad} step${bad === 1 ? "" : "s"} would fail` : "Test: every reached step would run");
    } catch (err) { notify(err.message); } finally { setTesting(false); }
  }

  const curve = (x1, y1, x2, y2) => {
    const d = Math.max(50, Math.abs(x2 - x1) / 2);
    return x2 > x1 + 20 ? `M${x1},${y1} C${x1 + d},${y1} ${x2 - d},${y2} ${x2},${y2}` : `M${x1},${y1} C${x1 + 90},${y1} ${x1 + 90},${y1 + 120} ${(x1 + x2) / 2},${Math.max(y1, y2) + 120} S${x2 - 90},${y2} ${x2},${y2}`;
  };
  const mid = (x1, y1, x2, y2) => (x2 > x1 + 20 ? [(x1 + x2) / 2, (y1 + y2) / 2] : [(x1 + x2) / 2, Math.max(y1, y2) + 120]);

  const save = (enabled) => onSave({ ...(start.id ? { id: start.id } : {}), name, enabled, flow: { nodes, edges } },
    enabled ? (live ? `"${name}" saved; it stays live` : `"${name}" is live`) : live ? `"${name}" is a draft again` : `Draft "${name}" saved`);
  const people = users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>);
  const stageOptions = meta.stages.map((s) => <option key={s} value={s}>{s}</option>);
  const used = new Set(edges.map((e) => `${e.from}:${e.port}`));
  const ran = new Set(test?.lines || []);

  return (
    <div className={full ? "wfb wfb-full" : "wfb"}>
      <div className="wfb-top">
        <button type="button" className="btn btn-quiet wfb-back" aria-label="Back to the workflow list" onClick={onCancel}><TIcon name="chevronLeft" size={18} /></button>
        <input className="field-input wfb-name" aria-label="Workflow name" placeholder="Name this workflow, like “Call back missed calls”" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        <span className={live ? "wf-pill wf-pill-live" : "wf-pill"}>{live ? "Live" : "Draft"}</span>
        <span className="wfb-actions">
          {live
            ? <><button className="btn" disabled={busy} onClick={() => save(false)}>Unpublish</button><button className="btn btn-primary" disabled={busy} onClick={() => save(true)}>Save changes</button></>
            : <><button className="btn" disabled={busy} onClick={() => save(false)}>Save draft</button><button className="btn btn-primary" disabled={busy} onClick={() => save(true)}>Publish</button></>}
        </span>
      </div>
      <div className="wfb-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "editor"} className={tab === "editor" ? "wfb-tab wfb-tab-on" : "wfb-tab"} onClick={() => setTab("editor")}>Editor</button>
        <button type="button" role="tab" aria-selected={tab === "runs"} className={tab === "runs" ? "wfb-tab wfb-tab-on" : "wfb-tab"} onClick={() => setTab("runs")}>Executions{runs.length ? ` (${runs.length})` : ""}</button>
        {tab === "editor" && <span className="wfb-view">
          <button type="button" className="btn" onClick={() => setFull((f) => !f)}>{full ? "Exit full screen" : "Full screen"}</button>
        </span>}
      </div>
      {tab === "runs" ? (
        <div className="wfb-runs">{start.id ? <RunsTable runs={runs} showRule={false} /> : <p className="muted">This workflow has not been saved yet.</p>}</div>
      ) : (
        <div className={drawer ? "wfc wfc-drawer" : "wfc"}>
          <div className="wfc-stage" ref={box} onPointerDown={(e) => down(e, "pan")} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
            <svg className={drag?.kind === "pan" && drag.moved ? "wfc-svg wfc-panning" : "wfc-svg"} width="100%" height="100%">
              <defs>
                <pattern id="wfc-dots" width={26 * view.k} height={26 * view.k} x={view.x} y={view.y} patternUnits="userSpaceOnUse"><circle cx={1} cy={1} r={Math.max(0.7, 1.1 * view.k)} className="wfc-dot" /></pattern>
                <marker id="wfc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="wfc-arrowhead" /></marker>
              </defs>
              <rect width="100%" height="100%" fill="url(#wfc-dots)" />
              <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
                {edges.map((e, i) => {
                  const a = byId.get(e.from), b = byId.get(e.to);
                  if (!a || !b) return null;
                  const x1 = a.x + S, y1 = a.y + PORT_Y[e.port], x2 = b.x, y2 = b.y + S / 2, [mx, my] = mid(x1, y1, x2, y2), d = curve(x1, y1, x2, y2);
                  const on = selected === "edge:" + i, hot = ran.has(`${e.from}:${e.port}:${e.to}`);
                  return (
                    <g key={`${e.from}:${e.port}:${e.to}`} className={`wfc-edge${on ? " wfc-edge-on" : ""}${hot ? " wfc-edge-ran" : ""}${test && !hot ? " wfc-idle" : ""}`}
                      onPointerDown={(ev) => { ev.stopPropagation(); setSelected("edge:" + i); }}>
                      <path d={d} className="wfc-edge-hit" />
                      <path d={d} className={`wfc-edge-line wfc-edge-${e.port}`} markerEnd="url(#wfc-arrow)" />
                      <g className="wfc-edge-tools" transform={`translate(${mx},${my})`}>
                        <g className="wfc-tool" onPointerDown={(ev) => { ev.stopPropagation(); setSelected("edge:" + i); setDrawer({ kind: "insert", edge: i }); }}>
                          <title>Put a step in between</title>
                          <rect x={-30} y={-13} width={26} height={26} rx={6} /><path d="M-17,-6 V6 M-23,0 H-11" />
                        </g>
                        <g className="wfc-tool wfc-tool-del" onPointerDown={(ev) => { ev.stopPropagation(); remove("edge:" + i); }}>
                          <title>Remove this line</title>
                          <rect x={4} y={-13} width={26} height={26} rx={6} /><svg x={8} y={-9} width={18} height={18} viewBox="0 0 24 24"><path d={ICONS.trash} /></svg>
                        </g>
                      </g>
                    </g>
                  );
                })}
                {drag?.kind === "link" && drag.moved && (() => { const a = byId.get(drag.id); return <path d={curve(a.x + S, a.y + PORT_Y[drag.port], drag.px, drag.py)} className="wfc-edge-line wfc-edge-draft" />; })()}
                {nodes.map((n) => {
                  const [kind, text] = label(n, meta, nameOf), step = test?.steps[n.id];
                  const cls = `wfc-node ${kindClass(n)}${selected === n.id ? " wfc-node-on" : ""}${step ? ` wfc-${step.status}` : test ? " wfc-idle" : ""}`;
                  return (
                    <g key={n.id} transform={`translate(${n.x},${n.y})`} className={cls} onPointerDown={(e) => down(e, "move", { id: n.id, dx: world(e).x - n.x, dy: world(e).y - n.y })}>
                      <title>{`${kind}: ${text}${step ? `\nTest: ${step.text}` : ""}`}</title>
                      {n.type === "trigger"
                        ? <path className="wfc-box" d={`M${S / 2},0 H${S - 12} Q${S},0 ${S},12 V${S - 12} Q${S},${S} ${S - 12},${S} H${S / 2} A${S / 2},${S / 2} 0 0 1 ${S / 2},0 Z`} />
                        : <rect className="wfc-box" width={S} height={S} rx={n.type === "condition" ? 18 : 12} />}
                      <svg className="wfc-icon" x={S / 2 - 20} y={S / 2 - 20} width={40} height={40} viewBox="0 0 24 24"><path d={ICONS[iconOf(n)]} /></svg>
                      {n.type === "trigger" && <svg className="wfc-bolt" x={-8} y={S / 2 - 10} width={20} height={20} viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></svg>}
                      {step && <g className="wfc-badge" transform={`translate(${S - 8},8)`}><circle r={11} /><path d={step.status === "error" ? "M-4,-4 L4,4 M4,-4 L-4,4" : "M-5,0 L-1.5,4 L5,-4"} /></g>}
                      <text className="wfc-name" x={S / 2} y={S + 20}>{cut(kind, 22)}</text>
                      <text className="wfc-sub" x={S / 2} y={S + 37}>{cut(step ? step.text : text, 30)}</text>
                      {n.type !== "trigger" && <circle className="wfc-port wfc-in" cx={0} cy={S / 2} r={6} />}
                      {PORTS[n.type].map((port) => (
                        <g key={port}>
                          {!used.has(`${n.id}:${port}`) && (
                            <g className="wfc-stub" onPointerDown={(e) => { e.stopPropagation(); setSelected(n.id); setDrawer({ kind: "add", from: n.id, port }); }}>
                              <title>Add the next step</title>
                              <line x1={S + 6} y1={PORT_Y[port]} x2={S + 44} y2={PORT_Y[port]} />
                              <rect x={S + 44} y={PORT_Y[port] - 13} width={26} height={26} rx={6} />
                              <path d={`M${S + 57},${PORT_Y[port] - 6} V${PORT_Y[port] + 6} M${S + 51},${PORT_Y[port]} H${S + 63}`} />
                            </g>
                          )}
                          {/* a wider, unseen grab area: the dot itself is small, and a near miss used to move the whole box */}
                          <circle className="wfc-port-hit" cx={S} cy={PORT_Y[port]} r={16} onPointerDown={(e) => down(e, "link", { id: n.id, port })}><title>Drag to another step to join them</title></circle>
                          <circle className={`wfc-port wfc-out wfc-port-${port}`} cx={S} cy={PORT_Y[port]} r={7} onPointerDown={(e) => down(e, "link", { id: n.id, port })}><title>Drag to another step to join them</title></circle>
                          {port !== "out" && <text className="wfc-port-label" x={S + 10} y={PORT_Y[port] - 8}>{port}</text>}
                        </g>
                      ))}
                    </g>
                  );
                })}
              </g>
            </svg>
            <div className="wfc-tools-tr">
              {triggers.length < MAX_WHEN && <button type="button" className="btn wfc-add-when" title="Another thing that also starts this workflow" onPointerDown={(e) => e.stopPropagation()} onClick={() => setDrawer({ kind: "trigger", add: true })}><TIcon name="plus" size={16} /> Add another When</button>}
              <button type="button" className="wfc-btn wfc-btn-plus" aria-label="Add a step" title="Add a step" onPointerDown={(e) => e.stopPropagation()} onClick={() => setDrawer({ kind: "add", from: sel && sel.type ? sel.id : "", port: "" })}><TIcon name="plus" size={22} /></button>
            </div>
            <div className="wfc-tools-bl" onPointerDown={(e) => e.stopPropagation()}>
              <button type="button" className="wfc-btn" aria-label="Fit the workflow on screen" title="Fit to view" onClick={fit}><TIcon name="columns" size={18} /></button>
              <button type="button" className="wfc-btn" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(1.2)}><TIcon name="plus" size={18} /></button>
              <button type="button" className="wfc-btn" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(1 / 1.2)}><svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg></button>
              <button type="button" className="wfc-btn wfc-btn-text" aria-label="Zoom to 100%" title="Actual size" onClick={() => zoomBy(1 / view.k)}>{Math.round(view.k * 100)}%</button>
            </div>
            <div className="wfc-tools-bc" onPointerDown={(e) => e.stopPropagation()}>
              <button type="button" className="btn btn-primary wfc-test" onClick={() => setDrawer({ kind: "test" })}><TIcon name="sparkle" size={16} /> Test workflow</button>
            </div>
            <p className="wfc-hint muted">Drag the background to move · Ctrl + scroll to zoom · Click a step to set it up</p>
          </div>
          {drawer && (
            <aside className="wfd" aria-label="Step panel" onPointerDown={(e) => e.stopPropagation()}>
              {drawer.kind === "settings" && sel && <>
                <div className="wfd-head">
                  <span className={`wfd-icon ${kindClass(sel)}`}><TIcon name={iconOf(sel)} size={22} /></span>
                  <h3>{label(sel, meta, nameOf)[0]}</h3>
                  <button type="button" className="wfd-close" aria-label="Close" onClick={() => setDrawer(null)}><TIcon name="x" size={18} /></button>
                </div>
                {test?.steps[sel.id] && <p className={`wfd-test wfd-test-${test.steps[sel.id].status}`}>Test with {test.lead.name}: {test.steps[sel.id].text}</p>}
                {test && !test.steps[sel.id] && <p className="wfd-test">Test with {test.lead.name}: not reached</p>}
                {sel.type === "trigger" && <button type="button" className="btn wfd-change" onClick={() => setDrawer({ kind: "trigger", node: sel.id })}>Change what starts it</button>}
                {sel.type === "trigger" && triggers.length < MAX_WHEN && <button type="button" className="btn wfd-change" onClick={() => setDrawer({ kind: "trigger", add: true })}>Add another When</button>}
                {sel.type === "trigger" && triggers.length > 1 && <p className="muted wfd-note">This workflow starts when any of its {triggers.length} When boxes happens.</p>}
                <BoxForm n={sel} meta={meta} users={users} people={people} stageOptions={stageOptions} gateway={gateway} canRemove={sel.type !== "trigger" || triggers.length > 1} set={(patch) => setConfig(sel.id, patch)} replace={(config) => setNodes((all) => all.map((x) => (x.id === sel.id ? { ...x, config } : x)))} onRemove={() => remove(sel.id)} />
              </>}
              {drawer.kind === "settings" && !sel && <div className="wfd-inner"><p className="muted">Click a step to set it up.</p></div>}
              {["add", "insert", "trigger"].includes(drawer.kind) && <Picker mode={drawer} onPick={pick} onClose={() => setDrawer(null)} joinTo={joinChoices(drawer)}
                onJoin={(to) => { const from = byId.get(drawer.from), port = drawer.port || PORTS[from.type].find((p) => !edges.some((x) => x.from === from.id && x.port === p)) || PORTS[from.type][0]; setEdges((all) => [...all, { from: from.id, port, to }]); setSelected(""); setDrawer(null); }} />}
              {drawer.kind === "test" && triggers.length > 1 && (
                <label className="wfd-from">Start the test from
                  <select className="field-input" value={testFrom || triggers[0].id} onChange={(e) => { setTestFrom(e.target.value); setTest(null); }}>
                    {triggers.map((t) => <option key={t.id} value={t.id}>{triggerText(t.config, meta, nameOf)}</option>)}
                  </select>
                </label>
              )}
              {drawer.kind === "test" && <TestPanel leads={crm?.leads || []} result={test} busy={testing} onRun={runTest} onClose={() => setDrawer(null)} onClear={() => setTest(null)} />}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

function FieldOptions({ meta, only }) {
  const custom = Object.entries(meta.custom || {});
  return <>
    <optgroup label="Lead">{Object.entries(meta.fields).filter(([k]) => !only || only(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</optgroup>
    {custom.length > 0 && <optgroup label="TeleCRM fields">{custom.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</optgroup>}
  </>;
}

function BoxForm({ n, meta, users, people, stageOptions, gateway, set, replace, onRemove, canRemove = n.type !== "trigger" }) {
  const c = n.config;
  const setCond = (i, patch) => set({ conditions: c.conditions.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <div className="wfb-form">
      {n.type === "trigger" && <>
        <h3>When</h3>
        <label>This happens<select className="field-input" value={c.type} onChange={(e) => replace({ type: e.target.value, ...structuredClone(EVENTS.find(([t]) => t === e.target.value)?.[3] || {}) })}>
          {Object.entries(meta.triggers).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></label>
        {c.type === "stage_changed" && <>
          <label>Moves to<select className="field-input" value={c.to || ""} onChange={(e) => set({ to: e.target.value })}><option value="">Any stage</option>{stageOptions}</select></label>
          <label>Moves from<select className="field-input" value={c.from || ""} onChange={(e) => set({ from: e.target.value })}><option value="">Any stage</option>{stageOptions}</select></label>
        </>}
        {c.type === "owner_changed" && <>
          <label>Assigned to<select className="field-input" value={c.to || ""} onChange={(e) => set({ to: e.target.value })}><option value="">Anyone</option>{people}</select></label>
          <Note>Runs when the lead gets a new owner, from any screen, the phone app or TeleCRM.</Note>
        </>}
        {c.type === "field_changed" && <>
          <label>Field<select className="field-input" value={c.field || ""} onChange={(e) => set({ field: e.target.value, to: "" })}><FieldOptions meta={meta} only={(k) => !["stage", "owner", "rating"].includes(k)} /></select></label>
          <label>Changes to (leave empty for any change)<input className="field-input" value={c.to || ""} maxLength={200} placeholder="Kerala" onChange={(e) => set({ to: e.target.value })} /></label>
          <Note>TeleCRM fields change here when TeleCRM's copy is read again, every few minutes.</Note>
        </>}
        {c.type === "rating_changed" && <label>New rating<select className="field-input" value={c.to ?? ""} onChange={(e) => set({ to: e.target.value })}><option value="">Any change</option>{[0, 1, 2, 3, 4, 5].map((r) => <option key={r} value={String(r)}>{r}</option>)}</select></label>}
        {c.type === "no_activity" && <>
          <label>Days without a call, message or note<input className="field-input" type="number" min={1} max={365} value={c.days ?? 3} onChange={(e) => set({ days: Number(e.target.value) })} /></label>
          <Note>Closed and archived leads are left out. A lead counts once it has been quiet this long, and at most 3 days more, so leads that died long ago are not woken up all at once.</Note>
        </>}
      </>}
      {n.type === "condition" && <>
        <h3>If</h3>
        <label>Go down <b>yes</b> when<select className="field-input" value={c.match} onChange={(e) => set({ match: e.target.value })}><option value="all">all of these are true</option><option value="any">any of these is true</option></select></label>
        {c.conditions.map((x, i) => (
          <div key={i} className="wfb-cond">
            <select className="field-input" aria-label="Field" value={x.field} onChange={(e) => setCond(i, { field: e.target.value, value: "" })}><FieldOptions meta={meta} /></select>
            <select className="field-input" aria-label="Test" value={x.op} onChange={(e) => setCond(i, { op: e.target.value })}>{Object.entries(meta.ops).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            {!["is_empty", "not_empty"].includes(x.op) && (x.field === "owner"
              ? <select className="field-input" aria-label="Person" value={x.value} onChange={(e) => setCond(i, { value: e.target.value })}><option value="">Choose…</option>{people}</select>
              : x.field === "stage" && !["contains", "more", "less"].includes(x.op)
                ? <select className="field-input" aria-label="Stage" value={x.value} onChange={(e) => setCond(i, { value: e.target.value })}><option value="">Choose…</option>{stageOptions}</select>
                : <input className="field-input" aria-label="Value" value={x.value} maxLength={200} inputMode={["more", "less"].includes(x.op) ? "decimal" : undefined} placeholder={["more", "less"].includes(x.op) ? "100000" : x.field === "source" ? "IndiaMART" : x.field === "city" ? "Coimbatore" : ""} onChange={(e) => setCond(i, { value: e.target.value })} />)}
            {c.conditions.length > 1 && <button type="button" className="btn btn-quiet" onClick={() => set({ conditions: c.conditions.filter((_, j) => j !== i) })}>Remove test</button>}
          </div>
        ))}
        <button type="button" className="btn" disabled={c.conditions.length >= 10} onClick={() => set({ conditions: [...c.conditions, { field: "city", op: "is", value: "" }] })}>Add test</button>
      </>}
      {n.type === "wait" && <>
        <h3>Time delay</h3>
        <label>Hold the lead for<select className="field-input" value={String(c.hours)} onChange={(e) => set({ hours: Number(e.target.value) })}>
          {[0.25, 0.5, 1, 2, 4, 8, 24, 48, 72, 120, 168, 336, 720].map((h) => <option key={h} value={h}>{hoursText(h)}</option>)}
        </select></label>
        <Note>After the wait, the next boxes see the lead as it is then, so put an If box after a wait to check it is still worth doing.</Note>
      </>}
      {n.type === "action" && <>
        <h3>{meta.actions[c.type]}</h3>
        <label>Action<select className="field-input" value={c.type} onChange={(e) => { const found = ADD.find(([, , , cfg]) => cfg.type === e.target.value); replace(found ? structuredClone(found[3]) : { type: e.target.value }); }}>
          {Object.entries(meta.actions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></label>
        {c.type === "assign" && <>
          <label>To<select className="field-input" value={c.to || ""} onChange={(e) => set({ to: e.target.value, users: c.users || [] })}><option value="">Choose…</option><option value="round_robin">Take turns between people</option>{people}</select></label>
          {c.to === "round_robin" && <div className="wfb-people">{users.map((u) => (
            <label key={u.id} className="check"><input type="checkbox" checked={(c.users || []).includes(u.id)} onChange={(e) => set({ users: e.target.checked ? [...(c.users || []), u.id] : (c.users || []).filter((x) => x !== u.id) })} /> {u.name}</label>
          ))}</div>}
        </>}
        {c.type === "stage" && <label>Move to<select className="field-input" value={c.stage || ""} onChange={(e) => set({ stage: e.target.value })}><option value="">Choose…</option>{meta.pipeline.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>}
        {c.type === "field" && <>
          <label>Field<select className="field-input" value={c.field || ""} onChange={(e) => set({ field: e.target.value })}>{Object.entries(meta.editable || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Set it to<input className="field-input" value={c.value || ""} maxLength={200} placeholder={c.field === "value" ? "100000" : "Leave empty to clear it"} onChange={(e) => set({ value: e.target.value })} /></label>
          <p className="muted">{PLACEHOLDERS}</p>
          <Note>TeleCRM's own fields are not written from here: TeleCRM keeps them.</Note>
        </>}
        {c.type === "task" && <>
          <label>Task<input className="field-input" value={c.title || ""} maxLength={300} placeholder="Call {name}" onChange={(e) => set({ title: e.target.value })} /></label>
          <label>Due after<select className="field-input" value={String(c.hours ?? 1)} onChange={(e) => set({ hours: Number(e.target.value) })}>
            {[0, 0.25, 0.5, 1, 2, 4, 24, 48, 72, 168].map((h) => <option key={h} value={h}>{h ? hoursText(h) : "Right away"}</option>)}
          </select></label>
          <label>For<select className="field-input" value={c.owner || "lead_owner"} onChange={(e) => set({ owner: e.target.value })}><option value="lead_owner">The lead's owner</option>{people}</select></label>
          <p className="muted">{PLACEHOLDERS}</p>
        </>}
        {c.type === "whatsapp" && <>
          <label>Message<textarea className="field-input" rows={4} maxLength={1000} value={c.text || ""} disabled={Boolean(c.template)} placeholder="Hello {name}, thank you for your enquiry." onChange={(e) => set({ text: e.target.value })} /></label>
          <label>Or an approved template<input className="field-input" value={c.template || ""} maxLength={80} placeholder="enquiry_thanks" onChange={(e) => set({ template: e.target.value.toLowerCase() })} /></label>
          <p className="muted">{PLACEHOLDERS}</p>
          <Note tone={gateway ? "info" : "warn"}>{gateway ? "Sent through the WhatsApp gateway. A plain message reaches the customer only within 24 hours of their last message; for new leads use an approved template." : "The WhatsApp gateway is not connected, so this will not be sent. Connect it in Settings, WhatsApp gateway."}</Note>
        </>}
        {c.type === "notify" && <>
          <label>Tell<select className="field-input" value={c.to || "lead_owner"} onChange={(e) => set({ to: e.target.value })}><option value="lead_owner">The lead's owner</option>{people}</select></label>
          <label>Message<textarea className="field-input" rows={3} maxLength={500} value={c.text || ""} onChange={(e) => set({ text: e.target.value })} /></label>
          <p className="muted">{PLACEHOLDERS}</p>
          <Note>Shows under the bell at the top of Salesdesk, with a link to the lead.</Note>
        </>}
        {c.type === "cancel_tasks" && <>
          <label>Which open tasks of this lead<select className="field-input" value={c.which || "workflow"} onChange={(e) => set({ which: e.target.value })}><option value="workflow">Only tasks made by workflows</option><option value="all">All open tasks, also ones people made</option></select></label>
          <Note>Cancelled tasks are marked done, so they leave everyone's list.</Note>
        </>}
        {c.type === "webhook" && <>
          <label>Address<input className="field-input" value={c.url || ""} maxLength={500} placeholder="https://n8n.example.com/webhook/new-lead" onChange={(e) => set({ url: e.target.value.trim() })} /></label>
          <Note>Sends the lead's name, phone, company, city, source, stage, owner and value as JSON in a POST, for n8n or any other tool. Only public https addresses; the reply is not read.</Note>
        </>}
        {c.type === "note" && <label>Note<textarea className="field-input" rows={3} maxLength={2000} value={c.text || ""} onChange={(e) => set({ text: e.target.value })} /></label>}
      </>}
      {canRemove && <button type="button" className="btn btn-quiet wfb-remove" onClick={onRemove}>Remove this box</button>}
    </div>
  );
}
