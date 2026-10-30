import React from "react";
import { crmGet, logout } from "../api.js";
import { useLoad } from "../hooks.js";
import { hashFor } from "../format.js";
import Users, { ROLES } from "./settings/Users.jsx";
import Email from "./settings/Email.jsx";
import WhatsApp from "./settings/WhatsApp.jsx";
import CallAI from "./settings/CallAI.jsx";
import Mcp from "./settings/Mcp.jsx";
import { Import, Export, Archived, Merge } from "./settings/LeadData.jsx";

export default function Settings({ params, me }) {
  const { data: access, error } = useLoad(() => crmGet("workspace/access"), []);
  if (error) return <p className="error">{error.message}</p>;
  if (!access) return <p className="muted">Loading settings…</p>;
  const can = (p) => Boolean(access.permissions?.[p]);
  // The server also requires the Administrator role for call AI and AI connections.
  const admin = can("integrations.manage") && (access.crmOwner || ["owner", "admin"].includes(access.role));
  const full ={ ...access, users: me.users };
  const sections = [
    ["users", "People and access", can("users.manage"), <Users access={full} />],
    ["email", "Email", can("integrations.manage"), <Email />],
    ["whatsapp", "WhatsApp", can("integrations.manage"), <WhatsApp />],
    ["callai", "Call AI", admin, <CallAI />],
    ["mcp", "AI connections", admin, <Mcp />],
    ["import", "Add leads from a file", can("leads.write") && can("data.export"), <Import access={full} />],
    ["merge", "Merge duplicates", can("leads.write") && me.lead, <Merge />],
    ["archived", "Archived leads", can("leads.write"), <Archived />],
    ["export", "Download data", can("data.export"), <Export />],
    ["account", "Your account", true, null],
  ].filter(([, , allowed]) => allowed);
  const tab = sections.find(([key]) => key === params.tab) || sections[0];
  const roleLabel = access.crmOwner ? "Ultra Admin" : ROLES.find(([r]) => r === access.role)?.[1] || "Member";
  return (
    <>
      <div className="work-head"><h1 className="work-title">Settings</h1><span className="work-date">{access.name}</span></div>
      <div className="tabs settings-tabs" role="tablist" aria-label="Settings sections">
        {sections.map(([key, label]) => (
          <a key={key} className="tab" role="tab" aria-selected={tab[0] === key} href={hashFor("/settings", { tab: key })}>{label}</a>
        ))}
      </div>
      <div className="settings-body" role="tabpanel">
        {tab[0] === "account" ? (
          <>
            <p><b>{me.users.find((u) => u.id === me.id)?.name || "You"}</b><br /><span className="muted">{roleLabel}</span></p>
            <span className="newlead-actions">
              <button className="btn" onClick={async () => { await logout(); location.reload(); }}>Sign out</button>
              <a className="btn btn-quiet" href="/classic/">More settings (WhatsApp, integrations, AI, MCP)</a>
            </span>
          </>
        ) : tab[3]}
      </div>
    </>
  );
}
