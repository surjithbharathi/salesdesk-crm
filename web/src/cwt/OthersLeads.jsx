import React, { useEffect, useState } from "react";
import { crmGet } from "../api.js";

// A staff member sees only their own leads. When a search matches a colleague's lead, the server says whose it is and
// at what stage, so nobody adds the customer twice or calls someone a colleague is already talking to. View only: no
// opening, calling or editing. Admins see every lead already, and get an empty list.
export function useOthersLeads(query) {
  const [found, setFound] = useState([]);
  useEffect(() => {
    const q = String(query || "").trim();
    const digits = q.replace(/\D/g, "");
    if (digits.length < 6 && q.length < 3) { setFound([]); return undefined; }
    let live = true;
    const wait = setTimeout(() => {
      crmGet(`leads/whose?q=${encodeURIComponent(q)}`).then((r) => { if (live) setFound(Array.isArray(r) ? r : []); }).catch(() => { if (live) setFound([]); });
    }, 300);
    return () => { live = false; clearTimeout(wait); };
  }, [query]);
  return found;
}

export function OthersLeads({ leads, compact = false }) {
  if (!leads.length) return null;
  return (
    <div className={`others-leads ${compact ? "compact" : ""}`} role="status">
      <p className="others-head">{leads.length === 1 ? "A colleague's lead" : "Colleagues' leads"} · view only</p>
      {leads.map((l) => (
        <div key={l.id} className="others-row">
          <span className="others-main"><b>{l.name || l.phone}</b><small>{l.phone}</small></span>
          <span className="others-side"><b>{l.owner === "Nobody" ? "No owner" : `${l.owner}'s lead`}</b><small>{[l.stage, l.archived ? "Archived" : ""].filter(Boolean).join(" · ")}</small></span>
        </div>
      ))}
    </div>
  );
}
