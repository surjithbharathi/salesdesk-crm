import React, { useEffect, useState } from "react";
import { crmGet, crmSend } from "../api.js";
import { useToast } from "../toast.jsx";

// ERPNext quotations and invoices for the lead's mobile number, with what is still owed, and a draft quotation from here
const inr = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
const short = (n) => (n >= 100000 ? `₹${(n / 100000).toFixed(n >= 1000000 ? 1 : 2)} L` : inr(n));
const day = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "");
const TONE = { Paid: "ok", Ordered: "ok", Open: "", Draft: "muted", "Partly Paid": "warn", Unpaid: "warn", Overdue: "bad", Lost: "muted", Expired: "muted", Cancelled: "muted", Submitted: "" };

function Doc({ d, kind, base }) {
  const doctype = kind === "q" ? "Quotation" : "Sales Invoice", slug = kind === "q" ? "quotation" : "sales-invoice";
  const pdf = `${base}/api/method/frappe.utils.print_format.download_pdf?doctype=${encodeURIComponent(doctype)}&name=${encodeURIComponent(d.name)}`;
  return (
    <li className="erp-doc">
      <a href={`${base}/app/${slug}/${encodeURIComponent(d.name)}`} target="_blank" rel="noreferrer">{d.name}</a>
      <span className="erp-amt">{inr(d.total)}</span>
      <span className="erp-meta">{day(d.date)}{kind === "i" && d.outstanding > 0 && d.status !== "Draft" ? ` · ${inr(d.outstanding)} due` : ""}</span>
      <span className={`erp-st ${TONE[d.status] || ""}`}>{d.status}</span>
      {d.status !== "Draft" && <a className="erp-pdf" href={pdf} target="_blank" rel="noreferrer">PDF</a>}
    </li>
  );
}

function NewQuotation({ leadId, onClose, onMade }) {
  const notify = useToast();
  const [find, setFind] = useState("");
  const [found, setFound] = useState([]);
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (find.trim().length < 2) { setFound([]); return undefined; }
    const t = setTimeout(() => { crmGet(`erpnext/items?q=${encodeURIComponent(find.trim())}`).then(setFound).catch((e) => notify(e.message)); }, 300);
    return () => clearTimeout(t);
  }, [find]);
  const add = (it) => { setLines((l) => (l.some((x) => x.code === it.code) ? l : [...l, { code: it.code, name: it.name, qty: 1, rate: it.rate }])); setFind(""); setFound([]); };
  const edit = (i, patch) => setLines((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const total = lines.reduce((a, x) => a + (Number(x.qty) || 0) * (Number(x.rate) || 0), 0);
  async function make(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await crmSend("POST", `erpnext/lead/${encodeURIComponent(leadId)}/quotation`, { items: lines.map((x) => ({ code: x.code, qty: Number(x.qty), rate: Number(x.rate) })) });
      notify(`Draft ${r.name} made in ERPNext`);
      window.open(r.url, "_blank", "noopener");
      onMade();
    } catch (err) { notify(err.message); setBusy(false); }
  }
  return (
    <>
      <div className="r-scrim" onClick={onClose} />
      <form className="r-dialog erp-new" role="dialog" aria-modal="true" aria-label="New quotation" onSubmit={make}>
        <h2>New quotation in ERPNext</h2>
        <label className="r-field"><span>Add a machine or item</span><input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Name or item code" autoFocus /></label>
        {found.length > 0 && (
          <div className="fu-matches" role="listbox" aria-label="Items">
            {found.map((it) => <button key={it.code} type="button" role="option" aria-selected="false" onClick={() => add(it)}><b>{it.name}</b><span>{it.code}{it.rate ? ` · ${inr(it.rate)}` : ""}</span></button>)}
          </div>
        )}
        {lines.length > 0 && (
          <ul className="erp-lines">
            {lines.map((x, i) => (
              <li key={x.code}>
                <span className="erp-line-name">{x.name}</span>
                <label>Qty<input type="number" min="1" step="1" value={x.qty} onChange={(e) => edit(i, { qty: e.target.value })} /></label>
                <label>Rate<input type="number" min="0" step="1" value={x.rate} onChange={(e) => edit(i, { rate: e.target.value })} /></label>
                <button type="button" className="r-link" onClick={() => setLines((l) => l.filter((_, j) => j !== i))} aria-label={`Remove ${x.name}`}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        <p className="erp-total">Total before tax {inr(total)}. It is saved as a draft: check taxes and terms in ERPNext, then submit it there.</p>
        <div className="r-dialog-acts"><button type="button" className="r-btn ghost" onClick={onClose}>Cancel</button><button type="submit" className="r-btn" disabled={busy || !lines.length || lines.some((x) => !(Number(x.qty) > 0))}>Make draft quotation</button></div>
      </form>
    </>
  );
}

export default function ErpPanel({ leadId, canEdit }) {
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    let live = true;
    crmGet(`erpnext/lead/${encodeURIComponent(leadId)}`).then((d) => live && setData(d)).catch(() => live && setData(null));
    return () => { live = false; };
  }, [leadId, tick]);
  if (!data || (!data.connected && !data.quotations.length && !data.invoices?.length)) return null;
  // invoices come only for owners, admins and managers (null for callers)
  const { quotations, totals, base } = data, invoices = data.invoices || [], seeInvoices = Array.isArray(data.invoices);
  return (
    <section className="r-card ld-enq erp" aria-label="ERPNext">
      <p className="ld-kicker">ERPNext</p>
      {(quotations.length > 0 || invoices.length > 0) ? (
        <div className="erp-totals">
          <div><span>Quoted</span><b>{short(totals.quoted)}</b></div>
          {seeInvoices ? <div><span>Outstanding</span><b className={totals.outstanding > 0 ? "erp-owed" : ""}>{short(totals.outstanding)}</b></div> : <div><span>Quotations</span><b>{quotations.length}</b></div>}
        </div>
      ) : <p className="ld-enq-intro">No quotation{seeInvoices ? " or invoice" : ""} for this number in ERPNext yet.</p>}
      {quotations.length > 0 && <><p className="erp-head">Quotations</p><ul className="erp-list">{quotations.slice(0, 8).map((d) => <Doc key={d.name} d={d} kind="q" base={base} />)}</ul></>}
      {invoices.length > 0 && <><p className="erp-head">Invoices</p><ul className="erp-list">{invoices.slice(0, 8).map((d) => <Doc key={d.name} d={d} kind="i" base={base} />)}</ul></>}
      {canEdit && data.connected && <button type="button" className="r-btn ghost erp-make" onClick={() => setCreating(true)}>Create quotation in ERPNext</button>}
      {creating && <NewQuotation leadId={leadId} onClose={() => setCreating(false)} onMade={() => { setCreating(false); setTick((t) => t + 1); }} />}
    </section>
  );
}
