import { parseLeadCsv } from "./csv.js";
import { summarizeReport } from "./reports.js";
import { applyLeadView } from "./lead-views.js";
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const money = (n) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n || 0);
const date = (s) =>
  s ? new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const today = () => new Date().toLocaleDateString("en-CA");
const sameDay = (s) => s && new Date(s).toLocaleDateString("en-CA") === today();
const initials = (s) =>
  String(s || "?")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
const sum = (a, key) => a.reduce((v, x) => v + Number(x[key] || 0), 0);
let state,
  view = "dashboard",
  query = "",
  stage = "",
  owner = "",
  source = "",
  queue = "",
  page = 1,
  scope = "",
  leadViewId = "",
  leadLayout = "list",
  sortKey = "createdAt",
  sortDir = "desc",
  selected = new Set(),
  detailId;
const titles = {
  dashboard: "Dashboard",
  leads: "Active leads",
  archived: "Already worked leads",
  businesses: "Businesses",
  lists: "Lead lists",
  import: "Bulk add leads",
  distribution: "Lead distribution",
  engagements: "All engagements",
  calls: "Calls",
  messages: "Messages",
  visits: "Visits",
  tasks: "To do",
  deals: "Deals",
  payments: "Payments",
  reports: "Activity metrics",
  team: "User leads",
  sources: "Source reports",
  activities: "Activity feed",
  products: "Products & inventory",
  integrations: "Integrations",
  exports: "Data exports",
  inbox: "Lead inbox",
  teamInbox: "Team inbox",
  mailbox: "Mailbox",
  tickets: "Support tickets",
  campaigns: "Campaigns",
  rules: "Automatic distribution",
  documents: "Documents",
  attendance: "Attendance",
  customReports: "Custom reports",
  featureStatus: "Feature status",
  autoReplies: "Auto reply drafts",
};
const groups = [
  [
    "Workspace",
    [
      ["dashboard", "◫"],
      ["products", "▦"],
    ],
  ],
  [
    "Leads",
    [
      ["leads", "▤"],
      ["archived", "▣"],
      ["businesses", "▥"],
      ["lists", "☷"],
      ["import", "↥"],
      ["distribution", "⇄"],
    ],
  ],
  [
    "Engagements",
    [
      ["engagements", "◉"],
      ["calls", "↗"],
      ["messages", "▢"],
      ["visits", "⌖"],
      ["tasks", "☑"],
    ],
  ],
  [
    "Opportunities",
    [
      ["deals", "◇"],
      ["payments", "₹"],
    ],
  ],
  [
    "Metrics",
    [
      ["reports", "▥"],
      ["team", "♧"],
      ["sources", "◴"],
      ["activities", "≋"],
    ],
  ],
  [
    "Workspace tools",
    [
      ["integrations", "⊞"],
      ["exports", "↓"],
    ],
  ],
];
groups.push([
  "Collaboration",
  [
    ["inbox", "▢"],
    ["teamInbox", "♧"],
    ["mailbox", "✉"],
    ["tickets", "☷"],
    ["campaigns", "◉"],
    ["autoReplies", "↩"],
    ["rules", "⇄"],
    ["documents", "▤"],
    ["attendance", "◷"],
    ["customReports", "▥"],
    ["featureStatus", "ⓘ"],
  ],
]);
$("#nav").innerHTML = groups
  .map(
    ([label, links]) =>
      `<div class="group">${label}</div>${links.map(([key, icon]) => `<a href="#${key}" data-nav="${key}"><span>${icon}</span>${titles[key]}</a>`).join("")}`,
  )
  .join("");
