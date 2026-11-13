import React from "react";
import Recording from "./Recording.jsx";

// One line of a lead's activity history drawn as part of a WhatsApp-style conversation, in the order things happened:
// what the customer did (a message, a call to us) sits on the left, what our side did (a message, a call, a note) on the right.
// Events that belong to nobody in particular (a stage moved, a field updated) sit in the middle as a small label.
const OUT_KINDS = ["note", "visit"];

export const secondsText = (s) => {
  const n = Math.max(0, Math.round(Number(s) || 0));
  return n >= 3600 ? `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m ${n % 60}s` : n >= 60 ? `${Math.floor(n / 60)}m ${n % 60}s` : `${n}s`;
};

// From a stored activity record to what a ChatEntry draws.
// What the customer already said in chat, so a lead card does not repeat the same words as the message beside it.
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
export const saidInChat = (activities) => new Set((activities || []).filter((a) => a.type === "Message").map((a) => norm(a.text)).filter(Boolean));
const unrepeated = (lead, said) => (lead && said?.has(norm(lead.intro)) ? { ...lead, intro: "" } : lead);

// Salesmax and some TeleCRM notes carry HTML line breaks ("Cold Press<br>Operation Type"): shown as real new lines
const lines = (t) => (typeof t === "string" ? t.replace(/<br\s*\/?>/gi, "\n") : t);

export function fromActivity(a, { by = "", at = "", recordingId = "", customer = "", badge = "", recordingPending = false, said = null } = {}) {
  const type = a.type;
  a = a.text && /<br/i.test(a.text) ? { ...a, text: lines(a.text) } : a;
  if (type === "Call") {
    const secs = Number(a.duration) || 0, dir = a.direction || "Outgoing";
    return { id: a.id, kind: "call", customer, badge, out: dir === "Outgoing", dir, secs, text: a.text, outcome: a.outcome, by, at, recordingPending, recordingId: recordingId || a.recordingId || "" };
  }
  if (type === "Message") return { id: a.id, kind: "message", customer, badge, out: a.direction === "Outgoing", text: a.text, sender: a.sender, via: a.via, label: a.numberLabel, by, at };
  // the call itself is already on the timeline; these raw phone-system records become one short label
  const phoneEvent = superfoneOf(a.text) || callStatusOf(a.text);
  if (phoneEvent) return { id: a.id, kind: "system", text: phoneEvent, at };
  if (type === "System") {
    const arrived = unrepeated(leadArrivedOf(a.text), said);
    return arrived ? { id: a.id, kind: "buylead", customer, badge, out: false, lead: arrived, by, at } : { id: a.id, kind: "system", text: a.text, at };
  }
  const lead = buyLeadOf(a);
  if (lead) return { id: a.id, kind: "buylead", customer, badge, out: false, lead, by, at };
  return { id: a.id, kind: type === "Visit" ? "visit" : "note", customer, badge, out: true, text: a.text, by, at, voiceNoteId: a.voiceNoteId, type };
}

