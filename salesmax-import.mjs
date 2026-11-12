// One-time import of a Salesmax account's history from its export files: contacts (leads), deals, tasks and activities.
// The browser reads the files and sends rows in batches; this module maps each row to this CRM's records.
// Rules:
//   - The mobile number ties everything together (last digits normalised the same way as everywhere else in the CRM).
//   - A lead that already exists here (typed in, from TeleCRM, IndiaMART…) keeps its owner and stage; only its empty fields
//     are filled. New leads get Salesmax's owner, stage and dates.
//   - Every imported record has a fixed id made from the row, so importing the same files again adds nothing twice.
//   - A call that is already here (same lead, same direction, start within 2 minutes; e.g. from the TeleCRM copy) is skipped.
//   - Imported leads and calls are marked importedFrom: "salesmax", and workflows never start for them.
import { createHash } from "node:crypto";
import { phoneParts } from "./lead-phone.mjs";
import { PIPELINE } from "./pipeline.mjs";
import { withRegion } from "./lead-region.mjs";

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const MAX_ROWS = 400;
const FROM = "salesmax";
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const str = (v, max = 300) => String(v ?? "").trim().slice(0, max);
const hash = (...parts) => createHash("sha1").update(parts.join("\u0001")).digest("hex").slice(0, 24);

// Salesmax writes India time without a zone ("2026-09-10 17:17:10"); the tasks sheet uses Excel day numbers
export function istToIso(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Math.round((Number(s) - 25569) * 86400000) - 19800000).toISOString();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - 19800000).toISOString();
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}
// "+919876543210|+919812345678" → the first number in this CRM's form, and the others as text
export function phoneOf(v) {
  const all = String(v ?? "").split(/[|,;/]/).map((x) => x.trim()).filter(Boolean);
  for (const raw of all) {
    try { const p = phoneParts(raw.startsWith("+") ? raw : raw.replace(/\D/g, "").length === 10 ? "+91" + raw.replace(/\D/g, "") : raw); if (p.phoneKey) return { ...p, others: all.filter((x) => x !== raw) }; } catch { /* try the next one */ }
  }
  return null;
}

