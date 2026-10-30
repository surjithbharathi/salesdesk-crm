import React, { useState } from "react";
import { crmGet, crmSend } from "../../api.js";
import { useLoad } from "../../hooks.js";
import { useToast } from "../../toast.jsx";

export const ROLES = [["owner", "Super Admin"], ["admin", "Admin"], ["manager", "Manager"], ["member", "Caller"]];
const RANK = { owner: 4, admin: 3, manager: 2, member: 1, viewer: 0 };
const PERMISSIONS = [
  ["leads.write", "Add and edit leads"],
  ["tasks.write", "Add and edit follow-ups"],
  ["calls.read", "See calls and recordings"],
  ["calls.sync", "Sync calls from the phone"],
  ["messages.read", "See WhatsApp messages"],
  ["reports.read", "See reports"],
  ["integrations.manage", "Manage integrations"],
  ["users.manage", "Manage users"],
  ["data.export", "Export data"],
];
const ADMIN_ONLY = ["integrations.manage", "users.manage", "data.export"];
// Same defaults the server applies, so only real differences are sent as overrides.
const defaults = (role) => Object.fromEntries(PERMISSIONS.map(([key]) => [key, role === "owner" || role === "admin" || !ADMIN_ONLY.includes(key)]));
const absolute = (url) => (url.startsWith("/") ? location.origin + url : url);

function SetupLink({ link, onClose }) {
  const notify = useToast();
  return (
    <div className="setup-link" role="status">
      <p><b>Send this link to the person.</b> It works once and expires in ten minutes. They choose their own password with it.</p>
      <input className="field-input" readOnly value={absolute(link)} aria-label="Setup link" onFocus={(e) => e.target.select()} />
      <span className="newlead-actions">
        <button className="btn btn-primary" onClick={async () => { try { await navigator.clipboard.writeText(absolute(link)); notify("Link copied"); } catch { notify("Select the link and copy it by hand"); } }}>Copy link</button>
        <button className="btn btn-quiet" onClick={onClose}>Done</button>
      </span>
    </div>
  );
}

function Edit({ user, access, onSaved, onCancel }) {
  const notify = useToast();
  const [role, setRole] = useState(user.role);
  const [active, setActive] = useState(user.active);
  const [email, setEmail] = useState(user.email || "");
  const [perms, setPerms] = useState(user.permissions);
  const [busy, setBusy] = useState(false);
  const mayGive = ROLES.filter(([r]) => RANK[r] <= RANK[access.role] || access.crmOwner);
  const base = defaults(role);
  const adminRole = role === "owner" || role === "admin";
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const overrides = Object.fromEntries(PERMISSIONS.filter(([key]) => perms[key] !== base[key]).map(([key]) => [key, perms[key]]));
      await crmSend("PATCH", `workspace/users/${user.id}`, { role, active, email, permissions: overrides });
      notify("Access saved. The person is signed out on their devices.");
      onSaved();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="user-edit" onSubmit={save}>
      <label>Role
        <select className="field-input" value={role} onChange={(e) => { setRole(e.target.value); setPerms(defaults(e.target.value)); }}>
          {mayGive.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <label>Email<input className="field-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Can sign in</label>
      <fieldset>
        <legend>What this person can do</legend>
        {PERMISSIONS.map(([key, label]) => (
          <label key={key} className="check">
            <input type="checkbox" checked={Boolean(perms[key])} disabled={!adminRole && ADMIN_ONLY.includes(key)} onChange={(e) => setPerms({ ...perms, [key]: e.target.checked })} /> {label}
          </label>
        ))}
        <small className="muted">Manage users, integrations and export need the Admin role.</small>
      </fieldset>
      <span className="newlead-actions">
        <button className="btn btn-primary" disabled={busy}>Save access</button>
        <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>
      </span>
    </form>
  );
}

