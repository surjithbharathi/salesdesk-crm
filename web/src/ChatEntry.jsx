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
export function fromActivity(a, { by = "", at = "", recordingId = "" } = {}) {
  const type = a.type;
  if (type === "Call") {
    const secs = Number(a.duration) || 0, dir = a.direction || "Outgoing";
    return { id: a.id, kind: "call", out: dir === "Outgoing", dir, secs, text: a.text, outcome: a.outcome, by, at, recordingId: recordingId || a.recordingId || "" };
  }
  if (type === "Message") return { id: a.id, kind: "message", out: a.direction === "Outgoing", text: a.text, sender: a.sender, via: a.via, label: a.numberLabel, by, at };
  if (type === "System") return { id: a.id, kind: "system", text: a.text, at };
  return { id: a.id, kind: type === "Visit" ? "visit" : "note", out: true, text: a.text, by, at, voiceNoteId: a.voiceNoteId, type };
}

const Phone = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" /></svg>
);

function callTitle(e) {
  if (e.dir === "Outgoing") return e.secs > 0 ? "Outgoing call" : "Called, no answer";
  if (e.dir === "Incoming" || e.dir === "Rejected") return e.secs > 0 ? "Incoming call" : e.dir === "Rejected" ? "Rejected call" : "Missed call";
  return e.secs > 0 ? `${e.dir} call` : "Missed call";
}

export default function ChatEntry({ e }) {
  if (e.kind === "system") return <div className="wa-sys"><span>{e.text}{e.at ? ` · ${e.at}` : ""}</span></div>;
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
        {e.recordingId && <Recording id={e.recordingId} />}
        <small>{e.by || (out ? "Our team" : "Customer")}{e.outcome ? ` · ${e.outcome}` : ""}{e.at ? `, ${e.at}` : ""}</small>
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
  return <div className={`wa-row ${out ? "out" : ""}`}>{body}</div>;
}
