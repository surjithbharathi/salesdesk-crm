// State and language of a lead. Leads are given to people by these two, so they are plain fields of every lead.
// When a lead has a state but no language yet, the main language of that state is filled in as a first guess
// (languageGuess: true) for the team to correct; a language someone chose is never replaced.
export const STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand",
  "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan",
  "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
];
export const LANGUAGES = ["Tamil", "Telugu", "Kannada", "Malayalam", "Hindi", "Marathi", "Gujarati", "Bengali", "Odia", "Punjabi", "Assamese", "English", "Urdu", "Konkani"];
const STATE_LANGUAGE = {
  "Tamil Nadu": "Tamil", Puducherry: "Tamil", Kerala: "Malayalam", Lakshadweep: "Malayalam", Karnataka: "Kannada", "Andhra Pradesh": "Telugu", Telangana: "Telugu",
  Maharashtra: "Marathi", Goa: "Konkani", Gujarat: "Gujarati", "Dadra and Nagar Haveli and Daman and Diu": "Gujarati", "West Bengal": "Bengali", Tripura: "Bengali",
  Odisha: "Odia", Punjab: "Punjabi", Assam: "Assamese",
  "Uttar Pradesh": "Hindi", Bihar: "Hindi", "Madhya Pradesh": "Hindi", Rajasthan: "Hindi", Haryana: "Hindi", Delhi: "Hindi", Jharkhand: "Hindi", Chhattisgarh: "Hindi",
  Uttarakhand: "Hindi", "Himachal Pradesh": "Hindi", Chandigarh: "Hindi", "Jammu and Kashmir": "Hindi", Ladakh: "Hindi",
  "Andaman and Nicobar Islands": "Hindi", "Arunachal Pradesh": "Hindi", Sikkim: "English", Manipur: "English", Meghalaya: "English", Mizoram: "English", Nagaland: "English",
};
const key = (s) => String(s || "").toLowerCase().replace(/[^a-z]+/g, "");
const ALIASES = { tn: "Tamil Nadu", tamilnadu: "Tamil Nadu", ap: "Andhra Pradesh", up: "Uttar Pradesh", mp: "Madhya Pradesh", ts: "Telangana", tg: "Telangana", ka: "Karnataka", kl: "Kerala", mh: "Maharashtra", wb: "West Bengal", orissa: "Odisha", pondicherry: "Puducherry", newdelhi: "Delhi", nctofdelhi: "Delhi", jk: "Jammu and Kashmir", uttaranchal: "Uttarakhand" };
const BY_KEY = new Map([...STATES.map((s) => [key(s), s]), ...Object.entries(ALIASES)]);
// "TAMILNADU", "tamil nadu", "TN" -> "Tamil Nadu"; anything else is kept as written (trimmed)
export const cleanState = (s) => { const t = String(s ?? "").trim().slice(0, 80); return BY_KEY.get(key(t)) || t; };
export const cleanLanguage = (s) => { const t = String(s ?? "").trim().slice(0, 40); return LANGUAGES.find((l) => key(l) === key(t)) || t; };
export const languageOfState = (state) => STATE_LANGUAGE[cleanState(state)] || "";

// fills state and language of a lead from what is known, without overwriting what a person set; returns the changed lead or null
export function withRegion(lead, { state = "", language = "" } = {}) {
  const next = { ...lead };
  if (!next.state && state) next.state = cleanState(state);
  if (!next.language && language) { next.language = cleanLanguage(language); delete next.languageGuess; }
  if (!next.language && next.state && languageOfState(next.state)) { next.language = languageOfState(next.state); next.languageGuess = true; }
  return next.state !== lead.state || next.language !== lead.language ? next : null;
}
// what TeleCRM / Salesmax / an import know about a lead's state and language
export function regionHints(lead) {
  const f = lead.telecrm?.fields || {};
  const lang = Object.entries(f).find(([k, v]) => /lang/i.test(k) && v && typeof v !== "object")?.[1] || "";
  return { state: f.state || lead.salesmax?.state || "", language: lang };
}
