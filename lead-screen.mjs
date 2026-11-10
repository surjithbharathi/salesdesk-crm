// The phone's lead screen: the same details and history the web lead page shows. A person sees their own leads, unassigned
// leads and, as an administrator, every lead; a colleague's lead is refused.
const FIELDS = ["id", "name", "phone", "countryCode", "mobileNumber", "company", "email", "city", "state", "probableState", "language", "languageFrom", "stage", "deal", "disposition", "owner", "value", "source", "createdAt", "updatedAt", "rating"];
const ACT = ["id", "type", "text", "direction", "duration", "outcome", "occurredAt", "createdAt", "recordingId", "voiceNoteId", "importedFrom"];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== "" && o[k] !== null).map((k) => [k, o[k]]));

export function leadScreen({ db, get, users }, id, viewer) {
  let lead = get("leads", id);
  if (lead?.mergedInto) lead = get("leads", lead.mergedInto) || lead;
  if (!lead || lead.archived) throw Object.assign(new Error("Lead not found"), { status: 404 });
  if (!viewer.admin && lead.owner && lead.owner !== viewer.id) throw Object.assign(new Error("This lead belongs to a colleague"), { status: 403 });
  const people = new Map(users().map((u) => [u.id, u.name || u.username || ""]));
  const rows = (kind) => db.prepare(`SELECT body FROM records WHERE kind='${kind}' AND json_extract(body,'$.leadId')=?`).all(lead.id).map((r) => JSON.parse(r.body));
  const when = (a) => String(a.occurredAt || a.createdAt || "");
  const activities = rows("activities").sort((a, b) => when(b).localeCompare(when(a))).slice(0, 200)
    .map((a) => ({ ...pick(a, ACT), ...(typeof a.text === "string" && a.text.length > 2000 ? { text: a.text.slice(0, 1999) + "…" } : {}), by: people.get(a.userId) || "" }));
  const tasks = rows("tasks").filter((t) => t.status !== "Done").sort((a, b) => String(a.due).localeCompare(String(b.due)))
    .map((t) => ({ id: t.id, title: t.title, due: t.due, status: t.status || "Open" }));
  return {
    lead: { ...pick(lead, FIELDS), ownerName: people.get(lead.owner) || "" },
    activities, tasks,
    canEdit: lead.owner === viewer.id,
  };
}
