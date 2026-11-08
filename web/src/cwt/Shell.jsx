import React, { useMemo, useState } from "react";
import { useCrm } from "../crm.jsx";
import { hashFor, initials } from "../format.js";
import { TIcon } from "./icons.jsx";

// The frame of the TeleCRM style: a slim icon menu on the left that can open to full width, and a top bar with the workspace, follow-ups due and the account.
// The class names are the reference web app's, so its style sheet (cwt/shell.css) applies as written.

const Mark = () => <svg viewBox="0 0 28 28" aria-hidden="true"><rect x="11" y="7" width="9" height="2.6" rx="1" /><rect x="17.4" y="7" width="2.6" height="7" rx="1" /><rect x="13.2" y="11.2" width="2.6" height="4.4" rx="1" /><rect x="8.6" y="14.6" width="2.6" height="6.6" rx="1" /></svg>;
const when = (iso) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function navFor(owner) {
  return [
    { key: "dash", label: "Dashboard", icon: "dashboard", link: owner ? "/business" : "/my-day" },
    ...(owner ? [{ key: "day", label: "My day", icon: "user", link: "/my-day" }] : []),
    { key: "search", label: "Search", icon: "search", link: "/search" },
    { key: "calls", label: "My Calls", icon: "calls", link: "/calls" },
    { key: "todo", label: "Follow Ups", icon: "alarm", link: "/todo" },
    { key: "views", label: "Views", icon: "filter", link: "/leads" },
    { key: "chat", label: "Messages", icon: "message", link: "/messages" },
    ...(owner ? [{ key: "reports", label: "Reports", icon: "chart", children: [{ label: "Leaderboard", icon: "trophy", link: "/reports?tab=leaderboard" }, { label: "Call Report", icon: "bars", link: "/reports?tab=calls" }, { label: "Report Download", icon: "download", link: "/reports?tab=download" }, { label: "Duplicate Leads", icon: "merge", link: "/reports?tab=duplicates" }, { label: "Deleted leads", icon: "trash", link: "/reports?tab=deleted" }, { label: "Team today", icon: "user", link: "/team" }, { label: "Daily goals", icon: "chart", link: "/goals" }] }] : []),
    { key: "settings", label: "Settings", icon: "gear", link: "/settings" },
  ];
}

