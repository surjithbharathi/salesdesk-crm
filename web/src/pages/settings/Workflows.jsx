import React, { useState } from "react";
import { crmGet, crmSend } from "../../api.js";
import { useLoad } from "../../hooks.js";
import { useToast } from "../../toast.jsx";
import { hashFor } from "../../format.js";
import { Section, Note, Loading, Failed } from "./Parts.jsx";

// Workflows: "when this happens to a lead, and these conditions hold, do these things." The server checks every 30 seconds.
const EMPTY = { name: "", enabled: true, trigger: { type: "lead_created" }, conditions: [], actions: [{ type: "task", title: "Call {name}", hours: 1, owner: "lead_owner" }] };
const EXAMPLES = [
  ["New IndiaMART lead: share it out and call within an hour", { name: "New IndiaMART leads", trigger: { type: "lead_created" }, conditions: [{ field: "source", op: "contains", value: "IndiaMART" }], actions: [{ type: "assign", to: "round_robin", users: [] }, { type: "task", title: "Call {name} ({city})", hours: 1, owner: "lead_owner" }] }],
  ["Missed call: call back in 15 minutes", { name: "Call back missed calls", trigger: { type: "call_missed" }, conditions: [], actions: [{ type: "task", title: "Call back {name}", hours: 0.25, owner: "lead_owner" }] }],
  ["Quotation shared: follow up after 2 days", { name: "Quotation follow-up", trigger: { type: "stage_changed", to: "Quotation Shared", from: "" }, conditions: [], actions: [{ type: "task", title: "Ask {name} about the quotation", hours: 48, owner: "lead_owner" }] }],
  ["Quiet for 3 days: remind the owner", { name: "Quiet leads", trigger: { type: "no_activity", days: 3 }, conditions: [], actions: [{ type: "task", title: "{name} has gone quiet. Call today", hours: 0, owner: "lead_owner" }] }],
];
const PLACEHOLDERS = "Use {name}, {company}, {city}, {source} or {owner} to fill in the lead's details.";

function describe(rule, meta, nameOf) {
  const t = rule.trigger;
  let when = meta.triggers[t.type] || t.type;
  if (t.type === "stage_changed") when = `A lead moves${t.from ? ` from ${t.from}` : ""} to ${t.to || "any stage"}`;
  if (t.type === "no_activity") when = `A lead has no activity for ${t.days} day${t.days === 1 ? "" : "s"}`;
  const ifs = rule.conditions.map((c) => `${meta.fields[c.field]} ${meta.ops[c.op]}${c.value ? " " + (c.field === "owner" ? nameOf(c.value) : c.value) : ""}`);
  const thens = rule.actions.map((a) =>
    a.type === "assign" ? (a.to === "round_robin" ? `assign in turn to ${a.users.map(nameOf).join(", ")}` : `assign to ${nameOf(a.to)}`)
    : a.type === "stage" ? `move to ${a.stage}`
    : a.type === "task" ? `task "${a.title}"${a.hours ? ` due in ${hoursText(a.hours)}` : " due now"}`
    : a.type === "whatsapp" ? (a.template ? `WhatsApp template ${a.template}` : "WhatsApp message")
    : "add a note");
  return { when, ifs, thens };
}
function hoursText(h) {
  if (h < 1) return `${Math.round(h * 60)} minutes`;
  if (h % 24 === 0) return `${h / 24} day${h === 24 ? "" : "s"}`;
  return `${h} hour${h === 1 ? "" : "s"}`;
}

