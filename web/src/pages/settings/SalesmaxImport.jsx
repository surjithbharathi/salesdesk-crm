import React, { useRef, useState } from "react";
import { crmSend } from "../../api.js";
import { useToast } from "../../toast.jsx";
import { Section, Note } from "./Parts.jsx";

// Brings a Salesmax account's history in from its export files. The files are read here in the browser; only the columns the
// import uses go to the server, a few hundred rows at a time. Importing the same files again adds nothing twice, so a stopped
// import can simply be started again.
const KINDS = {
  contacts: { label: "Contacts (leads)", test: (h) => h.includes("LEAD NAME") && h.includes("MOBILE NUMBER"), batch: 150,
    cols: ["LEAD NAME", "LEAD OWNER", "LEAD STAGE", "DEAL STAGE", "LEAD DISPOSITION", "BUSINESS", "MOBILE NUMBER", "EMAIL", "ADDRESS", "STATE", "CITY", "AREA", "COUNTRY", "ZIPCODE", "DESIGNATION", "LEAD TYPE", "LEAD PRIORITY", "LEAD SOURCE", "SOURCE - LEVEL 2", "SOURCE - LEVEL 3", "TAGS", "LAST USER REMARK", "QUERY TYPE", "QUERY CAT", "SUMMERY", "IS CUSTOMER", "CREATED", "LAST UPDATED", "STARTED WORK ON", "TIMES RE-ENGAGED", "LAST NOTE", "LAST NOTE BY", "LAST WORKED"] },
  deals: { label: "Deals", test: (h) => h.includes("DEAL NAME") && h.includes("LEAD NUMBER"), batch: 300,
    cols: ["LEAD NUMBER", "DEAL NAME", "CREATED AT", "DEAL STAGE UPDATED AT", "UPDATED AT", "DEAL OWNER", "DEAL AMOUNT", "DEAL STAGE", "LOST REASON", "DEAL DESCRIPTION"] },
  tasks: { label: "Tasks", test: (h) => h.includes("TASK ID") && h.includes("CONTACT NUMBER"), batch: 300,
    cols: ["CONTACT NUMBER", "TASK ID", "CREATED AT", "TASK TYPE", "DUE DATE", "STATUS", "INPUT NOTE", "TASK OWNER", "COMPLETION TYPE", "COMPLETION NOTE", "UPDATED AT"] },
  activities: { label: "Activities", test: (h) => h.includes("ACTIVITY TYPE") && h.includes("CONTACT NUMBER"), batch: 300,
    cols: ["CONTACT NUMBER", "ACTIVITY TYPE", "DESCRIPTION", "ACTIVITY TIME", "ACTIVITY BY"] },
};
const ORDER = ["contacts", "deals", "tasks", "activities"]; // leads first: the others hang on them
const NOTES = { noPhone: "without a usable mobile number", noLead: "for a number with no lead", repeats: "repeat notices of a call already listed (recording ready, disposition added, transcript made)", callsAlreadyHere: "calls already in Salesdesk (from TeleCRM or listed twice)" };

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
// an .xlsx file is a zip of XML files: read the shared strings and the first sheet
async function xlsxRows(buf) {
  const v = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder();
  let e = buf.byteLength - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("This .xlsx file could not be read");
  const files = {};
  let p = v.getUint32(e + 16, true);
  for (let i = 0, n = v.getUint16(e + 10, true); i < n; i++) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl)), start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
    if (name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet1\.xml$/.test(name)) {
      const data = u8.subarray(start, start + size);
      files[name] = method === 8 ? await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text() : dec.decode(data);
    }
    p += 46 + nl + xl + cl;
  }
  const un = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, "&");
  const shared = [...(files["xl/sharedStrings.xml"] || "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => un([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  const col = (ref) => [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return [...(files["xl/worksheets/sheet1.xml"] || "").matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((rm) => {
    const row = [];
    for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const t = (cm[2].match(/t="(\w+)"/) || [])[1], inner = cm[3] || "";
      let val = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (t === "s") val = shared[+val];
      else if (t === "inlineStr") val = un([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
      else if (val !== undefined) val = un(val);
      row[col(cm[1])] = val ?? "";
    }
    return row;
  });
}
async function readFile(file) {
  const rows = /\.xlsx$/i.test(file.name) ? await xlsxRows(await file.arrayBuffer()) : parseCsv(await file.text());
  const head = (rows.shift() || []).map((h) => String(h ?? "").trim());
  const kind = ORDER.find((k) => KINDS[k].test(head));
  if (!kind) return { file: file.name, kind: "", rows: [] };
  const keep = KINDS[kind].cols.map((c) => [c, head.indexOf(c)]).filter(([, i]) => i >= 0);
  const out = rows.filter((r) => r.some((c) => c !== "" && c != null)).map((r) => Object.fromEntries(keep.map(([c, i]) => [c, String(r[i] ?? "").trim()])));
  return { file: file.name, kind, rows: out };
}

