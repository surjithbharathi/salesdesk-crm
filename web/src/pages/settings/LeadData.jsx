import React, { useMemo, useState } from "react";
import { crmSend, crmState } from "../../api.js";
import { useCrm, userName } from "../../crm.jsx";
import { useToast } from "../../toast.jsx";
import { parseLeadCsv } from "../../csv.js";
import { hashFor } from "../../format.js";

function download(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function Import({ access }) {
  const crm = useCrm();
  const notify = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function pick(event) {
    setError("");
    setRows(null);
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setRows(parseLeadCsv(await file.text()));
    } catch (e) {
      setError(e.message);
    }
  }
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const owner = new FormData(form).get("owner");
    setBusy(true);
    try {
      const out = await crmSend("POST", "import", { leads: rows.map((l) => ({ ...l, owner })) });
      await crm.reload();
      notify(`${out.added} leads imported, ${out.skipped} skipped because the number already exists`);
      setRows(null);
      form.reset();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="muted report-meta">Add many leads at once from a spreadsheet saved as CSV. The first row must name the columns: Name (required), Company, Phone, Email, City, Source, Value, Stage. Up to 500 leads at a time. A number that already exists is skipped, never duplicated.</p>
      <form className="newlead" onSubmit={submit}>
        <label>CSV file<input className="field-input" type="file" accept=".csv,text/csv" onChange={pick} required /></label>
        <label>Give these leads to
          <select className="field-input" name="owner" defaultValue="">
            <option value="">No owner yet</option>
            {access.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        {error && <p className="error wide" role="alert">{error}</p>}
        {rows && <p className="wide"><b>{rows.length}</b> leads found. First: {rows[0]?.name}.</p>}
        <span className="newlead-actions"><button className="btn btn-primary" disabled={busy || !rows}>{busy ? "Importing…" : `Import ${rows ? rows.length : ""} leads`}</button></span>
      </form>
    </>
  );
}

export function Export() {
  const notify = useToast();
  async function json() {
    try {
      download(`salesdesk-export-${new Date().toISOString().slice(0, 10)}.json`, "application/json", JSON.stringify(await crmState(), null, 2));
    } catch (e) {
      notify(e.message);
    }
  }
  async function csv() {
    try {
      const state = await crmState();
      const names = new Map((state.users || []).map((u) => [u.id, u.name]));
      const head = ["Name", "Company", "Phone", "Email", "City", "Source", "Stage", "Result", "Value", "Owner", "Created"];
      const lines = [head.join(",")].concat(state.leads.map((l) => [l.name, l.company, l.phone, l.email, l.city, l.source, l.stage, l.disposition, l.value, names.get(l.owner) || "", l.createdAt].map(csvCell).join(",")));
      download(`salesdesk-leads-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv", lines.join("\n"));
    } catch (e) {
      notify(e.message);
    }
  }
  return (
    <>
      <p className="muted report-meta">Download your records. Keep exports private: they contain customer contact details and sales history.</p>
      <span className="newlead-actions">
        <button className="btn btn-primary" onClick={csv}>Download leads (CSV)</button>
        <button className="btn" onClick={json}>Download everything (JSON)</button>
      </span>
    </>
  );
}

export function Archived() {
  const crm = useCrm();
  const notify = useToast();
  if (!crm.state) return <p className="muted">Loading…</p>;
  const archived = crm.leads.filter((l) => l.archived);
  async function restore(lead) {
    try {
      await crmSend("PATCH", `leads/${lead.id}`, { archived: false });
      await crm.reload();
      notify("Lead restored");
    } catch (e) {
      notify(e.message);
    }
  }
  if (!archived.length) return <div className="empty"><b>No archived leads</b>Leads you archive are kept here and can be restored.</div>;
  return (
    <div className="table-frame">
      <table className="grid">
        <thead><tr><th>Lead</th><th>Stage</th><th>Owner</th><th><span className="sr">Restore</span></th></tr></thead>
        <tbody>
          {archived.map((l) => (
            <tr key={l.id}>
              <td><b>{l.name}</b><small>{[l.company, l.city, l.phone].filter(Boolean).join(", ")}</small></td>
              <td>{l.stage === "Closed" ? l.disposition || "Closed" : l.stage}</td>
              <td>{userName(crm, l.owner)}</td>
              <td className="right"><button className="btn" onClick={() => restore(l)}>Restore</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Likely duplicates: the same name and company written in different cases. The server already refuses the same phone number.
export function Merge() {
  const crm = useCrm();
  const notify = useToast();
  const groups = useMemo(() => {
    if (!crm.state) return [];
    const by = new Map();
    for (const l of crm.leads.filter((x) => !x.archived)) {
      const key = `${l.name}|${l.company || ""}`.toLowerCase().replace(/\s+/g, " ").trim();
      by.set(key, [...(by.get(key) || []), l]);
    }
    return [...by.values()].filter((g) => g.length > 1).map((g) => g.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))));
  }, [crm.state, crm.leads]);
  async function merge(group) {
    const [keep, ...rest] = group;
    if (!confirm(`Merge ${rest.length} lead(s) into ${keep.name} (${keep.phone})? Calls, notes and follow-ups move to it. This cannot be undone.`)) return;
    try {
      await crmSend("POST", "leads/merge", { targetId: keep.id, sourceIds: rest.map((l) => l.id) });
      await crm.reload();
      notify("Leads merged");
    } catch (e) {
      notify(e.message);
    }
  }
  if (!crm.state) return <p className="muted">Loading…</p>;
  return (
    <>
      <p className="muted report-meta">Leads with the same name and company are listed together. The oldest one is kept; the others are merged into it with their calls, notes and follow-ups.</p>
      {!groups.length && <div className="empty"><b>No likely duplicates</b>Nothing here shares a name and company.</div>}
      {groups.map((g) => (
        <div key={g[0].id} className="dup-group">
          <ul>
            {g.map((l, i) => <li key={l.id}><a href={hashFor("/leads", { lead: l.id })}>{l.name}</a> <span className="muted">{l.phone}, {l.stage}{i === 0 ? ", will be kept" : ""}</span></li>)}
          </ul>
          <button className="btn" onClick={() => merge(g)}>Merge {g.length} leads</button>
        </div>
      ))}
    </>
  );
}
