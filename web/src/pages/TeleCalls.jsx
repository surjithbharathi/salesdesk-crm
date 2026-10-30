import React, { useMemo, useState } from "react";
import { useCrm, stageText } from "../crm.jsx";
import Icon from "../icons.jsx";
import TeleLeadDetail from "./TeleLeadDetail.jsx";
import { ms, relTime, talk, tagClass } from "./tele.js";

const PAGE = 60;
const FILTERS = [["", "All"], ["Outgoing", "Called"], ["Incoming", "Received"], ["Missed", "Missed"]];

// "My Calls" in the TeleCRM style: the calls on the left, the lead of the chosen call on the right.
export default function TeleCalls() {
  const crm = useCrm();
  const [filter, setFilter] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [pick, setPick] = useState("");
  const rows = useMemo(
    () => (crm.state ? crm.calls.filter((c) => !filter || c.direction === filter).sort((a, b) => ms(b.startedAt) - ms(a.startedAt)) : []),
    [crm.state, crm.calls, filter],
  );
  if (!crm.state) return <p className="muted">{crm.error || "Loading calls…"}</p>;
  const chosen = rows.find((c) => c.id === pick) || rows[0];
  return (
    <div className="tele-split">
      <section className="tele-list" aria-label="My calls">
        <header className="tele-list-head">
          <h1>My calls</h1>
          <button className="tele-refresh" onClick={() => crm.reload()} aria-label="Refresh calls"><Icon name="again" size={14} /></button>
        </header>
        <div className="pills tele-pills" role="group" aria-label="Kind of call">
          {FILTERS.map(([key, label]) => <button key={key || "all"} className="pill" aria-pressed={filter === key} onClick={() => { setFilter(key); setShown(PAGE); }}>{label}</button>)}
        </div>
        {!rows.length && <p className="tele-empty">No calls yet. Calls made from the phone app appear here.</p>}
        <ul>
          {rows.slice(0, shown).map((c) => {
            const lead = crm.leadById.get(c.leadId);
            const answered = c.duration > 0;
            return (
              <li key={c.id}>
                <button className="tele-call" aria-current={chosen?.id === c.id ? "true" : undefined} onClick={() => setPick(c.id)}>
                  <b className="tele-call-name">{lead ? lead.name : c.phone}</b>
                  <span className="tele-call-phone">{c.phone}</span>
                  {lead && <span className="tele-call-status">Status: <span className={`tag ${tagClass(lead)}`}>{stageText(lead)}</span></span>}
                  <span className="tele-call-line">
                    <Icon name="phone" size={14} />
                    <b>{answered ? talk(c.duration) : "0s"}</b>
                    <span className="muted">{relTime(c.startedAt)}</span>
                    <span className={answered ? "tele-connected" : "tele-missed"}>{answered ? "CONNECTED" : c.direction === "Incoming" ? "MISSED" : "NOT ANSWERED"}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {rows.length > shown && <button className="btn tele-more" onClick={() => setShown((n) => n + PAGE)}>Show more calls ({rows.length - shown} left)</button>}
      </section>
      {chosen?.leadId ? <TeleLeadDetail key={chosen.leadId} id={chosen.leadId} /> : (
        <div className="tele-detail-empty"><Icon name="phone" size={44} /><p>{chosen ? "This number is not a lead in the CRM yet." : "Choose a call to see the lead."}</p></div>
      )}
    </div>
  );
}
