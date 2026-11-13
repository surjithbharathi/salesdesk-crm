import React, { useState } from "react";
import { crmGet, crmSend } from "../../api.js";
import { useLoad } from "../../hooks.js";
import { useToast } from "../../toast.jsx";
import { Section, Loading, Failed } from "./Parts.jsx";

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
    <Section title="Send this link to the person" desc="It works once and expires in ten minutes. They choose their own password with it." status="New" tone="ok">
      <input className="field-input" readOnly value={absolute(link)} aria-label="Setup link" onFocus={(e) => e.target.select()} />
      <span className="newlead-actions">
        <button className="btn btn-primary" onClick={async () => { try { await navigator.clipboard.writeText(absolute(link)); notify("Link copied"); } catch { notify("Select the link and copy it by hand"); } }}>Copy link</button>
        <button className="btn btn-quiet" onClick={onClose}>Done</button>
      </span>
    </Section>
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

// Which phone / WhatsApp numbers this person works on. Chats and calls on those numbers then show this person.
function Numbers({ user, onSaved, onCancel }) {
  const notify = useToast();
  const [text, setText] = useState((user.numbers || []).join(", "));
  const [busy, setBusy] = useState(false);
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const numbers = text.split(/[,\n;]+/).map((n) => n.trim()).filter(Boolean);
      await crmSend("PUT", `workspace/users/${user.id}/numbers`, { numbers });
      notify("Numbers saved.");
      onSaved();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="user-edit" onSubmit={save}>
      <label>Numbers {user.name} uses (phone and WhatsApp)
        <input className="field-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="90390 00067, 98428 00068" inputMode="tel" />
      </label>
      <small className="muted">Separate numbers with commas. Calls and WhatsApp messages on these numbers show {user.name}'s badge in the activity history. Saving does not sign them out.</small>
      <span className="newlead-actions">
        <button className="btn btn-primary" disabled={busy}>Save numbers</button>
        <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>
      </span>
    </form>
  );
}

export default function Users({ access, meId }) {
  const notify = useToast();
  const [version, setVersion] = useState(0);
  const { data: users, error } = useLoad(() => crmGet("workspace/users"), [version]);
  // each person's company SIM: the SIM the phone app always uses for CRM calls
  const { data: sims } = useLoad(() => crmGet("click-to-call/company-sims").catch(() => ({})), [version]);
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
  async function remove(user) {
    if (!confirm(`Remove ${user.name} for good?\n\nThey can no longer sign in. Their leads, follow-ups and deals stay but become unassigned, and their past calls and notes are kept. This cannot be undone. To stop someone signing in for now, use Edit access and switch off "Can sign in" instead.`)) return;
    try {
      const out = await crmSend("DELETE", `workspace/users/${user.id}`);
      const n = out.unassigned || {};
      notify(`${out.name || user.name} removed. ${n.leads || 0} leads and ${n.tasks || 0} follow-ups are now unassigned.`);
      setEditing("");
      reload();
    } catch (e) {
      notify(e.message);
    }
  }
  async function resetSim(user) {
    if (!confirm(`Reset ${user.name}'s company SIM?

Their Salesdesk app will ask them to choose the company SIM again, and CRM calls from their phone wait until they do.`)) return;
    try {
      await crmSend("DELETE", `click-to-call/company-sims/${user.id}`);
      notify(`${user.name}'s company SIM was reset. Their app will ask for it again.`);
      reload();
    } catch (e) {
      notify(e.message);
    }
  }
  if (error) return <Failed>{error.message}</Failed>;
  return (
    <>
      {link && <SetupLink link={link} onClose={() => setLink("")} />}
      <Section title="People" desc="Everyone who can open this CRM. Changing someone's access signs them out on their devices." status={users ? `${users.length} people` : undefined} tone="off">
        <div className="table-frame">
          <table className="grid">
            <thead><tr><th>Name</th><th>Username</th><th>Numbers</th><th>Company SIM</th><th>Role</th><th>Status</th><th><span className="sr">Actions</span></th></tr></thead>
            <tbody>
              {(users || []).map((u) => (
                <React.Fragment key={u.id}>
                  <tr>
                    <td><b>{u.name}</b>{u.crmOwner && <span className="note note-warn small-note">Ultra Admin</span>}</td>
                    <td>{u.username || <span className="muted">No login</span>}</td>
                    <td>{u.numbers?.length ? u.numbers.join(", ") : <span className="muted">None</span>}</td>
                    <td>{sims?.[u.id]?.key ? <>{sims[u.id].label} <button className="btn btn-quiet" onClick={() => resetSim(u)}>Reset</button></> : <span className="muted">Not chosen</span>}</td>
                    <td>{ROLES.find(([r]) => r === u.role)?.[1] || u.role}</td>
                    <td>{u.active ? "Active" : <span className="muted">Disabled</span>}</td>
                    <td className="right">
                      <button className="btn btn-quiet" onClick={() => setEditing(editing === `n:${u.id}` ? "" : `n:${u.id}`)}>Numbers</button>
                      {u.hasLogin ? (
                        <span className="quick-actions">
                          <button className="btn" onClick={() => setEditing(editing === u.id ? "" : u.id)}>Edit access</button>
                          <button className="btn btn-quiet" onClick={() => setup(u)}>Setup link</button>
                        </span>
                      ) : <button className="btn" onClick={() => createLogin(u)}>Create login</button>}
                      {!u.crmOwner && u.id !== meId && <button className="btn btn-danger" onClick={() => remove(u)}>Remove</button>}
                    </td>
                  </tr>
                  {editing === u.id && (
                    <tr className="reasons"><td colSpan={7}><Edit user={u} access={access} onCancel={() => setEditing("")} onSaved={() => { setEditing(""); reload(); }} /></td></tr>
                  )}
                  {editing === `n:${u.id}` && (
                    <tr className="reasons"><td colSpan={7}><Numbers user={u} onCancel={() => setEditing("")} onSaved={() => { setEditing(""); reload(); }} /></td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="Add a person" desc="They get a one-use link to choose their own password.">
        <form className="sec-grid" onSubmit={invite}>
          <label>Name<input className="field-input" name="name" required maxLength={120} /></label>
          <label>Username<input className="field-input" name="username" required minLength={3} maxLength={120} autoComplete="off" /></label>
          <label>Email (optional)<input className="field-input" name="email" type="email" /></label>
          <label>Role
            <select className="field-input" name="role" defaultValue="member">{mayGive.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          </label>
          <div className="newlead-actions"><button className="btn btn-primary" disabled={busy}>Add and create setup link</button></div>
        </form>
      </Section>
      <Section title="What each role can do">
        <dl className="roles">
          <div><dt>Super Admin</dt><dd>Runs the workspace.</dd></div>
          <div><dt>Admin</dt><dd>Manages users and integrations.</dd></div>
          <div><dt>Manager</dt><dd>Sees the team's leads and reports.</dd></div>
          <div><dt>Caller</dt><dd>Sees only their own leads and calls.</dd></div>
        </dl>
      </Section>
    </>
  );
}