// The Superfone office phone posts each call to TeleCRM as a raw webhook, which TeleCRM keeps as a note:
// `ACTION_1005: {"body_event":"CDR_RECORDING_AVAILABLE","body_cdr call type":"INBOUND","body_cdr disposition":"ANSWER",
// "body_staff first name":"Priya","superfone_duration seconds":24,"superfone_recording_url":"https://…(expires in 7 days)"…}`.
// The text can be cut short, so each field is read on its own. The recording link has long expired, so it is not shown.
const SF_STATUS = { ANSWER: "answered", ANSWERED: "answered", ACTIVE: "ringing", NOANSWER: "not answered", NO_ANSWER: "not answered", BUSY: "busy", CANCEL: "cancelled", CANCELLED: "cancelled", FAILED: "failed", MISSED: "missed", CONGESTION: "network busy", CHANUNAVAIL: "not reachable" };
export function superfoneOf(text) {
  const t = String(text || "");
  if (!/^ACTION_\d+:\s*\{/.test(t) || !/"body_event"\s*:/.test(t)) return "";
  const field = (k) => { const m = new RegExp(`"${k}"\\s*:\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|(-?\\d+(?:\\.\\d+)?))`).exec(t); return m ? (m[1] ?? m[2]) : ""; };
  const event = field("body_event"), dir = field("body_cdr call type"), status = field("body_cdr disposition"), staff = field("body_staff first name");
  const secs = Number(field("superfone_duration seconds")) || 0;
  if (/CUSTOMER_CREATE/i.test(event)) return "Superfone saved this number as a contact";
  if (/^CDR/i.test(event)) {
    const parts = [`${/OUT/i.test(dir) ? "Outgoing" : /IN/i.test(dir) ? "Incoming" : "A"} call`, SF_STATUS[status.toUpperCase()] || status.toLowerCase(), secs > 0 ? secondsText(secs) : "", staff];
    return "Superfone · " + parts.filter(Boolean).join(" · ");
  }
  return "Superfone · " + event.replace(/_/g, " ").toLowerCase();
}
// A note that is only Superfone's status word for a call ("ANSWER", "ACTIVE") says nothing the call line does not
export function callStatusOf(text) {
  const t = String(text || "").trim();
  return SF_STATUS[t] && t === t.toUpperCase() ? `Call ${SF_STATUS[t]}` : "";
}

// An IndiaMART enquiry (Buy-Lead, direct enquiry, call) that TeleCRM stored as a raw action like
// `ACTION_105: {"type":"Buy-Lead","product_name":[...],"query":"..."}`. Newer imports carry it as `a.buyLead`.
// The stored text can be cut short, so fields are read one by one when the JSON does not parse.
export function buyLeadOf(a) {
  let f = a.buyLead && typeof a.buyLead === "object" ? a.buyLead : null;
  // the CRM's own IndiaMART / TradeIndia reads (push and pull) keep the enquiry already taken apart
  if (f && Array.isArray(f.specs)) {
    const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
    return {
      source: f.source || "IndiaMART", tag: f.source || "IndiaMART",
      kind: /^call$/i.test(f.kind) ? (Number(f.callSeconds) > 0 ? `Call enquiry · ${secondsText(f.callSeconds)}` : "Call enquiry") : clean(f.kind).replace(/-/g, " "),
      product: clean(f.product), category: clean(f.category), searched: clean(f.searched), requirement: clean(f.requirement),
      intro: clean(f.intro || f.subject), specs: f.specs.filter((s) => Array.isArray(s) && s[1]).map(([k, v]) => [clean(k), clean(v)]),
      note: clean(f.buyerNote), extra: (f.notes || []).map(clean).filter(Boolean), quantity: clean(f.quantity), repeat: Boolean(f.repeat),
      name: clean(f.name), company: clean(f.company), mobile: clean(f.mobile), mobile2: clean(f.mobile2), landline: clean(f.landline),
      email: clean(f.email), place: [clean(f.city), clean(f.state)].filter(Boolean).join(", "), pin: clean(f.pincode),
      receivedOn: clean(f.receivedOn), ref: clean(f.id), when: f.at || "",
    };
  }
  if (!f) {
    const m = /^ACTION_\d+:\s*(\{[\s\S]*)$/.exec(String(a.text || "").trim());
    if (!m) return null;
    try { f = JSON.parse(m[1]); } catch {
      f = {};
      for (const key of ["type", "time", "name", "mobile", "email", "address", "city", "state", "query"]) {
        const v = new RegExp(`"${key}"\\s*:\\s*(?:"((?:[^"\\\\]|\\\\.)*)|(-?\\d+))`).exec(m[1]);
        if (v) f[key] = v[1] !== undefined ? v[1].replace(/\\(.)/g, "$1") : Number(v[2]);
      }
      const p = /"product_name"\s*:\s*\[([^\]]*)/.exec(m[1]);
      if (p) f.product_name = [...p[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]);
    }
  }
  if (!f || typeof f !== "object") return null;
  const products = Array.isArray(f.product_name) ? f.product_name : f.product_name ? [f.product_name] : f.product ? [f.product] : [];
  if (!products.length && !f.query && !/buy/i.test(f.type || "")) return null;
  const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const address = clean(f.address);
  return {
    source: "IndiaMART", tag: "IndiaMART",
    kind: indiaMartKind(f.type, f.call_duration),
    product: products.map(clean).filter(Boolean).join(", "),
    ...querySpecs(clean(f.query)),
    name: clean(f.name), mobile: clean(f.mobile), email: clean(f.email),
    place: [clean(f.city), clean(f.state)].filter(Boolean).join(", "),
    pin: (/\b\d{6}\b/.exec(address) || [""])[0],
  };
}

// IndiaMART sends three kinds of enquiry: a buy lead (B, bought from the buy-lead list), a direct enquiry (W, the buyer wrote to us)
// and a call enquiry (P, the buyer rang the IndiaMART number).
export function indiaMartKind(type, secs) {
  const t = String(type || "").trim();
  if (/^b$|buy/i.test(t)) return "Buy lead";
  if (/^w$|direct|enq/i.test(t)) return "Direct enquiry";
  if (/^p$|call|pns/i.test(t)) return Number(secs) > 0 ? `Call enquiry · ${secondsText(secs)}` : "Call enquiry";
  return t.replace(/-/g, " ") || "Enquiry";
}

// Where a lead came from, in words the team uses. A "Whatsapp Cloud API" lead is someone who tapped a Facebook / Instagram (Meta) ad.
export const sourceLabel = (s) => {
  const v = String(s || "").trim();
  if (/whatsapp\s*cloud|click.?to.?whatsapp|ctwa/i.test(v)) return "Meta ad · WhatsApp";
  if (/facebook|instagram|meta/i.test(v)) return "Meta ad";
  if (/indiamart/i.test(v)) return "IndiaMART";
  if (/trade\s*india/i.test(v)) return "TradeIndia";
  if (/just\s*dial/i.test(v)) return "JustDial";
  return v || "New lead";
};

// Which mark to draw for a lead source.
export const sourceKeys = (s) => {
  const v = String(s || "");
  if (/whatsapp\s*cloud|click.?to.?whatsapp|ctwa/i.test(v)) return ["meta", "whatsapp"];
  if (/instagram/i.test(v)) return ["instagram"];
  if (/facebook/i.test(v)) return ["facebook"];
  if (/meta/i.test(v)) return ["meta"];
  if (/indiamart/i.test(v)) return ["indiamart"];
  if (/trade\s*india/i.test(v)) return ["tradeindia"];
  if (/just\s*dial/i.test(v)) return ["justdial"];
  if (/google/i.test(v)) return ["google"];
  if (/whatsapp/i.test(v)) return ["whatsapp"];
  if (/web|site|form/i.test(v)) return ["website"];
  return ["other"];
};

// Each platform's own logo (web/public/sources: IndiaMART, TradeIndia and JustDial site icons; Meta, WhatsApp, Google,
// Facebook and Instagram marks in their brand colour). Website and unknown sources get a plain drawn mark.
const LOGOS = { indiamart: "indiamart.png", tradeindia: "tradeindia.png", justdial: "justdial.png", meta: "meta.svg", whatsapp: "whatsapp.svg", google: "google.svg", facebook: "facebook.svg", instagram: "instagram.svg" };
function Mark({ k }) {
  if (LOGOS[k]) return <img className={`src-logo src-${k}`} src={`${import.meta.env.BASE_URL}sources/${LOGOS[k]}`} width="16" height="16" alt="" />;
  const common = { className: `src-logo src-${k}`, viewBox: "0 0 24 24", width: 16, height: 16, "aria-hidden": "true" };
  if (k === "website") return <svg {...common}><circle cx="12" cy="12" r="12" /><path d="M5 12h14M12 5c2.2 2 2.2 12 0 14M12 5c-2.2 2-2.2 12 0 14" fill="none" stroke="#fff" strokeWidth="1.5" /><circle cx="12" cy="12" r="7" fill="none" stroke="#fff" strokeWidth="1.5" /></svg>;
  return <svg {...common}><rect width="24" height="24" rx="6" /><path d="M7 7h6l4 4-6 6-4-4z" fill="none" stroke="#fff" strokeWidth="1.8" /></svg>;
}
export const SourceLogo = ({ source }) => <span className="src-logos">{sourceKeys(source).map((k) => <Mark key={k} k={k} />)}</span>;

// TeleCRM writes the arrival of a new lead as one line: "Details updated: phone: 91..., name: X, lead_source: Whatsapp Cloud API, query: Hello!..., assignee: a@b".
// When that line carries a lead source it is shown as the customer's enquiry instead of a grey system label.
export function leadArrivedOf(text) {
  const t = String(text || "").trim();
  const only = /^(?:Lead Source:|Lead (?:captured|received|came) from)\s*([^\n,]{1,60})$/i.exec(t);
  if (only) return { source: only[1].trim(), tag: sourceLabel(only[1]), kind: "New lead", product: "", intro: "", specs: [], name: "", mobile: "", email: "", place: "", pin: "" };
  const m = /^Details updated:\s*([\s\S]+)$/.exec(t);
  if (!m) return null;
  const f = {};
  for (const part of m[1].split(/,\s*(?=[a-z][a-z0-9_]*:\s)/)) {
    const kv = /^([a-z][a-z0-9_]*):\s*([\s\S]*)$/.exec(part.trim());
    if (kv) f[kv[1]] = kv[2].trim();
  }
  if (!f.lead_source) return null;
  return {
    source: f.lead_source, tag: sourceLabel(f.lead_source), kind: "New lead", product: f.product || f.product_name || "",
    intro: f.query || f.message || "", specs: [], name: f.name || "", mobile: f.phone || f.mobile || "", email: f.email || "",
    place: [f.city, f.state].filter(Boolean).join(", "), pin: "",
  };
}

// "Buyer Searched for X Machine Type: Cold Press Motor Power: 5 HP" -> intro + [["Machine Type","Cold Press"],["Motor Power","5 HP"]]
function querySpecs(q) {
  const keys = [...q.matchAll(/(Probable(?: [A-Z][\w/&().-]*){1,2}|[A-Z][\w/&().-]*(?: [A-Z][\w/&().-]*)?):\s+/g)];
  if (!keys.length) return { intro: q, specs: [] };
  return {
    intro: q.slice(0, keys[0].index).trim(),
    specs: keys.map((k, i) => [k[1], q.slice(k.index + k[0].length, keys[i + 1]?.index ?? q.length).trim()]).filter(([, v]) => v),
  };
}

const phoneText = (n) => { const d = String(n || "").replace(/[^0-9]/g, ""); return d.length === 12 && d.startsWith("91") ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : n; };

// The team member whose phone / WhatsApp number appears in a label like "Sales 90390 00067" (numbers are set in Settings, People).
export function userForNumber(users, label) {
  const digits = String(label || "").replace(/[^0-9]/g, "");
  if (digits.length < 8) return null;
  for (const u of users?.values?.() || []) {
    if ((u.numbers || []).some((n) => { const tail = String(n).slice(-10); return tail.length >= 8 && digits.endsWith(tail); })) return u;
  }
  return null;
}

// Two letters of a name, like a profile picture: Surjith -> SU, Bala -> BA
export const initialsOf = (name) => {
  const s = String(name || "").replace(/[^p{L}p{N} ]/gu, "").trim();
  return (s ? s.replace(/s+/g, "").slice(0, 2) : "?").toUpperCase();
};

const Phone = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" /></svg>
);

// Some calls come in with no talk time (TeleCRM keeps none for a call somebody logged by hand), so what the person
// recorded decides whether it was answered; the talk time only decides when nobody said.
const ANSWERED = /^(answered|connected|interested|callback|call ?back)$/i;
const UNANSWERED = /^(no answer|not answered|missed|rejected|busy|switched off|not reachable)$/i;
function callTitle(e) {
  const said = String(e.outcome || "");
  const talked = ANSWERED.test(said) || (e.secs > 0 && !UNANSWERED.test(said));
  if (e.dir === "Outgoing") return talked ? "Outgoing call" : "Called, no answer";
  if (e.dir === "Incoming" || e.dir === "Rejected") return talked ? "Incoming call" : e.dir === "Rejected" ? "Rejected call" : "Missed call";
  return talked ? `${e.dir} call` : "Missed call";
}

// The Excel upload into TeleCRM packed a lead's whole Salesmax record into one note: "Salesmax Lead Owner: Bala Salesmax Closed Reason: …".
// The Salesmax import now brings the same history in properly, so this note is folded to one line and opens as a list.
export function salesmaxSummaryOf(text) {
  const t = String(text || "").trim();
  if (!/^Salesmax [A-Z]/.test(t) || (t.match(/\bSalesmax [A-Z][\w ]{1,40}?: /g) || []).length < 4) return null;
  return t.split(/\s(?=Salesmax [A-Z][\w ]{1,40}?: )/).map((part) => {
    const m = /^Salesmax ([A-Z][\w ]{1,40}?): ([\s\S]*)$/.exec(part.trim());
    return m ? [m[1], m[2].trim()] : ["", part.trim()];
  }).filter(([, v]) => v);
}

export default function ChatEntry({ e }) {
  if (e.kind === "system") {
    const fields = salesmaxSummaryOf(e.text);
    if (fields) return (
      <div className="wa-sys wa-fold">
        <details>
          <summary>Salesmax details from the Excel upload{e.at ? ` · ${e.at}` : ""}</summary>
          <dl>{fields.map(([k, v], i) => <div key={i}>{k && <dt>{k}</dt>}<dd>{v}</dd></div>)}</dl>
        </details>
      </div>
    );
    return <div className="wa-sys"><span>{e.text}{e.at ? ` · ${e.at}` : ""}</span></div>;
  }
  const out = Boolean(e.out);
  let body;
  if (e.kind === "message") {
    body = (
      <article className={`gwchat-msg ${out ? "out" : ""}`}>
        <p>{e.text}</p>
        <small>{e.sender || e.by || (out ? "Our team" : "Customer")}{e.via ? ` · via ${e.via}` : ""}{e.label ? ` · ${e.label}` : ""}{e.at ? `, ${e.at}` : ""}</small>
      </article>
    );
  } else if (e.kind === "call") {
    const generic = !e.text || /^(Phone sync|Incoming|Outgoing|Missed|Rejected|Called)\b/i.test(e.text);
    body = (
      <article className={`gwchat-msg call ${out ? "out" : ""} ${e.secs > 0 ? "" : "missed"}`}>
        <p className="call-line"><Phone /> <b>{callTitle(e)}</b>{e.secs > 0 ? <span> · {secondsText(e.secs)}</span> : null}</p>
        {!generic && <p>{e.text}</p>}
        {e.recordingId ? <Recording id={e.recordingId} /> : e.recordingPending === "failed" ? <p className="rec-wait">Recording is only in TeleCRM</p> : e.recordingPending ? <p className="rec-wait">Recording is being copied from TeleCRM</p> : e.secs > 0 && e.dir !== "Missed" ? <p className="rec-wait">No recording from the phone yet. In the Salesdesk app, turn on Settings → "Sync call recordings".</p> : null}
        <small>{e.by || (out ? "Our team" : "Customer")}{e.outcome && !(e.outcome === "Recorded" && !e.recordingId) ? ` · ${e.outcome}` : e.outcome === "Recorded" ? " · Answered" : ""}{e.at ? `, ${e.at}` : ""}</small>
      </article>
    );
  } else if (e.kind === "buylead") {
    const l = e.lead;
    body = (
      <article className="gwchat-msg buylead">
        <p className="bl-head">
          <span className="bl-tag"><SourceLogo source={l.source} />{l.tag}</span>
          {l.kind && <span className="bl-chip kind">{l.kind}</span>}
          {l.requirement && <span className="bl-chip req">{l.requirement}</span>}
          {l.repeat && <span className="bl-chip">Repeat enquiry</span>}
        </p>
        {l.product && <p className="bl-product">{l.product}</p>}
        {(l.searched || l.category) && <p className="bl-meta">{[l.searched && `Searched "${l.searched}"`, l.category && `Category: ${l.category}`].filter(Boolean).join(" · ")}</p>}
        {l.intro && <p>{l.intro}</p>}
        {(l.specs.length > 0 || l.quantity) && (
          <dl className="bl-grid">
            {l.quantity && <div><dt>Quantity</dt><dd>{l.quantity}</dd></div>}
            {l.specs.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        )}
        {l.note && <blockquote className="bl-note">{l.note}</blockquote>}
        {(l.extra || []).map((t, i) => <p key={i} className="bl-meta">{t}</p>)}
        {(l.place || l.pin) && <p className="bl-meta">{[l.place, l.pin].filter(Boolean).join(" · ")}</p>}
        {l.company && <p className="bl-meta">{l.company}</p>}
        {(l.mobile || l.mobile2 || l.landline || l.email) && <p className="bl-meta">{[phoneText(l.mobile), l.mobile2 && `alt ${phoneText(l.mobile2)}`, l.landline && `landline ${l.landline}`, l.email].filter(Boolean).join(" · ")}</p>}
        {l.receivedOn && <p className="bl-meta">Came on our number {phoneText(l.receivedOn)}</p>}
        <small>{l.name || e.customer || "Buyer"}{e.at ? `, ${e.at}` : ""}{l.ref ? ` · ID ${l.ref}` : ""}</small>
      </article>
    );
  } else {
    body = (
      <article className="gwchat-msg out note">
        <p>{e.text}</p>
        {e.voiceNoteId && <Recording id={e.voiceNoteId} ai={false} />}
        <small>{OUT_KINDS.includes(e.kind) && e.kind === "visit" ? "Visit · " : "Note · "}{e.by || "Our team"}{e.at ? `, ${e.at}` : ""}</small>
      </article>
    );
  }
  // who did it: our team member on the right, the customer on the left
  // The badge always names the team member whose number the thing happened on, on both sides:
  // right = what they did, left = what the customer did to them (their number was called or messaged).
  const handler = (out && e.kind === "message" ? e.sender : "") || e.by || "Our team";
  const title = out ? handler : `${e.customer || "Customer"} to ${handler}`;
  const avatar = <span className={`wa-av ${out ? "us" : "them"}`} title={title} aria-label={title}>{String(e.badge || initialsOf(handler)).slice(0, 3)}</span>;
  return <div className={`wa-row ${out ? "out" : ""}`}>{!out && avatar}{body}{out && avatar}</div>;
}
