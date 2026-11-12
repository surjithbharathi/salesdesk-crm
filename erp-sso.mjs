// Single sign-on from ERPNext (Frappe OAuth 2 provider) into Salesdesk.
// Flow: /api/auth/erp/start -> ERPNext authorize -> /api/auth/erp/callback
// -> exchange code (confidential client) -> openid_profile email -> Salesdesk session.
import { randomBytes } from "node:crypto";

const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const STATE_MS = 10 * 60 * 1000;

export function erpSsoConfig(env = process.env, publicOrigin = "") {
  const erpOrigin = (env.ERP_OAUTH_ORIGIN || "").replace(/\/+$/, "");
  const clientId = env.ERP_OAUTH_CLIENT_ID || "";
  const clientSecret = env.ERP_OAUTH_CLIENT_SECRET || "";
  if (!erpOrigin || !clientId || !clientSecret) return null;
  if (!/^https?:\/\//.test(erpOrigin) || new URL(erpOrigin).origin !== erpOrigin)
    throw Error("ERP_OAUTH_ORIGIN must be an origin such as https://deviindustries.com");
  const redirectUri =
    env.ERP_OAUTH_REDIRECT_URI || (publicOrigin ? `${publicOrigin}/api/auth/erp/callback` : "");
  if (!redirectUri) throw Error("ERP_OAUTH_REDIRECT_URI or PUBLIC_ORIGIN is required for ERP login");
  // Optional explicit mapping "erp@email=salesdesk-username,other@x=user2".
  const userMap = new Map(
    (env.ERP_OAUTH_USER_MAP || "")
      .split(",")
      .map((pair) => pair.split("=").map((s) => s.trim().toLowerCase()))
      .filter(([email, username]) => email && username),
  );
  return { erpOrigin, clientId, clientSecret, redirectUri, userMap };
}

export function createErpSso({ config, fetchImpl = fetch, now = () => Date.now() }) {
  const pending = new Map();
  function start() {
    const time = now();
    for (const [key, expires] of pending) if (expires <= time) pending.delete(key);
    if (pending.size > 1000) pending.delete(pending.keys().next().value);
    const state = randomBytes(32).toString("base64url");
    pending.set(state, time + STATE_MS);
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      scope: "openid",
      redirect_uri: config.redirectUri,
      state,
    });
    return {
      state,
      location: `${config.erpOrigin}/api/method/frappe.integrations.oauth2.authorize?${params}`,
    };
  }
  async function callback({ code, state, cookieState, error }) {
    if (error) fail(`ERP login was not approved (${String(error).slice(0, 80)})`, 401);
    if (typeof state !== "string" || !state || state !== cookieState)
      fail("ERP login session expired. Please click CRM again.", 401);
    const expires = pending.get(state);
    pending.delete(state);
    if (!expires || expires <= now()) fail("ERP login session expired. Please click CRM again.", 401);
    if (typeof code !== "string" || !code || code.length > 512) fail("Missing ERP authorization code", 401);
    const tokenResponse = await fetchImpl(
      `${config.erpOrigin}/api/method/frappe.integrations.oauth2.get_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: config.redirectUri,
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    const token = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || typeof token.access_token !== "string")
      fail("ERP did not accept the login. Ask the administrator to check the OAuth client.", 502);
    const profileResponse = await fetchImpl(
      `${config.erpOrigin}/api/method/frappe.integrations.oauth2.openid_profile`,
      {
        headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      },
    );
    const raw = await profileResponse.json().catch(() => ({}));
    const profile = raw?.message && typeof raw.message === "object" ? raw.message : raw;
    const email = typeof profile?.email === "string" ? profile.email.trim().toLowerCase() : "";
    if (!profileResponse.ok || !email) fail("ERP did not share your email address", 502);
    return { email, username: config.userMap.get(email) || email, name: profile.name || "" };
  }
  return { start, callback };
}
