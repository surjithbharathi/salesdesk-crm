import React, { useState } from "react";
import { hashFor, initials } from "../format.js";
import Icon from "../icons.jsx";

// The frame of the Salesmax style: a white menu on top, a purple bar of views under it, and the page below.
// The class names are the reference web app's, so its style sheet (cw/shell.css) applies as written.

const DASH_VIEWS = [["", "Default"], ["activity", "Activity Metrics"], ["sources", "Source Reports"], ["users", "User Leads"], ["attendance", "Attendance"]];
const MORE = [["/team", "Team"], ["/goals", "Daily goals"]];
const TABS = [
  ["/todo", [["", "To-do kanban"], ["table", "To-do table"]]],
  ["/deals", [["", "Deals"], ["table", "Deals table"]]],
  ["/engagements", [["", "Activities"], ["calls", "Calls"]]],
  ["/messages", [["", "Inbox"], ["stats", "Numbers"]]],
];
const LEAD_VIEWS = [["", "Active Leads"], ["new", "New Leads"], ["untouched", "Not Worked"], ["unassigned", "No Owner"], ["all", "All Leads"]];

export function menuFor(owner) {
  const first = owner ? ["/business", "Dashboards", "dashboard"] : ["/my-day", "Dashboards", "dashboard"];
  return [first, ["/leads", "Leads", "people"], ["/deals", "Opportunities", "rupee"], ["/todo", "To-dos", "task"], ["/engagements", "Engagements", "trend"], ["/messages", "Conversations", "chat"], ["/settings", "Settings", "gear"]];
}

export default function Shell({ path, params, owner, session, onLogout, children }) {
  const [account, setAccount] = useState(false);
  const inDash = ["/business", "/my-day", "/team", "/goals"].some((p) => path.startsWith(p));
  const here = (to) => (to === "/business" || to === "/my-day" ? inDash : path.startsWith(to));
  let views = null;
  if (inDash) {
    const own = owner ? DASH_VIEWS.map(([k, label]) => [hashFor("/business", { tab: k }), label, path.startsWith("/business") && (params.tab || "") === k]) : [];
    const more = (owner ? MORE : [["/my-day", "My day"]]).map(([to, label]) => [hashFor(to), label, path.startsWith(to)]);
    views = [...own, ...more];
  } else if (path.startsWith("/leads")) {
    views = LEAD_VIEWS.filter(([k]) => owner || k !== "unassigned").map(([k, label]) => [hashFor("/leads", { queue: k }), label, (params.queue || "") === k]);
  } else {
    const t = TABS.find(([to]) => path.startsWith(to));
    if (t) views = t[1].map(([k, label]) => [hashFor(t[0], { tab: k }), label, (params.tab || "") === k]);
  }
  return (
    <div className="cw-ws ws" data-route={path}>
      <header className="top">
        <nav className="top__tabs" aria-label="Workspace">
          {menuFor(owner).map(([to, label, icon]) => (
            <a key={to} className={`top__tab ${here(to) ? "on" : ""}`} href={hashFor(to)} aria-current={here(to) ? "page" : undefined}>
              <Icon name={icon} size={20} /><span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="top__right">
          <a className="customize" href={hashFor("/settings")}>Customize <Icon name="external" size={15} /></a>
          <a className="top__icon" href={hashFor("/leads")} aria-label="Search leads"><Icon name="search" size={20} /></a>
          <a className="top__icon top__icon--wide" href={hashFor("/messages")} aria-label="Conversations"><Icon name="chat" size={20} /></a>
          <div className="top__account">
            <button type="button" className="top__org" aria-expanded={account} onClick={() => setAccount(!account)}>
              <span className="top__org-ic"><Icon name="people" size={15} /><i /></span>
              <span className="top__org-name" lang="en">{session.company || "Devi Industries"}</span><Icon name="swap" size={14} />
            </button>
            {account && (
              <div className="menu menu--right" role="menu">
                <div className="menu__who"><b>{session.user?.name || "Demo access"}</b><small>{session.user ? "Signed in" : "No sign-in"}</small></div>
                <a role="menuitem" href={hashFor("/settings")} onClick={() => setAccount(false)}><Icon name="gear" size={16} /> Settings</a>
                {session.user && <button type="button" role="menuitem" onClick={onLogout}><Icon name="close" size={16} /> Sign out</button>}
              </div>
            )}
          </div>
          <a className="top__icon top__icon--wide" href={hashFor("/settings")} aria-label="Settings"><Icon name="gear" size={20} /></a>
          {session.user && <span className="top__me" title={session.user.name}>{initials(session.user.name)}</span>}
        </div>
      </header>
      <div className="sub">
        <nav className="sub__tabs" aria-label="Views">
          {views?.map(([href, label, on]) => <a key={href} className={`sub__tab ${on ? "on" : ""}`} href={href} aria-current={on ? "page" : undefined}>{label}</a>)}
        </nav>
      </div>
      <main className="ws__content">{children}</main>
    </div>
  );
}
