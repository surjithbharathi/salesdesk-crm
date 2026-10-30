import React, { useMemo, useState } from "react";
import { useCrm, userName } from "../crm.jsx";
import { initials } from "../format.js";
import Icon from "../icons.jsx";
import TeleLeadDetail from "./TeleLeadDetail.jsx";

function Mark({ text, needle }) {
  const s = String(text || "");
  const i = needle ? s.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (i < 0) return s;
  return <>{s.slice(0, i)}<mark>{s.slice(i, i + needle.length)}</mark>{s.slice(i + needle.length)}</>;
}

// "Search leads" in the TeleCRM style: results on the left with the match marked, the chosen lead on the right.
export default function TeleSearch({ params }) {
  const crm = useCrm();
  const [q, setQ] = useState(params.q || "");
  const [pick, setPick] = useState(params.lead || "");
  const needle = q.trim();
  const digits = needle.replace(/\D/g, "");
  const results = useMemo(() => {
    if (!crm.state || !needle) return [];
    const n = needle.toLowerCase();
    return crm.leads.filter((l) => !l.archived && (`${l.name} ${l.company || ""} ${l.city || ""} ${l.email || ""}`.toLowerCase().includes(n) || (digits.length > 2 && String(l.phone || "").replace(/\D/g, "").includes(digits)))).slice(0, 100);
  }, [crm.state, crm.leads, needle, digits]);
  if (!crm.state) return <p className="muted">{crm.error || "Loading leads…"}</p>;
  const chosen = results.find((l) => l.id === pick) || results[0];
  return (
    <div className="tele-split">
      <section className="tele-list" aria-label="Search leads">
        <header className="tele-list-head"><h1>Search leads</h1></header>
        <label className="tele-search tele-search-big">
          <Icon name="search" size={16} /><span className="sr">Search name, company, city, email or phone</span>
          <input type="search" autoFocus placeholder="Name, company, city, email or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {needle && <p className="tele-count">{results.length === 100 ? "100+" : results.length} matching leads for <i>{needle}</i></p>}
        {!needle && <p className="tele-empty">Type a name, company, city, email or phone number.</p>}
        <ul>
          {results.map((l) => (
            <li key={l.id}>
              <button className="tele-hit" aria-current={chosen?.id === l.id ? "true" : undefined} onClick={() => setPick(l.id)}>
                <span className="tele-hit-main">
                  <b><Mark text={l.name} needle={needle} /></b>
                  <small>{[l.company, l.city, l.phone].filter(Boolean).map((t, i) => <span key={i}>{i ? ", " : ""}<Mark text={t} needle={needle} /></span>)}</small>
                </span>
                <span className="avatar" title={userName(crm, l.owner)}>{l.owner ? initials(userName(crm, l.owner)) : "–"}</span>
                <span className="tele-go" aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {chosen ? <TeleLeadDetail key={chosen.id} id={chosen.id} /> : <div className="tele-detail-empty"><Icon name="search" size={44} /><p>{needle ? "No lead matches that." : "Search for a lead to see its details."}</p></div>}
    </div>
  );
}
