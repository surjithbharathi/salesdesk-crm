import React, { useState } from "react";
import { crmGet, crmSend } from "../../api.js";
import { useLoad } from "../../hooks.js";
import { useToast } from "../../toast.jsx";
import { Section, Note, Loading, Failed } from "./Parts.jsx";

// One person, two entries (for example the TeleCRM copy "surjith" and the login "Surjith Bharathi"):
// joining them shows their leads, calls and follow-ups together everywhere. Nothing stored is changed.
export default function SamePerson() {
  const notify = useToast();
  const [version, setVersion] = useState(0);
  const { data, error } = useLoad(() => crmGet("workspace/user-links"), [version]);
  const [busy, setBusy] = useState(false);
  if (error) return <Failed>{error.message}</Failed>;
  if (!data) return <Loading>Loading people…</Loading>;
  const name = (id) => data.people.find((p) => p.id === id)?.name || "Someone";
  const linked = new Set(data.links.map((l) => l.alias));
  const targets = new Set(data.links.map((l) => l.userId));
  const joinable = data.people.filter((p) => !p.login && !linked.has(p.id) && !targets.has(p.id));
  const keepers = data.people.filter((p) => !linked.has(p.id));

  async function send(body, done) {
    setBusy(true);
    try {
      await crmSend("POST", "workspace/user-links", body);
      notify(done);
      setVersion((v) => v + 1);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  function join(event) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    send({ alias: f.get("alias"), userId: f.get("userId") }, "Joined. Reload pages to see them together.");
  }

  return (
    <>
      <Section title="Joined people" desc="Each line shows two entries that are one person. Their leads, calls and follow-ups count once, under the name on the right.">
        {data.links.length ? (
          <ul className="sec-line">
            {data.links.map((l) => (
              <li key={l.alias}>
                <b>{name(l.alias)}</b> is shown as <b>{name(l.userId)}</b>{" "}
                <button type="button" className="btn" disabled={busy} onClick={() => send({ alias: l.alias, userId: null }, "Separated again")}>Separate</button>
              </li>
            ))}
          </ul>
        ) : <Note>No one is joined yet.</Note>}
      </Section>
      <form className="set-form" onSubmit={join}>
        <Section title="Join two entries" desc="Pick the extra entry (for example the TeleCRM copy) and the person it really is. Only entries without their own login can be joined into someone.">
          <div className="sec-grid">
            <label>Extra entry<select className="field-input" name="alias" required defaultValue="">
              <option value="" disabled>Choose…</option>
              {joinable.map((p) => <option key={p.id} value={p.id}>{p.name}{p.telecrm ? " (TeleCRM)" : ""}{p.email ? ` · ${p.email}` : ""}</option>)}
            </select></label>
            <label>Is really<select className="field-input" name="userId" required defaultValue="">
              <option value="" disabled>Choose…</option>
              {keepers.map((p) => <option key={p.id} value={p.id}>{p.name}{p.login ? " (has login)" : ""}</option>)}
            </select></label>
          </div>
          <Note>The TeleCRM copy keeps working: TeleCRM still writes under the extra entry, and Salesdesk shows it under the person you choose. Separate them again any time.</Note>
        </Section>
        <div className="set-bar"><button className="btn btn-primary" disabled={busy || !joinable.length}>Join</button></div>
      </form>
    </>
  );
}