export default function Shell({ path, owner, session, onLogout, children }) {
  const crm = useCrm();
  const nav = useMemo(() => navFor(owner), [owner]);
  const [expanded, setExpanded] = useState(() => { try { return localStorage.getItem("salesdesk-cwt-side") === "open"; } catch { return false; } });
  const [open, setOpen] = useState({});
  const [pop, setPop] = useState("");
  const [hover, setHover] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState("");
  const [bellSeen, setBellSeen] = useState(false);
  const company = session.company || "Devi Industries";

  const due = useMemo(() => {
    if (!crm.state) return [];
    const end = new Date(); end.setHours(23, 59, 59, 999);
    return crm.openTasks.filter((t) => Date.parse(t.due) <= end.getTime()).sort((a, b) => String(a.due).localeCompare(String(b.due)));
  }, [crm.state, crm.openTasks]);
  const recent = useMemo(() => (crm.state ? crm.activities.filter((a) => a.type === "Call").sort((a, b) => String(b.occurredAt || b.createdAt).localeCompare(String(a.occurredAt || a.createdAt))).slice(0, 5) : []), [crm.state, crm.activities]);

  const active = (n) => (n.link ? path === n.link || (n.link === "/leads" && path.startsWith("/leads")) : n.children?.some((c) => path.startsWith(c.link.split("?")[0])));
  const toggle = () => { setExpanded(!expanded); setPop(""); try { localStorage.setItem("salesdesk-cwt-side", !expanded ? "open" : "closed"); } catch { /* the choice then lasts for this visit only */ } };
  const go = (to) => { setPop(""); setMenuOpen(false); setPanel(""); location.hash = to.startsWith("/") ? "#" + to : hashFor(to); };
  const group = (n) => (expanded && !menuOpen ? setOpen({ ...open, [n.key]: !open[n.key] }) : setPop(pop === n.key ? "" : n.key));
  const openPanel = (name) => { setPanel(panel === name ? "" : name); if (name === "bell") setBellSeen(true); };
  const popItem = nav.find((n) => n.key === pop);

  return (
    <div className="cwt cwt-root">
      <div className={`shell ${expanded ? "expanded" : ""} ${menuOpen ? "menu-open" : ""}`} data-route={path}>
        <aside className="sidebar" aria-label="Main navigation">
          <a className="home" href={hashFor(owner ? "/business" : "/my-day")} aria-label="Home" onClick={() => setMenuOpen(false)}>
            <span className="tile"><Mark /></span>
            {expanded && <span className="word-logo">Salesdesk</span>}
          </a>
          <nav>
            {nav.map((n) => (
              <div key={n.key} className="navw">
                <button type="button" className={`nav-item ${active(n) ? "active" : ""} ${pop === n.key ? "pop-on" : ""}`}
                  onClick={() => (n.children ? group(n) : go(n.link))} onMouseEnter={() => !expanded && setHover(n.key)} onMouseLeave={() => setHover("")}
                  aria-expanded={n.children ? Boolean(open[n.key]) || pop === n.key : undefined}>
                  <TIcon name={n.icon} className="ni" />
                  <span className="lbl">{n.label}</span>
                  {n.children && <TIcon name="chevronDown" className={`chev ${open[n.key] ? "up" : ""}`} />}
                </button>
                {hover === n.key && <div className="tip">{n.label}</div>}
                {n.children && open[n.key] && expanded && <div className="sub">{n.children.map((c) => <button key={c.label} type="button" onClick={() => go(c.link)}>{c.label}</button>)}</div>}
                {popItem?.key === n.key && (
                  <>
                    <div className="pop-catcher" onClick={() => setPop("")} />
                    <div className="nav-pop" role="dialog" aria-label={n.label}>
                      <div className="np-head"><span>{n.label}</span></div>
                      <div className="np-list">{n.children.map((c) => <button key={c.label} type="button" role="menuitem" onClick={() => go(c.link)}><TIcon name={c.icon} /><span>{c.label}</span></button>)}</div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </nav>
          <div className="side-foot">
            <button type="button" className="support" onClick={() => go("/settings")} aria-label="Settings"><TIcon name="headset" className="ni" /><span className="lbl">Support</span><span className="ver">v1.0</span></button>
            <button type="button" className="toggle" onClick={toggle} aria-label={expanded ? "Collapse" : "Expand"}><TIcon name="collapse" className={`ni ${expanded ? "" : "flip"}`} /><span className="lbl">Collapse</span></button>
          </div>
        </aside>
        <div className="scrim" onClick={() => setMenuOpen(false)} />

        <div className="main">
          <header className="topbar">
            <button type="button" className="hamburger" onClick={() => setMenuOpen(true)} aria-label="Open menu"><TIcon name="menu" /></button>
            <div className="ws">
              <button type="button" className="ws-name" onClick={() => setPanel(panel === "ws" ? "" : "ws")}>
                <span className="ws-av"><Mark /></span><span className="ws-label" lang="en">{company}</span><TIcon name="chevronDown" className="caret" />
              </button>
              <span className="ws-div" />
              <a className="ws-gear" href={hashFor("/settings")} aria-label="Workspace settings"><TIcon name="gear" /></a>
              {panel === "ws" && (
                <div className="pop ws-pop" onMouseLeave={() => setPanel("")}>
                  <div className="pop-title">Workspaces</div>
                  <button type="button" className="pop-row on" onClick={() => setPanel("")}><span className="ws-av sm"><Mark /></span>{company} <span className="tick">✓</span></button>
                </div>
              )}
            </div>
            <div className="top-right">
              <div className="anchor">
                <button type="button" className="round alarm" onClick={() => openPanel("alarm")} aria-label="Follow-ups due"><TIcon name="alarm" />{due.length > 0 && <em className="count">{due.length > 99 ? "99+" : due.length}</em>}</button>
                {panel === "alarm" && (
                  <div className="pop list-pop" onMouseLeave={() => setPanel("")}>
                    <div className="pop-title">Follow ups due ({due.length})</div>
                    {due.slice(0, 6).map((t) => (
                      <button key={t.id} type="button" className="pop-row" onClick={() => { setPanel(""); location.hash = hashFor("/leads", { lead: t.leadId }); }}>
                        <span className="grow"><b>{crm.leadById.get(t.leadId)?.name || t.title}</b><small>{when(t.due)} · {crm.users.get(t.owner)?.name || "No owner"}</small></span>
                      </button>
                    ))}
                    {!due.length && <p className="pop-empty">Nothing due today.</p>}
                    <a className="pop-more" href={hashFor("/todo")} onClick={() => setPanel("")}>See all follow ups</a>
                  </div>
                )}
              </div>
              <div className="anchor">
                <button type="button" className="round bell" onClick={() => openPanel("bell")} aria-label="Notifications"><TIcon name="bell" />{!bellSeen && recent.length > 0 && <i className="dot" />}</button>
                {panel === "bell" && (
                  <div className="pop list-pop" onMouseLeave={() => setPanel("")}>
                    <div className="pop-title">Recent activity</div>
                    {recent.map((a) => (
                      <button key={a.id} type="button" className="pop-row" onClick={() => { setPanel(""); location.hash = hashFor("/leads", { lead: a.leadId }); }}>
                        <span className="grow"><b>{crm.users.get(a.userId)?.name || "Phone"} · {a.outcome || a.direction || "Call"}</b><small>{crm.leadById.get(a.leadId)?.name} · {when(a.occurredAt || a.createdAt)}</small></span>
                      </button>
                    ))}
                    {!recent.length && <p className="pop-empty">No calls yet.</p>}
                  </div>
                )}
              </div>
              <div className="anchor">
                <button type="button" className="user-btn" onClick={() => setPanel(panel === "user" ? "" : "user")} aria-label="Account menu"><span className="avatar">{initials(session.user?.name || "Demo")}</span></button>
                {panel === "user" && (
                  <div className="pop user-pop" onMouseLeave={() => setPanel("")}>
                    <div className="who"><b>{session.user?.name || "Demo access"}</b><span>{company}</span></div>
                    <a className="pop-row" href={hashFor("/settings")} onClick={() => setPanel("")}>Settings</a>
                    {session.user && <button type="button" className="pop-row" onClick={onLogout}>Log out</button>}
                  </div>
                )}
              </div>
            </div>
          </header>
          <main className="content">{children}</main>
        </div>
      </div>
    </div>
  );
}
