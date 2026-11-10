import React, { useEffect, useMemo, useState } from "react";
import { crmGet } from "../api.js";
import { useCrm } from "../crm.jsx";
import { hashFor } from "../format.js";
import { TIcon } from "./icons.jsx";
import LeadPanel from "./LeadDetail.jsx";
import { statusOf } from "./PageUtil.js";
import CwtCalls from "./PageCalls.jsx";
import CwtFollowups from "./PageFollowups.jsx";
import CwtReports from "./PageReports.jsx";

// My Calls, Search, Follow Ups and Reports in the Salesdesk (telecrm skin) look. My Calls, Follow Ups and Reports live in
// PageCalls.jsx, PageFollowups.jsx and PageReports.jsx; the style sheets are cwt/r-pages.css and cwt/pages.css.
export { CwtCalls, CwtFollowups, CwtReports };
// ---------------------------------------------------------------- Search
const MODES = [["auto", "Auto", ""], ["whatsapp", "Phone", "whatsapp"], ["text", "Text", "notePlus"], ["phone", "Phone", "phone"], ["email", "Email", "mail"]];
export function CwtSearch({ params }) {
  const crm = useCrm();
  const [query, setQuery] = useState(params.q || "");
  const [mode, setMode] = useState("auto");
  const [openId, setOpenId] = useState("");
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !crm.state) return [];
    const digits = q.replace(/\D/g, "");
    const byPhone = (p) => digits.length >= 3 && String(p || "").replace(/\D/g, "").includes(digits);
    return crm.leads.filter((l) => (mode === "email" ? String(l.email || "").toLowerCase().includes(q) : mode === "phone" || mode === "whatsapp" ? byPhone(l.phone)
      : mode === "text" ? `${l.name} ${l.company || ""}`.toLowerCase().includes(q) : `${l.name} ${l.email || ""} ${l.company || ""} ${l.city || ""}`.toLowerCase().includes(q) || byPhone(l.phone))).slice(0, 50);
  }, [crm.state, crm.leads, query, mode]);
  // Deleted leads and blocked numbers (admins only; others get empty lists), so a search can say what happened to a lead
  // that is no longer here: deleted, or deleted and blocked. Archived leads stay in the results with an Archived tag.
  const [blockedList, setBlockedList] = useState([]);
  const [deletedList, setDeletedList] = useState([]);
  useEffect(() => {
    const load = (path, set) => crmGet(path).then((l) => set(Array.isArray(l) ? l : [])).catch(() => set([]));
    load("blocked-numbers", setBlockedList);
    load("deleted-leads", setDeletedList);
  }, []);
  const digits = query.replace(/\D/g, "");
  const words = query.trim().toLowerCase();
  const sameNumber = (n) => digits.length >= 8 && (n.endsWith(digits.slice(-10)) || digits.endsWith(n));
  const blockedHit = blockedList.find((b) => sameNumber(b.phone)) || null;
  const gone = deletedList.filter((d) => sameNumber(d.phone) || (words.length >= 3 && !digits && d.name.toLowerCase().includes(words))).slice(0, 10);
  const dateOf = (t) => (t ? new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
  const byName = (id) => (id ? crm.users.get(id)?.name || "" : "");
  const pretty = (n) => `+91 ${n.replace(/(\d{5})(\d{5})$/, "$1 $2")}`;
  return (
    <div className="cwt-search">
      <div className="page">
        <h1>Search leads</h1>
        <div className="box">
          <label className="field"><input placeholder="Search for a lead's name, phone or other details" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus /><TIcon name="search" /></label>
          <div className="modes"><TIcon name="search" className="lens" />{MODES.map(([k, label, icon]) => <button key={k} type="button" className={mode === k ? "on" : ""} onClick={() => setMode(k)}>{icon && <TIcon name={icon} />}{label}</button>)}</div>
        </div>
        {!query.trim() ? <p className="hint">Enter search value to see results here</p> : (
          <>
            <p className="hint">{results.length} result(s)</p>
            {blockedHit && (
              <div className="gone-note blocked" role="status">
                <b>{pretty(blockedHit.phone)}: {gone.some((d) => d.phone === blockedHit.phone) || blockedHit.name ? "Deleted and blocked" : "Blocked"}</b>
                <span>{blockedHit.name ? `"${blockedHit.name}" ` : "This number "}was blocked{blockedHit.at ? ` on ${dateOf(blockedHit.at)}` : ""}{byName(blockedHit.by) ? ` by ${byName(blockedHit.by)}` : ""}. Calls and WhatsApp from it do not create a lead.</span>
                <a href={hashFor("/settings", { tab: "blocked" })}>Manage blocked numbers</a>
              </div>
            )}
            {gone.filter((d) => !(blockedHit && d.phone === blockedHit.phone)).map((d) => (
              <div key={d.id} className="gone-note" role="status">
                <b>{d.name || pretty(d.phone)}: {d.blocked ? "Deleted and blocked, now unblocked" : "Deleted"}</b>
                <span>{d.phone ? `${pretty(d.phone)}. ` : ""}Deleted on {dateOf(d.at)}{byName(d.by) ? ` by ${byName(d.by)}` : ""}. {d.blocked ? "The number was unblocked later, so" : "The number is not blocked, so"} a new call or chat from it creates a new lead.</span>
              </div>
            ))}
            <div className="results">
              {results.map((l) => <button key={l.id} type="button" className="res" onClick={() => setOpenId(l.id)}><b>{l.name}</b><span className="ph">{l.phone}</span><span className="row">Status: <span className="st">{statusOf(l)}</span>{l.archived && <span className="st archived">Archived</span>}<span className="as">{crm.users.get(l.owner)?.name || "No owner"}</span></span></button>)}
              {!results.length && !blockedHit && !gone.length && <p className="hint">No leads found.</p>}
            </div>
          </>
        )}
      </div>
      {openId && <LeadPanel id={openId} ids={results.map((l) => l.id)} onOpen={setOpenId} onClose={() => setOpenId("")} />}
    </div>
  );
}