$("#today").textContent = new Date().toLocaleDateString("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
$("#menu").onclick = () => document.body.classList.toggle("nav-open");
let toastTimer;
function toast(text, error = false) {
  $("#toast").hidden = false;
  $("#toast").textContent = text;
  $("#toast").className = error ? "error" : "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 4500);
}
async function api(path, method = "GET", body) {
  const r = await fetch("/api/" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const v = await r.json();
  if (!r.ok) throw Error(v.error || "Request failed");
  return v;
}
async function refresh() {
  state = await api("state");
  render();
}
async function change(kind, id, body) {
  await api(kind + (id ? "/" + id : ""), id ? "PATCH" : "POST", body);
  await refresh();
  toast("Saved successfully");
}
const user = (id) => state.users.find((x) => x.id === id)?.name || "Unassigned";
const lead = (id) => state.leads.find((x) => x.id === id);
const leadName = (id) => lead(id)?.name || "No linked lead";
const openTasks = () => state.tasks.filter((t) => t.status !== "Done");
const leadTasks = (id) =>
  openTasks()
    .filter((t) => t.leadId === id)
    .sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
const scoped = (a) => (scope ? a.filter((x) => x.owner === scope) : a);
function opts(values, value = "", blank) {
  return (
    (blank ? `<option value="">${esc(blank)}</option>` : "") +
    values
      .map((x) => {
        const [v, n] = Array.isArray(x) ? x : [x, x];
        return `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(n)}</option>`;
      })
      .join("")
  );
}
const ownerOptions = (value = "", blank = "Unassigned") =>
  opts(
    state.users.map((u) => [u.id, u.name]),
    value,
    blank,
  );
const leadOptions = (value = "", blank = "No linked lead") =>
  opts(
    state.leads.filter((l) => !l.archived).map((l) => [l.id, l.name + " · " + l.company]),
    value,
    blank,
  );
const pill = (s) =>
  `<span class="pill ${esc(
    String(s)
      .toLowerCase()
      .replace(/[^a-z]/g, ""),
  )}">${esc(s)}</span>`;
const leadButton = (id) =>
  id
    ? `<button class="name-btn" data-lead="${esc(id)}">${esc(leadName(id))}</button>`
    : '<span class="muted">No linked lead</span>';
const panel = (title, body, extra = "") =>
  `<section class="panel"><div class="panel-head"><h2>${title}</h2>${extra}</div>${body}</section>`;
const table = (headers, rows) =>
  `<div class="table-scroll"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>${rows.length ? "" : '<div class="empty">Nothing here yet. Add a record to get started.</div>'}</div>`;
const stats = (items) =>
  `<div class="stats">${items.map(([name, value, sub, icon]) => `<div class="stat"><span class="label">${name}</span><span class="symbol">${icon || "◫"}</span><strong>${value}</strong><small>${sub || "Current workspace"}</small></div>`).join("")}</div>`;
function heading(title, description, actions = "") {
  return `<div class="heading"><div><h1>${title}</h1><p>${description}</p></div><div class="row">${actions}</div></div>`;
}
function render() {
  if (!state) return;
  $("#breadcrumb").textContent = titles[view] || "Dashboard";
  document
    .querySelectorAll("[data-nav]")
    .forEach((a) => a.classList.toggle("active", a.dataset.nav === view));
  const base = heading(
    titles[view],
    "Every lead. Every conversation. One shared view.",
    '<button class="primary" data-action="add-lead">＋ Add lead</button>',
  );
  $("#heading").innerHTML = base;
  const screens = {
    dashboard: dashboard,
    leads: leadsPage,
    archived: leadsPage,
    businesses: businesses,
    lists: listsPage,
    import: importPage,
    distribution: distribution,
    engagements: engagements,
    calls: engagements,
    messages: engagements,
    visits: engagements,
    tasks: tasksPage,
    deals: dealsPage,
    payments: paymentsPage,
    reports: reports,
    team: teamPage,
    sources: sourcesPage,
    activities: engagements,
    products: productsPage,
    integrations: integrations,
    exports: exportsPage,
    inbox: collaborationPage,
    teamInbox: collaborationPage,
    mailbox: collaborationPage,
    tickets: collaborationPage,
    campaigns: collaborationPage,
    rules: collaborationPage,
    documents: collaborationPage,
    attendance: collaborationPage,
    customReports: collaborationPage,
    featureStatus: collaborationPage,
    autoReplies: collaborationPage,
  };
  $("#content").innerHTML = (screens[view] || dashboard)();
}
function queueLeads(key, list = state.leads.filter((l) => !l.archived)) {
  const tasks = openTasks();
  return list.filter((l) => {
    const ts = tasks.filter((t) => t.leadId === l.id);
    return (
      !key ||
      {
        new: l.stage === "New",
        assigned: !l.firstTouchAt,
        repeat: l.repeat,
        today: ts.some((t) => sameDay(t.due)),
        overdue: ts.some((t) => Date.parse(t.due) < Date.now()),
        closed: l.stage === "Closed",
        missed: state.activities.some(
          (a) =>
            a.leadId === l.id &&
            a.type === "Call" &&
            a.direction === "Incoming" &&
            a.outcome === "No answer",
        ),
      }[key]
    );
  });
}
function dashboard() {
  const ls = scoped(state.leads.filter((l) => !l.archived)),
    ts = scoped(openTasks()),
    calls = state.activities.filter(
      (a) => a.type === "Call" && (!scope || lead(a.leadId)?.owner === scope),
    ),
    connected = calls.filter((a) => a.outcome !== "No answer");
  const ds = scoped(state.deals);
  $("#heading").innerHTML = heading(
    "Your sales day, at a glance.",
    "A little clarity. A lot more momentum.",
    `<select id="scope" aria-label="Dashboard owner scope">${ownerOptions(scope, "All team members")}</select><button class="primary" data-action="add-lead">＋ Add lead</button>`,
  );
  const cards = [
    ["new", "↥", "New leads", "New enquiries waiting to move"],
    ["assigned", "⇄", "Awaiting first touch", "Owned leads with no activity yet"],
    ["repeat", "⟳", "Repeat enquiries", "Returning interest to follow up"],
    ["today", "◷", "Follow-ups today", "Scheduled conversations for today"],
    ["overdue", "!", "Overdue follow-ups", "Next actions past their due time"],
    ["missed", "↙", "Missed incoming calls", "Manually recorded missed calls"],
    ["closed", "✓", "Closed leads", "Won, lost, and closed enquiries"],
    ["tasks", "☑", "Ad-hoc tasks", "Work outside a lead record"],
  ];
  const queuePanel = panel(
    "Work pipeline",
    `<div class="queue-grid">${cards
      .map(([key, icon, title, sub]) => {
        const count =
          key === "tasks" ? ts.filter((t) => !t.leadId).length : queueLeads(key, ls).length;
        return `<button class="queue ${key === "overdue" ? "warning" : ""}" data-queue="${key}"><span class="qicon">${icon}</span><span class="arrow">↗</span><strong>${count}</strong><b>${title}</b><small>${sub}</small></button>`;
      })
      .join("")}</div>`,
    `<span class="muted">${scope ? "Selected owner" : "All team"} · live workspace</span>`,
  );
  const metrics = [
    ["Calls logged", calls.length],
    ["Connected calls", connected.length],
    ["Outgoing calls", calls.filter((a) => a.direction === "Outgoing").length],
    ["Incoming calls", calls.filter((a) => a.direction === "Incoming").length],
    [
      "Total call duration",
      Math.floor(sum(calls, "duration") / 60) + "m " + (sum(calls, "duration") % 60) + "s",
    ],
    [
      "Notes added",
      state.activities.filter(
        (a) => a.type === "Note" && (!scope || lead(a.leadId)?.owner === scope),
      ).length,
    ],
  ];
  return (
    stats([
      ["New leads", ls.filter((l) => l.stage === "New").length, "Awaiting their next step", "↥"],
      [
        "Prospecting",
        ls.filter((l) => l.stage === "Prospecting").length,
        "Conversations in progress",
        "◉",
      ],
      [
        "Opportunities",
        ls.filter((l) => l.stage === "Opportunity").length,
        "Qualified sales enquiries",
        "◇",
      ],
      [
        "Revenue won",
        money(
          sum(
            ds.filter((d) => d.stage === "Won"),
            "value",
          ),
        ),
        "From won deals",
        "₹",
      ],
    ]) +
    queuePanel +
    `<div class="columns-2">${panel(
      "Overall activities",
      table(
        ["Metric", "Total"],
        metrics.map(([k, n]) => `<tr><td>${k}</td><td><b>${n}</b></td></tr>`),
      ),
    )}${panel("Recent activity", `<div class="panel-body">${activityFeed(state.activities.filter((a) => !scope || lead(a.leadId)?.owner === scope).slice(0, 5))}</div>`, `<a href="#activities">View all →</a>`)}</div><div class="columns-2">${panel("Where leads came from", `<div class="panel-body">${bars(ls, "source")}</div>`, `<a href="#sources">Source report →</a>`)}${panel("Who got them", `<div class="panel-body">${state.users.map((u) => bar(u.name, ls.filter((l) => l.owner === u.id).length, Math.max(ls.length, 1))).join("")}</div>`, `<a href="#distribution">Distribute →</a>`)}</div>`
  );
}
function bar(name, value, total) {
  return `<div class="bar-row"><span>${esc(name || "Unknown")}</span><progress value="${value}" max="${Math.max(1, total)}" aria-label="${esc(name)} lead share">${value}</progress><b>${value}</b></div>`;
}
function bars(list, key) {
  const groups = Object.groupBy(list, (l) => l[key] || "Unknown");
  return (
    Object.entries(groups)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([name, items]) => bar(name, items.length, list.length))
      .join("") || '<div class="empty">No records yet</div>'
  );
}
function filters() {
  return `<div class="toolbar"><input id="search" placeholder="Search name, company, phone or email…" aria-label="Search leads" value="${esc(query)}"><select id="stage" aria-label="Filter stage">${opts(["New", "Prospecting", "Opportunity", "Closed"], stage, "All stages")}</select><select id="owner" aria-label="Filter owner">${ownerOptions(owner, "All owners")}</select><select id="source" aria-label="Filter source">${opts([...new Set(state.leads.map((l) => l.source).filter(Boolean))], source, "All sources")}</select>${queue ? `<button data-action="clear-queue">${esc(queue)} ×</button>` : ""}</div>`;
}
function filtered() {
  let ls = state.leads.filter((l) => Boolean(l.archived) === (view === "archived"));
  if (queue) ls = queueLeads(queue, ls);
  return applyLeadView(ls, {
    query,
    stage,
    owner,
    source,
    sortKey,
    sortDir,
    archived: view === "archived",
  });
}
function leadsPage() {
  const ls = filtered(),
    pages = Math.max(1, Math.ceil(ls.length / 10));
  page = Math.min(page, pages);
  const rows = ls.slice((page - 1) * 10, page * 10);
  $("#heading").innerHTML = heading(
    titles[view],
    `${ls.length} leads · organised, assigned, and ready to work.`,
    `<button data-action="bulk-import">↥ Import</button><button data-action="export">↓ Export</button><button class="primary" data-action="add-lead">＋ Add lead</button>`,
  );
  return panel(
    "Lead workspace",
    `<div class="toolbar"><select id="lead-layout" aria-label="Lead layout">${opts(
      [
        ["list", "List"],
        ["board", "Kanban board"],
      ],
      leadLayout,
    )}</select><select id="lead-view" aria-label="Saved lead view">${opts(
      (state.leadViews || [])
        .filter((v) => Boolean(v.archived) === (view === "archived"))
        .map((v) => [v.id, v.name]),
      leadViewId,
      "Custom view",
    )}</select><select id="lead-sort" aria-label="Sort leads">${opts(
      [
        ["createdAt", "Created date"],
        ["name", "Lead name"],
        ["value", "Estimated value"],
      ],
      sortKey,
    )}</select><select id="lead-sort-dir" aria-label="Sort direction">${opts(
      [
        ["desc", "Descending"],
        ["asc", "Ascending"],
      ],
      sortDir,
    )}</select><button data-action="save-lead-view">Save current view</button></div>` +
      filters() +
      (leadLayout === "board"
        ? leadBoard(ls)
        : `<div class="toolbar"><span class="muted">${selected.size} selected</span><button data-action="assign">Assign owner</button><button data-action="archive">${view === "archived" ? "Restore selected" : "Archive selected"}</button><button data-action="clear-selection">Clear selection</button></div>` +
          table(
            [
              '<input type="checkbox" class="checkbox" id="select-all" aria-label="Select visible leads">',
              "Lead name",
              "Lead owner",
              "Lead stage",
              "First touch",
              "Source",
              "Next action",
              "Value",
            ],
            rows.map((l) => {
              const t = leadTasks(l.id)[0];
              return `<tr><td><input class="checkbox" type="checkbox" data-select="${l.id}" aria-label="Select ${esc(l.name)}" ${selected.has(l.id) ? "checked" : ""}></td><td><div class="person"><span class="avatar">${esc(initials(l.name))}</span><div>${leadButton(l.id)}<small>${esc(l.company)} ${l.repeat ? " · Repeat" : ""}</small></div></div></td><td>${esc(user(l.owner))}</td><td>${pill(l.stage)}</td><td>${l.firstTouchAt ? '<span class="green">Worked</span>' : '<span class="overdue">Not worked yet</span>'}</td><td>${esc(l.source)}</td><td><span class="${t && Date.parse(t.due) < Date.now() ? "overdue" : ""}">${t ? esc(date(t.due)) : "Unscheduled"}</span></td><td>${money(l.value)}</td></tr>`;
            }),
          ) +
          `<div class="footer-row"><span>${ls.length ? (page - 1) * 10 + 1 : 0}–${Math.min(page * 10, ls.length)} of ${ls.length} leads</span><div class="row"><button data-action="prev" ${page === 1 ? "disabled" : ""}>←</button> Page ${page} of ${pages} <button data-action="next" ${page === pages ? "disabled" : ""}>→</button></div></div>`),
  );
}
function leadBoard(leads) {
  const stages = ["New", "Prospecting", "Opportunity", "Closed"];
  return `<div class="panel-body"><p class="muted">Same records and filters as the list. Open a card for its activity timeline; use Move to to change its stage.</p><div class="lead-board">${stages
    .map((stageName) => {
      const cards = leads.filter((l) => l.stage === stageName);
      return `<section class="lead-lane" aria-label="${stageName} leads"><h3>${esc(stageName)} <small>${cards.length} · ${money(sum(cards, "value"))}</small></h3>${cards.map((l) => `<article class="lead-card">${leadButton(l.id)}<p>${esc(l.company || "No company")}</p><small>${esc(user(l.owner))} · ${esc(l.source || "No source")}</small><p><b>${money(l.value)}</b></p><label>Move to<select data-board-stage="${esc(l.id)}" aria-label="Move ${esc(l.name)} to stage">${opts(stages, l.stage)}</select></label></article>`).join("") || '<p class="empty">No matching leads</p>'}</section>`;
    })
    .join("")}</div></div>`;
}
function activityFeed(items) {
  return items.length
    ? items
        .map(
          (a) =>
            `<div class="activity-item"><span class="avatar">${{ Call: "↗", Note: "≡", Message: "▢", Visit: "⌖", System: "⟳" }[a.type]}</span><div>${leadButton(a.leadId)}<p>${esc(a.text)}</p><small>${esc(a.type)} · ${date(a.createdAt)}</small></div></div>`,
        )
        .join("")
    : '<div class="empty">No activity to show yet.</div>';
}
function engagements() {
  let items = state.activities;
  const type = { calls: "Call", messages: "Message", visits: "Visit" }[view];
  if (type) items = items.filter((a) => a.type === type);
  if (view === "engagements") items = items.filter((a) => a.type !== "System");
  $("#heading").innerHTML = heading(
    titles[view],
    "A complete history of the work behind each lead.",
    '<button class="primary" data-action="log-activity">＋ Log activity</button>',
  );
  return (
    (type === "Call"
      ? stats([
          ["Calls logged", items.length, "Manual logs", "↗"],
          [
            "Connected",
            items.filter((a) => a.outcome !== "No answer").length,
            "Based on call outcome",
            "✓",
          ],
          ["Duration", Math.floor(sum(items, "duration") / 60) + " min", "Logged duration", "◷"],
          [
            "Missed / no answer",
            items.filter((a) => a.outcome === "No answer").length,
            "Recorded by your team",
            "↙",
          ],
        ])
      : "") +
    panel(
      "Activity history",
      `<div class="panel-body">${type ? '<p class="note">Activity is recorded manually. No calls or messages are sent from this screen.</p>' : ""}${activityFeed(items)}</div>`,
    )
  );
}
function tasksPage() {
  const ts = state.tasks;
  $("#heading").innerHTML = heading(
    "Your work, in order.",
    "From a promised callback to the next big conversation.",
    '<button class="primary" data-action="add-task">＋ Add task</button>',
  );
  return (
    stats([
      ["Open tasks", ts.filter((t) => t.status === "Open").length],
      ["In progress", ts.filter((t) => t.status === "In progress").length],
      ["Overdue", openTasks().filter((t) => Date.parse(t.due) < Date.now()).length],
      ["Completed", ts.filter((t) => t.status === "Done").length],
    ]) +
    `<div class="pipeline tasks">${["Open", "In progress", "Done"]
      .map(
        (s) =>
          `<div class="lane"><div class="lane-head"><b>${s}</b><span>${ts.filter((t) => t.status === s).length}</span></div>${
            ts
              .filter((t) => t.status === s)
              .map(
                (t) =>
                  `<article class="deal-card"><h3>${esc(t.title)}</h3>${t.leadId ? leadButton(t.leadId) : '<span class="pill">Ad-hoc</span>'}<p class="${s !== "Done" && Date.parse(t.due) < Date.now() ? "overdue" : ""}">${date(t.due)}</p><div class="card-bottom"><span>${esc(user(t.owner))}</span><button class="link" data-edit-task="${t.id}">Edit</button></div><select aria-label="Task status for ${esc(t.title)}" data-task-status="${t.id}">${opts(["Open", "In progress", "Done"], s)}</select></article>`,
              )
              .join("") || '<div class="empty">No tasks</div>'
          }</div>`,
      )
      .join("")}</div>`
  );
}
function dealsPage() {
  const ds = state.deals;
  $("#heading").innerHTML = heading(
    "Every opportunity, in view.",
    "Move your deals from a first conversation to a confident close.",
    '<button class="primary" data-action="add-deal">＋ Add deal</button>',
  );
  return (
    stats([
      [
        "Open pipeline",
        money(
          sum(
            ds.filter((d) => !["Won", "Lost"].includes(d.stage)),
            "value",
          ),
        ),
      ],
      ["Active deals", ds.filter((d) => !["Won", "Lost"].includes(d.stage)).length],
      [
        "Won revenue",
        money(
          sum(
            ds.filter((d) => d.stage === "Won"),
            "value",
          ),
        ),
      ],
      ["Payments received", money(sum(state.payments, "amount"))],
    ]) +
    `<div class="pipeline">${["Qualified", "Proposal", "Negotiation", "Won", "Lost"]
      .map(
        (s) =>
          `<div class="lane"><div class="lane-head"><b>${s}</b><span>${ds.filter((d) => d.stage === s).length}</span></div>${
            ds
              .filter((d) => d.stage === s)
              .map(
                (d) =>
                  `<article class="deal-card"><h3>${esc(d.title)}</h3>${leadButton(d.leadId)}<strong>${money(d.value)}</strong><p>Expected close · ${esc(d.closeDate)}</p><div class="card-bottom"><span>${esc(user(d.owner))}</span><button class="link" data-edit-deal="${d.id}">Edit</button></div><select aria-label="Stage for ${esc(d.title)}" data-deal-status="${d.id}">${opts(["Qualified", "Proposal", "Negotiation", "Won", "Lost"], s)}</select></article>`,
              )
              .join("") || '<div class="empty">No deals</div>'
          }</div>`,
      )
      .join("")}</div>`
  );
}
function paymentsPage() {
  $("#heading").innerHTML = heading(
    "Payments",
    "Track collections against the deals you close.",
    '<button class="primary" data-action="add-payment">＋ Record payment</button>',
  );
  return (
    stats([
      ["Total recorded", money(sum(state.payments, "amount"))],
      ["Payment records", state.payments.length],
      [
        "Won deal value",
        money(
          sum(
            state.deals.filter((d) => d.stage === "Won"),
            "value",
          ),
        ),
      ],
      ["Deals with payments", new Set(state.payments.map((p) => p.dealId)).size],
    ]) +
    panel(
      "Payment ledger",
      table(
        ["Deal", "Lead", "Amount", "Reference", "Recorded"],
        state.payments.map((p) => {
          const d = state.deals.find((d) => d.id === p.dealId);
          return `<tr><td>${esc(d?.title)}</td><td>${leadButton(d?.leadId)}</td><td>${money(p.amount)}</td><td>${esc(p.reference) || "—"}</td><td>${date(p.createdAt)}</td></tr>`;
        }),
      ),
    )
  );
}
function teamPage() {
  $("#heading").innerHTML = heading(
    "User-wise lead position",
    "See who owns the work, and how it is moving.",
    '<button class="primary" data-action="add-user">＋ Add team member</button>',
  );
  return (
    panel(
      "Team overview",
      table(
        ["Team member", "New", "Prospecting", "Opportunity", "Closed", "Overdue", "Won revenue"],
        state.users.map((u) => {
          const ls = state.leads.filter((l) => l.owner === u.id && !l.archived);
          return `<tr><td><div class="person"><span class="avatar">${esc(initials(u.name))}</span><div><b>${esc(u.name)}</b><small>${esc(u.role)}</small></div></div></td>${["New", "Prospecting", "Opportunity", "Closed"].map((s) => `<td>${ls.filter((l) => l.stage === s).length}</td>`).join("")}<td class="overdue">${openTasks().filter((t) => t.owner === u.id && Date.parse(t.due) < Date.now()).length}</td><td>${money(
            sum(
              state.deals.filter((d) => d.owner === u.id && d.stage === "Won"),
              "value",
            ),
          )}</td></tr>`;
        }),
      ),
    ) +
    '<div class="info-box">Team members represent assignment and reporting records in this local version. Roles do not grant login access or enforce permissions.</div>'
  );
}
function sourcesPage() {
  const sources = [...new Set(state.leads.map((l) => l.source || "Unknown"))];
  return (
    panel(
      "Lead source performance",
      table(
        ["Source", "Leads", "Awaiting first touch", "Opportunities", "Won deals", "Won revenue"],
        sources.map((s) => {
          const ls = state.leads.filter((l) => (l.source || "Unknown") === s),
            ids = new Set(ls.map((l) => l.id)),
            ds = state.deals.filter((d) => ids.has(d.leadId) && d.stage === "Won");
          return `<tr><td>${esc(s)}</td><td>${ls.length}</td><td>${ls.filter((l) => !l.firstTouchAt).length}</td><td>${ls.filter((l) => l.stage === "Opportunity").length}</td><td>${ds.length}</td><td>${money(sum(ds, "value"))}</td></tr>`;
        }),
      ),
    ) + panel("Source mix", `<div class="panel-body">${bars(state.leads, "source")}</div>`)
  );
}
function reports() {
  return (
    panel(
      "Activity by team member",
      table(
        ["Team member", "Calls", "Connected", "Duration", "Notes", "Visits", "Open tasks"],
        state.users.map((u) => {
          const ids = new Set(state.leads.filter((l) => l.owner === u.id).map((l) => l.id)),
            as = state.activities.filter((a) => ids.has(a.leadId)),
            cs = as.filter((a) => a.type === "Call");
          return `<tr><td>${esc(u.name)}</td><td>${cs.length}</td><td>${cs.filter((c) => c.outcome !== "No answer").length}</td><td>${Math.floor(sum(cs, "duration") / 60)}m</td><td>${as.filter((a) => a.type === "Note").length}</td><td>${as.filter((a) => a.type === "Visit").length}</td><td>${openTasks().filter((t) => t.owner === u.id).length}</td></tr>`;
        }),
      ),
    ) +
    '<div class="info-box">Activity totals are grouped by the lead’s current owner. They describe manually logged work, not independently verified phone records.</div>'
  );
}
function productsPage() {
  $("#heading").innerHTML = heading(
    "Products & inventory",
    "Your catalogue, pricing, and available stock.",
    '<button class="primary" data-action="add-product">＋ Add product</button>',
  );
  return panel(
    "Product catalogue",
    table(
      ["Product", "SKU", "Unit price", "Stock", ""],
      state.products.map(
        (p) =>
          `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.sku)}</td><td>${money(p.price)}</td><td>${p.stock}</td><td><button data-edit-product="${p.id}">Edit</button></td></tr>`,
      ),
    ),
  );
}
function businesses() {
  const companies = Object.groupBy(state.leads, (l) => l.company || "Individual");
  return panel(
    "Business directory",
    table(
      ["Business", "Contacts", "Opportunity value", "Contacts"],
      Object.entries(companies).map(
        ([name, ls]) =>
          `<tr><td><b>${esc(name)}</b><small>${esc(ls[0].city)}</small></td><td>${ls.length}</td><td>${money(
            sum(
              ls.filter((l) => l.stage === "Opportunity"),
              "value",
            ),
          )}</td><td>${ls.map((l) => leadButton(l.id)).join(" · ")}</td></tr>`,
      ),
    ),
  );
}
function listsPage() {
  $("#heading").innerHTML = heading(
    "Lead lists",
    "Keep campaigns and customer groups organised.",
    '<button class="primary" data-action="add-list">＋ Create list</button>',
  );
  return (
    panel(
      "Lists",
      table(
        ["List name", "Leads", "Created"],
        state.lists.map(
          (l) =>
            `<tr><td><b>${esc(l.name)}</b></td><td>${state.leads.filter((x) => x.list === l.id).length}</td><td>${date(l.createdAt)}</td></tr>`,
        ),
      ),
    ) + '<div class="info-box">Assign a lead to a list from its Details tab.</div>'
  );
}
function importPage() {
  return panel(
    "Bulk import",
    `<div class="panel-body"><p class="note">Paste or load up to 500 leads as CSV or a JSON array. Phone duplicates are skipped. All records are validated before saving. Loading a file does not import it.</p><form id="import-form"><label>Format<select name="format"><option value="csv">CSV</option><option value="json">JSON array</option></select></label><label>Load a local file<input id="import-file" type="file" accept=".csv,.json,text/csv,application/json"></label><p id="import-filename" aria-live="polite">No file selected</p><label>Lead records<textarea name="records" rows="12" required placeholder="name,company,phone,source,value"></textarea></label><label>Assign imported leads to<select name="owner">${ownerOptions()}</select></label><div class="actions"><button type="button" data-module="csv-template">Download CSV template</button><button class="primary">Validate & import</button></div></form></div>`,
  );
}
function distribution() {
  return (
    panel(
      "Assign unowned leads",
      `<div class="panel-body"><div class="mini-stats"><div><small>Unassigned active leads</small><strong>${state.leads.filter((l) => !l.owner && !l.archived).length}</strong></div><div><small>Active team members</small><strong>${state.users.filter((u) => u.active).length}</strong></div></div><p class="note">Round-robin assignment distributes currently unassigned active leads across the team. This is a manual action; automatic source rules are not connected.</p><button class="primary" data-action="distribute">Distribute unassigned leads</button></div>`,
    ) +
    panel(
      "Current workload",
      `<div class="panel-body">${state.users.map((u) => bar(u.name, state.leads.filter((l) => l.owner === u.id && !l.archived).length, state.leads.length)).join("")}</div>`,
    )
  );
}
function integrations() {
  return (
    '<div class="warning-box">External services are not connected. These are integration requirements, not active features.</div><br><div class="integration-grid">' +
    [
      [
        "WhatsApp Business",
        "Shared inbox, message delivery, templates, and delivery receipts require a Meta Business account and API credentials.",
      ],
      [
        "IndiaMART / TradeIndia",
        "Lead capture needs authorized lead API access and a verified ingestion endpoint.",
      ],
      [
        "Cloud telephony",
        "Automatic dialing, recording and call events require an authorized telephony provider.",
      ],
      [
        "Google / Meta Ads",
        "Lead form ingestion needs account authorization and webhook verification.",
      ],
      [
        "AI assistant",
        "Summaries and qualification require a configured model provider and data handling controls.",
      ],
      [
        "Authentication",
        "Production use needs sign-in, access policies, auditing and isolated team workspaces.",
      ],
      [
        "Twenty CRM",
        "Reference architecture reviewed. Connecting a Twenty workspace needs an API endpoint, authorized credentials and object/field mappings. No sync is active.",
      ],
    ]
      .map(
        ([name, desc]) =>
          `<div class="integration"><h3>${name}</h3><span class="pill closed">Not connected</span><p>${desc}</p></div>`,
      )
      .join("") +
    "</div>"
  );
}
function exportsPage() {
  return panel(
    "Workspace export",
    `<div class="panel-body"><p class="note">Download your current local records. Keep exports private: they may contain contact information and sales history.</p><div class="row"><button class="primary" data-action="export">↓ Export full workspace JSON</button><button data-action="export-csv">↓ Export leads CSV</button></div></div>`,
  );
}

function modal(title, body) {
  $("#modal-content").innerHTML =
    `<div class="modal-head"><h2>${title}</h2><button data-action="close" aria-label="Close dialog">×</button></div><div class="modal-body">${body}</div>`;
  if (!$("#modal").open) $("#modal").showModal();
}
function field(name, label, value = "", type = "text", required = false) {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${required ? "required" : ""} ${type === "number" ? 'min="0" max="1000000000000"' : ""}></label>`;
}
function selectField(name, label, options) {
  return `<label>${label}<select name="${name}">${options}</select></label>`;
}
function form(kind, fields, id = "", title = "Add record") {
  modal(
    title,
    `<form id="record-form" data-kind="${kind}" data-id="${id}"><div class="form-grid">${fields}</div><div class="actions"><button type="button" data-action="close">Cancel</button><button class="primary">Save ${kind === "leads" ? "lead" : "record"}</button></div></form>`,
  );
}
function leadForm(l = {}) {
  form(
    "leads",
    field("name", "Lead name", l.name, "text", true) +
      field("company", "Business / company", l.company) +
      field("phone", "Phone", l.phone, "tel") +
      field("email", "Email", l.email, "email") +
      selectField("owner", "Lead owner", ownerOptions(l.owner)) +
      selectField(
        "stage",
        "Lead stage",
        opts(["New", "Prospecting", "Opportunity", "Closed"], l.stage || "New"),
      ) +
      field("source", "Lead source", l.source || "Manual") +
      field("city", "City", l.city) +
      field("value", "Estimated value (₹)", l.value || 0, "number") +
      selectField(
        "list",
        "List",
        opts(
          state.lists.map((l) => [l.id, l.name]),
          l.list,
          "No list",
        ),
      ) +
      `<label class="inline-check"><input type="checkbox" name="repeat" ${l.repeat ? "checked" : ""}>Repeat enquiry</label>`,
    l.id || "",
    l.id ? "Edit lead" : "Add a new lead",
  );
}
function taskForm(t = {}, leadId = "") {
  form(
    "tasks",
    field("title", "Task / next action", t.title, "text", true) +
      selectField("leadId", "Linked lead", leadOptions(t.leadId || leadId)) +
      selectField("owner", "Task owner", ownerOptions(t.owner || lead(leadId)?.owner)) +
      field("due", "Due date & time", t.due ? localDate(t.due) : "", "datetime-local", true) +
      selectField("status", "Status", opts(["Open", "In progress", "Done"], t.status || "Open")),
    t.id || "",
    t.id ? "Edit task" : "Schedule next action",
  );
}
function localDate(s) {
  const d = new Date(s);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function dealForm(d = {}, leadId = "") {
  form(
    "deals",
    field("title", "Deal title", d.title, "text", true) +
      selectField("leadId", "Lead", leadOptions(d.leadId || leadId, "Select a lead")) +
      field("value", "Deal value (₹)", d.value ?? lead(leadId)?.value ?? 0, "number", true) +
      selectField("owner", "Owner", ownerOptions(d.owner || lead(leadId)?.owner)) +
      selectField(
        "stage",
        "Deal stage",
        opts(["Qualified", "Proposal", "Negotiation", "Won", "Lost"], d.stage || "Qualified"),
      ) +
      field(
        "closeDate",
        "Expected close date",
        d.closeDate || new Date().toISOString().slice(0, 10),
        "date",
        true,
      ),
    d.id || "",
    d.id ? "Edit deal" : "Create opportunity",
  );
}
function activityForm(leadId = "") {
  form(
    "activities",
    selectField("leadId", "Lead", leadOptions(leadId, "Select a lead")) +
      selectField(
        "type",
        "Activity type",
        opts(
          ["Note", "Call", "Message", "Visit"],
          { calls: "Call", messages: "Message", visits: "Visit" }[view] || "Note",
        ),
      ) +
      `<label class="full">Details<textarea name="text" required maxlength="4000"></textarea></label><div class="full note">For call logs, also provide the outcome, direction, and actual duration below. Messages are logs only.</div>` +
      selectField(
        "outcome",
        "Call outcome",
        opts(["Connected", "Interested", "Callback", "No answer", "Not interested"], "Connected"),
      ) +
      selectField("direction", "Call direction", opts(["Outgoing", "Incoming"], "Outgoing")) +
      field("duration", "Call duration (seconds)", 0, "number"),
    "",
    "Log an engagement",
  );
}
function showLead(id, tab = "Timeline") {
  const l = lead(id);
  if (!l) return;
  detailId = id;
  const acts = state.activities.filter((a) => a.leadId === id),
    tasks = state.tasks.filter((t) => t.leadId === id);
  let body = "";
  if (tab === "Timeline")
    body = `<div class="row"><button data-action="lead-activity">＋ Log activity</button><button data-action="lead-task">◷ Schedule follow-up</button></div><div class="timeline">${acts.map((a) => `<div class="event"><b>${esc(a.type)}</b> · ${esc(a.text)}${a.type === "Call" ? `<small>${esc(a.direction)} · ${esc(a.outcome)} · ${a.duration}s</small>` : ""}<small>${date(a.createdAt)}</small></div>`).join("")}</div>`;
  if (tab === "Details")
    body = `<div class="form-grid">${[
      ["Phone", l.phone],
      ["Email", l.email],
      ["City", l.city],
      ["Source", l.source],
      ["Owner", user(l.owner)],
      ["Stage", l.stage],
      ["Estimated value", money(l.value)],
      ["Created", date(l.createdAt)],
      ["List", state.lists.find((x) => x.id === l.list)?.name || "None"],
      ["First touch", date(l.firstTouchAt)],
    ]
      .map(([k, v]) => `<div><small>${k}</small><p>${esc(v) || "—"}</p></div>`)
      .join("")}</div><button data-action="edit-current">Edit lead details</button>`;
  if (tab === "Tasks")
    body = `<button data-action="lead-task">＋ Schedule follow-up</button>${table(
      ["Task", "Due", "Status", ""],
      tasks.map(
        (t) =>
          `<tr><td>${esc(t.title)}</td><td>${date(t.due)}</td><td>${pill(t.status)}</td><td><button data-edit-task="${t.id}">Edit</button></td></tr>`,
      ),
    )}`;
  if (tab === "Deals")
    body = `<button data-action="lead-deal">＋ Create deal</button>${table(
      ["Deal", "Value", "Stage"],
      state.deals
        .filter((d) => d.leadId === id)
        .map(
          (d) =>
            `<tr><td>${esc(d.title)}</td><td>${money(d.value)}</td><td>${pill(d.stage)}</td></tr>`,
        ),
    )}`;
  modal(
    "Lead workspace",
    `<div class="lead-banner"><span class="avatar">${esc(initials(l.name))}</span><div><h2>${esc(l.name)}</h2><span class="muted">${esc(l.company)} · ${esc(user(l.owner))}</span></div></div><div class="split"><div class="row">${pill(l.stage)}${l.repeat ? pill("Repeat enquiry") : ""}</div><span class="muted">${money(l.value)}</span></div><div class="detail-tabs">${["Timeline", "Details", "Tasks", "Deals"].map((t) => `<button data-detail-tab="${t}" class="${t === tab ? "active" : ""}">${t}</button>`).join("")}</div>${body}`,
  );
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function navigate(next) {
  location.hash = next;
}
window.addEventListener("hashchange", () => {
  view = location.hash.slice(1) || "dashboard";
  query = "";
  stage = "";
  owner = queue ? scope : "";
  source = "";
  leadViewId = "";
  sortKey = "createdAt";
  sortDir = "desc";
  page = 1;
  selected.clear();
  document.body.classList.remove("nav-open");
  render();
});
document.querySelectorAll("[data-nav]").forEach((a) =>
  a.addEventListener("click", () => {
    queue = "";
    owner = "";
    if (location.hash === a.getAttribute("href")) render();
  }),
);
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  try {
    if (b.dataset.lead) {
      showLead(b.dataset.lead);
      return;
    }
    if (b.dataset.detailTab) {
      showLead(detailId, b.dataset.detailTab);
      return;
    }
    if (b.dataset.queue) {
      queue = b.dataset.queue;
      if (queue === "tasks") {
        queue = "";
        navigate("tasks");
      } else {
        owner = scope;
        navigate("leads");
      }
      return;
    }
    if (b.dataset.editTask) {
      taskForm(state.tasks.find((t) => t.id === b.dataset.editTask));
      return;
    }
    if (b.dataset.editDeal) {
      dealForm(state.deals.find((d) => d.id === b.dataset.editDeal));
      return;
    }
    if (b.dataset.editProduct) {
      productForm(state.products.find((p) => p.id === b.dataset.editProduct));
      return;
    }
    const a = b.dataset.action;
    if (a === "save-lead-view") {
      if (queue) throw Error("Clear the work-queue filter before saving a view.");
      const definition = {
        query,
        stage,
        owner,
        source,
        sortKey,
        sortDir,
        archived: String(view === "archived"),
      };
      form(
        "leadViews",
        field("name", "View name", "", "text", true) +
          Object.entries(definition)
            .map(([key, value]) => `<input type="hidden" name="${key}" value="${esc(value)}">`)
            .join(""),
        "",
        "Save current lead view",
      );
    }
    if (a === "close") $("#modal").close();
    if (a === "add-lead") leadForm();
    if (a === "add-task") taskForm();
    if (a === "add-deal") dealForm();
    if (a === "log-activity") activityForm();
    if (a === "lead-activity") activityForm(detailId);
    if (a === "lead-task") taskForm({}, detailId);
    if (a === "lead-deal") dealForm({}, detailId);
    if (a === "edit-current") leadForm(lead(detailId));
    if (a === "add-product") productForm();
    if (a === "add-user")
      form(
        "users",
        field("name", "Full name", "", "text", true) +
          selectField("role", "Role", opts(["Sales representative", "Manager"])),
        "",
        "Add team member",
      );
    if (a === "add-list")
      form("lists", field("name", "List name", "", "text", true), "", "Create a lead list");
    if (a === "add-payment")
      form(
        "payments",
        selectField(
          "dealId",
          "Deal",
          opts(
            state.deals.map((d) => [d.id, d.title]),
            "",
            "Select deal",
          ),
        ) +
          field("amount", "Amount (₹)", 0, "number", true) +
          field("reference", "Payment reference"),
        "",
        "Record payment",
      );
    if (a === "prev") {
      page--;
      render();
    }
    if (a === "next") {
      page++;
      render();
    }
    if (a === "clear-queue") {
      queue = "";
      page = 1;
      render();
    }
    if (a === "clear-selection") {
      selected.clear();
      render();
    }
    if (a === "bulk-import") navigate("import");
    if (a === "export")
      download("salesdesk-workspace.json", JSON.stringify(state, null, 2), "application/json");
    if (a === "export-csv") {
      const keys = ["name", "company", "phone", "email", "city", "stage", "source", "value"];
      const safe = (v) => {
        const s = String(v ?? "");
        return '"' + (/^[=+@\-\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""') + '"';
      };
      download(
        "salesdesk-leads.csv",
        [keys.join(","), ...state.leads.map((l) => keys.map((k) => safe(l[k])).join(","))].join(
          "\r\n",
        ),
        "text/csv",
      );
    }
    if (a === "assign") {
      if (!selected.size) {
        toast("Select leads first", true);
        return;
      }
      modal(
        "Assign selected leads",
        `<form id="assign-form"><label>Owner<select name="owner">${ownerOptions()}</select></label><p class="note">Applies to ${selected.size} selected leads.</p><div class="actions"><button class="primary">Assign leads</button></div></form>`,
      );
    }
    if (a === "archive") {
      if (!selected.size) {
        toast("Select leads first", true);
        return;
      }
      for (const id of selected)
        await api("leads/" + id, "PATCH", { archived: view !== "archived" });
      selected.clear();
      await refresh();
      toast("Leads updated");
    }
    if (a === "distribute") {
      const users = state.users.filter((u) => u.active),
        ls = state.leads.filter((l) => !l.owner && !l.archived);
      if (!users.length) throw Error("Add an active team member first");
      for (let i = 0; i < ls.length; i++)
        await api("leads/" + ls[i].id, "PATCH", { owner: users[i % users.length].id });
      await refresh();
      toast(`${ls.length} leads assigned`);
    }
  } catch (err) {
    toast(err.message, true);
  }
});
function productForm(p = {}) {
  form(
    "products",
    field("name", "Product name", p.name, "text", true) +
      field("sku", "SKU", p.sku) +
      field("price", "Unit price (₹)", p.price || 0, "number", true) +
      field("stock", "Stock count", p.stock || 0, "number", true),
    p.id || "",
    p.id ? "Edit product" : "Add product",
  );
}
document.addEventListener("input", (e) => {
  if (e.target.id === "search") {
    const input = e.target,
      pos = input.selectionStart;
    query = input.value;
    leadViewId = "";
    page = 1;
    render();
    $("#search").focus();
    $("#search").setSelectionRange(pos, pos);
  }
});
document.addEventListener("change", async (e) => {
  const el = e.target;
  try {
    if (el.id === "lead-layout") {
      leadLayout = el.value === "board" ? "board" : "list";
      selected.clear();
      render();
    }
    if (el.dataset.boardStage) {
      el.disabled = true;
      try {
        await change("leads", el.dataset.boardStage, { stage: el.value });
      } finally {
        render();
      }
    }
    if (el.id === "lead-view") {
      const saved = (state.leadViews || []).find((v) => v.id === el.value);
      leadViewId = saved?.id || "";
      query = saved?.query || "";
      stage = saved?.stage || "";
      owner = saved?.owner || "";
      source = saved?.source || "";
      sortKey = saved?.sortKey || "createdAt";
      sortDir = saved?.sortDir || "desc";
      queue = "";
      page = 1;
      selected.clear();
      render();
    }
    if (el.id === "lead-sort" || el.id === "lead-sort-dir") {
      if (el.id === "lead-sort") sortKey = el.value;
      else sortDir = el.value;
      leadViewId = "";
      page = 1;
      render();
    }
    if (["stage", "owner", "source"].includes(el.id)) {
      leadViewId = "";
      ({ stage: (v) => (stage = v), owner: (v) => (owner = v), source: (v) => (source = v) })[
        el.id
      ](el.value);
      page = 1;
      render();
    }
    if (el.id === "scope") {
      scope = el.value;
      render();
    }
    if (el.dataset.select) {
      if (el.checked) selected.add(el.dataset.select);
      else selected.delete(el.dataset.select);
      render();
    }
    if (el.id === "select-all") {
      filtered()
        .slice((page - 1) * 10, page * 10)
        .forEach((l) => (el.checked ? selected.add(l.id) : selected.delete(l.id)));
      render();
    }
    if (el.dataset.taskStatus) await change("tasks", el.dataset.taskStatus, { status: el.value });
    if (el.dataset.dealStatus) await change("deals", el.dataset.dealStatus, { stage: el.value });
  } catch (err) {
    toast(err.message, true);
    await refresh();
  }
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target,
    button = f.querySelector('button[type="submit"],button.primary');
  if (button) button.disabled = true;
  try {
    const p = Object.fromEntries(new FormData(f));
    if (f.id === "record-form") {
      for (const k of ["value", "duration", "amount", "price", "stock", "followupHours", "days"])
        if (k in p) p[k] = Number(p[k]);
      if ("enabled" in p) p.enabled = p.enabled === "true";
      if (f.dataset.kind === "teamChannels")
        p.memberIds = Array.from(f.querySelector('[name="memberIds"]').selectedOptions).map(
          (o) => o.value,
        );
      if (f.dataset.kind === "leads") p.repeat = f.elements.repeat.checked;
      if (f.dataset.kind === "leadViews") p.archived = p.archived === "true";
      if (p.due) p.due = new Date(p.due).toISOString();
      await change(f.dataset.kind, f.dataset.id, p);
      $("#modal").close();
    }
    if (f.id === "assign-form") {
      for (const id of selected) await api("leads/" + id, "PATCH", { owner: p.owner });
      selected.clear();
      await refresh();
      $("#modal").close();
      toast("Leads assigned");
    }
    if (f.id === "import-form") {
      let rows;
      try {
        rows = p.format === "csv" ? parseLeadCsv(p.records) : JSON.parse(p.records);
      } catch (error) {
        throw Error(p.format === "csv" ? error.message : "Enter a valid JSON array");
      }
      if (!Array.isArray(rows)) throw Error("Enter a JSON array");
      const r = await api("import", "POST", { leads: rows.map((l) => ({ ...l, owner: p.owner })) });
      await refresh();
      toast(`${r.added} leads imported; ${r.skipped} duplicates skipped`);
    }
  } catch (err) {
    toast(err.message, true);
  } finally {
    if (button) button.disabled = false;
  }
});
let inboxOwner = "",
  ticketQuery = "",
  ticketOwner = "";
let reportDisplay = "Chart",
  reportPreset = "sources";
const reportTemplates = {
  sources: {
    name: "Leads by source · last 7 days",
    entity: "leads",
    groupBy: "source",
    measure: "count",
    days: 7,
  },
  funnel: {
    name: "Active deal funnel · count",
    entity: "deals",
    groupBy: "stage",
    measure: "count",
    days: 0,
    active: true,
  },
  funnelValue: {
    name: "Active deal funnel · value",
    entity: "deals",
    groupBy: "stage",
    measure: "value",
    days: 0,
    active: true,
  },
  calls: {
    name: "Call outcomes · last 7 days",
    entity: "calls",
    groupBy: "outcome",
    measure: "count",
    days: 7,
  },
  payments: {
    name: "Payments by owner · last 30 days",
    entity: "payments",
    groupBy: "owner",
    measure: "value",
    days: 30,
  },
};
function reportRows(r) {
  return summarizeReport(state, r);
}
function reportCard(r, key) {
  const rows = reportRows(r),
    max = Math.max(1, ...rows.map((x) => x[1]));
  const content =
    reportDisplay === "Table"
      ? table(
          [esc(r.groupBy), r.measure === "value" ? "Recorded value" : "Records"],
          rows.map(
            ([k, v]) =>
              `<tr><td>${esc(k)}</td><td>${r.measure === "value" ? money(v) : v}</td></tr>`,
          ),
        )
      : rows.length
        ? rows
            .map(
              ([k, v]) =>
                `<div class="report-bar"><span>${esc(k)}</span><progress max="${max}" value="${v}" aria-label="${esc(k)}: ${v}"></progress><strong>${r.measure === "value" ? money(v) : v}</strong></div>`,
            )
            .join("")
        : '<p class="empty">No recorded data in this period.</p>';
  return panel(
    esc(r.name),
    `<p>Local ${esc(r.entity || "leads")} records · ${r.days ? `last ${r.days} days` : "all time"}</p>${content}${moduleButton("export-report", "Export CSV", key)}`,
  );
}
const ticketStages = [
  "Open",
  "Payment Pending",
  "Service Scheduled",
  "In progress",
  "Spare Paid",
  "Issue Solved",
  "Spare Sent",
  "Closed",
  "Resolved",
];
const records = (kind) => state[kind] || [];
const moduleButton = (action, label, id = "") =>
  `<button data-module="${action}" data-record="${esc(id)}">${esc(label)}</button>`;
function collaborationPage() {
  const add = (kind, label) => `<div class="actions">${moduleButton("new-" + kind, label)}</div>`;
  if (view === "teamInbox")
    return (
      "<p>Internal channel records in this workspace. Staff notifications are not connected.</p>" +
      add("teamChannels", "Create team channel") +
      table(
        ["Channel name", "Last message time", "Last message by", "Last message", "Actions"],
        records("teamChannels").map((c) => {
          const last = records("teamMessages")
            .filter((m) => m.channelId === c.id)
            .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
            .at(-1);
          return `<tr><td>${esc(c.name)}</td><td>${esc(date(last?.createdAt))}</td><td>${last ? esc(user(last.userId)) : "—"}</td><td>${esc(last?.text || "No messages")}</td><td>${moduleButton("team-channel", "Open channel", c.id)}</td></tr>`;
        }),
      )
    );
  if (view === "autoReplies")
    return (
      '<p class="warning-box">Enabled rules create local drafts when the selected event occurs. No messages are delivered.</p>' +
      add("autoReplies", "Create auto reply draft rule") +
      table(
        ["Name", "Event", "Draft text", "Enabled"],
        records("autoReplies").map(
          (r) =>
            `<tr><td>${esc(r.name)}</td><td>${esc(r.trigger)}</td><td>${esc(r.text)}</td><td>${moduleButton("toggle-reply", r.enabled ? "Enabled — disable" : "Disabled — enable", r.id)}</td></tr>`,
        ),
      )
    );
  if (["inbox", "teamInbox", "mailbox"].includes(view)) {
    const conversations = records("conversations").filter(
      (c) =>
        (!inboxOwner || c.owner === inboxOwner) && (view !== "mailbox" || c.channel === "Email"),
    );
    return (
      `<p class="warning-box">Messages are local records and drafts. No email, SMS or WhatsApp delivery is connected.</p><label>Assigned user<select id="inbox-owner">${ownerOptions(inboxOwner, "All users")}</select></label>` +
      add("conversations", "New conversation") +
      stats([
        ["Conversations", conversations.length],
        ["Open", conversations.filter((c) => c.status === "Open").length],
        ["Resolved", conversations.filter((c) => c.status === "Resolved").length],
      ]) +
      table(
        ["Subject", "Lead", "Channel", "Owner", "Status", "Actions"],
        conversations.map(
          (c) =>
            `<tr><td>${esc(c.subject)}</td><td>${leadButton(c.leadId)}</td><td>${esc(c.channel)}</td><td>${esc(user(c.owner))}</td><td>${pill(c.status)}</td><td>${moduleButton("conversation", "Open", c.id)}</td></tr>`,
        ),
      )
    );
  }
  if (view === "tickets") {
    const tickets = records("tickets").filter(
      (t) =>
        (!ticketOwner || t.owner === ticketOwner) &&
        `${t.subject} ${t.description} ${t.category} ${leadName(t.leadId)}`
          .toLowerCase()
          .includes(ticketQuery.toLowerCase()),
    );
    return (
      add("tickets", "Create ticket") +
      `<div class="row"><label>Search tickets<input id="ticket-search" value="${esc(ticketQuery)}" placeholder="Subject, description, category or contact"></label><label>Assignee<select id="ticket-owner">${ownerOptions(ticketOwner, "All users")}</select></label></div><div class="ticket-board">` +
      ticketStages
        .map(
          (status) =>
            `<section class="panel ticket-column"><h2>${esc(status)} (${tickets.filter((t) => t.status === status).length})</h2>${
              tickets
                .filter((t) => t.status === status)
                .map(
                  (t) =>
                    `<article class="message-record"><h3>${esc(t.subject)}</h3><p>${esc(t.description)}</p><p>${esc(t.category || "Service")} · ${esc(t.priority)}</p><p>${leadButton(t.leadId)} · ${esc(user(t.owner))}</p>${moduleButton("ticket", "Update ticket", t.id)}</article>`,
                )
                .join("") || '<p class="empty">No tickets</p>'
            }</section>`,
        )
        .join("") +
      "</div>"
    );
  }
  if (view === "campaigns")
    return (
      `<p class="warning-box">Preparation creates local message drafts only. Nothing is sent.</p>` +
      add("campaigns", "Create campaign") +
      table(
        ["Campaign", "Status", "Actions"],
        records("campaigns").map(
          (c) =>
            `<tr><td>${esc(c.name)}</td><td>${pill(c.status)}</td><td>${moduleButton("prepare", "Prepare local drafts", c.id)}</td></tr>`,
        ),
      )
    );
  if (view === "rules")
    return (
      `<p>Rules assign unowned leads matching an exact source. Run explicitly to apply enabled rules.</p>` +
      add("automationRules", "Create rule") +
      moduleButton("run-rules", "Run enabled rules") +
      table(
        ["Name", "Source", "Assigned owner", "Follow-up hours", "Enabled"],
        records("automationRules").map(
          (r) =>
            `<tr><td>${esc(r.name)}</td><td>${esc(r.source)}</td><td>${esc(user(r.owner))}</td><td>${esc(r.followupHours)}</td><td>${moduleButton("toggle-rule", r.enabled ? "Enabled — disable" : "Disabled — enable", r.id)}</td></tr>`,
        ),
      )
    );
  if (view === "documents")
    return (
      `<p>Attach plain text documents up to 100 KB. Downloads preserve the recorded text.</p>` +
      add("documents", "Attach text document") +
      table(
        ["Name", "Lead", "Actions"],
        records("documents").map(
          (d) =>
            `<tr><td>${esc(d.name)}</td><td>${leadButton(d.leadId)}</td><td>${moduleButton("document", "Preview", d.id)} <a href="/api/documents/${encodeURIComponent(d.id)}/download">Download</a></td></tr>`,
        ),
      )
    );
  if (view === "attendance")
    return (
      `<p>Manual attendance records. Location tracking is not connected.</p>` +
      add("attendance", "Check in") +
      table(
        ["User", "Date", "Check in", "Check out", "Actions"],
        records("attendance").map(
          (a) =>
            `<tr><td>${esc(user(a.userId))}</td><td>${esc(a.date)}</td><td>${esc(date(a.checkIn))}</td><td>${esc(date(a.checkOut))}</td><td>${a.checkOut ? "Complete" : moduleButton("checkout", "Check out", a.id)}</td></tr>`,
        ),
      )
    );
  if (view === "customReports")
    return (
      `<p>Chart library based on recorded local data. Date windows use record creation dates.</p><div class="row"><label>Chart library<select id="report-preset">${opts(
        Object.entries(reportTemplates).map(([k, r]) => [k, r.name]),
        reportPreset,
      )}</select></label><label>Display<select id="report-display">${opts(["Chart", "Table"], reportDisplay)}</select></label></div>` +
      add("savedReports", "Save custom report") +
      reportCard(reportTemplates[reportPreset], "preset") +
      records("savedReports")
        .map((r) => reportCard(r, r.id))
        .join("")
    );
  return panel(
    "Feature availability",
    table(
      ["Feature", "Status"],
      [
        ["Lead, deal, task, product and payment records", "Available locally"],
        ["Inboxes, tickets, document text and attendance", "Available locally"],
        [
          "Campaign preparation and source assignment rules",
          "Local drafts and explicit rule execution",
        ],
        ["Calling, WhatsApp, SMS and email delivery", "Provider connection required"],
        ["Authentication, shared workspaces and permissions", "Not connected"],
        ["AI summaries, transcription, GPS and external integrations", "Not connected"],
      ].map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`),
    ),
  );
}
const textField = (name, label, value = "") =>
  `<label class="full">${esc(label)}<textarea name="${name}" required maxlength="100000">${esc(value)}</textarea></label>`;