export default function Users({ access }) {
  const notify = useToast();
  const [version, setVersion] = useState(0);
  const { data: users, error } = useLoad(() => crmGet("workspace/users"), [version]);
  const sync = useLoad(() => crmGet("workspace/call-sync"), [version]);
  const skipped = new Set(sync.data?.skipped || []);
  const [editing, setEditing] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const mayGive = ROLES.filter(([r]) => RANK[r] <= RANK[access.role] || access.crmOwner);
  const reload = () => setVersion((v) => v + 1);

  async function invite(event) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const out = await crmSend("POST", "workspace/users", { name: f.get("name"), username: f.get("username"), email: f.get("email") || undefined, role: f.get("role") });
      setLink(out.setupUrl);
      event.currentTarget.reset();
      reload();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function setSync(user, on) {
    try {
      await crmSend("POST", "workspace/call-sync", { userId: user.id, skip: !on });
      notify(on ? `Calls from ${user.name} are synced again` : `Calls from ${user.name} are no longer synced`);
      reload();
    } catch (e) {
      notify(e.message);
    }
  }
  async function setup(user) {
    try {
      setLink((await crmSend("POST", `workspace/users/${user.id}/setup-link`)).setupUrl);
    } catch (e) {
      notify(e.message);
    }
  }
  async function createLogin(user) {
    const username = prompt(`Choose a username for ${user.name} (letters, numbers, . @ _ + -)`);
    if (!username) return;
    try {
      const out = await crmSend("POST", "workspace/users", { userId: user.id, name: user.name, username, email: user.email || undefined, role: "member" });
      setLink(out.setupUrl);
      reload();
    } catch (e) {
      notify(e.message);
    }
  }
  if (error) return <p className="error">{error.message}</p>;
  return (
    <>
      <p className="muted report-meta">Super Admin runs the workspace. Admin manages users and integrations. Manager sees the team's leads and reports. Caller sees only their own leads and calls. Changing someone's access signs them out on their devices.</p>
      {link && <SetupLink link={link} onClose={() => setLink("")} />}
      <h2 className="section-title">Add a person</h2>
      <form className="newlead" onSubmit={invite}>
        <label>Name<input className="field-input" name="name" required maxLength={120} /></label>
        <label>Username<input className="field-input" name="username" required minLength={3} maxLength={120} autoComplete="off" /></label>
        <label>Email (optional)<input className="field-input" name="email" type="email" /></label>
        <label>Role
          <select className="field-input" name="role" defaultValue="member">{mayGive.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        </label>
        <span className="newlead-actions"><button className="btn btn-primary" disabled={busy}>Add and create setup link</button></span>
      </form>
      <h2 className="section-title section-gap">People</h2>
      <p className="muted report-meta">Call sync copies a person's phone calls and recordings into the CRM. Turn it off for people whose calls should stay out. Their phone then sends nothing, and nobody is signed out. Calls already synced stay in the CRM.</p>
      <div className="table-frame">
        <table className="grid">
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Call sync</th><th><span className="sr">Actions</span></th></tr></thead>
          <tbody>
            {(users || []).map((u) => (
              <React.Fragment key={u.id}>
                <tr>
                  <td><b>{u.name}</b>{u.crmOwner && <span className="note note-warn small-note">Ultra Admin</span>}</td>
                  <td>{u.username || <span className="muted">No login</span>}</td>
                  <td>{ROLES.find(([r]) => r === u.role)?.[1] || u.role}</td>
                  <td>{u.active ? "Active" : <span className="muted">Disabled</span>}</td>
                  <td>
                    <label className="check sync-switch">
                      <input type="checkbox" checked={!skipped.has(u.id)} disabled={!sync.data} onChange={(e) => setSync(u, e.target.checked)} aria-label={`Sync calls from ${u.name}`} />
                      {skipped.has(u.id) ? <span className="muted">Off</span> : "On"}
                    </label>
                  </td>
                  <td className="right">
                    {u.hasLogin ? (
                      <span className="quick-actions">
                        <button className="btn" onClick={() => setEditing(editing === u.id ? "" : u.id)}>Edit access</button>
                        <button className="btn btn-quiet" onClick={() => setup(u)}>Setup link</button>
                      </span>
                    ) : <button className="btn" onClick={() => createLogin(u)}>Create login</button>}
                  </td>
                </tr>
                {editing === u.id && (
                  <tr className="reasons"><td colSpan={6}><Edit user={u} access={access} onCancel={() => setEditing("")} onSaved={() => { setEditing(""); reload(); }} /></td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
