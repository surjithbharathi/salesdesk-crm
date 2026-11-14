import React, { useState } from "react";
import { LOST_REASONS } from "../pipeline.js";

// Asked before a lead is closed as Lost: one reason from the list, or "Other" with the reason typed.
export default function LostReason({ name, onPick, onClose }) {
  const [pick, setPick] = useState("");
  const [other, setOther] = useState("");
  const reason = pick === "Other" ? other.trim() : pick;
  function save(e) {
    e.preventDefault();
    if (reason) onPick(reason.slice(0, 200));
  }
  return (
    <>
      <div className="r-scrim" onClick={onClose} />
      <form className="r-dialog" role="dialog" aria-modal="true" aria-label="Why was this lead lost" onSubmit={save}>
        <h2>Why was {name || "this lead"} lost?</h2>
        <div className="lost-reasons" role="radiogroup" aria-label="Lost reason">
          {[...LOST_REASONS, "Other"].map((r) => (
            <label key={r} className={`lost-reason${pick === r ? " on" : ""}`}>
              <input type="radio" name="lost-reason" value={r} checked={pick === r} onChange={() => setPick(r)} />
              {r}
            </label>
          ))}
        </div>
        {pick === "Other" && <label className="r-field"><span>Reason</span><input value={other} onChange={(e) => setOther(e.target.value)} maxLength={200} placeholder="Write the reason" autoFocus /></label>}
        <div className="r-dialog-acts"><button type="button" className="r-btn ghost" onClick={onClose}>Cancel</button><button type="submit" className="r-btn" disabled={!reason}>Close as Lost</button></div>
      </form>
    </>
  );
}
