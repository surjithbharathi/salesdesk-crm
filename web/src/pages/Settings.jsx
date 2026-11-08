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

function Appearance() {
  const [skin, setSkin] = useState(readSkin);
  return (
    <Section title="Appearance" desc="Pick the look you are used to. It stays in this browser, and the light or dark choice still works with each one.">
      <div className="skin-list" role="radiogroup" aria-label="Appearance">
        {SKINS.map((s) => (
          <button key={s.id} role="radio" aria-checked={skin === s.id} className="skin-option" onClick={() => { applySkin(s.id); setSkin(s.id); }}>
            <span className={`skin-swatch swatch-${s.id}`} aria-hidden="true"><i /><i /><i /></span>
            <b>{s.name}</b>
            <small>{s.note}</small>
          </button>
        ))}
      </div>
    </Section>
  );
}

export default function Settings({ params, me }) {
  const { data: access, error } = useLoad(() => crmGet("workspace/access"), []);
  if (error) return <Failed>{error.message}</Failed>;
  if (!access) return <Loading>Loading settings…</Loading>;
  const can = (p) => Boolean(access.permissions?.[p]);
  // The server also requires the Administrator role for call AI and AI connections.
  const admin = can("integrations.manage") && (access.crmOwner || ["owner", "admin"].includes(access.role));
  const full ={ ...access, users: me.users };
  // [key, label, allowed, content, group, what it is for]
  const sections = [
    ["users", "People and access", can("users.manage"), <Users access={full} meId={me.id} />, "People", "Who can sign in, what each person can see and change."],
    ["email", "Email", can("integrations.manage"), <Email />, "Connections", "Mail settings used to send sign-in invitations and password resets."],
    ["whatsapp", "WhatsApp", can("integrations.manage"), <WhatsApp />, "Connections", "Link a WhatsApp number by QR code so chats appear against the lead."],
    ["gateway", "WhatsApp gateway", can("integrations.manage"), <Gateway users={me.users} />, "Connections", "Connect the Devi WhatsApp gateway: customer messages become leads, and people reply from a lead."],
    ["telecrm", "TeleCRM copy", can("integrations.manage"), <TelecrmMirror />, "Connections", "Keep a read-only copy of TeleCRM here: team, leads, timelines and follow-ups."],
    ["callai", "Call AI", admin, <CallAI />, "AI", "Turn call recordings into summaries and next steps."],
    ["mcp", "AI connections", admin, <Mcp />, "AI", "Let AI assistants read and work with this CRM through keys you control."],
    ["assign", "Assign leads", can("leads.write") && me.lead, <Assign access={full} />, "Leads and data", "Hand leads to people in bulk."],
    ["import", "Add leads from a file", can("leads.write") && can("data.export"), <Import access={full} />, "Leads and data", "Bring in leads from a spreadsheet."],
    ["merge", "Merge duplicates", can("leads.write") && me.lead, <Merge />, "Leads and data", "Combine leads that share a mobile number."],
    ["archived", "Archived leads", can("leads.write"), <Archived />, "Leads and data", "Bring archived leads back."],
    ["export", "Download data", can("data.export"), <Export />, "Leads and data", "Take a copy of your leads and activity."],
    ["workspaces", "Workspaces", Boolean(access.crmOwner), <Workspaces currentName={access.name} />, "Workspace", "Separate workspaces, each with its own data and sign-in."],
    ["account", "Your account", true, null, "Account", "Your sign-in, how the app looks, and signing out."],
  ].filter(([, , allowed]) => allowed);
  const tab = sections.find(([key]) => key === params.tab) || sections[0];
  const groups = [...new Set(sections.map((s) => s[4]))];
  const roleLabel = access.crmOwner ? "Ultra Admin" : ROLES.find(([r]) => r === access.role)?.[1] || "Member";
  return (
    <>
      <div className="work-head"><h1 className="work-title">Settings</h1><span className="work-date">{access.name}</span></div>
      <div className="set">
        <nav className="set-nav" aria-label="Settings sections">
          {groups.map((g) => (
            <div key={g} className="set-group">
              <h2>{g}</h2>
              {sections.filter((s) => s[4] === g).map(([key, label]) => (
                <a key={key} href={hashFor("/settings", { tab: key })} aria-current={tab[0] === key ? "page" : undefined}>{label}</a>
              ))}
            </div>
          ))}
        </nav>
        <section className="set-main">
          <header className="set-head"><h2>{tab[1]}</h2><p>{tab[5]}</p></header>
          <div className="set-card">
            {tab[0] === "account" ? (
              <>
                <Section title={me.users.find((u) => u.id === me.id)?.name || "You"} desc={roleLabel}>
                  <div className="newlead-actions">
                    <button className="btn" onClick={async () => { await logout(); location.reload(); }}>Sign out</button>
                  </div>
                </Section>
                <Appearance />
              </>
            ) : tab[3]}
          </div>
        </section>
      </div>
    </>
  );
}
