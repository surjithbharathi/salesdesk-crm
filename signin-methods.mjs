// Extra ways for staff to sign in, besides username and password:
//   - a 6-digit code sent on WhatsApp (through the Devi WhatsApp gateway) to the mobile number an admin saved for that person;
//   - "Sign in with Devi ERP": OAuth 2.0 against the company's ERPNext (Frappe), matched to a CRM user by email.
// Both only ever sign in people who already have a CRM login; neither creates accounts.
// The ERP client secret is stored encrypted, like the WhatsApp gateway settings, and is never sent back to the browser.
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const fail = (message, status = 400) => {
  throw Object.assign(Error(message), { status });
};
const digest = (value) => createHash("sha256").update(value).digest("hex");
const OTP_MS = 5 * 60 * 1000;
const RESEND_MS = 30 * 1000;
const STATE_MS = 10 * 60 * 1000;
const DEFAULTS = { otpEnabled: false, otpTemplate: "", erpEnabled: false, erpBaseUrl: "", erpClientId: "", erpClientSecret: "" };

// Indian numbers may be typed as 98xxxxxxxx, 098..., +91 98..., 91 98...; everything is kept as 91XXXXXXXXXX.
export function mobileKey(value) {
  let d = String(value ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  return /^[1-9]\d{9,14}$/.test(d) ? d : "";
}
export const maskMobile = (key) => (key ? `+${key.slice(0, key.length - 10)} ${key.slice(-10, -8)}xxx xx${key.slice(-3)}` : "");

export function createSigninMethods({ db, getUser, users, userAuth, waGateway, keyPath, checkUrl, publicOrigin = "", fetchImpl = (...a) => globalThis.fetch(...a), now = () => Date.now(), log = () => {} }) {
  db.exec(`CREATE TABLE IF NOT EXISTS signin_settings(id INTEGER PRIMARY KEY CHECK(id=1), body BLOB);
    CREATE TABLE IF NOT EXISTS signin_mobiles(user_id TEXT PRIMARY KEY, mobile TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS signin_otps(mobile TEXT PRIMARY KEY, code_hash TEXT NOT NULL, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, sent_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS signin_erp_states(state_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);`);

  let key;
  function secretKey() {
    if (key) return key;
    mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    try { chmodSync(keyPath, 0o600); } catch { /* not all file systems support it */ }
    key = readFileSync(keyPath);
    if (key.length !== 32) fail("The settings key is unavailable", 503);
    return key;
  }
  function raw() {
    const row = db.prepare("SELECT body FROM signin_settings WHERE id=1").get();
    if (!row) return { ...DEFAULTS };
    const b = Buffer.from(row.body), d = createDecipheriv("aes-256-gcm", secretKey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return { ...DEFAULTS, ...JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8")) };
  }
  function store(s) {
    const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", secretKey(), iv);
    const bytes = Buffer.concat([c.update(JSON.stringify(s)), c.final()]);
    db.prepare("INSERT INTO signin_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(Buffer.concat([iv, c.getAuthTag(), bytes]));
  }
  const hasAccount = (userId) => Boolean(db.prepare("SELECT 1 FROM auth_accounts WHERE user_id=?").get(userId));
  const gatewayReady = () => {
    try {
      const g = waGateway.settings();
      return Boolean(g.enabled && g.baseUrl && g.hasKey);
    } catch {
      return false;
    }
  };
  const erpReady = (s) => Boolean(s.erpEnabled && s.erpBaseUrl && s.erpClientId);
  const redirectUri = () => `${publicOrigin}/api/auth/erp/callback`;

  // what the sign-in screen may offer; nothing secret
  function methods() {
    const s = raw();
    return { otp: Boolean(s.otpEnabled && gatewayReady()), erp: erpReady(s) };
  }

  function settings(users) {
    const s = raw();
    const mobiles = new Map(db.prepare("SELECT user_id, mobile FROM signin_mobiles").all().map((r) => [r.user_id, r.mobile]));
    return {
      otpEnabled: s.otpEnabled,
      otpTemplate: s.otpTemplate,
      gatewayReady: gatewayReady(),
      erpEnabled: s.erpEnabled,
      erpBaseUrl: s.erpBaseUrl,
      erpClientId: s.erpClientId,
      erpHasSecret: Boolean(s.erpClientSecret),
      erpRedirectUri: redirectUri(),
      people: users.filter((u) => u.active && hasAccount(u.id)).map((u) => ({ id: u.id, name: u.name, email: u.email || "", mobile: mobiles.get(u.id) || "" })),
    };
  }

  async function save(input = {}, users) {
    const s = raw();
    if ("otpTemplate" in input) {
      const t = String(input.otpTemplate || "").trim();
      if (t && !/^[a-z0-9_]{1,80}$/.test(t)) fail("Template names use small letters, numbers and _ only");
      s.otpTemplate = t;
    }
    if ("erpBaseUrl" in input) s.erpBaseUrl = input.erpBaseUrl ? await checkUrl(String(input.erpBaseUrl).trim().replace(/\/+$/, "")) : "";
    if ("erpClientId" in input) {
      const id = String(input.erpClientId || "").trim();
      if (id.length > 200 || /\s/.test(id)) fail("That client ID does not look right");
      s.erpClientId = id;
    }
    if (typeof input.erpClientSecret === "string" && input.erpClientSecret.trim()) {
      if (input.erpClientSecret.length > 300 || /\s/.test(input.erpClientSecret.trim())) fail("That client secret does not look right");
      s.erpClientSecret = input.erpClientSecret.trim();
    }
    if (input.mobiles && typeof input.mobiles === "object" && !Array.isArray(input.mobiles)) {
      const seen = new Map();
      for (const [userId, value] of Object.entries(input.mobiles)) {
        if (!getUser(userId)?.active || !hasAccount(userId)) fail("Mobile numbers can only be saved for people who have a login");
        const m = value ? mobileKey(value) : "";
        if (value && !m) fail(`${getUser(userId).name}: that mobile number does not look right`);
        if (m && seen.has(m)) fail("Two people cannot share one mobile number");
        if (m) seen.set(m, userId);
      }
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const [userId, value] of Object.entries(input.mobiles)) {
          db.prepare("DELETE FROM signin_mobiles WHERE user_id=?").run(userId);
          const m = value ? mobileKey(value) : "";
          if (m) {
            const other = db.prepare("SELECT user_id FROM signin_mobiles WHERE mobile=?").get(m);
            if (other && other.user_id !== userId) fail(`${getUser(other.user_id)?.name || "Someone"} already uses that mobile number`);
            db.prepare("INSERT INTO signin_mobiles VALUES(?,?)").run(userId, m);
          }
        }
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
    if ("otpEnabled" in input) {
      if (input.otpEnabled === true && !gatewayReady()) fail("Turn on the WhatsApp gateway first");
      s.otpEnabled = input.otpEnabled === true;
    }
    if ("erpEnabled" in input) {
      if (input.erpEnabled === true && !(s.erpBaseUrl && s.erpClientId && s.erpClientSecret)) fail("Add the ERP address, client ID and client secret first");
      s.erpEnabled = input.erpEnabled === true;
    }
    store(s);
    return settings(users);
  }

  // ---------------------------------------------------------------- WhatsApp code
  let globalSends = [];
  const hourly = new Map();
  // Always answers the same way, so the screen does not reveal which numbers belong to staff.
  async function otpStart({ mobile } = {}) {
    const s = raw();
    if (!s.otpEnabled || !gatewayReady()) fail("Sign-in with a code is not turned on", 409);
    const m = mobileKey(mobile);
    if (!m) fail("Enter a 10-digit mobile number");
    const time = now();
    globalSends = globalSends.filter((t) => t > time - 60 * 60 * 1000);
    const mine = (hourly.get(m) || []).filter((t) => t > time - 60 * 60 * 1000);
    if (mine.length >= 5 || globalSends.length >= 300) fail("Too many codes asked for. Try again in an hour.", 429);
    const prev = db.prepare("SELECT sent_at FROM signin_otps WHERE mobile=?").get(m);
    if (prev && prev.sent_at > time - RESEND_MS) fail("Wait a few seconds before asking for another code", 429);
    mine.push(time);
    hourly.set(m, mine);
    if (hourly.size > 2000) hourly.delete(hourly.keys().next().value);
    globalSends.push(time);
    const owner = db.prepare("SELECT user_id FROM signin_mobiles WHERE mobile=?").get(m);
    const user = owner && getUser(owner.user_id);
    if (user?.active && hasAccount(user.id)) {
      const code = String(randomInt(0, 1000000)).padStart(6, "0");
      db.prepare("INSERT INTO signin_otps VALUES(?,?,?,?,0,?) ON CONFLICT(mobile) DO UPDATE SET code_hash=excluded.code_hash,user_id=excluded.user_id,expires_at=excluded.expires_at,attempts=0,sent_at=excluded.sent_at")
        .run(m, digest(`${m}:${code}`), user.id, time + OTP_MS, time);
      try {
        await waGateway.sendSystem(m, s.otpTemplate ? { template: s.otpTemplate, params: [code] } : { text: `${code} is your Salesdesk sign-in code. It works for 5 minutes. Do not share it with anyone.` });
      } catch (e) {
        db.prepare("DELETE FROM signin_otps WHERE mobile=?").run(m);
        log("signin.otp.send_failed", { user: user.id, error: e.message });
        fail("The code could not be sent on WhatsApp. Try again or use your password.", 502);
      }
    }
    return { ok: true, sentTo: maskMobile(m), resendAfter: RESEND_MS / 1000 };
  }

  function otpVerify({ mobile, code, deviceId } = {}) {
    const m = mobileKey(mobile);
    const c = String(code ?? "").replace(/\D/g, "");
    const wrong = () => fail("That code is not right, or it has expired", 401);
    if (!m || c.length !== 6) wrong();
    const row = db.prepare("SELECT * FROM signin_otps WHERE mobile=?").get(m);
    if (!row || row.expires_at <= now()) wrong();
    if (row.attempts >= 5) {
      db.prepare("DELETE FROM signin_otps WHERE mobile=?").run(m);
      wrong();
    }
    const ok = timingSafeEqual(Buffer.from(row.code_hash, "hex"), Buffer.from(digest(`${m}:${c}`), "hex"));
    if (!ok) {
      db.prepare("UPDATE signin_otps SET attempts=attempts+1 WHERE mobile=?").run(m);
      wrong();
    }
    db.prepare("DELETE FROM signin_otps WHERE mobile=?").run(m);
    return userAuth.sessionForUser(row.user_id, deviceId);
  }

  // ---------------------------------------------------------------- Devi ERP (ERPNext / Frappe OAuth 2.0)
  function erpStart() {
    const s = raw();
    if (!erpReady(s) || !s.erpClientSecret) fail("Sign-in with Devi ERP is not turned on", 409);
    const state = randomBytes(24).toString("base64url");
    db.prepare("DELETE FROM signin_erp_states WHERE expires_at<=?").run(now());
    db.prepare("INSERT INTO signin_erp_states VALUES(?,?)").run(digest(state), now() + STATE_MS);
    const q = new URLSearchParams({ client_id: s.erpClientId, response_type: "code", scope: "openid", redirect_uri: redirectUri(), state });
    return { state, url: `${s.erpBaseUrl}/api/method/frappe.integrations.oauth2.authorize?${q}` };
  }

  async function erpCallback({ code, state, browserState } = {}) {
    const s = raw();
    if (!erpReady(s) || !s.erpClientSecret) fail("Sign-in with Devi ERP is not turned on", 409);
    if (typeof state !== "string" || state.length < 20 || state !== browserState) fail("The sign-in link has expired. Try again.", 401);
    const row = db.prepare("SELECT * FROM signin_erp_states WHERE state_hash=?").get(digest(state));
    db.prepare("DELETE FROM signin_erp_states WHERE state_hash=?").run(digest(state));
    if (!row || row.expires_at <= now()) fail("The sign-in link has expired. Try again.", 401);
    if (typeof code !== "string" || !code || code.length > 500) fail("Devi ERP did not send a sign-in code", 401);
    const base = await checkUrl(s.erpBaseUrl);
    let token;
    try {
      const res = await fetchImpl(`${base}/api/method/frappe.integrations.oauth2.get_token`, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), client_id: s.erpClientId, client_secret: s.erpClientSecret }).toString(),
      });
      token = await res.json().catch(() => ({}));
      if (!res.ok || !token.access_token) fail("Devi ERP refused the sign-in", 401);
    } catch (e) {
      if (e.status) throw e;
      fail("Devi ERP did not answer", 502);
    }
    let profile;
    try {
      const res = await fetchImpl(`${base}/api/method/frappe.integrations.oauth2.openid_profile`, { redirect: "manual", signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" } });
      profile = await res.json().catch(() => ({}));
      if (!res.ok) fail("Devi ERP did not share who you are", 401);
    } catch (e) {
      if (e.status) throw e;
      fail("Devi ERP did not answer", 502);
    }
    const p = profile?.message && typeof profile.message === "object" ? profile.message : profile;
    const email = String(p?.email || "").trim().toLowerCase();
    if (!email || p.email_verified === false) fail("Your Devi ERP account has no confirmed email", 403);
    const matches = users().filter((u) => u.active && String(u.email || "").trim().toLowerCase() === email && hasAccount(u.id));
    if (matches.length !== 1) {
      log("signin.erp.no_match", { email, matches: matches.length });
      fail(matches.length ? "More than one Salesdesk person has this email. Ask your admin." : "No Salesdesk login uses your ERP email. Ask your admin to add it.", 403);
    }
    return userAuth.sessionForUser(matches[0].id);
  }

  return { methods, settings, save, otpStart, otpVerify, erpStart, erpCallback };
}
