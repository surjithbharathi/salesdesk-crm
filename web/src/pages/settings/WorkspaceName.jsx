import React, { useState } from "react";
import { crmSend } from "../../api.js";
import { useToast } from "../../toast.jsx";
import { Section } from "./Parts.jsx";

// The name everyone sees in the top bar and under Settings.
export default function WorkspaceName({ current }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  async function save(event) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") || "").trim();
    setBusy(true);
    try {
      await crmSend("POST", "workspace/name", { name });
      notify("Workspace name saved");
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      notify(e.message);
      setBusy(false);
    }
  }
  return (
    <form className="set-form" onSubmit={save}>
      <Section title="Workspace name" desc="Shown in the top bar and under Settings for everyone in this workspace.">
        <div className="sec-grid">
          <label>Name<input className="field-input" name="name" defaultValue={current} maxLength={120} required /></label>
        </div>
      </Section>
      <div className="set-bar"><button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
    </form>
  );
}
