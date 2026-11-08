import React from "react";

// Building blocks every settings page uses, so each one reads the same way:
// a page is a short stack of sections; a section says what it is for, holds one form or list, and ends with its buttons.
export function Section({ title, desc, status, tone = "off", children, id }) {
  return (
    <section className="sec" id={id} aria-label={title}>
      <header className="sec-head">
        <div>
          <h3>{title}</h3>
          {desc && <p>{desc}</p>}
        </div>
        {status && <span className={`pill pill-${tone}`}>{status}</span>}
      </header>
      <div className="sec-body">{children}</div>
    </section>
  );
}

export function Steps({ children }) {
  return <ol className="steps">{React.Children.map(children, (c, i) => <li key={i}><span>{c}</span></li>)}</ol>;
}

export function Note({ children, tone = "info" }) {
  return <p className={`sec-note sec-note-${tone}`} role={tone === "warn" ? "note" : undefined}>{children}</p>;
}

export function Loading({ children }) {
  return <div className="sec"><p className="muted">{children}</p></div>;
}

export function Failed({ children }) {
  return <div className="sec"><p className="error">{children}</p></div>;
}
