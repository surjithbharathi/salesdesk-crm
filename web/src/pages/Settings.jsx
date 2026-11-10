import React, { useState } from "react";
import { SKINS, applySkin, readSkin } from "../skin.js";
import { crmGet, logout } from "../api.js";
import { useLoad } from "../hooks.js";
import { hashFor } from "../format.js";
import Users, { ROLES } from "./settings/Users.jsx";
import Email from "./settings/Email.jsx";
import WhatsApp from "./settings/WhatsApp.jsx";
import Gateway from "./settings/Gateway.jsx";
import TelecrmMirror from "./settings/TelecrmMirror.jsx";
import { Section, Loading, Failed } from "./settings/Parts.jsx";
import CallAI from "./settings/CallAI.jsx";
import Mcp from "./settings/Mcp.jsx";
import Assign from "./settings/Assign.jsx";
import Workspaces from "./settings/Workspaces.jsx";
import { Import, Export, Archived, Merge } from "./settings/LeadData.jsx";
import Blocked from "./settings/Blocked.jsx";
import Workflows from "./settings/Workflows.jsx";
import SalesmaxImport from "./settings/SalesmaxImport.jsx";
import Integrations from "./settings/Integrations.jsx";
import SigninMethods from "./settings/SigninMethods.jsx";
import WorkspaceName from "./settings/WorkspaceName.jsx";

const THEMES = [["", "Automatic", "Follows your phone or computer"], ["light", "Light", "Bright pages"], ["dark", "Dark", "Easy on the eyes at night"]];
function chooseTheme(value) {
  try { value ? localStorage.setItem("salesdesk-theme", value) : localStorage.removeItem("salesdesk-theme"); } catch { /* the choice then lasts for this visit only */ }
  window.dispatchEvent(new Event("salesdesk-theme"));
}
function Appearance() {
  const [skin, setSkin] = useState(readSkin);
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem("salesdesk-theme") || ""; } catch { return ""; } });
  return (
    <>
    <Section title="Theme" desc="Light or dark. It works with every look below and stays in this browser.">
      <div className="skin-list" role="radiogroup" aria-label="Theme">
        {THEMES.map(([id, name, note]) => (
          <button key={id || "auto"} role="radio" aria-checked={theme === id} className="skin-option" onClick={() => { chooseTheme(id); setTheme(id); }}>
            <b>{name}</b>
            <small>{note}</small>
          </button>
        ))}
      </div>
    </Section>
    <Section title="Look" desc="Pick the layout and colours you are used to. It stays in this browser.">
      <div className="skin-list" role="radiogroup" aria-label="Appearance">
        {SKINS.map((s) => (
          <button key={s.id} role="radio" aria-checked={skin === s.id} className="skin-option" disabled={s.off} title={s.off ? "Not available for now" : undefined} onClick={() => { if (s.off) return; applySkin(s.id); setSkin(s.id); }}>
            <span className={`skin-swatch swatch-${s.id}`} aria-hidden="true"><i /><i /><i /></span>
            <b>{s.name}</b>
            <small>{s.off ? "Not available for now" : s.note}</small>
          </button>
        ))}
      </div>
    </Section>
    </>
  );
}

// The groups of the settings menu, in this order. A section names its group by the key on the left; the menu shows the label.
const GROUPS = [["Workspace", "Workspace"], ["Calling", "Calling"], ["Connections", "Connect"], ["Leads and data", "Leads and data"], ["Account", "Account"]];

