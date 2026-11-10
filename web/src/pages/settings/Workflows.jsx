import React, { useEffect, useRef, useState } from "react";
import { crmGet, crmSend } from "../../api.js";
import { useLoad } from "../../hooks.js";
import { useToast } from "../../toast.jsx";
import { hashFor } from "../../format.js";
import { Section, Note, Loading, Failed } from "./Parts.jsx";

// Workflows are drawn as flows: a trigger box, then condition (yes / no), wait and action boxes joined by lines.
// The canvas is plain SVG (no inline styles: the CSP allows only stylesheets), so boxes move by their x / y attributes.
const W = 216, H = 76, CANVAS_W = 1800, CANVAS_H = 1100;
const PORT_Y = { out: H / 2, yes: H * 0.32, no: H * 0.72 };
const PORTS = { trigger: ["out"], condition: ["yes", "no"], wait: ["out"], action: ["out"] };
const PLACEHOLDERS = "Use {name}, {company}, {city}, {source} or {owner} to fill in the lead's details.";
const newId = () => "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const ADD = [
  ["condition", "If / else", { match: "all", conditions: [{ field: "source", op: "contains", value: "" }] }],
  ["wait", "Wait", { hours: 24 }],
  ["action", "Assign the lead", { type: "assign", to: "" }],
  ["action", "Change the stage", { type: "stage", stage: "" }],
  ["action", "Follow-up task", { type: "task", title: "Call {name}", hours: 1, owner: "lead_owner" }],
  ["action", "WhatsApp message", { type: "whatsapp", text: "" }],
  ["action", "Add a note", { type: "note", text: "" }],
];

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
function triggerText(t, meta) {
  if (t.type === "stage_changed") return `Moves${t.from ? ` from ${t.from}` : ""} to ${t.to || "any stage"}`;
  if (t.type === "no_activity") return `No activity for ${t.days} day${t.days === 1 ? "" : "s"}`;
  return meta.triggers[t.type] || t.type;
}
// the two lines a box shows: what kind of box, and what it does
function label(n, meta, nameOf) {
  const c = n.config;
  if (n.type === "trigger") return ["When", triggerText(c, meta)];
  if (n.type === "wait") return ["Wait", hoursText(c.hours || 0)];
  if (n.type === "condition") {
    const parts = (c.conditions || []).map((x) => `${meta.fields[x.field]} ${meta.ops[x.op]}${x.value ? " " + (x.field === "owner" ? nameOf(x.value) : x.value) : ""}`);
    return ["If", parts.join(c.match === "any" ? " or " : " and ") || "No test yet"];
  }
  if (c.type === "assign") return ["Assign", c.to === "round_robin" ? `In turn: ${(c.users || []).map(nameOf).join(", ") || "pick people"}` : c.to ? nameOf(c.to) : "Choose a person"];
  if (c.type === "stage") return ["Change stage", c.stage || "Choose a stage"];
  if (c.type === "task") return ["Task", c.title ? `${c.title}${c.hours ? ` · in ${hoursText(c.hours)}` : ""}` : "Write the task"];
  if (c.type === "whatsapp") return ["WhatsApp", c.template ? `Template ${c.template}` : c.text || "Write the message"];
  return ["Note", c.text || "Write the note"];
}
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const kindClass = (n) => (n.type === "action" ? `wfn-action wfn-${n.config.type}` : `wfn-${n.type}`);

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
    try { await fn(); notify(done); reload(); return true; } catch (e) { notify(e.message); return false; } finally { setBusy(false); }
  }
  if (error) return <Failed>{error.message}</Failed>;
  if (!data) return <Loading>Loading workflows…</Loading>;
  const { rules, runs, meta, gateway, waiting } = data;
  const on = rules.filter((r) => r.enabled).length;

  if (editing) return <Builder start={editing} meta={meta} users={users} nameOf={nameOf} gateway={gateway} busy={busy} onCancel={() => setEditing(null)}
    onSave={async (rule) => { if (await act(() => (rule.id ? crmSend("PUT", `workflows/${rule.id}`, rule) : crmSend("POST", "workflows", rule)), `Workflow "${rule.name}" saved`)) setEditing(null); }} />;

  const blank = () => setEditing({ name: "", enabled: true, flow: { nodes: [node("t", "trigger", 40, 160, { type: "lead_created" })], edges: [] } });
  return (
    <>
      <Section title="Your workflows" desc="Each workflow starts when one thing happens to a lead, then follows the boxes you joined: checks, waits and actions. It never acts on things that happened before it was saved." status={rules.length ? `${on} of ${rules.length} on` : "None yet"} tone={on ? "ok" : "off"}>
        {rules.length ? (
          <ul className="wf-list">
            {rules.map((r) => {
              const steps = r.flow.nodes.filter((n) => n.type !== "trigger").map((n) => label(n, meta, nameOf)[0]);
              return (
                <li key={r.id} className={r.enabled ? "wf-rule" : "wf-rule wf-off"}>
                  <div className="wf-text">
                    <b>{r.name}</b>
                    <p><span className="wf-k">When</span> {triggerText(r.trigger, meta)}</p>
                    <p><span className="wf-k">Then</span> {steps.join(" → ")}</p>
                    <p className="muted">{r.runs ? `Started ${r.runs} time${r.runs === 1 ? "" : "s"}, last on ${new Date(r.lastRunAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : "Has not run yet"}</p>
                  </div>
                  <div className="wf-buttons">
                    <label className="check"><input type="checkbox" checked={r.enabled} disabled={busy} onChange={(e) => act(() => crmSend("PUT", `workflows/${r.id}`, { ...r, enabled: e.target.checked }), e.target.checked ? `"${r.name}" is on` : `"${r.name}" is off`)} /> On</label>
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
      <Section title="Start from an example" desc="Opens the example on the canvas so you can change it before saving.">
        <div className="wf-examples">
          {EXAMPLES.map(([text, rule]) => <button key={text} className="btn" onClick={() => setEditing(structuredClone({ enabled: true, ...rule }))}>{text}</button>)}
        </div>
      </Section>
      <Section title="Recent runs" desc="What the workflows did in the last 60 days, newest first.">
        {runs.length ? (
          <div className="table-frame">
            <table className="grid">
              <thead><tr><th>When</th><th>Workflow</th><th>Lead</th><th>Why</th><th>What it did</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</td>
                    <td>{r.rule}</td>
                    <td><a href={hashFor("/leads", { lead: r.leadId })}>{r.lead || "Lead"}</a></td>
                    <td>{r.why}</td>
                    <td className={r.ok ? "" : "error"}>{(r.done || []).map((d) => (d.startsWith("waiting until ") ? "waiting till " + new Date(d.slice(14)).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : d)).join(", ") || "Nothing to change"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">Nothing yet.</p>}
      </Section>
    </>
  );
}

function Builder({ start, meta, users, nameOf, gateway, busy, onSave, onCancel }) {
  const [name, setName] = useState(start.name);
  const [enabled, setEnabled] = useState(start.enabled !== false);
  const [nodes, setNodes] = useState(start.flow.nodes);
  const [edges, setEdges] = useState(start.flow.edges);
  const [selected, setSelected] = useState("t"); // a node id, or "edge:<index>"
  const [zoom, setZoom] = useState(1);
  const [full, setFull] = useState(false);
  const [drag, setDrag] = useState(null); // { kind: "move", id, dx, dy } or { kind: "link", from, port, x, y }
  const svg = useRef(null), pane = useRef(null);
  const [focus, setFocus] = useState("");
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sel = byId.get(selected);

  const point = (e) => { const p = svg.current.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.current.getScreenCTM().inverse()); };
  const hit = (x, y) => nodes.find((n) => x >= n.x && x <= n.x + W && y >= n.y && y <= n.y + H);
  const setConfig = (id, patch) => setNodes((all) => all.map((n) => (n.id === id ? { ...n, config: { ...n.config, ...patch } } : n)));
  const connect = (from, port, to) => {
    if (!to || to === from || byId.get(to)?.type === "trigger") return;
    setEdges((all) => (all.some((e) => e.from === from && e.port === port && e.to === to) ? all : [...all, { from, port, to }]));
  };
  function remove() {
    if (selected.startsWith("edge:")) { const i = Number(selected.slice(5)); setEdges((all) => all.filter((_, j) => j !== i)); setSelected(""); return; }
    if (!sel || sel.type === "trigger") return;
    setNodes((all) => all.filter((n) => n.id !== selected));
    setEdges((all) => all.filter((e) => e.from !== selected && e.to !== selected));
    setSelected("");
  }
  // a new box goes to the right of the selected one and is joined to it, like adding the next step
  function add(type, config) {
    const id = newId(), from = sel || nodes[nodes.length - 1];
    const port = from ? PORTS[from.type].find((p) => !edges.some((e) => e.from === from.id && e.port === p)) || PORTS[from.type][0] : null;
    const x = from ? Math.min(CANVAS_W - W - 20, from.x + W + 44) : 40;
    let y = from ? Math.min(CANVAS_H - H - 20, from.y + (port === "no" ? 110 : 0)) : 160;
    // never on top of another box: step down until the spot is free
    while (y < CANVAS_H - H - 20 && nodes.some((n) => Math.abs(n.x - x) < W + 20 && Math.abs(n.y - y) < H + 20)) y += H + 34;
    setNodes((all) => [...all, { id, type, x, y, config: structuredClone(config) }]);
    if (from) setEdges((all) => [...all, { from: from.id, port, to: id }]);
    setSelected(id);
    setFocus(id);
  }
  // bring a newly added box into view
  useEffect(() => {
    const n = nodes.find((x) => x.id === focus), el = pane.current;
    if (!n || !el) return;
    el.scrollTo({ left: Math.max(0, (n.x + W / 2) * zoom - el.clientWidth / 2), top: Math.max(0, (n.y + H / 2) * zoom - el.clientHeight / 2), behavior: "auto" });
    setFocus("");
  }, [focus]);
  useEffect(() => {
    const key = (e) => {
      if (e.key === "Escape") { setFull(false); return; }
      if (!["Delete", "Backspace"].includes(e.key) || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) return;
      e.preventDefault(); remove();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  function onMove(e) {
    if (!drag) return;
    const p = point(e);
    if (drag.kind === "move") setNodes((all) => all.map((n) => (n.id === drag.id ? { ...n, x: Math.max(0, Math.min(CANVAS_W - W, Math.round(p.x - drag.dx))), y: Math.max(0, Math.min(CANVAS_H - H, Math.round(p.y - drag.dy))) } : n)));
    else setDrag({ ...drag, x: p.x, y: p.y });
  }
  function onUp(e) {
    if (drag?.kind === "link") { const p = point(e); connect(drag.from, drag.port, hit(p.x, p.y)?.id); }
    setDrag(null);
  }
  const curve = (x1, y1, x2, y2) => { const d = Math.max(40, Math.abs(x2 - x1) / 2); return `M${x1},${y1} C${x1 + d},${y1} ${x2 - d},${y2} ${x2},${y2}`; };

  const save = () => onSave({ ...(start.id ? { id: start.id } : {}), name, enabled, flow: { nodes, edges } });
  const people = users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>);
  const stageOptions = meta.stages.map((s) => <option key={s} value={s}>{s}</option>);

  return (
    <div className={full ? "wfb wfb-full" : "wfb"}>
      <div className="wfb-top">
        <input className="field-input wfb-name" aria-label="Workflow name" placeholder="Name this workflow, like “Call back missed calls”" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        <label className="check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> On</label>
        <button className="btn btn-primary" disabled={busy} onClick={save}>Save workflow</button>
        <button className="btn btn-quiet" onClick={onCancel}>Cancel</button>
        <span className="wfb-view" role="group" aria-label="View">
          <button type="button" className="btn btn-quiet" aria-label="Zoom out" disabled={zoom <= 0.5} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.15).toFixed(2)))}>−</button>
          <span className="muted">{Math.round(zoom * 100)}%</span>
          <button type="button" className="btn btn-quiet" aria-label="Zoom in" disabled={zoom >= 1.3} onClick={() => setZoom((z) => Math.min(1.3, +(z + 0.15).toFixed(2)))}>+</button>
          <button type="button" className="btn" onClick={() => setFull((f) => !f)}>{full ? "Exit full screen" : "Full screen"}</button>
        </span>
      </div>
      <div className="wfb-add" role="toolbar" aria-label="Add a box">
        <span className="muted">Add after the selected box:</span>
        {ADD.map(([type, text, config]) => <button key={text} type="button" className={`btn wfb-chip ${type === "action" ? `wfn-action wfn-${config.type}` : `wfn-${type}`}`} onClick={() => add(type, config)}>{text}</button>)}
      </div>
      <div className="wfb-body">
        <div className="wfb-canvas" tabIndex={-1} ref={pane}>
          <svg ref={svg} width={Math.round(CANVAS_W * zoom)} height={Math.round(CANVAS_H * zoom)} viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} className={drag ? "wfb-svg wfb-dragging" : "wfb-svg"}
            onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onPointerDown={(e) => { if (e.target === svg.current || e.target.classList.contains("wfb-grid")) setSelected(""); }}>
            <defs>
              <pattern id="wfb-dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" className="wfb-dot" /></pattern>
              <marker id="wfb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="wfb-arrowhead" /></marker>
            </defs>
            <rect className="wfb-grid" width={CANVAS_W} height={CANVAS_H} fill="url(#wfb-dots)" />
            {edges.map((e, i) => {
              const a = byId.get(e.from), b = byId.get(e.to);
              if (!a || !b) return null;
              const d = curve(a.x + W, a.y + PORT_Y[e.port], b.x, b.y + H / 2), on = selected === "edge:" + i;
              return (
                <g key={i} className={on ? "wfb-edge wfb-edge-on" : "wfb-edge"} onPointerDown={(ev) => { ev.stopPropagation(); setSelected("edge:" + i); }}>
                  <path d={d} className="wfb-edge-hit" />
                  <path d={d} className={`wfb-edge-line wfb-edge-${e.port}`} markerEnd="url(#wfb-arrow)" />
                </g>
              );
            })}
            {drag?.kind === "link" && (() => { const a = byId.get(drag.from); return <path d={curve(a.x + W, a.y + PORT_Y[drag.port], drag.x, drag.y)} className="wfb-edge-line wfb-edge-draft" />; })()}
            {nodes.map((n) => {
              const [kind, text] = label(n, meta, nameOf);
              return (
                <g key={n.id} transform={`translate(${n.x},${n.y})`} className={`wfb-node ${kindClass(n)}${selected === n.id ? " wfb-node-on" : ""}`}
                  onPointerDown={(e) => { e.stopPropagation(); const p = point(e); setSelected(n.id); setDrag({ kind: "move", id: n.id, dx: p.x - n.x, dy: p.y - n.y }); }}>
                  <title>{`${kind}: ${text}`}</title>
                  <rect className="wfb-box" width={W} height={H} rx="10" />
                  <rect className="wfb-band" width="8" height={H} rx="4" />
                  <text className="wfb-kind" x="22" y="28">{kind}</text>
                  <text className="wfb-text" x="22" y="52">{cut(text, 27)}</text>
                  {n.type !== "trigger" && <circle className="wfb-port wfb-in" cx="0" cy={H / 2} r="7" />}
                  {PORTS[n.type].map((port) => (
                    <g key={port} className="wfb-out" onPointerDown={(e) => { e.stopPropagation(); const p = point(e); setSelected(n.id); setDrag({ kind: "link", from: n.id, port, x: p.x, y: p.y }); }}>
                      <circle className={`wfb-port wfb-port-${port}`} cx={W} cy={PORT_Y[port]} r="8" />
                      {port !== "out" && <text className="wfb-port-label" x={W + 12} y={PORT_Y[port] + 4}>{port}</text>}
                    </g>
                  ))}
                </g>
              );
            })}
          </svg>
        </div>
        <aside className="wfb-side" aria-label="Selected box">
          {!sel && !selected.startsWith("edge:") && <><h3>How to draw</h3><ul className="wfb-help">
            <li>Click a box to set it up here.</li>
            <li>Drag a box to move it.</li>
            <li>Drag from the dot on a box's right edge onto another box to join them. An If box has a <b>yes</b> and a <b>no</b> dot.</li>
            <li>Click a line, then Delete, to remove it.</li>
            <li>Boxes run left to right along the lines. A Wait box holds the lead, then carries on.</li>
          </ul></>}
          {selected.startsWith("edge:") && <><h3>Line</h3><p className="muted">Joins two boxes.</p><button className="btn btn-quiet" onClick={remove}>Remove line</button></>}
          {sel && <BoxForm n={sel} meta={meta} users={users} people={people} stageOptions={stageOptions} gateway={gateway} set={(patch) => setConfig(sel.id, patch)} replace={(config) => setNodes((all) => all.map((x) => (x.id === sel.id ? { ...x, config } : x)))} onRemove={remove} />}
        </aside>
      </div>
    </div>
  );
}

function BoxForm({ n, meta, users, people, stageOptions, gateway, set, replace, onRemove }) {
  const c = n.config;
  const setCond = (i, patch) => set({ conditions: c.conditions.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <div className="wfb-form">
      {n.type === "trigger" && <>
        <h3>When</h3>
        <label>This happens<select className="field-input" value={c.type} onChange={(e) => replace({ type: e.target.value, ...(e.target.value === "no_activity" ? { days: 3 } : {}) })}>
          {Object.entries(meta.triggers).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></label>
        {c.type === "stage_changed" && <>
          <label>Moves to<select className="field-input" value={c.to || ""} onChange={(e) => set({ to: e.target.value })}><option value="">Any stage</option>{stageOptions}</select></label>
          <label>Moves from<select className="field-input" value={c.from || ""} onChange={(e) => set({ from: e.target.value })}><option value="">Any stage</option>{stageOptions}</select></label>
        </>}
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
            <select className="field-input" aria-label="Field" value={x.field} onChange={(e) => setCond(i, { field: e.target.value, value: "" })}>{Object.entries(meta.fields).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select className="field-input" aria-label="Test" value={x.op} onChange={(e) => setCond(i, { op: e.target.value })}>{Object.entries(meta.ops).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            {!["is_empty", "not_empty"].includes(x.op) && (x.field === "owner"
              ? <select className="field-input" aria-label="Person" value={x.value} onChange={(e) => setCond(i, { value: e.target.value })}><option value="">Choose…</option>{people}</select>
              : x.field === "stage" && x.op !== "contains"
                ? <select className="field-input" aria-label="Stage" value={x.value} onChange={(e) => setCond(i, { value: e.target.value })}><option value="">Choose…</option>{stageOptions}</select>
                : <input className="field-input" aria-label="Value" value={x.value} maxLength={200} placeholder={x.field === "source" ? "IndiaMART" : x.field === "city" ? "Coimbatore" : ""} onChange={(e) => setCond(i, { value: e.target.value })} />)}
            {c.conditions.length > 1 && <button type="button" className="btn btn-quiet" onClick={() => set({ conditions: c.conditions.filter((_, j) => j !== i) })}>Remove test</button>}
          </div>
        ))}
        <button type="button" className="btn" disabled={c.conditions.length >= 10} onClick={() => set({ conditions: [...c.conditions, { field: "city", op: "is", value: "" }] })}>Add test</button>
      </>}
      {n.type === "wait" && <>
        <h3>Wait</h3>
        <label>Hold the lead for<select className="field-input" value={String(c.hours)} onChange={(e) => set({ hours: Number(e.target.value) })}>
          {[0.25, 0.5, 1, 2, 4, 8, 24, 48, 72, 120, 168, 336, 720].map((h) => <option key={h} value={h}>{hoursText(h)}</option>)}
        </select></label>
        <Note>After the wait, the next boxes see the lead as it is then, so put an If box after a wait to check it is still worth doing.</Note>
      </>}
      {n.type === "action" && <>
        <h3>{meta.actions[c.type]}</h3>
        <label>Action<select className="field-input" value={c.type} onChange={(e) => replace(ADD.find(([, , cfg]) => cfg.type === e.target.value)?.[2] ? structuredClone(ADD.find(([, , cfg]) => cfg.type === e.target.value)[2]) : { type: e.target.value })}>
          {Object.entries(meta.actions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></label>
        {c.type === "assign" && <>
          <label>To<select className="field-input" value={c.to || ""} onChange={(e) => set({ to: e.target.value, users: c.users || [] })}><option value="">Choose…</option><option value="round_robin">Take turns between people</option>{people}</select></label>
          {c.to === "round_robin" && <div className="wfb-people">{users.map((u) => (
            <label key={u.id} className="check"><input type="checkbox" checked={(c.users || []).includes(u.id)} onChange={(e) => set({ users: e.target.checked ? [...(c.users || []), u.id] : (c.users || []).filter((x) => x !== u.id) })} /> {u.name}</label>
          ))}</div>}
        </>}
        {c.type === "stage" && <label>Move to<select className="field-input" value={c.stage || ""} onChange={(e) => set({ stage: e.target.value })}><option value="">Choose…</option>{meta.pipeline.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>}
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
        {c.type === "note" && <label>Note<textarea className="field-input" rows={3} maxLength={2000} value={c.text || ""} onChange={(e) => set({ text: e.target.value })} /></label>}
      </>}
      {n.type !== "trigger" && <button type="button" className="btn btn-quiet wfb-remove" onClick={onRemove}>Remove this box</button>}
    </div>
  );
}
