import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { crmState } from "./api.js";

const CrmContext = createContext(null);
export const useCrm = () => useContext(CrmContext);

const open = (lead) => lead.stage !== "Closed" && !lead.archived;

// Loads the CRM's records once and keeps simple lookups. `reload` is called after every change so screens never show stale numbers.
export function CrmProvider({ me, children }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      setState(await crmState());
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    reload();
    const refresh = () => document.visibilityState === "visible" && reload();
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
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
  return <CrmContext.Provider value={value}>{children}</CrmContext.Provider>;
}

export const userName = (crm, id) => crm.users.get(id)?.name || "No owner";
export function phoneLabel(lead) {
  return lead.phone || (lead.mobileNumber ? `${lead.countryCode || ""}${lead.mobileNumber}` : "No phone");
}
export const telHref = (lead) => `tel:${String(lead.phone || "").replace(/[^\d+]/g, "")}`;
export const waHref = (lead) => `https://wa.me/${String(lead.phone || "").replace(/\D/g, "")}`;

export const STAGES = [["New", "New"], ["Prospecting", "Discussion"], ["Opportunity", "Interested customer"], ["Quotation given", "Quotation given"], ["Closed", "Closed"]];
export const stageLabel = (stage) => STAGES.find(([key]) => key === stage)?.[1] || stage;
export const stageText = (lead) => (lead.stage === "Closed" ? lead.disposition || "Closed" : stageLabel(lead.stage));