export default function Settings({ params, me }) {
  const { data: access, error } = useLoad(() => crmGet("workspace/access"), []);
  if (error) return <Failed>{error.message}</Failed>;
  if (!access) return <Loading>Loading settings…</Loading>;
  const can = (p) => Boolean(access.permissions?.[p]);
  // The server also requires the Administrator role for call AI and AI connections.
  const admin = can("integrations.manage") && (access.crmOwner || ["owner", "admin"].includes(access.role));
  const manager = access.crmOwner || ["owner", "admin"].includes(access.role);
  const full ={ ...access, users: me.users };
  // [key, label, allowed, content, group, what it is for]
  // A new section is one more line here: pick a key (it becomes #/settings?tab=<key>), a group from GROUPS above and a component.
  const sections = [
    ["workspace", "Workspace name", admin && can("users.manage"), <WorkspaceName current={access.name} />, "Workspace", "The company name everyone sees in the app."],
    ["users", "People and roles", can("users.manage"), <Users access={full} meId={me.id} />, "Workspace", "Who can sign in, what each person can see and change."],
    ["assign", "Lead assignment", can("leads.write") && me.lead, <Assign access={full} />, "Workspace", "Hand leads to people in bulk."],
    ["workflows", "Workflows", manager, <Workflows users={me.users} />, "Workspace", "Rules that act on leads by themselves: assign, follow up, message."],
    ["workspaces", "Workspaces", Boolean(access.crmOwner), <Workspaces currentName={access.name} />, "Workspace", "Separate workspaces, each with its own data and sign-in."],
    // Sign-in methods (WhatsApp OTP, Devi ERP) plug in here, for example:
    ["signin", "Sign-in methods", admin, <SigninMethods />, "Workspace", "How people sign in: password, a WhatsApp code, or their Devi ERP account."],
    ["callai", "Call AI", admin, <CallAI />, "Calling", "Turn call recordings into summaries and next steps."],
    ["blocked", "Blocked numbers", manager, <Blocked />, "Calling", "Numbers whose calls and chats never become leads."],
    ["integrations", "Integrations", can("integrations.manage"), <Integrations has={(key) => sections.some(([k, , allowed]) => k === key && allowed)} />, "Connections", "New enquiries from these come into Leads by themselves and are shared out by your assignment rules."],
    ["whatsapp", "WhatsApp", can("integrations.manage"), <WhatsApp />, "Connections", "Link a WhatsApp number by QR code so chats appear against the lead."],
    ["gateway", "WhatsApp gateway", can("integrations.manage"), <Gateway users={me.users} />, "Connections", "Connect the Devi WhatsApp gateway: customer messages become leads, and people reply from a lead."],
    ["telecrm", "TeleCRM copy", can("integrations.manage"), <TelecrmMirror />, "Connections", "Keep a read-only copy of TeleCRM here: team, leads, timelines and follow-ups."],
    ["email", "Email", can("integrations.manage"), <Email />, "Connections", "Mail settings used to send sign-in invitations and password resets."],
    ["mcp", "AI connections", admin, <Mcp />, "Connections", "Let AI assistants read and work with this CRM through keys you control."],
    ["import", "Add leads from a file", can("leads.write") && can("data.export"), <Import access={full} />, "Leads and data", "Bring in leads from a spreadsheet."],
    ["salesmax", "Salesmax history", manager, <SalesmaxImport />, "Leads and data", "Bring in leads, deals, tasks and activity from Salesmax export files."],
    ["merge", "Merge duplicates", can("leads.write") && me.lead, <Merge />, "Leads and data", "Combine leads that share a mobile number."],
    ["archived", "Archived leads", can("leads.write"), <Archived />, "Leads and data", "Bring archived leads back."],
    ["export", "Download data", can("data.export"), <Export />, "Leads and data", "Take a copy of your leads and activity."],
    ["look", "Look", true, <Appearance />, "Account", "Theme (light or dark) and the look of the app."],
    ["account", "Your account", true, null, "Account", "Your sign-in and signing out."],
  ].filter(([, , allowed]) => allowed);
  const groups = GROUPS.filter(([g]) => sections.some((s) => s[4] === g));
  const ordered = groups.flatMap(([g]) => sections.filter((s) => s[4] === g));
  const tab = sections.find(([key]) => key === params.tab) || ordered[0];
  const roleLabel = access.crmOwner ? "Ultra Admin" : ROLES.find(([r]) => r === access.role)?.[1] || "Member";
  return (
    <div className="rset">
      <nav className="rs-nav" aria-label="Settings sections">
        <h1>Settings</h1>
        <p className="rs-ws" lang="en">{access.name}</p>
        {groups.map(([g, label]) => (
          <div key={g} className="rs-group">
            <h2>{label}</h2>
            {sections.filter((s) => s[4] === g).map(([key, text]) => (
              <a key={key} className="rs-link" href={hashFor("/settings", { tab: key })} aria-current={tab[0] === key ? "page" : undefined}>{text}</a>
            ))}
          </div>
        ))}
      </nav>
      <section className="rs-main" aria-label={tab[1]}>
        <header className="rs-head"><h2>{tab[1]}</h2><p>{tab[5]}</p></header>
        <div className="set-card rs-body">
          {tab[0] === "account" ? (
            <>
              <Section title={me.users.find((u) => u.id === me.id)?.name || "You"} desc={roleLabel}>
                <div className="newlead-actions">
                  <button className="btn" onClick={async () => { await logout(); location.reload(); }}>Sign out</button>
                </div>
              </Section>
            </>
          ) : tab[3]}
        </div>
      </section>
    </div>
  );
}
