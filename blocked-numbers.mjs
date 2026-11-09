// Numbers the team never wants in the CRM (family, staff, spam). Phone call sync, the TeleCRM copy and the
// WhatsApp gateway all skip a blocked number, so a lead deleted with "block" does not come back.
// A number is kept as its last 10 digits, so 919787333953, +91 97873 33953 and 9787333953 are the same number.
export const numberKey = (phone) => String(phone || "").replace(/[^0-9]/g, "").slice(-10);

export function ensureBlockedTable(db) {
  db.exec("CREATE TABLE IF NOT EXISTS blocked_numbers(phone TEXT PRIMARY KEY, name TEXT, by TEXT, at TEXT)");
}

export function isBlocked(db, phone) {
  const key = numberKey(phone);
  if (key.length < 8) return false;
  try {
    return Boolean(db.prepare("SELECT 1 FROM blocked_numbers WHERE phone=?").get(key));
  } catch {
    return false;
  }
}

export function createBlockedNumbers(db) {
  ensureBlockedTable(db);
  return {
    list: () => db.prepare("SELECT phone, name, by, at FROM blocked_numbers ORDER BY at DESC").all().map((r) => ({ ...r })),
    add(phone, { name = "", by = "" } = {}) {
      const key = numberKey(phone);
      if (key.length < 8) throw Object.assign(Error("This lead has no phone number to block"), { status: 400 });
      db.prepare("INSERT INTO blocked_numbers VALUES(?,?,?,?) ON CONFLICT(phone) DO UPDATE SET name=excluded.name, by=excluded.by, at=excluded.at").run(key, String(name).slice(0, 200), by, new Date().toISOString());
      return key;
    },
    remove: (phone) => Number(db.prepare("DELETE FROM blocked_numbers WHERE phone=?").run(numberKey(phone)).changes) > 0,
    has: (phone) => isBlocked(db, phone),
  };
}
