import React, { useEffect, useState } from "react";
import { authStatus, logout, AuthError, v2 } from "./api.js";
import { parseHash, hashFor, initials } from "./format.js";
import { useHash } from "./hooks.js";
import Icon from "./icons.jsx";
import { applySkin, readSkin, useSkin } from "./skin.js";
import TeleDashboard from "./pages/TeleDashboard.jsx";
import CwShell from "./cw/Shell.jsx";
import CwDashboard from "./cw/Dashboard.jsx";
import CwtShell from "./cwt/Shell.jsx";
import Login from "./cwt/Login.jsx";
import CwtDashboard from "./cwt/Dashboard.jsx";
import CwtViews from "./cwt/Views.jsx";
import { CwtCalls, CwtSearch, CwtFollowups, CwtReports } from "./cwt/Pages.jsx";
import CwLeads from "./cw/LeadsGrid.jsx";
import { CwDeals, CwTodos, CwEngagements, CwConversations } from "./cw/Views.jsx";
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
  useEffect(() => {
    const on = () => setTheme(readTheme());
    window.addEventListener("salesdesk-theme", on);
    return () => window.removeEventListener("salesdesk-theme", on);
  }, []);
  const dark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  return [dark, () => setTheme(dark ? "light" : "dark")];
}

export default function App() {
  const hash = useHash();
  const [session, setSession] = useState({ state: "loading" });
  const [meta, setMeta] = useState(null);
  const [dark, toggleTheme] = useTheme();
  const skin = useSkin();
  // In the TeleCRM look the left menu opens with names and can be folded to icons; the choice is kept in this browser.
  const [railOpen, setRailOpen] = useState(() => {
    try {
      return localStorage.getItem("salesdesk-rail") !== "collapsed";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-rail", railOpen ? "open" : "collapsed");
    try {
      railOpen ? localStorage.removeItem("salesdesk-rail") : localStorage.setItem("salesdesk-rail", "collapsed");
    } catch {
      /* the choice then lasts for this visit only */
    }
  }, [railOpen]);
  useEffect(() => applySkin(readSkin()), []);

  async function boot() {
    try {
      const status = await authStatus();
      if (status.configured && !status.user) return setSession({ state: "login", methods: status.methods || {} });
      const loaded = await v2("/me");
      setMeta(loaded);
      setSession({ state: "ready", user: status.user, company: status.company });
    } catch (e) {
      if (e instanceof AuthError) setSession({ state: "login", methods: {} });
      else setSession({ state: "error", message: e.message });
    }
  }
  useEffect(() => {
    boot();
  }, []);

  if (session.state === "loading") return <main className="screen"><p className="muted">Loading…</p></main>;
  if (session.state === "login") return <Login methods={session.methods} onDone={() => { if (location.hash.startsWith("#/login")) location.hash = ""; boot(); }} />;
  if (session.state === "error") return <main className="screen"><p className="error">{session.message}</p></main>;

  const { path, params } = parseHash();
  const owner = meta.lead; // owners, admins and managers see the whole team; callers see only their own day
  const baseNav = owner ? NAV_LEAD : NAV_CALLER;
  // that look has a search page of its own, right after Leads
  const max = skin === "salesmax";
  const NAV = skin === "telecrm" ? baseNav.flatMap((item) => (item[0] === "/leads" ? [item, ["/search", "Search", "search"]] : [item])) : baseNav;
  const isHere = (to) => path.startsWith(to);
  const callers = meta.users;
  const viewing = owner ? (params.user || meta.id || callers[0]?.id) : meta.id;
  const page =
    path.startsWith("/leads") ? (skin === "telecrm" ? <CwtViews key="cwtviews" params={params} /> : skin === "salesmax" ? <CwLeads key="cwleads" params={params} /> : <Leads key="leads" params={params} />) :
    path.startsWith("/search") && skin === "telecrm" ? <CwtSearch key="cwtsearch" params={params} /> :
    path.startsWith("/reports") && skin === "telecrm" ? <CwtReports key={`cwtrep${params.tab || ""}`} params={params} /> :
    path.startsWith("/calls") ? (skin === "telecrm" ? <CwtCalls key="cwtcalls" /> : <Calls key="calls" />) :
    path.startsWith("/deals") && max ? <CwDeals key={`deals${params.tab || ""}`} params={params} /> :
    path.startsWith("/engagements") && max ? <CwEngagements key={`eng${params.tab || ""}`} params={params} /> :
    path.startsWith("/todo") ? (skin === "telecrm" ? <CwtFollowups key="cwtfollow" /> : max ? <CwTodos key={`mtodo${params.tab || ""}`} params={params} /> : <Tasks key="todo" />) :
    path.startsWith("/messages") ? (max ? <CwConversations key={`mchat${params.tab || ""}`} params={params} /> : <Messages key="messages" />) :
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
    skin === "telecrm" ? <CwtDashboard key="cwtdash" meta={meta} /> : skin === "salesmax" ? <CwDashboard key={`cwdash${params.tab || ""}`} tab={params.tab || "default"} /> : <Business key="business" />;

  if (max) {
    return (
      <CwShell path={path} params={params} owner={owner} session={session} onLogout={async () => { await logout(); location.reload(); }}>
        <CrmProvider me={meta}>{page}</CrmProvider>
      </CwShell>
    );
  }
  if (skin === "telecrm") {
    return (
      <CrmProvider me={meta}>
        <CwtShell path={path} owner={owner} session={session} onLogout={async () => { await logout(); location.reload(); }}>{page}</CwtShell>
      </CrmProvider>
    );
  }
  return (
    <div className="shell" data-route={hash}>
      <aside className="rail">
        <a className="brand" href={hashFor(owner ? "/business" : "/my-day")} aria-label="Salesdesk, go home">
          <span className="brand-mark"><Icon name="drop" size={20} /></span>
          <span className="brand-text">
            <span className="brand-name">Salesdesk</span>
            <span className="brand-co" lang="en">{session.company || "Devi Industries"}</span>
          </span>
        </a>
        <nav className="rail-nav" aria-label="Main">
          {NAV.map(([to, label, icon]) => (
            <a key={to} className="rail-link" href={hashFor(to)} title={skin === "telecrm" && label === "Business" ? "Dashboard" : label} aria-current={isHere(to) ? "page" : undefined}>
              <Icon name={icon} /><span className="label">{skin === "telecrm" && label === "Business" ? "Dashboard" : label}</span>
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
          {skin === "telecrm" && (
            <button onClick={() => setRailOpen((v) => !v)} aria-expanded={railOpen}><Icon name="swap" /><span className="label">{railOpen ? "Collapse" : "Expand"}</span></button>
          )}
          {session.user && (
            <button onClick={async () => { await logout(); location.reload(); }}>
              <Icon name="close" /><span className="label">Sign out</span>
            </button>
          )}
        </div>
      </aside>
      <div className="main-col">
        <header className="topbar">
          <span className="topbar-co" lang="en">{session.company || "Devi Industries"}</span>
          <span className="topbar-user" title={session.user?.name || ""}><span className="avatar">{initials(session.user?.name || "Demo")}</span></span>
        </header>
        <main className="work"><CrmProvider me={meta}>{page}</CrmProvider></main>
      </div>
    </div>
  );
}
