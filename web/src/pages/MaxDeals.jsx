import React, { useMemo, useState } from "react";
import { crmSend } from "../api.js";
import { useCrm, userName } from "../crm.jsx";
import { useToast } from "../toast.jsx";
import { initials, rupees } from "../format.js";
import { PIPELINE, pipelineStep } from "../pipeline.js";
import Icon from "../icons.jsx";
import LeadPanel from "./LeadPanel.jsx";
import { ms, relTime } from "./tele.js";

// "Opportunities" in the Salesmax style: leads that are being worked, as a board with one column per stage.
// One column per pipeline step. Drag a card, or use the arrows, to move it; Won and Lost close the lead.

const DAY = 86400000;
const CAP = 30;
const COLUMNS = PIPELINE.map((d) => [d.name, d.name, { deal: d.name }]);
const columnOf = (l) => (l.stage === "New" ? "" : pipelineStep(l));

export default function MaxDeals({ params }) {
  const crm = useCrm();
  const notify = useToast();
  const table = params.tab === "table";
  const [scope, setScope] = useState("all");
  const [find, setFind] = useState("");
  const [idle, setIdle] = useState(false);
  const [openId, setOpenId] = useState("");
  const [dragId, setDragId] = useState("");
  const [over, setOver] = useState("");
  const [busy, setBusy] = useState(false);

  // when each lead was last worked: its latest call or note (system entries do not count)
  const worked = useMemo(() => {
    const map = new Map();
    for (const a of crm.activities || []) {
      if (a.type === "System") continue;
      const t = ms(a.occurredAt || a.createdAt);
      if (t > (map.get(a.leadId) || 0)) map.set(a.leadId, t);
    }
    return map;
  }, [crm.activities]);

  const deals = useMemo(() => {
    if (!crm.state) return [];
    const needle = find.trim().toLowerCase();
    const recent = Date.now() - 30 * DAY;
    return crm.leads.filter((l) => {
      if (l.archived || l.stage === "New") return false;
      const column = columnOf(l);
      if (!column) return false;
      if ((column === "Won" || column === "Lost") && ms(l.updatedAt || l.createdAt) < recent) return false;
      if (scope === "mine" && l.owner !== crm.me.id) return false;
      if (needle && !`${l.name} ${l.company || ""}`.toLowerCase().includes(needle)) return false;
      if (idle && (column === "Won" || column === "Lost" || (worked.get(l.id) || 0) > Date.now() - 7 * DAY)) return false;
      return true;
    });
  }, [crm.state, crm.leads, crm.me.id, scope, find, idle, worked]);

  async function move(lead, target) {
    const patch = COLUMNS.find(([key]) => key === target)?.[2];
    if (!patch || columnOf(lead) === target) return;
    setBusy(true);
    try {
      await crmSend("PATCH", `leads/${lead.id}`, patch);
      await crm.reload();
      notify(`${lead.name} moved to ${COLUMNS.find(([key]) => key === target)[1]}`);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
      setDragId("");
      setOver("");
    }
  }
  const step = (lead, by) => {
    const at = COLUMNS.findIndex(([key]) => key === columnOf(lead));
    const next = COLUMNS[at + by];
    if (next) move(lead, next[0]);
  };

  if (!crm.state) return <p className="muted">{crm.error || "Loading opportunities…"}</p>;
  const total = deals.filter((l) => columnOf(l) !== "Won" && columnOf(l) !== "Lost").reduce((s, l) => s + (Number(l.value) || 0), 0);
  return (
    <>
      <section className="max-card" aria-label="Opportunities">
        <div className="max-tools">
          {crm.me.lead && (
            <span className="max-toggle" role="group" aria-label="Whose deals">
              {[["all", "All"], ["mine", "My"]].map(([key, label]) => <button key={key} aria-pressed={scope === key} onClick={() => setScope(key)}>{label}</button>)}
            </span>
          )}
          <label className="max-find">
            <Icon name="search" size={14} /><span className="sr">Search deals</span>
            <input type="search" placeholder="Search deal or company…" value={find} onChange={(e) => setFind(e.target.value)} />
          </label>
          <button className="max-chipbtn" aria-pressed={idle} onClick={() => setIdle(!idle)}>No action in 7 days</button>
          <span className="max-spacer" />
          <span className="muted num">Open value {rupees(total)}</span>
        </div>
        {!table ? (
          <div className="max-board max-board-deals">
            {COLUMNS.map(([key, title]) => {
              const list = deals.filter((l) => columnOf(l) === key);
              const sum = list.reduce((s, l) => s + (Number(l.value) || 0), 0);
              return (
                <section key={key} className={`max-col ${over === key ? "drop" : ""}`} aria-label={title}
                  onDragOver={(e) => { e.preventDefault(); setOver(key); }} onDragLeave={() => setOver("")}
                  onDrop={(e) => { e.preventDefault(); const lead = crm.leadById.get(dragId); if (lead) move(lead, key); }}>
                  <header className={`max-col-head ${key === "Won" ? "stage-won" : key === "Lost" ? "stage-lost" : ""}`}><b>{title}</b><span className="num">{list.length}</span><small className="num">{rupees(sum)}</small></header>
                  {list.slice(0, CAP).map((l) => (
                    <article key={l.id} className="max-deal" draggable onDragStart={() => setDragId(l.id)} onDragEnd={() => { setDragId(""); setOver(""); }}>
                      <button className="max-deal-body" onClick={() => setOpenId(l.id)}>
                        <b>{l.name}</b>
                        {l.company && <span>{l.company}</span>}
                        <small className="num">{l.value ? rupees(l.value) : "No value yet"} · {l.owner ? userName(crm, l.owner) : "No owner"}</small>
                      </button>
                      <footer>
                        <button className="btn btn-quiet" aria-label="Move back" disabled={busy || key === COLUMNS[0][0]} onClick={() => step(l, -1)}>‹</button>
                        <small className="muted">{worked.get(l.id) ? relTime(worked.get(l.id)) : "Not worked"}</small>
                        <button className="btn btn-quiet" aria-label="Move forward" disabled={busy || key === COLUMNS.at(-1)[0]} onClick={() => step(l, 1)}>›</button>
                      </footer>
                    </article>
                  ))}
                  {list.length > CAP && <p className="muted max-more">+ {list.length - CAP} more. Search to narrow them down.</p>}
                  {!list.length && <p className="muted max-none">Drop deals here</p>}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="max-table-wrap">
            <table className="max-table">
              <thead><tr><th>Deal</th><th>Stage</th><th>Value</th><th>Owner</th><th>Source</th><th>Last worked</th></tr></thead>
              <tbody>
                {deals.slice(0, 200).map((l) => (
                  <tr key={l.id}>
                    <td><span className="max-lead"><span className="avatar">{initials(l.name)}</span><button className="max-link" onClick={() => setOpenId(l.id)}>{l.name}</button></span>{l.company && <small className="muted"> {l.company}</small>}</td>
                    <td><span className={`max-stage ${columnOf(l) === "Won" ? "won" : columnOf(l) === "Lost" ? "lost" : ""}`}>{COLUMNS.find(([k]) => k === columnOf(l))[1]}</span></td>
                    <td className="num">{l.value ? rupees(l.value) : ""}</td>
                    <td>{l.owner ? userName(crm, l.owner) : <span className="muted">No owner</span>}</td>
                    <td>{l.source}</td>
                    <td>{worked.get(l.id) ? relTime(worked.get(l.id)) : "Not worked"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!deals.length && <div className="empty"><b>No opportunities match</b>Clear the search or the inactivity filter.</div>}
            {deals.length > 200 && <p className="muted max-more">Showing 200 of {deals.length}. Search to narrow them down.</p>}
          </div>
        )}
      </section>
      {openId && <LeadPanel id={openId} onClose={() => setOpenId("")} />}
    </>
  );
}