export default function Workflows({ users }) {
  const notify = useToast();
  const [version, setVersion] = useState(0);
  const { data, error } = useLoad(() => crmGet("workflows"), [version]);
  const [editing, setEditing] = useState(null); // null, or { id?, ...rule }
  const [busy, setBusy] = useState(false);
  const nameOf = (id) => users.find((u) => u.id === id)?.name || "Someone removed";
  const reload = () => setVersion((v) => v + 1);
  async function act(fn, done) {
    setBusy(true);
    try { await fn(); notify(done); reload(); return true; } catch (e) { notify(e.message); return false; } finally { setBusy(false); }
  }
  if (error) return <Failed>{error.message}</Failed>;
  if (!data) return <Loading>Loading workflows…</Loading>;
  const { rules, runs, meta, gateway } = data;
  const on = rules.filter((r) => r.enabled).length;

  if (editing) return <Editor rule={editing} meta={meta} users={users} gateway={gateway} busy={busy} onCancel={() => setEditing(null)}
    onSave={async (rule) => { if (await act(() => (rule.id ? crmSend("PUT", `workflows/${rule.id}`, rule) : crmSend("POST", "workflows", rule)), `Workflow "${rule.name}" saved`)) setEditing(null); }} />;

  return (
    <>
      <Section title="Your workflows" desc="Each workflow watches for one thing that happens to a lead, checks your conditions, then does its actions by itself. A workflow never acts on things that happened before it was saved." status={rules.length ? `${on} of ${rules.length} on` : "None yet"} tone={on ? "ok" : "off"}>
        {rules.length ? (
          <ul className="wf-list">
            {rules.map((r) => {
              const d = describe(r, meta, nameOf);
              return (
                <li key={r.id} className={r.enabled ? "wf-rule" : "wf-rule wf-off"}>
                  <div className="wf-text">
                    <b>{r.name}</b>
                    <p><span className="wf-k">When</span> {d.when}{d.ifs.length ? <>, <span className="wf-k">if</span> {d.ifs.join(" and ")}</> : null}</p>
                    <p><span className="wf-k">Then</span> {d.thens.join(", ")}</p>
                    <p className="muted">{r.runs ? `Ran ${r.runs} time${r.runs === 1 ? "" : "s"}, last on ${new Date(r.lastRunAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : "Has not run yet"}</p>
                  </div>
                  <div className="wf-buttons">
                    <label className="check"><input type="checkbox" checked={r.enabled} disabled={busy} onChange={(e) => act(() => crmSend("PUT", `workflows/${r.id}`, { ...r, enabled: e.target.checked }), e.target.checked ? `"${r.name}" is on` : `"${r.name}" is off`)} /> On</label>
                    <button className="btn" disabled={busy} onClick={() => setEditing(structuredClone(r))}>Edit</button>
                    <button className="btn btn-quiet" disabled={busy} onClick={() => confirm(`Delete the workflow "${r.name}"? Tasks and messages it already made stay.`) && act(() => crmSend("DELETE", `workflows/${r.id}`), "Workflow deleted")}>Delete</button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <p className="muted">No workflows yet. Start from an example below or make your own.</p>}
        <div className="newlead-actions"><button className="btn btn-primary" onClick={() => setEditing(structuredClone(EMPTY))}>New workflow</button></div>
      </Section>
      <Section title="Start from an example" desc="Opens the example so you can change it before saving.">
        <div className="wf-examples">
          {EXAMPLES.map(([label, rule]) => <button key={label} className="btn" onClick={() => setEditing(structuredClone({ enabled: true, ...rule }))}>{label}</button>)}
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
                    <td className={r.ok ? "" : "error"}>{[...(r.done || []), r.note].filter(Boolean).join(", ") || "Nothing to change"}</td>
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

function Editor({ rule: start, meta, users, gateway, busy, onSave, onCancel }) {
  const [rule, setRule] = useState(start);
  const set = (patch) => setRule((r) => ({ ...r, ...patch }));
  const setTrigger = (patch) => set({ trigger: { ...rule.trigger, ...patch } });
  const setAt = (key, i, patch) => set({ [key]: rule[key].map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const drop = (key, i) => set({ [key]: rule[key].filter((_, j) => j !== i) });
  const t = rule.trigger;
  const stageOptions = meta.stages.map((s) => <option key={s} value={s}>{s}</option>);
  const people = users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>);
  const usesWhatsApp = rule.actions.some((a) => a.type === "whatsapp");

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(rule); }}>
      <Section title={start.id ? "Edit workflow" : "New workflow"} desc="Give it a name people will understand, like “Call back missed calls”.">
        <div className="sec-grid">
          <label className="wide">Name<input className="field-input" value={rule.name} maxLength={120} required onChange={(e) => set({ name: e.target.value })} /></label>
          <label className="check wide"><input type="checkbox" checked={rule.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> <span>On: run this workflow as soon as it is saved</span></label>
        </div>
      </Section>
      <Section title="When" desc="The one thing that starts this workflow.">
        <div className="sec-grid">
          <label className="wide">This happens<select className="field-input" value={t.type} onChange={(e) => set({ trigger: { type: e.target.value, ...(e.target.value === "no_activity" ? { days: 3 } : {}) } })}>
            {Object.entries(meta.triggers).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
          {t.type === "stage_changed" && <>
            <label>Moves to<select className="field-input" value={t.to || ""} onChange={(e) => setTrigger({ to: e.target.value })}><option value="">Any stage</option>{stageOptions}</select></label>
            <label>Moves from<select className="field-input" value={t.from || ""} onChange={(e) => setTrigger({ from: e.target.value })}><option value="">Any stage</option>{stageOptions}</select></label>
          </>}
          {t.type === "no_activity" && <label>Days without a call, message or note<input className="field-input" type="number" min={1} max={365} value={t.days ?? 3} onChange={(e) => setTrigger({ days: Number(e.target.value) })} /></label>}
        </div>
        {t.type === "no_activity" && <Note>Closed and archived leads are left out. A lead counts once it has been quiet for this many days, and at most 3 days more, so leads that died long ago are not woken up all at once.</Note>}
      </Section>
      <Section title="Only if" desc="Leave empty to act on every lead. All conditions must be true.">
        {rule.conditions.map((c, i) => (
          <div key={i} className="wf-row">
            <select className="field-input" aria-label="Field" value={c.field} onChange={(e) => setAt("conditions", i, { field: e.target.value, value: "" })}>
              {Object.entries(meta.fields).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="field-input" aria-label="Test" value={c.op} onChange={(e) => setAt("conditions", i, { op: e.target.value })}>
              {Object.entries(meta.ops).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {!["is_empty", "not_empty"].includes(c.op) && (
              c.field === "owner" ? <select className="field-input" aria-label="Person" value={c.value} onChange={(e) => setAt("conditions", i, { value: e.target.value })}><option value="">Choose…</option>{people}</select>
              : c.field === "stage" && c.op !== "contains" ? <select className="field-input" aria-label="Stage" value={c.value} onChange={(e) => setAt("conditions", i, { value: e.target.value })}><option value="">Choose…</option>{stageOptions}</select>
              : <input className="field-input" aria-label="Value" value={c.value} maxLength={200} placeholder={c.field === "source" ? "IndiaMART" : c.field === "city" ? "Coimbatore" : ""} onChange={(e) => setAt("conditions", i, { value: e.target.value })} />
            )}
            <button type="button" className="btn btn-quiet" onClick={() => drop("conditions", i)}>Remove</button>
          </div>
        ))}
        <div className="newlead-actions"><button type="button" className="btn" disabled={rule.conditions.length >= 10} onClick={() => set({ conditions: [...rule.conditions, { field: "source", op: "is", value: "" }] })}>Add condition</button></div>
      </Section>
      <Section title="Then" desc={`Done in this order. ${PLACEHOLDERS}`}>
        {rule.actions.map((a, i) => (
          <div key={i} className="wf-action">
            <div className="wf-row">
              <select className="field-input" aria-label="Action" value={a.type} onChange={(e) => setAt("actions", i, { type: e.target.value })}>
                {Object.entries(meta.actions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button type="button" className="btn btn-quiet" onClick={() => drop("actions", i)}>Remove</button>
            </div>
            <div className="sec-grid">
              {a.type === "assign" && <>
                <label>To<select className="field-input" value={a.to || ""} onChange={(e) => setAt("actions", i, { to: e.target.value, users: a.users || [] })}><option value="">Choose…</option><option value="round_robin">Take turns between people</option>{people}</select></label>
                {a.to === "round_robin" && <div className="wide wf-people">{users.map((u) => (
                  <label key={u.id} className="check"><input type="checkbox" checked={(a.users || []).includes(u.id)} onChange={(e) => setAt("actions", i, { users: e.target.checked ? [...(a.users || []), u.id] : (a.users || []).filter((x) => x !== u.id) })} /> {u.name}</label>
                ))}</div>}
              </>}
              {a.type === "stage" && <label>Move to<select className="field-input" value={a.stage || ""} onChange={(e) => setAt("actions", i, { stage: e.target.value })}><option value="">Choose…</option>{meta.pipeline.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>}
              {a.type === "task" && <>
                <label className="wide">Task<input className="field-input" value={a.title || ""} maxLength={300} placeholder="Call {name}" onChange={(e) => setAt("actions", i, { title: e.target.value })} /></label>
                <label>Due after<select className="field-input" value={String(a.hours ?? 1)} onChange={(e) => setAt("actions", i, { hours: Number(e.target.value) })}>
                  {[0, 0.25, 0.5, 1, 2, 4, 24, 48, 72, 168].map((h) => <option key={h} value={h}>{h ? hoursText(h) : "Right away"}</option>)}
                </select></label>
                <label>For<select className="field-input" value={a.owner || "lead_owner"} onChange={(e) => setAt("actions", i, { owner: e.target.value })}><option value="lead_owner">The lead's owner</option>{people}</select></label>
              </>}
              {a.type === "whatsapp" && <>
                <label className="wide">Message<textarea className="field-input" rows={3} maxLength={1000} value={a.text || ""} disabled={Boolean(a.template)} placeholder="Hello {name}, thank you for your enquiry. {owner} from Devi Industries will call you shortly." onChange={(e) => setAt("actions", i, { text: e.target.value })} /></label>
                <label>Or an approved template<input className="field-input" value={a.template || ""} maxLength={80} placeholder="enquiry_thanks" onChange={(e) => setAt("actions", i, { template: e.target.value.toLowerCase() })} /></label>
              </>}
              {a.type === "note" && <label className="wide">Note<textarea className="field-input" rows={2} maxLength={2000} value={a.text || ""} onChange={(e) => setAt("actions", i, { text: e.target.value })} /></label>}
            </div>
          </div>
        ))}
        {usesWhatsApp && <Note tone={gateway ? "info" : "warn"}>{gateway ? "WhatsApp goes out through the WhatsApp gateway. A plain message reaches the customer only within 24 hours of their last message; for new leads use an approved template." : "The WhatsApp gateway is not connected, so this message will not be sent. Connect it in Settings, WhatsApp gateway."}</Note>}
        <div className="newlead-actions"><button type="button" className="btn" disabled={rule.actions.length >= 10} onClick={() => set({ actions: [...rule.actions, { type: "task", title: "", hours: 1, owner: "lead_owner" }] })}>Add action</button></div>
      </Section>
      <div className="set-bar newlead-actions">
        <button className="btn btn-primary" disabled={busy}>Save workflow</button>
        <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
