import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const SESSION_MS = 12 * 60 * 60 * 1000;
const WINDOW_MS = 5 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createUserAuth({ db, getUser, now = () => Date.now() }) {
  db.exec(`CREATE TABLE IF NOT EXISTS auth_accounts(user_id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, device_id TEXT);
    CREATE TABLE IF NOT EXISTS auth_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_resets(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL);`);
  const failures = new Map();
  let globalFailures = [];
  const configured = () => Boolean(db.prepare("SELECT 1 FROM auth_accounts LIMIT 1").get());
  const companyName = () =>
    db.prepare("SELECT value FROM auth_settings WHERE key='company'").get()?.value || "";
  function usernameOf(value) {
    if (typeof value !== "string") fail("Invalid username");
    const name = value.trim().toLowerCase();
    if (!/^[a-z0-9.@_+\-]{3,120}$/.test(name))
      fail("Username must be 3–120 letters, numbers, or . @ _ + -");
    return name;
  }
  function publicUser(account) {
    const user = account && getUser(account.user_id);
    if (!user?.active) fail("Invalid credentials or session", 401);
    return { id: user.id, name: user.name, username: account.username, role: account.role };
  }
  function addAccount({ userId, username, password }, role) {
    const name = usernameOf(username);
    if (typeof password !== "string" || password.length < 12 || password.length > 200)
      fail("Password must be 12–200 characters");
    if (typeof userId !== "string" || !getUser(userId)?.active) fail("Select an active CRM user");
    if (db.prepare("SELECT 1 FROM auth_accounts WHERE user_id=? OR username=?").get(userId, name))
      fail("User or username already has an account", 409);
    const salt = randomBytes(32).toString("hex");
    const passwordHash = scryptSync(password, salt, 64).toString("hex");
    db.prepare("INSERT INTO auth_accounts VALUES(?,?,?,?,?)").run(
      userId,
      name,
      salt,
      passwordHash,
      role,
    );
    return { user_id: userId, username: name, role };
  }
  function session(account, deviceId) {
    const user = publicUser(account);
    const token = randomBytes(32).toString("base64url");
    db.prepare("DELETE FROM auth_sessions WHERE expires_at<=?").run(now());
    db.prepare("INSERT INTO auth_sessions VALUES(?,?,?,?)").run(
      digest(token),
      user.id,
      now() + SESSION_MS,
      deviceId || null,
    );
    return { token, user, company: companyName(), deviceId: deviceId || null };
  }
  function bootstrap({ userId, username, password, company }) {
    if (typeof company !== "string" || !company.trim() || company.trim().length > 120)
      fail("Company name required (maximum 120 characters)");
    db.exec("BEGIN IMMEDIATE");
    try {
      if (configured()) fail("Account setup already completed", 409);
      const account = addAccount({ userId, username, password }, "admin");
      db.prepare("INSERT INTO auth_settings VALUES('company',?)").run(company.trim());
      const result = session(account);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  function createAccount(admin, input) {
    // Re-read authority: never trust a role supplied by a caller.
    const actor = admin?.user && admin.user.id ? admin.user : admin;
    const account =
      actor?.id && db.prepare("SELECT * FROM auth_accounts WHERE user_id=?").get(actor.id);
    if (!account || publicUser(account).role !== "admin") fail("Administrator required", 403);
    return { user: publicUser(addAccount(input, "member")), company: companyName() };
  }
  function login({ username, password, deviceId } = {}) {
    if (deviceId !== undefined && (typeof deviceId !== "string" || !UUID.test(deviceId)))
      fail("Device ID must be a UUID");
    let name;
    try {
      name = usernameOf(username);
    } catch {
      name = "<invalid>";
    }
    const time = now();
    globalFailures = globalFailures.filter((t) => t > time - WINDOW_MS);
    const recent = (failures.get(name) || []).filter((t) => t > time - WINDOW_MS);
    if (recent.length >= 5 || globalFailures.length >= 100)
      fail("Invalid credentials or session", 401);
    const account = db.prepare("SELECT * FROM auth_accounts WHERE username=?").get(name);
    // Unknown users perform the same password derivation to reduce enumeration.
    const safePassword = typeof password === "string" && password.length <= 200 ? password : "";
    const candidate = scryptSync(safePassword, account?.salt || "0".repeat(64), 64);
    const expected = Buffer.from(account?.password_hash || "0".repeat(128), "hex");
    if (!account || !timingSafeEqual(candidate, expected) || !getUser(account.user_id)?.active) {
      recent.push(time);
      failures.set(name, recent);
      globalFailures.push(time);
      // Bound attacker-controlled username memory.
      if (failures.size > 1000) failures.delete(failures.keys().next().value);
      fail("Invalid credentials or session", 401);
    }
    failures.delete(name);
    return session(account, deviceId);
  }
  function authenticate(token) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
      fail("Invalid credentials or session", 401);
    const entry = db.prepare("SELECT * FROM auth_sessions WHERE token_hash=?").get(digest(token));
    if (!entry || entry.expires_at <= now()) fail("Invalid credentials or session", 401);
    const account = db.prepare("SELECT * FROM auth_accounts WHERE user_id=?").get(entry.user_id);
    return { user: publicUser(account), company: companyName(), deviceId: entry.device_id };
  }
  function revoke(token) {
    if (typeof token === "string")
      db.prepare("DELETE FROM auth_sessions WHERE token_hash=?").run(digest(token));
    return { ok: true };
  }
  function listAccounts() {
    return db
      .prepare("SELECT user_id,username,role FROM auth_accounts ORDER BY username")
      .all()
      .map((account) => ({
        id: account.user_id,
        name: getUser(account.user_id)?.name || "",
        username: account.username,
        role: account.role,
        active: Boolean(getUser(account.user_id)?.active),
      }));
  }
  // Recovery tokens are issued only by an operator with database/console access,
  // never through an unauthenticated HTTP "forgot password" endpoint.
  function issuePasswordReset(username) {
    const account = db
      .prepare("SELECT * FROM auth_accounts WHERE username=?")
      .get(usernameOf(username));
    const user = publicUser(account),
      token = randomBytes(32).toString("base64url"),
      expiresAt = now() + 10 * 60 * 1000;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM auth_resets WHERE user_id=? OR expires_at<=?").run(user.id, now());
      db.prepare("INSERT INTO auth_resets VALUES(?,?,?)").run(digest(token), user.id, expiresAt);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { token, expiresAt, user };
  }
  function resetPassword({ token, password } = {}) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
      fail("Reset link is invalid or expired", 401);
    if (typeof password !== "string" || password.length < 12 || password.length > 200)
      fail("Password must be 12–200 characters");
    db.exec("BEGIN IMMEDIATE");
    try {
      const reset = db.prepare("SELECT * FROM auth_resets WHERE token_hash=?").get(digest(token));
      if (!reset || reset.expires_at <= now()) fail("Reset link is invalid or expired", 401);
      const account = db.prepare("SELECT * FROM auth_accounts WHERE user_id=?").get(reset.user_id);
      publicUser(account);
      const salt = randomBytes(32).toString("hex"),
        hash = scryptSync(password, salt, 64).toString("hex");
      db.prepare("UPDATE auth_accounts SET salt=?,password_hash=? WHERE user_id=?").run(
        salt,
        hash,
        reset.user_id,
      );
      db.prepare("DELETE FROM auth_sessions WHERE user_id=?").run(reset.user_id);
      db.prepare("DELETE FROM auth_resets WHERE user_id=?").run(reset.user_id);
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='call_receiver'").get())
        db.prepare("UPDATE call_receiver SET armed=0 WHERE user_id=?").run(reset.user_id);
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='call_commands'").get())
        db.prepare(
          "UPDATE call_commands SET status='Cancelled' WHERE user_id=? AND status='Pending'",
        ).run(reset.user_id);
      db.exec("COMMIT");
      failures.delete(account.username);
      return { ok: true };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return {
    configured,
    bootstrap,
    createAccount,
    login,
    authenticate,
    revoke,
    listAccounts,
    issuePasswordReset,
    resetPassword,
  };
}
