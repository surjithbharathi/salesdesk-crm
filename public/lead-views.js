export function applyLeadView(leads, definition = {}) {
  const query = String(definition.query || "").toLowerCase();
  const rows = leads.filter(
    (l) =>
      Boolean(l.archived) === Boolean(definition.archived) &&
      (!definition.stage || l.stage === definition.stage) &&
      (!definition.owner || l.owner === definition.owner) &&
      (!definition.source || l.source === definition.source) &&
      ["name", "company", "phone", "email", "city"].some((k) =>
        String(l[k] || "")
          .toLowerCase()
          .includes(query),
      ),
  );
  const key = ["name", "createdAt", "value"].includes(definition.sortKey)
    ? definition.sortKey
    : "createdAt";
  const direction = definition.sortDir === "asc" ? 1 : -1;
  return rows.sort((a, b) => {
    const comparison =
      key === "value"
        ? Number(a.value || 0) - Number(b.value || 0)
        : String(a[key] || "").localeCompare(String(b[key] || ""), undefined, { numeric: true });
    return direction * comparison || String(a.id).localeCompare(String(b.id));
  });
}