const SOURCES = { whatsapp: "WhatsApp", whstapp: "WhatsApp", "whatsapp business app": "WhatsApp Business", indiamart: "IndiaMART", tradeindia: "TradeIndia", incomingphonecall: "Incoming call", outgoingphonecall: "Outgoing call", salesmaxapi: "Salesmax API", superfone: "Superfone", call: "Phone call" };
const sourceOf = (s) => SOURCES[norm(s)] || SOURCES[norm(s).replace(/ /g, "")] || str(s, 200) || "Salesmax";
// Salesmax deal stage → pipeline step of this CRM
const STEPS = new Map([
  ["intrested customer", "Interested Customer"], ["interested customer", "Interested Customer"], ["requirement discussion", "Requirement Discussion"],
  ["quotation shared", "Quotation Shared"], ["loan document collected", "Loan Document Collected"], ["loan in process", "Loan in Process"],
  ["advance received", "Advance Received"], ["machine dispatched", "Machine Dispatched"], ["machine delivered need to start", "Machine Delivered - Need to Start"],
  ["won", "Won"], ["later purchase", "Later Purchase"], ["lost", "Lost"],
]);
const LEAD_STAGES = { "new lead": "New", new: "New", intrested: "Opportunity", interested: "Opportunity", "need discussion": "Prospecting", closed: "Closed", "return customer": "Closed" };
export function stageOf(leadStage, dealStage, disposition) {
  const step = PIPELINE.find((p) => p.name === STEPS.get(norm(dealStage)));
  if (step) return { deal: step.name, stage: step.stage, disposition: step.disposition };
  const stage = LEAD_STAGES[norm(leadStage)] || "Prospecting";
  const d = norm(disposition).replace(/\bintrested\b/, "interested").replace(/\brnr\b/, "ringing no response");
  return { deal: "", stage, disposition: stage === "Closed" && d ? d.replace(/^./, (c) => c.toUpperCase()) : "" };
}
// deal stage of a Salesmax deal → the five deal stages of this CRM
function dealStageOf(s) {
  const k = norm(s);
  if (k === "won" || k.startsWith("machine")) return "Won";
  if (k === "lost" || k === "later purchase") return "Lost";
  if (k === "quotation shared") return "Proposal";
  if (k.startsWith("loan") || k === "advance received") return "Negotiation";
  return "Qualified";
}
// "Bala made a 00:01:01 duration call to Ravi at 2026-09-10T11:46:00.737Z"
export function callOf(desc) {
  const m = String(desc).match(/ (made|received) a (\d{1,2}):(\d{2}):(\d{2}) duration call (?:to|from) .*? at (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
  if (!m) return null;
  const duration = +m[2] * 3600 + +m[3] * 60 + +m[4], out = m[1] === "made";
  return { direction: out ? "Outgoing" : duration ? "Incoming" : "Missed", duration, outcome: duration ? "Connected" : "No answer", at: new Date(m[5]).toISOString() };
}
// activity kinds that only repeat another row without adding anything (the recording or disposition of a call already listed)
const SKIP = new Set(["CALL_RECORD_AVAILABLE", "CALL_DISPOSITION_ADDED", "AI_TRANSCRIPT_GENERATED"]);

export function createSalesmaxImport({ db, get, put, tx, users }) {
  let indexed = false;
  function prepare() {
    if (indexed) return;
    // reading a lead's calls one by one needs this; harmless for everything else
    db.exec("CREATE INDEX IF NOT EXISTS activities_by_lead ON records(json_extract(body,'$.leadId')) WHERE kind='activities'");
    indexed = true;
  }
  // Salesmax names people by a short name ("Bala") that is not always the name here ("Balaji"): the same name, then the
  // same first word, then the e-mail's name (bala@…), then one name starting with the other. A guess is taken only when it
  // points at exactly one person, so a short name shared by two people stays unassigned.
  const people = () => {
    const list = users().filter((x) => x.active !== false && !x.mergedInto);
    const one = (hits) => (hits.length === 1 ? hits[0] : null);
    const mail = (x) => norm(String(x.email || "").split("@")[0]);
    return (name) => {
      const n = norm(name), first = n.split(" ")[0];
      if (!n) return "";
      const u = list.find((x) => norm(x.name) === n)
        || (first.length > 2 && one(list.filter((x) => norm(x.name).split(" ")[0] === first)))
        || (first.length > 2 && one(list.filter((x) => mail(x) === n || mail(x) === first)))
        || (first.length > 2 && one(list.filter((x) => { const f = norm(x.name).split(" ")[0]; return f.length > 2 && (f.startsWith(first) || first.startsWith(f)); })));
      return u?.id || "";
    };
  };
  // Leads brought in from Salesmax before a name could be matched get their owner now, from the name Salesmax gave
  // (kept on the lead), and so do their open follow-ups. Marked as an import change, so no "assigned" workflow fires.
  function fixOwners() {
    const personOf = people(), at = new Date().toISOString();
    let leads = 0, tasks = 0;
    tx(() => {
      for (const r of db.prepare("SELECT body FROM records WHERE kind='leads' AND json_extract(body,'$.importedFrom')=? AND COALESCE(json_extract(body,'$.owner'),'')='' AND json_extract(body,'$.salesmax.owner')<>''").all(FROM)) {
        const lead = JSON.parse(r.body), owner = personOf(lead.salesmax?.owner);
        if (!owner || lead.mergedInto) continue;
        put("leads", { ...lead, owner, importTouch: at, updatedAt: at });
        leads++;
        for (const t of db.prepare("SELECT body FROM records WHERE kind='tasks' AND json_extract(body,'$.leadId')=? AND COALESCE(json_extract(body,'$.owner'),'')=''").all(lead.id)) {
          put("tasks", { ...JSON.parse(t.body), owner, updatedAt: at });
          tasks++;
        }
      }
    });
    return { leads, tasks };
  }
  const leadByKey = (key) => {
    // the "<>''" lets SQLite use the unique phone index, which only holds leads with a number
    const r = db.prepare("SELECT body FROM records WHERE kind='leads' AND json_extract(body,'$.phoneKey')=? AND json_extract(body,'$.phoneKey')<>''").get(key);
    const l = r && JSON.parse(r.body);
    return l?.mergedInto ? get("leads", l.mergedInto) || l : l;
  };

  function contacts(rows, personOf, counts) {
    for (const r of rows) {
      const p = phoneOf(r["MOBILE NUMBER"]);
      if (!p) { counts.skipped++; counts.notes.noPhone = (counts.notes.noPhone || 0) + 1; continue; }
      const stage = stageOf(r["LEAD STAGE"], r["DEAL STAGE"], r["LEAD DISPOSITION"]);
      const info = {
        stage: str(r["LEAD STAGE"], 80), dealStage: str(r["DEAL STAGE"], 80), disposition: str(r["LEAD DISPOSITION"], 80), owner: str(r["LEAD OWNER"], 80),
        state: str(r.STATE, 80), area: str(r.AREA, 120), address: str(r.ADDRESS, 400), country: str(r.COUNTRY, 60), zipcode: str(r.ZIPCODE, 20), designation: str(r.DESIGNATION, 120),
        tags: str(r.TAGS, 300), leadType: str(r["LEAD TYPE"], 80), priority: str(r["LEAD PRIORITY"], 40), source2: str(r["SOURCE - LEVEL 2"], 120), source3: str(r["SOURCE - LEVEL 3"], 120),
        lastRemark: str(r["LAST USER REMARK"], 1000), query: str(r["QUERY TYPE"] || r["QUERY CAT"], 200), summary: str(r["SUMMERY"], 2000), otherPhones: p.others.join(", "), isCustomer: str(r["IS CUSTOMER"], 10),
      };
      const created = istToIso(r.CREATED) || new Date().toISOString(), updated = istToIso(r["LAST UPDATED"]) || created;
      const old = leadByKey(p.phoneKey);
      let lead;
      if (old) {
        // someone already works this lead here: fill what is empty, never change who owns it or where it stands
        lead = { ...old };
        for (const [k, v] of [["company", str(r.BUSINESS, 200)], ["email", /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.EMAIL || "") ? str(r.EMAIL, 200) : ""], ["city", str(r.CITY, 200)]]) if (!lead[k] && v) lead[k] = v;
        // leads that reached TeleCRM through an Excel upload carry the upload's day and "Excel" as source: Salesmax knows the real ones
        if (istToIso(r.CREATED) && (!lead.createdAt || istToIso(r.CREATED) < lead.createdAt)) lead.createdAt = istToIso(r.CREATED);
        if (str(r["LEAD SOURCE"]) && (!lead.source || /^(excel|telecrm)$/i.test(lead.source))) lead.source = sourceOf(r["LEAD SOURCE"]);
        lead.salesmax = info;
        Object.assign(lead, withRegion(lead, { state: info.state }) || {});
        if (JSON.stringify(old) === JSON.stringify(lead)) { counts.skipped++; continue; }
        // workflows see this change as the import's, not a person's (see workflows.mjs)
        lead.importTouch = lead.updatedAt = new Date().toISOString();
        counts.updated++;
      } else {
        lead = {
          id: "smx-" + p.phoneKey, name: str(r["LEAD NAME"], 200) || p.phone, company: str(r.BUSINESS, 200), phone: p.phone, countryCode: p.countryCode, mobileNumber: p.mobileNumber, phoneKey: p.phoneKey,
          email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.EMAIL || "") ? str(r.EMAIL, 200) : "", source: sourceOf(r["LEAD SOURCE"]), city: str(r.CITY, 200), value: 0,
          owner: personOf(r["LEAD OWNER"]), list: "", ...stage, archived: false, repeat: norm(r["LEAD STAGE"]) === "return customer" || Number(r["TIMES RE-ENGAGED"]) > 0,
          firstTouchAt: istToIso(r["STARTED WORK ON"]) || null, createdAt: created, updatedAt: updated, importedFrom: FROM, salesmax: info,
        };
        Object.assign(lead, withRegion(lead, { state: info.state }) || {});
        counts.created++;
      }
      put("leads", lead);
      // the export has only the last remark of each lead ("LAST NOTE" is just when it was written); it goes on the timeline once
      const raw = str(r["LAST USER REMARK"], 4000), note = raw.replace(/<br\s*\/?>/gi, "\n");
      if (note) {
        const id = "smx-n-" + hash(p.phoneKey, raw); // from the text as exported, so an import made before this cleaning is not repeated
        if (!get("activities", id)) {
          const at = istToIso(r["LAST NOTE"]) || istToIso(r["LAST WORKED"]) || updated;
          put("activities", { id, leadId: lead.id, type: "Note", text: note, userId: personOf(r["LAST NOTE BY"]), occurredAt: at, createdAt: at, updatedAt: at, source: "Salesmax", importedFrom: FROM });
        }
      }
    }
  }

  function deals(rows, personOf, counts) {
    for (const r of rows) {
      const p = phoneOf(r["LEAD NUMBER"]), lead = p && leadByKey(p.phoneKey);
      if (!lead) { counts.skipped++; counts.notes.noLead = (counts.notes.noLead || 0) + 1; continue; }
      const id = "smx-d-" + hash(p.phoneKey, r["DEAL NAME"], r["CREATED AT"]);
      if (get("deals", id)) { counts.skipped++; continue; }
      const created = istToIso(r["CREATED AT"]) || new Date().toISOString(), moved = istToIso(r["DEAL STAGE UPDATED AT"] || r["UPDATED AT"]) || created;
      put("deals", {
        id, leadId: lead.id, title: str(r["DEAL NAME"], 300) || "Deal", owner: personOf(r["DEAL OWNER"]), value: Number(String(r["DEAL AMOUNT"] || "").replace(/[^\d.]/g, "")) || 0,
        stage: dealStageOf(r["DEAL STAGE"]), closeDate: moved.slice(0, 10), lostReason: str(r["LOST REASON"], 300), description: str(r["DEAL DESCRIPTION"], 1000), salesmaxStage: str(r["DEAL STAGE"], 80),
        createdAt: created, updatedAt: moved, source: "Salesmax", importedFrom: FROM,
      });
      counts.created++;
    }
  }

  function tasks(rows, personOf, counts) {
    for (const r of rows) {
      const p = phoneOf(r["CONTACT NUMBER"]), lead = p && leadByKey(p.phoneKey);
      if (!lead) { counts.skipped++; counts.notes.noLead = (counts.notes.noLead || 0) + 1; continue; }
      const id = "smx-t-" + (str(r["TASK ID"], 60) || hash(p.phoneKey, r["CREATED AT"], r["TASK TYPE"]));
      if (get("tasks", id)) { counts.skipped++; continue; }
      const created = istToIso(r["CREATED AT"]) || new Date().toISOString(), due = istToIso(r["DUE DATE"]) || created, done = /^completed$/i.test(r.STATUS || "");
      const kind = /DEAL_FOLLOW_UP/i.test(r["TASK TYPE"]) ? "Deal follow-up" : "Follow-up", note = str(r["INPUT NOTE"], 300);
      put("tasks", {
        id, leadId: lead.id, title: note ? `${kind}: ${note}` : kind, owner: personOf(r["TASK OWNER"]) || lead.owner || "", due, status: done ? "Done" : "Open",
        result: done ? [/^success$/i.test(r["COMPLETION TYPE"] || "") ? "Done" : "Not done", str(r["COMPLETION NOTE"], 500)].filter(Boolean).join(": ") : "",
        createdAt: created, updatedAt: istToIso(r["UPDATED AT"]) || created, origin: "Salesmax", importedFrom: FROM,
      });
      counts.created++;
    }
  }

  function activities(rows, personOf, counts) {
    const byLead = new Map(); // calls already on each lead, read once per batch
    const callsOf = (leadId) => {
      if (!byLead.has(leadId)) byLead.set(leadId, db.prepare("SELECT body FROM records WHERE kind='activities' AND json_extract(body,'$.leadId')=? AND json_extract(body,'$.type')='Call'").all(leadId).map((x) => JSON.parse(x.body)));
      return byLead.get(leadId);
    };
    for (const r of rows) {
      const type = str(r["ACTIVITY TYPE"], 60).toUpperCase();
      if (SKIP.has(type)) { counts.skipped++; counts.notes.repeats = (counts.notes.repeats || 0) + 1; continue; }
      const p = phoneOf(r["CONTACT NUMBER"]), lead = p && leadByKey(p.phoneKey);
      if (!lead) { counts.skipped++; counts.notes.noLead = (counts.notes.noLead || 0) + 1; continue; }
      const desc = str(r.DESCRIPTION, 2000), when = istToIso(r["ACTIVITY TIME"]) || new Date().toISOString();
      const id = "smx-a-" + hash(p.phoneKey, r["ACTIVITY TIME"], type, desc);
      if (get("activities", id)) { counts.skipped++; continue; }
      const base = { id, leadId: lead.id, userId: personOf(r["ACTIVITY BY"]), occurredAt: when, createdAt: when, updatedAt: when, source: "Salesmax", importedFrom: FROM, salesmaxType: type };
      const call = type === "CALL_LOGGED" ? callOf(desc) : null;
      if (call) {
        const t = Date.parse(call.at), mine = callsOf(lead.id);
        if (mine.some((c) => c.direction === call.direction && Math.abs(Date.parse(c.occurredAt || c.createdAt) - t) <= 120000)) { counts.skipped++; counts.notes.callsAlreadyHere = (counts.notes.callsAlreadyHere || 0) + 1; continue; }
        const rec = { ...base, type: "Call", direction: call.direction, duration: call.duration, outcome: call.outcome, occurredAt: call.at, createdAt: call.at, updatedAt: call.at, text: `${call.direction} call · ${call.duration}s` };
        put("activities", rec);
        mine.push(rec);
      } else if (type === "VISIT_LOGGED") put("activities", { ...base, type: "Visit", text: desc || "Visit" });
      else put("activities", { ...base, type: "System", text: desc || type.replace(/_/g, " ").toLowerCase() });
      counts.created++;
    }
  }

  const KINDS = { contacts, deals, tasks, activities };
  // one batch of rows of one file; returns what happened to them
  function importBatch(kind, rows) {
    if (!KINDS[kind]) fail("Unknown export file");
    if (!Array.isArray(rows) || rows.length > MAX_ROWS) fail(`Send at most ${MAX_ROWS} rows at a time`);
    prepare();
    const counts = { created: 0, updated: 0, skipped: 0, notes: {} };
    const personOf = people();
    tx(() => KINDS[kind](rows.filter((r) => r && typeof r === "object"), personOf, counts));
    return counts;
  }
  // Closes the open follow-ups brought in from Salesmax that were due before `before`. Each is closed as of its own due
  // date, so none of them shows up as "done today"; no workflow runs and nothing is written to the lead's timeline.
  function closeOld(before) {
    const cut = Date.parse(before);
    if (!Number.isFinite(cut)) fail("Invalid date");
    const stamp = new Date().toISOString();
    let closed = 0;
    tx(() => {
      for (const r of db.prepare("SELECT body FROM records WHERE kind='tasks' AND json_extract(body,'$.origin')='Salesmax' AND json_extract(body,'$.status')<>'Done'").all()) {
        const t = JSON.parse(r.body);
        if (!(Date.parse(t.due) < cut)) continue;
        put("tasks", { ...t, status: "Done", completedAt: t.due, result: t.result || "Closed: old Salesmax follow-up", updatedAt: stamp });
        closed++;
      }
    });
    return { closed };
  }
  return { importBatch, closeOld, fixOwners };
}
