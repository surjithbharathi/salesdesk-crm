// Numbers the team never wants in the CRM (family, staff, spam). Phone call sync, the TeleCRM copy and the
// WhatsApp gateway all skip a blocked number, so a lead deleted with "block" does not come back.
// A number is kept as its last 10 digits, so 919787300010, +91 97873 00010 and 9787300010 are the same number.
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
  // A note of every lead deleted for good (name, number, who, when, blocked or not), so a search for the number can say what happened.
  db.exec("CREATE TABLE IF NOT EXISTS deleted_leads(id TEXT PRIMARY KEY, phone TEXT, name TEXT, by TEXT, at TEXT, blocked INTEGER)");
  return {
    recordDeleted: (lead, { by = "", blocked = false } = {}) => db.prepare("INSERT OR REPLACE INTO deleted_leads VALUES(?,?,?,?,?,?)").run(lead.id, numberKey(lead.phoneKey || lead.phone), String(lead.name || "").slice(0, 200), by, new Date().toISOString(), blocked ? 1 : 0),
    deleted: () => db.prepare("SELECT id, phone, name, by, at, blocked FROM deleted_leads ORDER BY at DESC LIMIT 5000").all().map((r) => ({ ...r, blocked: Boolean(r.blocked) })),
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
