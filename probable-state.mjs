// "Probable state" of a lead that has no state: worked out from its mobile number, never written into the state itself.
// 1. Learned from this CRM's own leads: if most leads whose number starts with the same 5 digits (else 4 digits) have
//    one state, that state is probable ("your leads"). Checked on live data: about 80% right where it applies.
// 2. Otherwise the telecom circle of the 4-digit series (mobile-series.mjs): about 74% right on live data.
// A number keeps its series when the customer moves or ports, so this is a hint for routing, not a fact.
import { SERIES_BY_CIRCLE } from "./mobile-series.mjs";

// what each telecom circle covers, as the team would say it
export const CIRCLE_STATE = {
  AP: "Andhra Pradesh / Telangana", AS: "Assam", BR: "Bihar / Jharkhand", DL: "Delhi", GJ: "Gujarat", HP: "Himachal Pradesh", HR: "Haryana",
  JK: "Jammu and Kashmir", KA: "Karnataka", KL: "Kerala", MH: "Maharashtra / Goa", MP: "Madhya Pradesh / Chhattisgarh", NE: "North East",
  OR: "Odisha", PB: "Punjab", RJ: "Rajasthan", TN: "Tamil Nadu", UE: "Uttar Pradesh", UW: "Uttar Pradesh / Uttarakhand", UP: "Uttar Pradesh", WB: "West Bengal",
};
const CIRCLE_OF = new Map(Object.entries(SERIES_BY_CIRCLE).flatMap(([c, list]) => list.split(" ").map((s) => [s, c])));
// the 10-digit Indian mobile number of a lead, or ""
export const mobileOf = (lead) => { const d = String(lead.phoneKey || lead.phone || "").replace(/\D/g, ""); const n = d.length === 12 && d.startsWith("91") ? d.slice(2) : d.length === 10 ? d : ""; return /^[6-9]\d{9}$/.test(n) ? n : ""; };
export const circleOf = (mobile) => CIRCLE_OF.get(String(mobile).slice(0, 4)) || "";

// learns series -> state from leads that have a state; returns guess(mobile) -> { state, from } | null
export function learnSeries(leads) {
  const count = (len) => {
    const m = new Map();
    for (const l of leads) { const n = mobileOf(l); if (!n || !l.state) continue; const k = n.slice(0, len), c = m.get(k) || new Map(); c.set(l.state, (c.get(l.state) || 0) + 1); m.set(k, c); }
    return m;
  };
  const c5 = count(5), c4 = count(4);
  const top = (m, k, min) => { const c = m.get(k); if (!c) return ""; let total = 0, best = "", n = 0; for (const [s, x] of c) { total += x; if (x > n) { best = s; n = x; } } return total >= min && n / total >= 0.7 ? best : ""; };
  return (mobile) => {
    if (!mobile) return null;
    const own = top(c5, mobile.slice(0, 5), 3) || top(c4, mobile.slice(0, 4), 5);
    if (own) return { state: own, from: "your leads" };
    const circle = circleOf(mobile);
    return circle ? { state: CIRCLE_STATE[circle], from: "number series" } : null;
  };
}

// sets probableState / probableStateFrom on leads without a state (and clears them once a state is set); returns the changed leads
export function probableStates(leads) {
  const guess = learnSeries(leads), changed = [];
  for (const l of leads) {
    const g = l.state ? null : guess(mobileOf(l));
    const state = g?.state || "", from = g?.from || "";
    if ((l.probableState || "") === state && (l.probableStateFrom || "") === from) continue;
    const next = { ...l };
    if (state) { next.probableState = state; next.probableStateFrom = from; } else { delete next.probableState; delete next.probableStateFrom; }
    changed.push(next);
  }
  return changed;
}
