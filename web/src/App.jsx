import React, { useEffect, useState } from "react";
import { authStatus, login, logout, AuthError, NotEnabledError, v2 } from "./api.js";
import { parseHash, hashFor, initials } from "./format.js";
import { useHash } from "./hooks.js";
import Icon from "./icons.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Leads from "./pages/Leads.jsx";
import SourceReport from "./pages/SourceReport.jsx";
import MyDay from "./pages/MyDay.jsx";
import Team from "./pages/Team.jsx";
import Goals from "./pages/Goals.jsx";

const NAV_OWNER = [
  ["/dashboard", "Business", "dashboard"],
  ["/my-day", "My day", "spark"],
  ["/team", "Team", "people"],
  ["/goals", "Daily goals", "check"],
  ["/leads", "Leads", "leads"],
  ["/reports/sources", "Where leads come from", "report"],
];
const NAV_CALLER = [
  ["/my-day", "My day", "spark"],
  ["/leads", "Leads", "leads"],
  ["/reports/sources", "Where leads come from", "report"],
];

function readTheme() {
  try {
    return localStorage.getItem("salesdesk-theme") || "";
  } catch {
    return "";
  }
}

function useTheme() {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    if (theme) document.documentElement.setAttribute("data-theme", theme);
    else document.documentElement.removeAttribute("data-theme");
    try {
      theme ? localStorage.setItem("salesdesk-theme", theme) : localStorage.removeItem("salesdesk-theme");
    } catch {
      /* storage can be blocked; the choice then lasts for this visit only */
    }
  }, [theme]);
  const dark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  return [dark, () => setTheme(dark ? "light" : "dark")];
}

function LoginForm({ onDone }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await login(form.get("username"), form.get("password"));
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="screen">
      <form className="sheet" onSubmit={submit}>
        <h1>Salesdesk</h1>
        <p className="muted">Sign in with your CRM account.</p>
        <label>Username<input className="field-input" name="username" autoComplete="username" required /></label>
        <label>Password<input className="field-input" name="password" type="password" autoComplete="current-password" required /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}

function NotEnabled() {
  return (
    <main className="screen">
      <div className="sheet">
        <h1>The new data layer is off</h1>
        <p>This server is running without the new tables. To preview the app:</p>
        <ol>
          <li>Run <code>node scripts/migrate.mjs &lt;database&gt;</code></li>
          <li>Run <code>node scripts/import-legacy.mjs &lt;database&gt; --apply</code></li>
          <li>Start the server with <code>ENABLE_V2=true</code></li>
        </ol>
        <p className="muted">Or run <code>npm run demo:v2</code> to try it with sample leads.</p>
      </div>
    </main>
  );
}

export default function App() {
  const hash = useHash();
  const [session, setSession] = useState({ state: "loading" });
  const [meta, setMeta] = useState(null);
  const [dark, toggleTheme] = useTheme();

  async function boot() {
    try {
      const status = await authStatus();
      if (status.configured && !status.user) return setSession({ state: "login" });
      const loaded = await v2("/meta");
      setMeta(loaded);
      setSession({ state: "ready", user: status.user, company: status.company });
    } catch (e) {
      if (e instanceof AuthError) setSession({ state: "login" });
      else if (e instanceof NotEnabledError) setSession({ state: "off" });
      else setSession({ state: "error", message: e.message });
    }
  }
  useEffect(() => {
    boot();
  }, []);

  if (session.state === "loading") return <main className="screen"><p className="muted">Loading…</p></main>;
  if (session.state === "login") return <LoginForm onDone={boot} />;
  if (session.state === "off") return <NotEnabled />;
  if (session.state === "error") return <main className="screen"><p className="error">{session.message}</p></main>;

  const { path, params } = parseHash();
  const owner = !session.user || session.user.role === "admin";
  const NAV = owner ? NAV_OWNER : NAV_CALLER;
  const callers = meta.users.filter((u) => u.active);
  const viewing = owner ? (params.user || callers[0]?.id) : session.user.id;
  const page =
    path.startsWith("/leads") ? <Leads key="leads" meta={meta} params={params} /> :
    path.startsWith("/reports/sources") ? <SourceReport key="report" /> :
    path.startsWith("/team") && owner ? <Team key="team" /> :
    path.startsWith("/goals") && owner ? <Goals key="goals" meta={meta} /> :
    path.startsWith("/my-day") || !owner ? (
      <>
        {owner && (
          <label className="viewing">Viewing the day of
            <select className="field-input" value={viewing} onChange={(e) => (location.hash = hashFor("/my-day", { user: e.target.value }))}>
              {callers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
        )}
        <MyDay key={viewing} userId={viewing} meta={meta} />
      </>
    ) :
    <Dashboard key="dashboard" />;

  return (
    <div className="shell" data-route={hash}>
      <aside className="rail">
        <a className="brand" href={hashFor(owner ? "/dashboard" : "/my-day")} aria-label="Salesdesk, go home">
          <span className="brand-mark"><Icon name="drop" size={20} /></span>
          <span>
            <span className="brand-name">Salesdesk</span>
            <span className="brand-co" lang="en">{session.company || "Devi Industries"}</span>
          </span>
        </a>
        <nav className="rail-nav" aria-label="Main">
          {NAV.map(([to, label, icon]) => (
            <a key={to} className="rail-link" href={hashFor(to)} aria-current={path.startsWith(to) ? "page" : undefined}>
              <Icon name={icon} />{label}
            </a>
          ))}
        </nav>
        <div className="rail-foot">
          {session.user ? (
            <div className="who">
              <span className="avatar">{initials(session.user.name)}</span>
              <span className="label">{session.user.name}</span>
            </div>
          ) : <span className="who label">Demo access, no sign-in</span>}
          <button onClick={toggleTheme} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
            <Icon name={dark ? "sun" : "moon"} /><span className="label">{dark ? "Light theme" : "Dark theme"}</span>
          </button>
          <a href="/"><Icon name="external" /><span className="label">Classic screens</span></a>
          {session.user && (
            <button onClick={async () => { await logout(); location.reload(); }}>
              <Icon name="close" /><span className="label">Sign out</span>
            </button>
          )}
        </div>
      </aside>
      <main className="work">{page}</main>
    </div>
  );
}
