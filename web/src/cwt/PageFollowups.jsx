import React, { useEffect, useMemo, useRef, useState } from "react";
import { crmGet, crmSend } from "../api.js";
import { useCrm } from "../crm.jsx";
import { useToast } from "../toast.jsx";
import { avClass, initials } from "../format.js";
import { TIcon } from "./icons.jsx";
import LeadPanel from "./LeadDetail.jsx";
import { DAY, addDays, dayStart, dayText, mondayOf, monthStart, telOf, timeText } from "./PageUtil.js";
import DateTimePicker from "../DateTimePicker.jsx";
import AiTasks from "./AiTasks.jsx";

// Follow Ups: open follow-ups in three columns (Late, Today, Upcoming), narrowed by a date filter and, for owners, by staff.

const PRESETS = [["all", "All open"], ["today", "Today"], ["tomorrow", "Tomorrow"], ["week", "This week"], ["next7", "Next 7 days"]];
function presetRange(key) {
  const t0 = dayStart(Date.now());
  if (key === "today") return [t0, addDays(t0, 1)];
  if (key === "tomorrow") return [addDays(t0, 1), addDays(t0, 2)];
  if (key === "week") { const mon = mondayOf(t0); return [mon, addDays(mon, 7)]; }
  if (key === "next7") return [t0, addDays(t0, 7)];
  return null;
}
const dueOf = (t) => Date.parse(t.due);

// What the time chip on a card says: "since yesterday 11:00 AM", "4:00 PM", "Tomorrow 10:00 AM", "Thu 10:00 AM".
function whenText(col, due) {
  const t0 = dayStart(Date.now());
  if (col === "late") {
    if (due >= t0) return `since ${timeText(due)}`;
    if (due >= addDays(t0, -1)) return `since yesterday ${timeText(due)}`;
    return `since ${dayText(due)}`;
  }
  if (col === "today") return timeText(due);
  if (due < addDays(t0, 2)) return `Tomorrow ${timeText(due)}`;
  if (due < addDays(t0, 7)) return `${new Date(due).toLocaleDateString("en-US", { weekday: "short" })} ${timeText(due)}`;
  return `${dayText(due)}, ${timeText(due)}`;
}

