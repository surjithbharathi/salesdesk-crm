export class AuthError extends Error {}
export class NotEnabledError extends Error {}

async function request(path, { method = "GET", params, body } = {}) {
  const url = new URL(path, location.origin);
  for (const [key, value] of Object.entries(params || {}))
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error page */
  }
  if (response.status === 401) throw new AuthError(data.error || "Sign in required");
  if (response.status === 404 && path.startsWith("/api/v2/meta")) throw new NotEnabledError();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

export const v2 = (path, params) => request("/api/v2" + path, { params });
export const authStatus = () => request("/api/auth/status");
export const login = (username, password) => request("/api/auth/login", { method: "POST", body: { username, password } });
export const logout = () => request("/api/auth/logout", { method: "POST", body: {} });

// "Today" follows the browser's local day, so work queues match what the team sees on their clock.
export function localDay() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setMilliseconds(-1);
  return { dayStart: start.toISOString(), dayEnd: end.toISOString() };
}

// Changes go through the same rules as everywhere else in the CRM; the server answers with the updated lead.
export const v2Send = (method, path, body = {}) => request("/api/v2" + path, { method, body });

export function localMonths() {
  const first = new Date();
  first.setDate(1);
  first.setHours(0, 0, 0, 0);
  const prev = new Date(first);
  prev.setMonth(prev.getMonth() - 1);
  const next = new Date(first);
  next.setMonth(next.getMonth() + 1);
  return { monthStart: first.toISOString(), prevStart: prev.toISOString(), nextStart: next.toISOString() };
}
