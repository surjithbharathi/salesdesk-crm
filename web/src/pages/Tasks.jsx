import React, { useState } from "react";
import { crmSend } from "../api.js";
import { useCrm, userName } from "../crm.jsx";
import { useToast } from "../toast.jsx";
import { hashFor, dueText, plural } from "../format.js";

export default function Tasks() {
  const crm = useCrm();
  const notify = useToast();
  const [busy, setBusy] = useState("");
  if (!crm.state) return <p className="muted">{crm.error || "Loading to-do…"}</p>;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = start.getTime() + 86400000;
  const sorted = [...crm.openTasks].sort((a, b) => a.due.localeCompare(b.due));
  const groups = [
    ["Late", sorted.filter((t) => Date.parse(t.due) < start.getTime())],
    ["Today", sorted.filter((t) => Date.parse(t.due) >= start.getTime() && Date.parse(t.due) < end)],
    ["Later", sorted.filter((t) => Date.parse(t.due) >= end)],
  ];
  async function done(task) {
    setBusy(task.id);
    try {
      await crmSend("PATCH", `tasks/${task.id}`, { status: "Done" });
      await crm.reload();
      notify("Follow-up marked done");
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="work-head">
        <h1 className="work-title">To-do</h1>
        <span className="work-date num">{plural(sorted.length, "open task")}</span>
      </div>
      {!sorted.length && <div className="empty"><b>Nothing to do</b>Follow-ups you add on a lead show up here.</div>}
      {groups.filter(([, list]) => list.length).map(([label, list]) => (
        <section key={label} aria-label={label}>
          <h2 className="section-title">{label} <span className="muted badge-count">{list.length}</span></h2>
          <ul className="work-tasks task-list">
            {list.map((t) => {
              const d = dueText(t.due);
              const lead = crm.leadById.get(t.leadId);
              return (
                <li key={t.id}>
                  <span>
                    <b>{t.title}</b> <span className={d.tone}>{d.text}</span>
                    <small className="muted"> {lead ? <a href={hashFor("/leads", { lead: lead.id })}>{lead.name}</a> : "No lead"}{crm.me.lead ? `, ${userName(crm, t.owner)}` : ""}</small>
                  </span>
                  <button className="btn" disabled={busy === t.id} onClick={() => done(t)}>Done</button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
