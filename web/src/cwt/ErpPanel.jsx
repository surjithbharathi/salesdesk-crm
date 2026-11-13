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

// the ERPNext customer for this number: name, GSTIN and address, with a copy button for dispatch and courier
function Customer({ leadId, tick }) {
  const notify = useToast();
  const [c, setC] = useState(null);
  useEffect(() => {
    let live = true;
    setC(null);
    crmGet(`erpnext/lead/${encodeURIComponent(leadId)}/customer`).then((r) => live && setC(r.customer)).catch(() => {});
    return () => { live = false; };
  }, [leadId, tick]);
  if (!c) return null;
  const a = c.address, place = a ? [a.city, [a.state, a.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
  const text = [c.customerName, ...(a ? [...a.lines, place] : []), c.gstin ? `GSTIN ${c.gstin}` : ""].filter(Boolean).join("\n");
  const copy = () => navigator.clipboard.writeText(text).then(() => notify("Address copied"), () => notify("Could not copy"));
  return (
    <div className="erp-cust">
      <div className="erp-cust-top">
        <a href={c.url} target="_blank" rel="noreferrer">{c.customerName}</a>
        {c.gstin && <span className="erp-gst">GSTIN {c.gstin}</span>}
      </div>
      {a ? (
        <>
          <address className="erp-addr">{a.lines.map((l) => <React.Fragment key={l}>{l}<br /></React.Fragment>)}{place}{a.type && <span className="erp-addr-type"> · {a.type}</span>}</address>
          <button type="button" className="r-link" onClick={copy}>Copy address</button>
        </>
      ) : <p className="erp-addr">No address for this customer in ERPNext.</p>}
    </div>
  );
}

export default function ErpPanel({ leadId, canEdit }) {
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  const [opening, setOpening] = useState(false);
  const notify = useToast();
  // ERPNext's own new-quotation page, with this lead's customer filled in (created in ERPNext first if it is new)
  async function openNew() {
    const tab = window.open("about:blank", "_blank"); // opened on the click, so the browser does not block it
    setOpening(true);
    try {
      const r = await crmSend("POST", `erpnext/lead/${encodeURIComponent(leadId)}/quotation`, { open: true });
      if (tab) { tab.opener = null; tab.location.href = r.url; } else window.location.href = r.url;
      setTick((t) => t + 1);
    } catch (e) { if (tab) tab.close(); notify(e.message); }
    finally { setOpening(false); }
  }
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
      {data.connected && <Customer leadId={leadId} tick={tick} />}
      {(quotations.length > 0 || invoices.length > 0) ? (
        <div className="erp-totals">
          <div><span>Quoted</span><b>{short(totals.quoted)}</b></div>
          {seeInvoices ? <div><span>Outstanding</span><b className={totals.outstanding > 0 ? "erp-owed" : ""}>{short(totals.outstanding)}</b></div> : <div><span>Quotations</span><b>{quotations.length}</b></div>}
        </div>
      ) : <p className="ld-enq-intro">No quotation{seeInvoices ? " or invoice" : ""} for this number in ERPNext yet.</p>}
      {quotations.length > 0 && <><p className="erp-head">Quotations</p><ul className="erp-list">{quotations.slice(0, 8).map((d) => <Doc key={d.name} d={d} kind="q" base={base} />)}</ul></>}
      {invoices.length > 0 && <><p className="erp-head">Invoices</p><ul className="erp-list">{invoices.slice(0, 8).map((d) => <Doc key={d.name} d={d} kind="i" base={base} />)}</ul></>}
      {canEdit && data.connected && <button type="button" className="r-btn ghost erp-make" onClick={openNew} disabled={opening}>{opening ? "Opening ERPNext…" : "Create quotation in ERPNext"}</button>}
    </section>
  );
}