// ---------------------------------------------------------------- the date picker
const WEEK = ["S", "M", "T", "W", "T", "F", "S"];
function DatePop({ initial, countIn, onApply, onClear, onClose }) {
  const box = useRef(null);
  const [mode, setMode] = useState(initial && initial.to - initial.from <= DAY ? "single" : "range");
  const [from, setFrom] = useState(initial ? initial.from : null);
  const [to, setTo] = useState(initial ? addDays(initial.to, -1) : null); // the last day, inclusive
  const [month, setMonth] = useState(() => monthStart(initial ? initial.from : Date.now()));
  useEffect(() => {
    const down = (e) => { if (box.current && !box.current.contains(e.target) && !e.target.closest?.(".fu-datechip")) onClose(); };
    const key = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [onClose]);
  function pick(day) {
    if (mode === "single") { setFrom(day); setTo(day); return; }
    if (from != null && to == null) { if (day < from) { setTo(from); setFrom(day); } else setTo(day); return; }
    setFrom(day);
    setTo(null);
  }
  const t0 = dayStart(Date.now());
  const first = new Date(month);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = [...Array(first.getDay()).fill(null), ...Array.from({ length: days }, (_, i) => new Date(first.getFullYear(), first.getMonth(), i + 1).getTime())];
  const end = to ?? from;
  const n = from != null ? countIn(from, addDays(end, 1)) : 0;
  const shift = (k) => setMonth(new Date(first.getFullYear(), first.getMonth() + k, 1).getTime());
  return (
    <div className="fu-pop" role="dialog" aria-label="Pick dates" ref={box}>
      <div className="fu-modes">
        <button type="button" className={`r-chip ${mode === "range" ? "on" : ""}`} aria-pressed={mode === "range"} onClick={() => setMode("range")}>Date range</button>
        <button type="button" className={`r-chip ${mode === "single" ? "on" : ""}`} aria-pressed={mode === "single"} onClick={() => { setMode("single"); if (from != null) setTo(from); }}>Single day</button>
      </div>
      <div className="fu-month">
        <button type="button" aria-label="Previous month" onClick={() => shift(-1)}><TIcon name="chevronLeft" /></button>
        <b>{first.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</b>
        <button type="button" aria-label="Next month" onClick={() => shift(1)}><TIcon name="chevronRight" /></button>
      </div>
      <div className="fu-cal">
        {WEEK.map((d, i) => <b key={i}>{d}</b>)}
        {cells.map((d, i) => {
          if (d == null) return <span key={`x${i}`} />;
          const cls = [
            d < t0 ? "mut" : "",
            d === t0 ? "tdy" : "",
            d === from ? "s" : "",
            end != null && d === end ? "e" : "",
            from != null && end != null && d > from && d < end ? "in" : "",
          ].filter(Boolean).join(" ");
          return <button key={d} type="button" className={cls} aria-pressed={from != null && end != null && d >= from && d <= end} aria-label={new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })} onClick={() => pick(d)}>{new Date(d).getDate()}</button>;
        })}
      </div>
      <div className="fu-fromto">
        {mode === "range" ? (
          <>
            <div className="fu-tm"><span>From</span>{from != null ? dayText(from) : "Pick a day"}</div>
            <div className="fu-tm"><span>To</span>{end != null ? dayText(end) : "Pick a day"}</div>
          </>
        ) : <div className="fu-tm"><span>Day</span>{from != null ? dayText(from) : "Pick a day"}</div>}
      </div>
      <div className="fu-popacts">
        <button type="button" className="r-btn ghost" onClick={onClear}>Clear</button>
        <button type="button" className="r-btn" disabled={from == null} onClick={() => onApply({ from, to: addDays(end, 1) })}>Show {n} follow-up{n === 1 ? "" : "s"}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- new follow-up
const localInput = (t) => { const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
function NewFollowup({ onClose }) {
  const crm = useCrm();
  const notify = useToast();
  const [find, setFind] = useState("");
  const [leadId, setLeadId] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(() => { const d = new Date(Date.now() + 3600000); d.setMinutes(0, 0, 0); return localInput(d.getTime()); });
  const [busy, setBusy] = useState(false);
  useEffect(() => { const key = (e) => e.key === "Escape" && onClose(); document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key); }, [onClose]);
  const q = find.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  const matches = crm.leads.filter((l) => !l.archived && (!q || `${l.name} ${l.company || ""}`.toLowerCase().includes(q) || (digits.length >= 3 && String(l.phone || "").replace(/\D/g, "").includes(digits)))).slice(0, 8);
  const lead = crm.leadById.get(leadId);
  async function save(e) {
    e.preventDefault();
    if (!lead) return notify("Choose a lead first");
    const at = Date.parse(due);
    if (!Number.isFinite(at)) return notify("Choose a date and time");
    setBusy(true);
    try {
      await crmSend("POST", "tasks", { leadId, title: title.trim() || `Call ${lead.name}`, due: new Date(at).toISOString(), status: "Open", owner: lead.owner || crm.me.id || "" });
      await crm.reload();
      notify("Follow up added");
      onClose();
    } catch (err) {
      notify(err.message);
      setBusy(false);
    }
  }
  return (
    <>
      <div className="r-scrim" onClick={onClose} />
      <form className="r-dialog" role="dialog" aria-modal="true" aria-label="New follow-up" onSubmit={save}>
        <h2>New follow-up</h2>
        {lead ? (
          <div className="fu-picked"><span className={`av ${avClass(lead.name)}`}>{initials(lead.name)}</span><b>{lead.name}</b><button type="button" className="r-link" onClick={() => setLeadId("")}>Change</button></div>
        ) : (
          <div className="fu-find">
            <label className="r-field"><span>Lead</span><input type="search" placeholder="Name, company or number" value={find} onChange={(e) => setFind(e.target.value)} autoFocus /></label>
            <div className="fu-matches" role="listbox" aria-label="Leads">
              {matches.map((l) => <button key={l.id} type="button" role="option" aria-selected="false" onClick={() => setLeadId(l.id)}><span className={`av ${avClass(l.name)}`}>{initials(l.name)}</span><b>{l.name}</b><span>{[l.company, l.city].filter(Boolean).join(" · ")}</span></button>)}
              {!matches.length && <p className="r-empty">No leads match.</p>}
            </div>
          </div>
        )}
        <label className="r-field"><span>What to do</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={lead ? `Call ${lead.name}` : "For example: send the price list"} maxLength={300} /></label>
        <label className="r-field"><span>When</span><DateTimePicker value={due} onChange={setDue} ariaLabel="When" required /></label>
        <div className="r-dialog-acts"><button type="button" className="r-btn ghost" onClick={onClose}>Cancel</button><button type="submit" className="r-btn" disabled={busy || !lead}>Add follow-up</button></div>
      </form>
    </>
  );
}

// ---------------------------------------------------------------- the page
export default function CwtFollowups() {
  const crm = useCrm();
  const notify = useToast();
  const [filter, setFilter] = useState({ key: "all" });
  const [pop, setPop] = useState(false);
  // whose follow-ups: the person signed in by default; "" is all staff, picked from the staff menu
  const [staff, setAssignee] = useState(null);
  const assignee = staff ?? (crm.me?.lead ? crm.me.id || "" : ""); // callers have no staff menu and see what they may see
  const [showDone, setShowDone] = useState(false);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState("");
  const [busy, setBusy] = useState("");
  // the page shows the planned follow-ups, or the AI tasks (what to do next, picked up from calls and leads)
  const [view, setView] = useState(() => (/[?&]view=ai\b/.test(location.hash) ? "ai" : "followups"));
  const [aiCount, setAiCount] = useState(null);
  // refresh: read follow-ups (and the AI tasks) again from the CRM without reloading the page
  const [tick, setTick] = useState(0);
  const [spin, setSpin] = useState(false);
  const refresh = () => { setSpin(true); setTick((t) => t + 1); Promise.resolve(crm.reload()).finally(() => setTimeout(() => setSpin(false), 400)); };
  useEffect(() => { if (view === "followups") crmGet("ai-tasks").then((d) => setAiCount(d.items.length)).catch(() => {}); }, [view, tick]);

  const range = filter.key === "custom" ? [filter.from, filter.to] : presetRange(filter.key);
  const mine = useMemo(() => (crm.state ? crm.tasks.filter((t) => !assignee || t.owner === assignee) : []), [crm.state, crm.tasks, assignee]);
  const groups = useMemo(() => {
    const g = { late: [], today: [], upcoming: [], doneToday: [], done: [] };
    const now = Date.now(), t0 = dayStart(now), t1 = addDays(t0, 1);
    const inRange = (d) => !range || (d >= range[0] && d < range[1]);
    const coversToday = !range || (range[0] < t1 && range[1] > t0);
    for (const t of mine) {
      const due = dueOf(t);
      if (t.status === "Done") {
        if (showDone) { if (inRange(due)) g.done.push(t); }
        else if (coversToday && dayStart(Date.parse(t.completedAt || t.updatedAt || "") || 0) === t0) g.doneToday.push(t);
        continue;
      }
      if (!inRange(due)) continue;
      if (due < now) g.late.push(t); else if (due < t1) g.today.push(t); else g.upcoming.push(t);
    }
    for (const k of ["late", "today", "upcoming"]) g[k].sort((a, b) => dueOf(a) - dueOf(b));
    g.done.sort((a, b) => dueOf(b) - dueOf(a));
    return g;
  }, [mine, range?.[0], range?.[1], showDone]);

  if (!crm.state) return <p className="muted">{crm.error || "Loading follow ups…"}</p>;

  const open = mine.filter((t) => t.status !== "Done");
  const lateCount = open.filter((t) => dueOf(t) < Date.now()).length;
  const countIn = (from, to) => open.filter((t) => { const d = dueOf(t); return d >= from && d < to; }).length;
  const nameOf = (id) => crm.users.get(id)?.name || "";
  const team = crm.me.lead ? crm.me.users || [] : [];
  const picked = team.find((u) => u.id === assignee);
  const chipLabel = filter.key === "custom" ? (filter.to - filter.from <= DAY ? dayText(filter.from) : `${dayText(filter.from)} – ${dayText(addDays(filter.to, -1))}`) : "Pick dates";

  async function mark(t, status) {
    if (status === "Done" && !window.confirm(`Mark "${t.title}" as done?`)) return;
    setBusy(t.id);
    try { await crmSend("PATCH", `tasks/${t.id}`, { status }); await crm.reload(); notify(status === "Done" ? "Follow up marked done" : "Follow up reopened"); } catch (e) { notify(e.message); } finally { setBusy(""); }
  }

  function card(t, col) {
    const l = crm.leadById.get(t.leadId);
    const owner = nameOf(t.owner);
    const tel = l ? telOf(l.phone) : "";
    if (t.status === "Done") {
      const doneAt = Date.parse(t.completedAt || t.updatedAt || "");
      return (
        <div className="fu-task done">
          <div className="fu-top">
            <button type="button" className="fu-tick on" disabled={busy === t.id} aria-label={`Reopen ${t.title}`} title="Reopen" onClick={() => mark(t, "Open")}><TIcon name="check" /></button>
            <div className="fu-text">
              <p className="fu-title">{t.title}</p>
              <p className="fu-sub">{l ? <button type="button" className="fu-lead" onClick={() => setOpenId(l.id)}>{l.name}</button> : "No lead"}{Number.isFinite(doneAt) ? ` · done ${dayStart(doneAt) === dayStart(Date.now()) ? timeText(doneAt) : dayText(doneAt)}` : ""}</p>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className={`fu-task ${col}`}>
        <div className="fu-top">
          <button type="button" className="fu-tick" disabled={busy === t.id} aria-label={`Mark ${t.title} as done`} title="Mark done" onClick={() => mark(t, "Done")} />
          <div className="fu-text">
            <p className="fu-title">{t.title}</p>
            <p className="fu-sub">{l ? <button type="button" className="fu-lead" onClick={() => setOpenId(l.id)}>{l.name}</button> : "No lead"}{l?.city ? ` · ${l.city}` : ""}</p>
          </div>
        </div>
        <div className="fu-foot">
          <span className={`fu-when ${col}`}>{whenText(col, dueOf(t))}</span>
          <span className="fu-gap" />
          {crm.me.lead && owner && <span className={`av fu-av ${avClass(owner)}`} title={owner} aria-label={`Assigned to ${owner}`}>{initials(owner)}</span>}
          {tel && <a className="fu-call" href={tel} aria-label={`Call ${l.name}`}><TIcon name="phone" />Call</a>}
        </div>
      </div>
    );
  }

  const COLS = [
    ["late", "Late", groups.late, "Nothing late."],
    ["today", "Today", groups.today, "Nothing left for today."],
    ["upcoming", "Upcoming", groups.upcoming, "Nothing coming up."],
    ...(showDone ? [["done", "Done", groups.done, "No follow-ups done in these dates."]] : []),
  ];
  return (
    <div className="r-page r-follow">
      <div className="r-head">
        <div className="r-title">
          <h1>Follow Ups</h1>
          <p>{open.length} open · {lateCount} late<button type="button" className={`lv-ref fu-ref ${spin ? "spin" : ""}`} onClick={refresh} disabled={spin} aria-label="Refresh follow-ups" title="Refresh"><TIcon name="refresh" /></button></p>
        </div>
        <button type="button" className="r-btn lg" onClick={() => setCreating(true)}><TIcon name="plus" />New follow-up</button>
      </div>

      <div className="ait-switch" role="tablist" aria-label="Follow-ups or AI tasks">
        <button type="button" role="tab" aria-selected={view === "followups"} className={view === "followups" ? "on" : ""} onClick={() => setView("followups")}>Follow-ups <em>{open.length}</em></button>
        <button type="button" role="tab" aria-selected={view === "ai"} className={view === "ai" ? "on" : ""} onClick={() => setView("ai")}><TIcon name="sparkle" />AI tasks {aiCount != null && <em className="ai">{aiCount}</em>}</button>
        <span className="fu-gap" />
        {view === "ai" && team.length > 0 && (
          <label className="r-chip r-select fu-staff">
            <span className={`av fu-av ${picked ? avClass(picked.name) : "all"}`} aria-hidden="true">{picked ? initials(picked.name) : <TIcon name="user" />}</span>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Staff">
              <option value="">All staff</option>
              {!team.some((u) => u.id === crm.me.id) && <option value={crm.me.id}>{crm.me.name || "Me"}</option>}
              {team.map((u) => <option key={u.id} value={u.id}>{u.id === crm.me.id ? `${u.name} (me)` : u.name}</option>)}
            </select>
            <TIcon name="chevronDown" />
          </label>
        )}
      </div>

      {view === "ai" ? <AiTasks key={tick} assignee={assignee} onOpenLead={setOpenId} onCount={setAiCount} /> : <>
      <div className="fu-filters">
        {PRESETS.map(([k, label]) => <button key={k} type="button" className={`r-chip ${filter.key === k ? "on" : ""}`} aria-pressed={filter.key === k} onClick={() => { setFilter({ key: k }); setPop(false); }}>{label}</button>)}
        <span className="fu-datewrap">
          <button type="button" className={`r-chip fu-datechip ${filter.key === "custom" ? "on" : ""}`} aria-expanded={pop} aria-haspopup="dialog" onClick={() => setPop((v) => !v)}>
            <TIcon name="calendar" />{chipLabel}<TIcon name="chevronDown" />
          </button>
          {pop && (
            <DatePop
              initial={filter.key === "custom" ? filter : null}
              countIn={countIn}
              onApply={(r) => { setFilter({ key: "custom", ...r }); setPop(false); }}
              onClear={() => { setFilter({ key: "all" }); setPop(false); }}
              onClose={() => setPop(false)}
            />
          )}
        </span>
        <button type="button" className={`r-chip ${showDone ? "on" : ""}`} aria-pressed={showDone} onClick={() => setShowDone((v) => !v)}>Show done</button>
        <span className="fu-gap" />
        {team.length > 0 && (
          <label className="r-chip r-select fu-staff">
            <span className={`av fu-av ${picked ? avClass(picked.name) : "all"}`} aria-hidden="true">{picked ? initials(picked.name) : <TIcon name="user" />}</span>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Staff">
              <option value="">All staff</option>
              {!team.some((u) => u.id === crm.me.id) && <option value={crm.me.id}>{crm.me.name || "Me"}</option>}
              {team.map((u) => <option key={u.id} value={u.id}>{u.id === crm.me.id ? `${u.name} (me)` : u.name}</option>)}
            </select>
            <TIcon name="chevronDown" />
          </label>
        )}
      </div>

      <div className="fu-cols">
        {COLS.map(([k, label, list, empty]) => (
          <section key={k} className={`fu-col ${k}`} aria-label={label}>
            <div className="fu-colh">{label} <em>{list.length}</em></div>
            {list.slice(0, 100).map((t) => <React.Fragment key={t.id}>{card(t, k)}</React.Fragment>)}
            {list.length > 100 && <p className="fu-more">{list.length - 100} more. Narrow the dates to see them.</p>}
            {k === "today" && groups.doneToday.map((t) => <React.Fragment key={t.id}>{card(t, "today")}</React.Fragment>)}
            {!list.length && !(k === "today" && groups.doneToday.length) && <p className="fu-none">{empty}</p>}
          </section>
        ))}
      </div>
      </>}
      {creating && <NewFollowup onClose={() => setCreating(false)} />}
      {openId && <LeadPanel id={openId} onClose={() => setOpenId("")} />}
    </div>
  );
}