function moduleForm(kind, record = {}) {
  let fields = "";
  const linked = selectField("leadId", "Lead", leadOptions(record.leadId));
  const assigned = selectField("owner", "Owner", ownerOptions(record.owner));
  if (kind === "teamChannels")
    fields =
      field("name", "Channel name", "", "text", true) +
      textField("description", "Description") +
      `<label>Members<select name="memberIds" multiple required>${opts(state.users.map((u) => [u.id, u.name]))}</select><small>Select channel participants.</small></label>`;
  if (kind === "autoReplies")
    fields =
      field("name", "Rule name", "", "text", true) +
      selectField(
        "trigger",
        "Event",
        opts([
          "Lead created",
          "Lead assigned",
          "Repeat enquiry",
          "Lead closed",
          "Call outcome",
          "Missed call",
          "Visit recorded",
          "Task created",
          "Task completed",
          "Deal stage changed",
          "Payment received",
          "Conversation opened",
          "Conversation resolved",
        ]),
      ) +
      textField("text", "Local draft text") +
      '<input type="hidden" name="enabled" value="false">';
  if (kind === "conversations")
    fields =
      field("subject", "Subject", "", "text", true) +
      linked +
      assigned +
      selectField("channel", "Channel", opts(["WhatsApp", "Email", "SMS"])) +
      '<input type="hidden" name="status" value="Open">';
  if (kind === "tickets")
    fields =
      field("subject", "Subject", record.subject, "text", true) +
      linked +
      assigned +
      textField("description", "Description", record.description) +
      field("category", "Category", record.category || "Service", "text", true) +
      selectField(
        "priority",
        "Priority",
        opts(["Low", "Normal", "High", "Urgent"], record.priority || "Normal"),
      ) +
      selectField("status", "Status", opts(ticketStages, record.status || "Open"));
  if (kind === "campaigns")
    fields =
      field("name", "Name", "", "text", true) +
      selectField("listId", "Lead list", opts(records("lists").map((l) => [l.id, l.name]))) +
      textField("text", "Draft message") +
      '<input type="hidden" name="status" value="Draft">';
  if (kind === "automationRules")
    fields =
      field("name", "Name", "", "text", true) +
      field("source", "Exact lead source", "", "text", true) +
      assigned +
      field("followupHours", "Follow-up delay in hours (0 disables)", 24, "number") +
      '<input type="hidden" name="enabled" value="true">';
  if (kind === "documents")
    fields =
      linked +
      field("name", "Filename", "note.txt", "text", true) +
      textField("content", "Plain text content") +
      '<input type="hidden" name="mime" value="text/plain">';
  if (kind === "attendance")
    fields =
      selectField("userId", "User", opts(state.users.map((u) => [u.id, u.name]))) +
      field("date", "Date", today(), "date", true) +
      `<input type="hidden" name="checkIn" value="${new Date().toISOString()}">`;
  if (kind === "savedReports")
    fields =
      field("name", "Report name", "", "text", true) +
      selectField("entity", "Records", opts(["leads", "deals", "calls", "payments"])) +
      selectField("measure", "Measure", opts(["count", "value"])) +
      field("days", "Creation window in days (0 = all time)", 0, "number") +
      selectField(
        "groupBy",
        "Group by",
        opts(["source", "owner", "stage", "direction", "outcome"]),
      ) +
      selectField(
        "stage",
        "Linked lead stage",
        opts(["New", "Prospecting", "Opportunity", "Closed"], "", "All stages"),
      );
  const labels = {
    teamChannels: "team channel",
    autoReplies: "reply draft rule",
    conversations: "conversation",
    tickets: "ticket",
    campaigns: "campaign",
    automationRules: "distribution rule",
    documents: "text document",
    attendance: "attendance record",
    savedReports: "custom report",
  };
  form(
    kind,
    fields,
    record.id || "",
    (record.id ? "Update " : "Add ") + (labels[kind] || "record"),
  );
}
document.addEventListener("change", (e) => {
  if (
    e.target.name === "entity" &&
    e.target.closest("#record-form")?.dataset.kind === "savedReports"
  ) {
    const form = e.target.closest("form"),
      isCalls = e.target.value === "calls";
    form.elements.groupBy.innerHTML = opts(
      isCalls ? ["source", "owner", "stage", "direction", "outcome"] : ["source", "owner", "stage"],
    );
    form.elements.measure.innerHTML = opts(isCalls ? ["count"] : ["count", "value"]);
  }
  if (e.target.id === "report-preset") {
    reportPreset = e.target.value;
    render();
  }
  if (e.target.id === "report-display") {
    reportDisplay = e.target.value;
    render();
  }
  if (e.target.id === "inbox-owner") {
    inboxOwner = e.target.value;
    render();
  }
  if (e.target.id === "ticket-owner") {
    ticketOwner = e.target.value;
    render();
  }
});
document.addEventListener("change", async (e) => {
  if (e.target.id !== "import-file") return;
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 1048576) throw Error("Choose a file no larger than 1 MiB");
    const content = await file.text(),
      f = $("#import-form");
    f.elements.records.value = content;
    f.elements.format.value = file.name.toLowerCase().endsWith(".json") ? "json" : "csv";
    $("#import-filename").textContent =
      `${file.name} loaded locally. Click Validate & import to save.`;
  } catch (error) {
    toast(error.message, true);
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "ticket-search") {
    const position = e.target.selectionStart;
    ticketQuery = e.target.value;
    render();
    const input = $("#ticket-search");
    input.focus();
    input.setSelectionRange(position, position);
  }
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-module]");
  if (!b) return;
  const action = b.dataset.module,
    id = b.dataset.record;
  try {
    if (action === "export-report") {
      const r =
        id === "preset"
          ? reportTemplates[reportPreset]
          : records("savedReports").find((r) => r.id === id);
      const csvCell = (value) =>
        '"' +
        String(value)
          .replace(/^[=+@\-\t\r]/, "'$&")
          .replaceAll('"', '""') +
        '"';
      download(
        "report.csv",
        [["Group", "Value"], ...reportRows(r)]
          .map((row) => row.map(csvCell).join(","))
          .join("\r\n"),
        "text/csv;charset=utf-8",
      );
    }
    if (action === "csv-template")
      download(
        "lead-import-template.csv",
        "name,company,phone,email,source,stage,value\nSample contact,Example business,+919000001234,sample@example.com,Website,New,10000\n",
        "text/csv;charset=utf-8",
      );
    if (action.startsWith("new-")) moduleForm(action.slice(4));
    if (action === "team-channel") {
      const c = records("teamChannels").find((c) => c.id === id);
      modal(
        c.name,
        `<p>${esc(c.description)}</p><p>Local channel history. No notifications are sent.</p>` +
          records("teamMessages")
            .filter((m) => m.channelId === id)
            .map(
              (m) =>
                `<article class="message-record"><strong>${esc(user(m.userId))} · ${esc(date(m.createdAt))}</strong><p>${esc(m.text)}</p></article>`,
            )
            .join("") +
          moduleButton("team-message", "Record team message", id),
      );
    }
    if (action === "team-message") {
      const c = records("teamChannels").find((c) => c.id === id);
      form(
        "teamMessages",
        `<input type="hidden" name="channelId" value="${esc(id)}">` +
          selectField(
            "userId",
            "Recorded author",
            opts(state.users.filter((u) => c.memberIds.includes(u.id)).map((u) => [u.id, u.name])),
          ) +
          textField("text", "Message (local record)"),
        "",
        "Record channel message",
      );
    }
    if (action === "ticket")
      moduleForm(
        "tickets",
        records("tickets").find((t) => t.id === id),
      );
    if (action === "prepare") {
      await api(`campaigns/${id}/prepare`, "POST", {});
      await refresh();
      toast("Local drafts prepared; no messages sent");
    }
    if (action === "run-rules") {
      await api("rules/run", "POST", {});
      await refresh();
      toast("Enabled rules applied");
    }
    if (action === "toggle-rule")
      await change("automationRules", id, {
        enabled: !records("automationRules").find((r) => r.id === id).enabled,
      });
    if (action === "toggle-reply")
      await change("autoReplies", id, {
        enabled: !records("autoReplies").find((r) => r.id === id).enabled,
      });
    if (action === "checkout")
      await change("attendance", id, { checkOut: new Date().toISOString() });
    if (action === "document") {
      const d = records("documents").find((d) => d.id === id);
      modal(d.name, `<pre class="document-preview">${esc(d.content)}</pre>`);
    }
    if (action === "resolve") {
      await change("conversations", id, { status: "Resolved" });
      $("#modal").close();
    }
    if (action === "conversation") {
      const c = records("conversations").find((c) => c.id === id);
      modal(
        c.subject,
        `<p>Local records only. No delivery is connected.</p>` +
          records("messages")
            .filter((m) => m.conversationId === id)
            .map(
              (m) =>
                `<article class="message-record"><strong>${esc(m.direction)} · ${esc(m.status)}</strong><p>${esc(m.text)}</p></article>`,
            )
            .join("") +
          moduleButton("record-incoming", "Record received message", id) +
          moduleButton("draft-message", "Compose local draft", id) +
          moduleButton("resolve", "Resolve conversation", id),
      );
    }
    if (["record-incoming", "draft-message"].includes(action))
      form(
        "messages",
        `<input type="hidden" name="conversationId" value="${esc(id)}"><input type="hidden" name="direction" value="${action === "record-incoming" ? "Incoming" : "Outgoing"}"><input type="hidden" name="status" value="${action === "record-incoming" ? "Recorded" : "Draft"}">` +
          textField("text", "Message text (local only)"),
        "",
        "Record message locally",
      );
  } catch (error) {
    toast(error.message, true);
  }
});
try {
  view = location.hash.slice(1) || "dashboard";
  await refresh();
} catch (e) {
  $("#content").innerHTML =
    '<div class="warning-box">Unable to load workspace. Check that the server is running, then reload.</div>';
  toast(e.message, true);
}
