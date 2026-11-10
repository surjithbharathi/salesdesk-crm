import React, { useEffect, useMemo, useRef, useState } from "react";
import { useCrm } from "../crm.jsx";
import { hashFor } from "../format.js";
import { pipelineStep } from "../pipeline.js";
import { TIcon } from "./icons.jsx";

// The search box at the top of every page. It searches as you type and matches anything about a lead: name, phone (any
// part of the number), business, city, state, language, source, email, owner, stage and TeleCRM's own fields.
// Enter opens the first lead; "See all results" opens the full search (which also tells about deleted and blocked numbers).
// "/" or Ctrl+K puts the cursor in it from anywhere.
const statusOf = (l) => (l.stage === "New" ? "New" : pipelineStep(l) || l.stage || "");

export default function GlobalSearch() {
  const crm = useCrm();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const box = useRef(null), input = useRef(null);
  useEffect(() => {
    const key = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;
      if ((e.key === "/" && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) { e.preventDefault(); input.current?.focus(); setOpen(true); }
    };
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    window.addEventListener("keydown", key);
    document.addEventListener("pointerdown", away);
    return () => { window.removeEventListener("keydown", key); document.removeEventListener("pointerdown", away); };
  }, []);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2 || !crm.state) return [];
    const digits = needle.replace(/\D/g, ""), phoneLike = digits.length >= 3 && digits.length >= needle.replace(/[\s+()-]/g, "").length - 1;
    const words = needle.split(/\s+/).filter(Boolean);
    const out = [];
    for (const l of crm.leads) {
      const owner = crm.users.get(l.owner)?.name || "";
      const fields = [["Name", l.name], ["Business", l.company], ["City", l.city], ["State", l.state], ["Language", l.language], ["Source", l.source], ["Email", l.email], ["Owner", owner], ["Stage", statusOf(l)]];
      for (const [k, v] of Object.entries(l.telecrm?.fields || {})) if (typeof v === "string" && v && !/_on$|frequency/.test(k)) fields.push([k.replace(/_/g, " "), v]);
      let score = 0, why = "";
      const phone = String(l.phone || "").replace(/\D/g, "");
      if (phoneLike && phone.includes(digits)) { score = phone.endsWith(digits) ? 100 : 90; why = l.phone; }
      else {
        const name = String(l.name || "").toLowerCase();
        if (name.startsWith(needle)) score = 80;
        else if (name.includes(needle)) score = 70;
        else if (words.every((w) => fields.some(([, v]) => String(v || "").toLowerCase().includes(w)))) {
          score = 50;
          const hit = fields.find(([k, v]) => k !== "Name" && String(v || "").toLowerCase().includes(words[0]));
          if (hit) why = `${hit[0][0].toUpperCase()}${hit[0].slice(1)}: ${hit[1]}`;
        }
      }
      if (score) out.push({ l, score: score - (l.archived ? 30 : 0), why, owner });
    }
    return out.sort((a, b) => b.score - a.score || String(b.l.updatedAt || "").localeCompare(String(a.l.updatedAt || ""))).slice(0, 50);
  }, [q, crm.state, crm.leads, crm.users]);
  useEffect(() => setAt(0), [q]);

  const go = (l) => { setOpen(false); setQ(""); input.current?.blur(); location.hash = hashFor("/leads", { lead: l.id }); };
  const seeAll = () => { setOpen(false); location.hash = hashFor("/search", { q: q.trim() }); };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(i + 1, Math.min(results.length, 8) - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (results[at]) go(results[at].l); else if (q.trim()) seeAll(); }
    else if (e.key === "Escape") { setOpen(false); input.current?.blur(); }
  };
  const shown = results.slice(0, 8);

  return (
    <div className="gsearch" ref={box}>
      <TIcon name="search" className="gs-icon" />
      <input ref={input} type="search" value={q} placeholder="Search anything: name, phone, city, state, business…" aria-label="Search leads"
        role="combobox" aria-expanded={open && q.trim().length >= 2} aria-controls="gsearch-list" aria-activedescendant={shown[at] ? `gs-${shown[at].l.id}` : undefined}
        onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onKeyDown={onKey} />
      {!q && <kbd className="gs-kbd" aria-hidden="true">/</kbd>}
      {open && q.trim().length >= 2 && (
        <div className="gs-pop" id="gsearch-list" role="listbox" aria-label="Search results">
          {shown.map(({ l, why, owner }, i) => (
            <button key={l.id} id={`gs-${l.id}`} type="button" role="option" aria-selected={i === at} className={i === at ? "on" : ""} onMouseEnter={() => setAt(i)} onClick={() => go(l)}>
              <span className="gs-main"><b>{l.name || l.phone}</b>{l.archived && <em className="gs-tag">Archived</em>}<small>{[l.phone, l.city, l.state].filter(Boolean).join(" · ")}</small></span>
              <span className="gs-side"><span className="gs-stage">{statusOf(l)}</span><small>{why || owner || ""}</small></span>
            </button>
          ))}
          {!shown.length && <p className="gs-none">No lead matches “{q.trim()}”.</p>}
          <button type="button" className="gs-all" onClick={seeAll}>{results.length > shown.length ? `See all ${results.length >= 50 ? "50+" : results.length} results` : "Search deleted and blocked numbers too"}</button>
        </div>
      )}
    </div>
  );
}
