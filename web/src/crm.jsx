import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AuthError, crmGet, crmStateText } from "./api.js";
import { clearState, readState, saveDelta, saveFull } from "./stateCache.js";
import { pipelineStep } from "./pipeline.js";
import { PhoneDial } from "./PhoneDial.jsx";

const CrmContext = createContext(null);
export const useCrm = () => useContext(CrmContext);

// History brought in from another CRM (the Salesmax import) is not in the shared state; a lead's screen reads it when opened.
const histories = new Map();
export function useLeadHistory(id) {
  const [items, setItems] = useState(() => histories.get(id) || []);
  useEffect(() => {
    let on = true;
    setItems(histories.get(id) || []);
    if (!id) return;
    crmGet(`leads/${encodeURIComponent(id)}/history`).then((r) => { histories.set(id, r.activities || []); if (on) setItems(r.activities || []); }).catch(() => {});
    return () => { on = false; };
  }, [id]);
  return items;
}

const open = (lead) => lead.stage !== "Closed" && !lead.archived;

// Puts changed records into the state: replaced where they were, new ones first (the state lists newest first),
// deleted ones dropped. Kinds that did not change keep their arrays, so their screens do not redraw.
function mergeChanges(state, { changes = {}, deleted = {}, syncSeq }) {
  const next = { ...state, syncSeq };
  for (const kind of new Set([...Object.keys(changes), ...Object.keys(deleted)])) {
    const list = state[kind] || [];
    const gone = new Set(deleted[kind] || []);
    const fresh = new Map((changes[kind] || []).map((r) => [r.id, r]));
    const kept = [];
    for (const r of list) {
      if (gone.has(r.id)) continue;
      if (fresh.has(r.id)) { kept.push(fresh.get(r.id)); fresh.delete(r.id); } else kept.push(r);
    }
    next[kind] = [...fresh.values(), ...kept];
  }
  return next;
}

// Loads the CRM's records once and keeps simple lookups. `reload` is called after every change so screens never show
// stale numbers: after the first load it asks only for what changed, instead of downloading the whole CRM again.
export function CrmProvider({ me, children }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const seq = useRef(null);
  const latest = useRef(null);
  latest.current = state;
  const uid = me?.id || "";
  const reload = useCallback(async () => {
    try {
      if (seq.current != null) {
        const from = seq.current;
        const delta = await crmGet(`state/changes?after=${from}`);
        // a staff member's screen holds only their own leads: an older lead just given to them brings its past calls and
        // notes, which only the whole load has, so that one case loads everything again
        const have = delta.scoped && new Set((latest.current?.leads || []).map((l) => l.id));
        const handedOver = have && (delta.changes?.leads || []).some((l) => !have.has(l.id) && Date.now() - Date.parse(l.createdAt || 0) > 600000);
        if (!delta.full && !handedOver) {
          seq.current = delta.syncSeq;
          if (Object.keys(delta.changes || {}).length || Object.keys(delta.deleted || {}).length) {
            setState((s) => (s ? mergeChanges(s, delta) : s));
            if (uid) saveDelta(uid, from, delta, () => latest.current);
          }
          setError("");
          return;
        }
      }
      const { data: full, text } = await crmStateText();
      seq.current = Number.isInteger(full.syncSeq) ? full.syncSeq : null;
      setState(full);
      setError("");
      if (uid) saveFull(uid, seq.current, text);
    } catch (e) {
      if (e instanceof AuthError) clearState();
      setError(e.message);
    }
  }, [uid]);
  useEffect(() => {
    let loadedAt = Date.now();
    let on = true;
    // Show the copy kept in this browser at once, then ask the server only for what changed since.
    (uid ? readState(uid, mergeChanges) : Promise.resolve(null)).then((saved) => {
      if (!on) return;
      if (saved && seq.current == null) {
        seq.current = saved.seq;
        setState(saved.state);
      }
      reload();
    });
    // Coming back to the tab refreshes the data, but not more than once a minute: on a phone every app switch
    // would otherwise download the whole CRM again.
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - loadedAt < 60000) return;
      loadedAt = Date.now();
      reload();
    };
    document.addEventListener("visibilitychange", refresh);
    return () => { on = false; document.removeEventListener("visibilitychange", refresh); };
  }, [reload]);
  const value = useMemo(() => {
    if (!state) return { me, state: null, error, reload };
    const leads = state.leads || [];
    const tasks = state.tasks || [];
    const users = new Map((state.users || []).map((u) => [u.id, u]));
    const leadById = new Map(leads.map((l) => [l.id, l]));
    const openTasks = tasks.filter((t) => t.status !== "Done");
    const nextDue = new Map();
    for (const t of openTasks) if (t.leadId && (!nextDue.has(t.leadId) || t.due < nextDue.get(t.leadId))) nextDue.set(t.leadId, t.due);
    return { me, state, error, reload, leads, tasks, openTasks, users, leadById, nextDue, activities: state.activities || [], calls: state.mobileCalls || [], isOpen: open };
  }, [state, error, me, reload]);
  return <CrmContext.Provider value={value}><PhoneDial />{children}</CrmContext.Provider>;
}

export const userName = (crm, id) => crm.users.get(id)?.name || "No owner";
export function phoneLabel(lead) {
  return lead.phone || (lead.mobileNumber ? `${lead.countryCode || ""}${lead.mobileNumber}` : "No phone");
}
export const telHref = (lead) => `tel:${String(lead.phone || "").replace(/[^\d+]/g, "")}`;
export const waHref = (lead) => `https://wa.me/${String(lead.phone || "").replace(/\D/g, "")}`;

export const STAGES = [["New", "New"], ["Prospecting", "Discussion"], ["Opportunity", "Interested customer"], ["Quotation given", "Quotation given"], ["Closed", "Closed"]];
export const stageLabel = (stage) => STAGES.find(([key]) => key === stage)?.[1] || stage;
// What people see as the stage: the pipeline step when there is one, else the basic stage.
export const stageText = (lead) => (lead.stage === "New" ? "New" : pipelineStep(lead) || (lead.stage === "Closed" ? lead.disposition || "Closed" : stageLabel(lead.stage)));
