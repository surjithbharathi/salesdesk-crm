import React, { useState } from "react";
import { crmGet, crmSend } from "../../api.js";
import { useLoad } from "../../hooks.js";
import { useToast } from "../../toast.jsx";
import { Section, Loading, Failed } from "./Parts.jsx";

// Numbers kept out of the CRM: phone call sync, the TeleCRM copy and the WhatsApp gateway skip them.
export default function Blocked() {
  const notify = useToast();
  const [version, setVersion] = useState(0);
  const { data: list, error } = useLoad(() => crmGet("blocked-numbers"), [version]);
  const [busy, setBusy] = useState(false);
  const reload = () => setVersion((v) => v + 1);
  async function act(fn, done) {
    setBusy(true);
    try { await fn(); notify(done); reload(); } catch (e) { notify(e.message); } finally { setBusy(false); }
  }
  if (error) return <Failed>{error.message}</Failed>;
  if (!list) return <Loading>Loading blocked numbers…</Loading>;
  return (
    <>
      <Section title="Blocked numbers" desc="Calls and WhatsApp messages from these numbers never create or update a lead. Family, staff and spam numbers belong here." status={`${list.length} blocked`} tone="off">
        {list.length ? (
          <div className="table-frame">
            <table className="grid">
              <thead><tr><th>Number</th><th>Was the lead</th><th>Blocked on</th><th><span className="sr">Actions</span></th></tr></thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.phone}>
                    <td>{b.phone.replace(/(\d{5})(\d{5})/, "$1 $2")}</td>
                    <td>{b.name || <span className="muted">Not known</span>}</td>
                    <td>{b.at ? new Date(b.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : ""}</td>
                    <td className="right"><button className="btn btn-quiet" disabled={busy} onClick={() => act(() => crmSend("DELETE", `blocked-numbers/${b.phone}`), `${b.phone} unblocked`)}>Unblock</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">No numbers are blocked. Use "Delete and block number" on a lead, or add one below.</p>}
      </Section>
      <Section title="Block a number" desc="The number does not need a lead. Existing leads with it stay until you delete them.">
        <form className="sec-grid" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const form = e.currentTarget; act(() => crmSend("POST", "blocked-numbers", { phone: f.get("phone"), name: f.get("name") }), "Number blocked").then(() => form.reset()); }}>
          <label>Mobile number<input className="field-input" name="phone" required inputMode="tel" placeholder="97873 33953" /></label>
          <label>Whose number (optional)<input className="field-input" name="name" maxLength={200} placeholder="Family, staff, spam" /></label>
          <div className="newlead-actions"><button className="btn btn-primary" disabled={busy}>Block number</button></div>
        </form>
      </Section>
    </>
  );
}