export default function SalesmaxImport() {
  const notify = useToast();
  const [files, setFiles] = useState([]);
  const [reading, setReading] = useState(false);
  const [run, setRun] = useState(null); // { kind, done, total, results: {kind: counts}, finished, error }
  const stop = useRef(false);

  async function pick(e) {
    const list = [...e.target.files];
    if (!list.length) return;
    setReading(true); setRun(null);
    try { setFiles(await Promise.all(list.map(readFile))); } catch (err) { notify(err.message); } finally { setReading(false); }
  }
  const ready = ORDER.map((k) => files.find((f) => f.kind === k)).filter(Boolean);
  const total = ready.reduce((n, f) => n + f.rows.length, 0);

  async function start() {
    stop.current = false;
    const results = {};
    let done = 0;
    setRun({ kind: ready[0]?.kind, done, total, results });
    for (const f of ready) {
      const sum = { created: 0, updated: 0, skipped: 0, notes: {} };
      results[f.kind] = sum;
      for (let i = 0; i < f.rows.length; i += KINDS[f.kind].batch) {
        if (stop.current) { setRun({ kind: f.kind, done, total, results, finished: true, error: "Stopped. Start again to carry on: rows already in are skipped." }); return; }
        const rows = f.rows.slice(i, i + KINDS[f.kind].batch);
        let c;
        for (let attempt = 1; ; attempt++) {
          try { c = await crmSend("POST", "import/salesmax", { kind: f.kind, rows }); break; }
          catch (err) { if (attempt >= 3) { setRun({ kind: f.kind, done, total, results, finished: true, error: `${err.message}. Start again to carry on: rows already in are skipped.` }); return; } await new Promise((r) => setTimeout(r, 2000 * attempt)); }
        }
        sum.created += c.created; sum.updated += c.updated; sum.skipped += c.skipped;
        for (const [k, n] of Object.entries(c.notes || {})) sum.notes[k] = (sum.notes[k] || 0) + n;
        done += rows.length;
        setRun({ kind: f.kind, done, total, results: { ...results } });
      }
    }
    setRun({ kind: "", done, total, results: { ...results }, finished: true });
    notify("Salesmax history imported");
  }
  const busy = run && !run.finished;

  return (
    <Section title="Bring in Salesmax history" desc="Choose the export files from Salesmax: contacts, deals, tasks and activities (CSV, or XLSX for tasks). Leads are matched by mobile number. A lead already in Salesdesk keeps its owner and stage; its empty details are filled, and a lead that reached TeleCRM through an Excel upload gets its real first date and source back. New leads come in with Salesmax's owner, stage and dates." status={run?.finished && !run.error ? "Imported" : busy ? "Importing" : files.length ? `${ready.length} file${ready.length === 1 ? "" : "s"} ready` : "No files yet"} tone={run?.finished && !run.error ? "ok" : "off"}>
      <label className="smx-pick">
        <span>Export files</span>
        <input type="file" multiple accept=".csv,.xlsx" disabled={reading || busy} onChange={pick} />
      </label>
      {reading && <p className="muted">Reading the files…</p>}
      {files.length > 0 && (
        <div className="table-frame">
          <table className="grid">
            <thead><tr><th>File</th><th>Holds</th><th className="right">Rows</th><th>Result</th></tr></thead>
            <tbody>
              {files.map((f) => {
                const r = run?.results[f.kind];
                return (
                  <tr key={f.file}>
                    <td>{f.file}</td>
                    <td>{f.kind ? KINDS[f.kind].label : <span className="error">Not a Salesmax export this page knows</span>}</td>
                    <td className="right">{f.rows.length.toLocaleString("en-IN")}</td>
                    <td>{r ? `${r.created.toLocaleString("en-IN")} added${r.updated ? `, ${r.updated.toLocaleString("en-IN")} filled in` : ""}, ${r.skipped.toLocaleString("en-IN")} skipped` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {run && <div className="smx-progress">
        <progress max={run.total || 1} value={run.done} aria-label="Import progress" />
        <span className="muted">{run.done.toLocaleString("en-IN")} of {run.total.toLocaleString("en-IN")} rows{busy && run.kind ? ` · ${KINDS[run.kind].label.toLowerCase()}` : ""}</span>
      </div>}
      {run?.error && <Note tone="warn">{run.error}</Note>}
      {run?.finished && !run.error && (
        <ul className="smx-notes">
          {Object.entries(run.results).flatMap(([k, r]) => Object.entries(r.notes).map(([n, c]) => <li key={k + n}>{KINDS[k].label}: {c.toLocaleString("en-IN")} skipped {NOTES[n] || n}</li>))}
        </ul>
      )}
      <Note>Workflows do not start for imported leads and calls. Calls already here from the TeleCRM copy are not added twice. Salesmax's export has only the last remark of each lead, so that one comes in as a note.</Note>
      <div className="newlead-actions">
        {busy
          ? <button className="btn" onClick={() => { stop.current = true; }}>Stop</button>
          : <button className="btn btn-primary" disabled={!ready.length || reading} onClick={start}>{run?.finished ? "Import again" : `Import ${total.toLocaleString("en-IN")} rows`}</button>}
      </div>
    </Section>
  );
}
