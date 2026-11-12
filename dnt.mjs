// Do Not Track (DNT) numbers: personal/office/blocked numbers that Salesdesk must never track.
// Numbers are stored as a normalized key (country code + national number, digits only).
const fail = (message, status = 400) => {
  throw Object.assign(Error(message), { status });
};
export const DEFAULT_COUNTRY_CODE = "91";
export const MAX_BULK = 10000;

// 10-digit local -> prefix country code; 0-prefixed 11-digit -> drop the 0; 00-prefixed -> international.
export function dntKey(value, countryCode = DEFAULT_COUNTRY_CODE) {
  let d = String(value ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = countryCode + d.slice(1);
  else if (d.length === 10) d = countryCode + d;
  return /^[1-9]\d{7,14}$/.test(d) ? d : "";
}

export function createDnt({ db, countryCode = DEFAULT_COUNTRY_CODE, now = () => new Date().toISOString() }) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS dnt_numbers(key TEXT PRIMARY KEY, phone TEXT NOT NULL, source TEXT NOT NULL DEFAULT '', added_by TEXT NOT NULL DEFAULT '', added_at TEXT NOT NULL)",
  );
  const key = (v) => dntKey(v, countryCode);
  const hasStmt = db.prepare("SELECT 1 FROM dnt_numbers WHERE key=?");
  const insert = db.prepare(
    "INSERT OR IGNORE INTO dnt_numbers(key,phone,source,added_by,added_at) VALUES(?,?,?,?,?)",
  );
  const has = (v) => {
    const k = key(v);
    return Boolean(k && hasStmt.get(k));
  };
  function add(numbers, { source = "", addedBy = "" } = {}) {
    if (!Array.isArray(numbers) || !numbers.length || numbers.length > MAX_BULK)
      fail(`Provide 1–${MAX_BULK} numbers`);
    if (typeof source !== "string" || source.length > 60) fail("Invalid source");
    const out = { added: 0, existing: 0, invalid: [] };
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const raw of numbers) {
        const k = typeof raw === "string" || typeof raw === "number" ? key(raw) : "";
        if (!k) {
          if (out.invalid.length < 50) out.invalid.push(String(raw).slice(0, 40));
          continue;
        }
        const r = insert.run(k, "+" + k, source, String(addedBy).slice(0, 80), now());
        if (r.changes) out.added++;
        else out.existing++;
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return out;
  }
  function remove(numbers) {
    if (!Array.isArray(numbers) || !numbers.length || numbers.length > MAX_BULK)
      fail(`Provide 1–${MAX_BULK} numbers`);
    const del = db.prepare("DELETE FROM dnt_numbers WHERE key=?");
    let removed = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const raw of numbers) {
        const k = key(raw);
        if (k) removed += Number(del.run(k).changes);
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return { removed };
  }
  function list({ q = "", limit = 50, offset = 0 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const off = Math.max(Number(offset) || 0, 0);
    const digits = String(q).replace(/\D/g, "");
    const where = digits ? "WHERE key LIKE ?" : "";
    const args = digits ? [`%${digits}%`] : [];
    const total = db.prepare(`SELECT COUNT(*) c FROM dnt_numbers ${where}`).get(...args).c;
    const rows = db
      .prepare(
        `SELECT phone, source, added_by AS addedBy, added_at AS addedAt FROM dnt_numbers ${where} ORDER BY added_at DESC, key LIMIT ? OFFSET ?`,
      )
      .all(...args, lim, off);
    return { total: Number(total), rows };
  }
  const count = () => Number(db.prepare("SELECT COUNT(*) c FROM dnt_numbers").get().c);
  return { key, has, add, remove, list, count };
}
