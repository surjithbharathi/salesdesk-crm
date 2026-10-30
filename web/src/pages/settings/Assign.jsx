import React, { useState } from "react";
import { crmSend } from "../../api.js";
import { useCrm } from "../../crm.jsx";
import { useToast } from "../../toast.jsx";

// Hands out leads that have no owner, one by one in turn, across the active team.
export default function Assign({ access }) {
  const crm = useCrm();
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState({});
  if (!crm.state) return <p className="muted">Loading…</p>;
  const team = access.users.filter((u) => u.active !== false);
  const active = crm.leads.filter((l) => !l.archived);
  const unowned = active.filter((l) => !l.owner);
  const chosen = team.filter((u) => picked[u.id] !== false);
  async function distribute() {
    if (!chosen.length) return notify("Choose at least one person");
    if (!confirm(`Give ${unowned.length} leads to ${chosen.length} people, one in turn?`)) return;
    setBusy(true);
    let done = 0;
    try {
      for (let i = 0; i < unowned.length; i++) {
        await crmSend("PATCH", `leads/${unowned[i].id}`, { owner: chosen[i % chosen.length].id });
        done++;
      }
      notify(`${done} leads assigned`);
    } catch (e) {
      notify(`${done} assigned, then stopped: ${e.message}`);
    } finally {
      await crm.reload();
      setBusy(false);
    }
  }
  const load = (u) => active.filter((l) => l.owner === u.id).length;
  const top = Math.max(1, ...team.map(load));
  return (
    <>
      <p className="muted report-meta">Leads without an owner are shared out one by one, in turn. Nothing already owned changes.</p>
      <p><b>{unowned.length}</b> leads have no owner.</p>
      <fieldset className="assign-team">
        <legend>Share them between</legend>
        {team.map((u) => (
          <label key={u.id} className="check"><input type="checkbox" checked={picked[u.id] !== false} onChange={(e) => setPicked({ ...picked, [u.id]: e.target.checked })} /> {u.name}</label>
        ))}
      </fieldset>
      <span className="newlead-actions"><button className="btn btn-primary" disabled={busy || !unowned.length || !chosen.length} onClick={distribute}>{busy ? "Assigning…" : `Assign ${unowned.length} leads`}</button></span>
      <h2 className="section-title section-gap">Who has how many</h2>
      {team.map((u) => (
        <div key={u.id} className="bar-row"><span>{u.name}</span><progress value={load(u)} max={top} aria-label={`${u.name} leads`}>{load(u)}</progress><b>{load(u)}</b></div>
      ))}
    </>
  );
}
