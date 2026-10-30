import React, { useEffect, useState } from "react";
import { authStatus, login, logout, AuthError, v2 } from "./api.js";
import { parseHash, hashFor, initials } from "./format.js";
import { useHash } from "./hooks.js";
import Icon from "./icons.jsx";
import Business from "./pages/Business.jsx";
import Leads from "./pages/Leads.jsx";
import Calls from "./pages/Calls.jsx";
import Tasks from "./pages/Tasks.jsx";
import Settings from "./pages/Settings.jsx";
import Messages from "./pages/Messages.jsx";
import { CrmProvider } from "./crm.jsx";
import MyDay from "./pages/MyDay.jsx";
import Team from "./pages/Team.jsx";
import Goals from "./pages/Goals.jsx";

const NAV_LEAD = [
  ["/business", "Business", "dashboard"],
  ["/my-day", "My day", "spark"],
  ["/leads", "Leads", "leads"],
  ["/calls", "Calls", "phone"],
  ["/todo", "To-do", "task"],
  ["/messages", "Messages", "chat"],
  ["/team", "Team", "people"],
  ["/goals", "Daily goals", "check"],
  ["/settings", "Settings", "gear"],
];
const NAV_CALLER = [
  ["/my-day", "My day", "spark"],
  ["/leads", "Leads", "leads"],
  ["/calls", "Calls", "phone"],
  ["/todo", "To-do", "task"],
  ["/messages", "Messages", "chat"],
  ["/settings", "Settings", "gear"],
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

export default function App() {
  const hash = useHash();
  const [session, setSession] = useState({ state: "loading" });
  const [meta, setMeta] = useState(null);
  const [dark, toggleTheme] = useTheme();

  async function boot() {
    try {
      const status = await authStatus();
      if (status.configured && !status.user) return setSession({ state: "login" });
      const loaded = await v2("/me");
      setMeta(loaded);
      setSession({ state: "ready", user: status.user, company: status.company });
    } catch (e) {
      if (e instanceof AuthError) setSession({ state: "login" });
      else setSession({ state: "error", message: e.message });
    }
  }
  useEffect(() => {
    boot();
  }, []);

  if (session.state === "loading") return <main className="screen"><p className="muted">Loading…</p></main>;
  if (session.state === "login") return <LoginForm onDone={boot} />;
  if (session.state === "error") return <main className="screen"><p className="error">{session.message}</p></main>;

  const { path, params } = parseHash();
  const owner = meta.lead; // owners, admins and managers see the whole team; callers see only their own day
  const NAV = owner ? NAV_LEAD : NAV_CALLER;
  const callers = meta.users;
  const viewing = owner ? (params.user || meta.id || callers[0]?.id) : meta.id;
  const page =
    path.startsWith("/leads") ? <Leads key="leads" params={params} /> :
    path.startsWith("/calls") ? <Calls key="calls" /> :
    path.startsWith("/todo") ? <Tasks key="todo" /> :
    path.startsWith("/messages") ? <Messages key="messages" /> :
    path.startsWith("/settings") ? <Settings key="settings" params={params} me={meta} /> :
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
    <Business key="business" />;

  return (
    <div className="shell" data-route={hash}>
      <aside className="rail">
        <a className="brand" href={hashFor(owner ? "/business" : "/my-day")} aria-label="Salesdesk, go home">
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
          {session.user && (
            <button onClick={async () => { await logout(); location.reload(); }}>
              <Icon name="close" /><span className="label">Sign out</span>
            </button>
          )}
        </div>
      </aside>
      <main className="work"><CrmProvider me={meta}>{page}</CrmProvider></main>
    </div>
  );
}
