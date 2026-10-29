let smtpConfig=null;
import { parseLeadCsv } from "./csv.js";
import { summarizeReport } from "./reports.js";
import { applyLeadView } from "./lead-views.js";
import { initializeAuth, openAccounts, signOut } from "./auth.js";
const $ = (s) => document.querySelector(s);
let sharedIdentity = null;
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
const leadStageOptions=[["New","New"],["Prospecting","Discussion"],["Opportunity","Interested customer"],["Quotation given","Quotation given"],["Closed","Closed"]];
const stageLabel=value=>leadStageOptions.find(([key])=>key===value)?.[1]||value;
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
  boardSaving = false,
  sortKey = "createdAt",
  sortDir = "desc",
  selected = new Set(),
  detailId;
let leadTab="active",activitySection="activity";
const titles = {
  settings: "Settings",
  automation: "Automation",
  dashboard: "Dashboard",
  leads: "Leads",
  archived: "Archived leads",
  businesses: "Businesses",
  lists: "Lead lists",
  import: "Bulk add leads",
  distribution: "Lead distribution",
  engagements: "All engagements",
  calls: "Calls",
  messages: "Messages",
  visits: "Visits",
  tasks: "To-do",
  deals: "Deals",
  payments: "Payments",
  reports: "Reports",
  team: "User leads",
  sources: "Source reports",
  activities: "Activity",
  products: "Products & inventory",
  integrations: "Integrations",
  whatsapp: "WhatsApp",
  callAI: "AI transcription & Call IQ",
  emailSettings: "Email / SMTP",
  apiKeys: "API Key Vault",
  mcp: "MCP connections",
  workspaces: "Workspaces",
  workspaceUsers: "Users & permissions",
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
function renderNavigation(){
  const links=[['dashboard','◫','Dashboard'],['leads','▤','Leads'],['calls','↗','Calls'],['messages','▢','Messages'],['tasks','☑','To-do'],['activities','≋','Activity & reports']];
  links.push(['settings','⚙',(!sharedIdentity||sharedIdentity.user.role==='admin')?'Admin settings':'Settings']);
  const primary=links.some(([key])=>key===view)?view:'settings';
  $('#nav').innerHTML=links.map(([key,icon,label])=>`<a href="#${key}" data-nav="${key}"${key===primary?' class="active" aria-current="page"':''}><span aria-hidden="true">${icon}</span>${label}</a>`).join('');
  $('#nav').querySelectorAll('[data-nav]').forEach(link=>link.addEventListener('click',()=>{queue='';owner='';document.body.classList.remove('nav-open');}));
}
function settingsPage(){
  const admin=!sharedIdentity||sharedIdentity.user.role==='admin';
  $('#heading').innerHTML=heading(admin?'Admin settings':'Settings','Manage your workspace in one place.');
  const tile=(title,description,links)=>panel(title,`<div class="settings-links"><p>${description}</p>${links}</div>`);
  const link=(page,label)=>`<a class="settings-link" href="#${page}">${label}<span aria-hidden="true">→</span></a>`;
  let html=workspaceProfile?.crmOwner?tile('Ultra Admin','Create workspaces and manage their owners and users.',link('workspaces','Manage workspaces')):'';
  if(workspaceProfile?.permissions?.['users.manage'])html+=tile('People & access','Workspace users, roles and permissions.',link('workspaceUsers','Users & permissions')+link('distribution','Lead assignment')+link('rules','Automated distribution'));
  if(workspaceProfile?.permissions?.['integrations.manage'])html+=tile('Integrations','Connect your lead sources and messaging.',link('integrations','Manage integrations')+link('whatsapp','WhatsApp')+link('emailSettings','Email / SMTP')+link('mcp','MCP connections')+link('apiKeys','API Key Vault')+link('callAI','AI transcription & Call IQ')+link('automation','n8n automation'));
  html+=tile('Lead settings','Import and maintain your leads.',(admin&&workspaceProfile?.permissions?.['leads.write']?link('import','Bulk add leads'):'')+link('archived','Archived leads')+`<button class="settings-link" data-action="merge-leads">Merge duplicate leads <span>→</span></button>`+(admin&&workspaceProfile?.permissions?.['data.export']?link('exports','Data export'):''));
  html+=tile('Your account',`${esc(sharedIdentity?.user?.name||'Workspace account')} · ${workspaceProfile?.crmOwner?'Ultra Admin':esc(workspaceRoles.find(([role])=>role===workspaceProfile?.role)?.[1]||'Member')}`,`<button class="settings-link" data-action="sign-out">Sign out <span>→</span></button>`);
  return `<div class="settings-grid">${html}</div>`;
}
renderNavigation();
$("#today").textContent = new Date().toLocaleDateString("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
$("#menu").onclick = () => document.body.classList.toggle("nav-open");
$("#scrim").onclick = () => document.body.classList.remove("nav-open");
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
  waStatus = await api("whatsapp/status");
  mobileDevices = await api("mobile/devices");
  try{workspaceProfile=await api('workspace/access');}catch{workspaceProfile=null;}
  if(workspaceProfile?.permissions?.['integrations.manage'])try{smtpConfig=await api('email/settings');}catch{smtpConfig=null;}
  const requestedWorkspace=new URLSearchParams(location.hash.split('?')[1]||'').get('workspace');
  workspaceUserScope=workspaceProfile?.crmOwner&&/^[a-f0-9-]{36}$/.test(requestedWorkspace||'')?requestedWorkspace:'';
  if(workspaceProfile?.permissions?.['users.manage'])try{workspaceUsers=await api(workspaceUsersEndpoint());}catch{workspaceUsers=[];}
  if(workspaceProfile?.crmOwner)try{workspaceDirectory=await api('workspaces');}catch{workspaceDirectory=null;}
  if(sharedIdentity?.user.role==='admin')try{aiConfig=await api('call-ai/settings');aiKeys=await api('call-ai/keys');}catch{aiConfig=null;aiKeys=[];}
  if(sharedIdentity?.user.role==='admin')try{mcpKeys=await api('mcp/keys');mcpApprovals=await api('mcp/approvals');}catch{mcpKeys=[];mcpApprovals=[];}
  const oauthRequest=new URLSearchParams(location.hash.split('?')[1]||'').get('oauth_request');
  mcpConsent=null;
  if(sharedIdentity?.user.role==='admin'&&/^[a-f0-9-]{36}$/.test(oauthRequest||''))try{mcpConsent=await api('mcp/oauth/'+oauthRequest);}catch(error){mcpConsent={error:error.message};}
  try {
    automationStatus = await api("automation/status");
    automationAccounts = automationStatus.canManageAccess ? await api("automation/access") : [];
  } catch {
    automationStatus = { enabled: false };
  }
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
  )}">${esc(stageLabel(s))}</span>`;
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
  if(sharedIdentity?.user?.role!=="admin"&&sharedIdentity&&["import","distribution","rules","integrations","automation","exports","workspaceAdmin","mcp"].includes(view))view="settings";
  if(['products','businesses','inbox','teamInbox','mailbox','tickets','campaigns','autoReplies','deals','payments','visits','documents','attendance','lists'].includes(view))view='settings';
  if(view==='reports'){view='activities';activitySection='reports';}
  if(view==='engagements')view='activities';
  renderNavigation();
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
    settings: settingsPage,
    automation: automationPage,
    dashboard: dashboard,
    leads: leadsPage,
    archived: leadsPage,
    businesses: businesses,
    lists: listsPage,
    import: importPage,
    distribution: distribution,
    engagements: engagements,
    calls: engagements,
    messages: whatsappMessagesPage,
    visits: engagements,
    tasks: tasksPage,
    deals: dealsPage,
    payments: paymentsPage,
    reports: reports,
    team: teamPage,
    sources: sourcesPage,
    activities: activityReportsPage,
    integrations: integrations,
    whatsapp: whatsappConfiguration,
    callAI: callAISettings,
    apiKeys: apiKeyVaultPage,
    emailSettings: smtpSettingsPage,
    mcp: mcpConnectionsPage,
    workspaces: workspacesPage,
    workspaceUsers: workspaceUsersPage,
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
  attachCallAIButtons($('#content'));
  applyWorkspacePermissions($('#content'));
  if(view==='callAI')updateCombinedUI();
  if(view==='callAI'&&sharedIdentity?.user.role==='admin')for(const part of ['stt','iq']){
    const provider=aiConfig?.[part]?.provider||'openai';
    if(aiConfig?.[part]?.hasKey||['sarvam','elevenlabs','ollama'].includes(provider))void loadAIModels(part);
  }
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
function activityReportsPage(){
  const tabs=`<div class="page-tabs" role="group" aria-label="Activity view"><button data-activity-section="activity" class="${activitySection==='activity'?'active':''}">Activity</button><button data-activity-section="reports" class="${activitySection==='reports'?'active':''}">Reports</button></div>`;
  const body=activitySection==='reports'?reports():engagements();
  $('#heading').innerHTML=heading('Activity & reports','Calls, notes and team metrics in one place.');
  return tabs+body;
}
function whatsappMessagesPage(){
  $('#heading').innerHTML=heading('Messages','WhatsApp conversations synced to your leads.');
  const conversations=state.conversations.filter(item=>item.channel==='WhatsApp');
  if(!conversations.length)return panel('WhatsApp messages','<div class="simple-empty">No synced WhatsApp messages yet. Your admin can connect WhatsApp in Settings → Integrations.</div>');
  return conversations.map(conversation=>{
    const messages=state.messages.filter(message=>message.conversationId===conversation.id).sort((a,b)=>String(a.occurredAt||a.createdAt).localeCompare(String(b.occurredAt||b.createdAt)));
    return `<details class="message-thread"><summary><b>${esc(leadName(conversation.leadId))}</b><span>${messages.length} messages</span></summary><div class="message-list">${messages.length?messages.map(message=>`<article class="synced-message ${message.direction==='Outgoing'?'outgoing':''}"><small>${message.direction==='Outgoing'?'You':'Customer'} · ${esc(date(message.occurredAt||message.createdAt))}</small><p>${esc(message.text)}</p></article>`).join(''):'<p>No message text synced yet.</p>'}</div></details>`;
  }).join('');
}

function dashboard(){
  const leads=scoped(state.leads.filter(lead=>!lead.archived)),tasks=scoped(openTasks());
  const overdue=tasks.filter(task=>task.due&&Date.parse(task.due)<Date.now()&&!sameDay(task.due));
  const due=tasks.filter(task=>sameDay(task.due));
  const upcoming=tasks.filter(task=>task.due&&Date.parse(task.due)>Date.now()&&!sameDay(task.due));
  const calls=state.activities.filter(item=>item.type==='Call'&&sameDay(item.occurredAt||item.createdAt)&&(!scope||lead(item.leadId)?.owner===scope));
  const recent=state.activities.filter(item=>!scope||lead(item.leadId)?.owner===scope).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,4);
  const plan=[...overdue,...due].sort((a,b)=>Date.parse(a.due)-Date.parse(b.due)).slice(0,5);
  $('#heading').innerHTML=heading('Dashboard','Your leads, calls and follow-ups.',`<select id="scope" aria-label="Dashboard owner scope">${ownerOptions(scope,'All team members')}</select><button class="primary" data-action="add-lead">＋ Add lead</button>`);
  return stats([
    ['New leads',leads.filter(lead=>lead.stage==='New').length,`${leads.filter(lead=>sameDay(lead.createdAt)).length} added today`,'↥'],
    ['Discussions',leads.filter(lead=>lead.stage==='Prospecting').length,'Conversations in progress','◉'],
    ['Interested',leads.filter(lead=>lead.stage==='Opportunity').length,'Ready for the next step','◇'],
    ['Follow-ups today',due.length,'Your scheduled tasks','◷']
  ])+`<div class="dashboard-grid">${panel('Work plan',`<div class="panel-body"><div class="plan-counts"><span><b>${overdue.length}</b> Overdue</span><span><b>${due.length}</b> Today</span><span><b>${upcoming.length}</b> Upcoming</span></div>${plan.length?plan.map(task=>`<a class="work-item" href="#tasks"><div><b>${esc(task.title)}</b><small>${esc(lead(task.leadId)?.name||'Task')}</small></div><span>${esc(date(task.due))}</span></a>`).join(''):'<div class="simple-empty">No follow-ups due. Add a task when you have a next step.</div>'}</div>`,`<a href="#tasks">View to-do →</a>`)}${panel('Recent activity',`<div class="panel-body">${activityFeed(recent)}</div>`,`<a href="#activities">View all →</a>`)}</div><div class="daily-call-summary"><span><b>${calls.length}</b> calls today</span><span>${Math.floor(sum(calls,'duration')/60)} minutes logged</span><a href="#calls">View calls →</a></div>`;
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
  return `<div class="toolbar"><input id="search" placeholder="Search name, company, phone or email…" aria-label="Search leads" value="${esc(query)}"><select id="stage" aria-label="Filter stage">${opts(leadStageOptions, stage, "All stages")}</select><select id="owner" aria-label="Filter owner">${ownerOptions(owner, "All owners")}</select><select id="source" aria-label="Filter source">${opts([...new Set(state.leads.map((l) => l.source).filter(Boolean))], source, "All sources")}</select>${queue ? `<button data-action="clear-queue">${esc(queue)} ×</button>` : ""}</div>`;
}
function filtered() {
  let ls = state.leads.filter((l) => Boolean(l.archived) === (view === "archived"));
  if(view==='leads')ls=ls.filter(lead=>leadTab==='closed'?lead.stage==='Closed':lead.stage!=='Closed');
  if(view==='leads'&&leadTab==='new')ls=ls.filter(lead=>lead.stage==='New');
  if(view==='leads'&&leadTab==='unassigned')ls=ls.filter(lead=>!lead.owner);
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
    `${ls.length} ${ls.length===1?"lead":"leads"}`,
    `<button class="primary" data-action="add-lead">＋ Add lead</button>`,
  );
  const active=state.leads.filter(lead=>!lead.archived&&lead.stage!=='Closed');
  const tabs=view==='leads'?`<div class="page-tabs" role="group" aria-label="Lead category">${[['active','Active',active.length],['new','New',active.filter(lead=>lead.stage==='New').length],['unassigned','Unassigned',active.filter(lead=>!lead.owner).length],['closed','Closed',state.leads.filter(lead=>!lead.archived&&lead.stage==='Closed').length]].map(([key,label,count])=>`<button data-lead-category="${key}" class="${leadTab===key?'active':''}">${label} <small>${count}</small></button>`).join('')}</div>`:'';
  const stageTabs=view==='leads'&&leadTab==='active'?`<div class="page-tabs stage-tabs" role="group" aria-label="Current lead stage">${[['','All stages'],...leadStageOptions.filter(([key])=>key!=='Closed')].map(([key,label])=>`<button data-active-stage="${key}" class="${stage===key?'active':''}">${label}</button>`).join('')}</div>`:'';
  return tabs+stageTabs+panel(
    "Lead workspace",
    `<details class="lead-options"><summary>View options</summary><div class="toolbar"><select id="lead-layout" aria-label="Lead layout">${opts(
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
    )}</select><button data-action="save-lead-view">Save current view</button></div></details>` +
      filters() +
      (leadLayout === "board"
        ? leadBoard(ls)
        : (selected.size ? `<div class="toolbar"><span class="muted">${selected.size} selected</span><button data-action="assign">Assign owner</button><button data-action="archive">${view === "archived" ? "Restore selected" : "Archive selected"}</button><button data-action="clear-selection">Clear selection</button></div>` : "") +
          table(
            [
              '<input type="checkbox" class="checkbox" id="select-all" aria-label="Select visible leads">',
              "Lead name",
              "Country code",
              "Mobile number",
              "Lead owner",
              "Lead stage",
              "Source",
              "Next action",
            ],
            rows.map((l) => {
              const t = leadTasks(l.id)[0];
              return `<tr><td><input class="checkbox" type="checkbox" data-select="${l.id}" aria-label="Select ${esc(l.name)}" ${selected.has(l.id) ? "checked" : ""}></td><td><div class="person"><span class="avatar">${esc(initials(l.name))}</span><div>${leadButton(l.id)}<small>${esc(l.company)} ${l.repeat ? " · Repeat" : ""}</small></div></div></td><td>${esc(l.countryCode?"+"+l.countryCode:"")}</td><td>${esc(l.mobileNumber||l.phone)}</td><td>${esc(user(l.owner))}</td><td><select data-inline-lead-stage="${esc(l.id)}" aria-label="Stage for ${esc(l.name)}">${opts(leadStageOptions,l.stage)}</select></td><td>${esc(l.source)}</td><td><span class="${t && Date.parse(t.due) < Date.now() ? "overdue" : ""}">${t ? esc(date(t.due)) : "Unscheduled"}</span></td></tr>`;
            }),
          ) +
          `<div class="footer-row"><span>${ls.length ? (page - 1) * 10 + 1 : 0}–${Math.min(page * 10, ls.length)} of ${ls.length} leads</span><div class="row"><button data-action="prev" ${page === 1 ? "disabled" : ""}>←</button> Page ${page} of ${pages} <button data-action="next" ${page === pages ? "disabled" : ""}>→</button></div></div>`),
  );
}
function leadBoard(leads) {
  const stages = leadStageOptions.map(([key])=>key);
  return `<div class="panel-body"><p class="muted">Drag a card into another stage, or use Move to. Open a card for its activity timeline. Filters and saved views apply to this board.</p><div class="lead-board" aria-busy="${boardSaving}">${stages
    .map((stageName) => {
      const cards = leads.filter((l) => l.stage === stageName);
      return `<section class="lead-lane" data-drop-stage="${stageName}" aria-label="${stageName} leads"><h3>${esc(stageLabel(stageName))} <small>${cards.length} · ${money(sum(cards, "value"))}</small></h3>${cards.map((l) => `<article class="lead-card" draggable="${!boardSaving}" data-drag-lead="${esc(l.id)}">${leadButton(l.id)}<p>${esc(l.company || "No company")}</p><small>${esc(user(l.owner))} · ${esc(l.source || "No source")}</small><p><b>${money(l.value)}</b></p><label>Move to<select data-board-stage="${esc(l.id)}" aria-label="Move ${esc(l.name)} to stage" ${boardSaving ? "disabled" : ""}>${opts(stages, l.stage)}</select></label></article>`).join("") || '<p class="empty">Drop a lead here</p>'}</section>`;
    })
    .join("")}</div></div>`;
}
let draggedLeadId = "";
function clearBoardDrag() {
  draggedLeadId = "";
  document
    .querySelectorAll(".dragging, .drop-target")
    .forEach((el) => el.classList.remove("dragging", "drop-target"));
}
async function moveBoardLead(id, targetStage) {
  if (boardSaving || !lead(id) || lead(id).stage === targetStage) return;
  boardSaving = true;
  render();
  try {
    await change("leads", id, { stage: targetStage });
  } catch (error) {
    toast(error.message, true);
  } finally {
    boardSaving = false;
    render();
  }
}
let boardPointer;
document.addEventListener("dragstart", (e) => {
  if (e.target.closest("[data-drag-lead]")) e.preventDefault();
});
document.addEventListener("pointerdown", (e) => {
  const card = e.target.closest("[data-drag-lead]");
  if (
    !card ||
    boardSaving ||
    e.button !== 0 ||
    e.pointerType === "touch" ||
    e.target.closest("select, input, button, a")
  )
    return;
  boardPointer = { card, pointerId: e.pointerId, x: e.clientX, y: e.clientY };
  card.setPointerCapture(e.pointerId);
});
document.addEventListener("pointermove", (e) => {
  if (!boardPointer || e.pointerId !== boardPointer.pointerId) return;
  if (!draggedLeadId && Math.hypot(e.clientX - boardPointer.x, e.clientY - boardPointer.y) < 6)
    return;
  draggedLeadId = boardPointer.card.dataset.dragLead;
  boardPointer.card.classList.add("dragging");
  e.preventDefault();
  document.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
  const lane = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-drop-stage]");
  if (!lane) return;
  lane.classList.add("drop-target");
  const board = lane.closest(".lead-board"),
    rect = board.getBoundingClientRect();
  if (e.clientX < rect.left + 45) board.scrollLeft -= 24;
  if (e.clientX > rect.right - 45) board.scrollLeft += 24;
});
function cancelBoardPointer() {
  if (boardPointer?.card.hasPointerCapture(boardPointer.pointerId))
    boardPointer.card.releasePointerCapture(boardPointer.pointerId);
  boardPointer = undefined;
  clearBoardDrag();
}
document.addEventListener("pointerup", async (e) => {
  if (!boardPointer || e.pointerId !== boardPointer.pointerId) return;
  const id = draggedLeadId;
  const lane = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-drop-stage]");
  cancelBoardPointer();
  if (id && lane) await moveBoardLead(id, lane.dataset.dropStage);
});
document.addEventListener("pointercancel", cancelBoardPointer);
window.addEventListener("blur", cancelBoardPointer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") cancelBoardPointer();
});
function activityFeed(items) {
  return items.length
    ? items
        .map(
          (a) =>
            `<div class="activity-item"><span class="avatar">${{ Call: "↗", Note: "≡", Message: "▢", Visit: "⌖", System: "⟳" }[a.type]}</span><div>${leadButton(a.leadId)}<p>${esc(a.text)}</p>${a.recordingId ? `<audio controls preload="none" src="/api/mobile/recordings/${esc(a.recordingId)}"></audio>` : ""}${a.voiceNoteId ? `<small>Post-call voice feedback</small><audio controls preload="none" src="/api/mobile/recordings/${esc(a.voiceNoteId)}"></audio>` : ""}<small>${esc(a.type)} · ${date(a.occurredAt || a.createdAt)}</small></div></div>`,
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
        ["Team member", "Calls", "Connected", "Duration", "Notes", "Open tasks"],
        state.users.map((u) => {
          const ids = new Set(state.leads.filter((l) => l.owner === u.id).map((l) => l.id)),
            as = state.activities.filter((a) => ids.has(a.leadId)),
            cs = as.filter((a) => a.type === "Call");
          return `<tr><td>${esc(u.name)}</td><td>${cs.length}</td><td>${cs.filter((c) => c.outcome !== "No answer").length}</td><td>${Math.floor(sum(cs, "duration") / 60)}m</td><td>${as.filter((a) => a.type === "Note").length}</td><td>${openTasks().filter((t) => t.owner === u.id).length}</td></tr>`;
        }),
      ),
    ) +
    '<div class="info-box">Totals are grouped by the lead’s current owner.</div>'
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
let waStatus = { state: "disconnected", qr: null, error: "", unmatched: 0 };
let aiConfig=null, aiKeys=[], aiRecording='', aiLead='', aiTab='Summary', aiStatus='';
let mcpKeys=[],mcpApprovals=[],mcpConsent=null;
let workspaceProfile=null,workspaceUsers=[],workspaceDirectory=null,workspaceUserScope='';
const permissionLabels={'leads.write':'Create / edit leads','tasks.write':'Create / edit tasks','calls.read':'View calls & recordings','calls.sync':'Phone call sync & calling','messages.read':'View messages','reports.read':'View reports','integrations.manage':'Manage integrations & MCP','users.manage':'Manage users','data.export':'Data export action'};
const workspaceRoles=[['owner','Super Admin'],['admin','Admin'],['manager','Manager'],['member','Caller']];
const workspaceUsersEndpoint=()=>workspaceUserScope?`workspaces/${workspaceUserScope}/users`:'workspace/users';
function smtpSettingsPage(){
 if(!workspaceProfile?.permissions?.['integrations.manage'])return panel('Email / SMTP','Administrator access required.');
 const c=smtpConfig||{host:'smtp.hostinger.com',port:465,fromName:'Salesdesk CRM'};
 return panel('Email / SMTP',`<div class="panel-body"><p>Configure outgoing CRM emails for account setup and password reset. Each workspace has its own encrypted SMTP settings.</p><form id="smtp-settings-form"><label><input type="checkbox" name="enabled" ${c.enabled?'checked':''}> Enable email delivery</label><div class="form-grid">${field('host','SMTP host',c.host,'text',true)}<label>Security<select name="port">${opts([['465','465 · SSL/TLS'],['587','587 · STARTTLS']],String(c.port))}</select></label>${field('username','SMTP username / mailbox',c.username,'email',true)}<label>SMTP password<input name="password" type="password" autocomplete="new-password" placeholder="${c.hasPassword?'Saved · leave blank to keep':'Mailbox password'}"></label>${field('fromEmail','From email',c.fromEmail,'email',true)}${field('fromName','Sender name',c.fromName,'text',true)}</div><button class="primary" type="submit">Save SMTP settings</button></form><hr><form id="smtp-test-form"><label>Test recipient<input name="to" type="email" required></label><button type="submit">Send test email</button></form><p>Save first, then send a test. SMTP acceptance does not guarantee inbox delivery; check Spam too. No email is sent when you save settings.</p></div>`);
}
function setupLinkModal(result){modal('Password setup link',`<p>Copy this private one-use link to the new user. They set their own password. ${result.emailStatus==='accepted'?'Invitation email accepted by SMTP.':result.emailStatus==='failed'?'User created, but email failed. Use this link or retry from Users & permissions.':'No email has been sent.'}</p><label>Setup link<input readonly value="${esc(result.setupUrl)}"></label><p>Expires ${esc(date(result.expiresAt))}</p>`);}
function workspacesPage(){
  if(!workspaceProfile?.crmOwner)return panel('Workspaces','Ultra Admin access required.');
  const entries=workspaceDirectory?.workspaces||[];
  return panel('Workspaces',`<div class="panel-body"><p>You are the Ultra Admin. Each workspace has a separate database, users, recordings, API keys and MCP connection. Current hosting capacity: ${workspaceDirectory?.capacity||5} additional workspaces.</p><p>Current workspace: <b>${esc(workspaceProfile.name)}</b></p><form id="workspace-create-form"><label>Workspace name<input name="name" required maxlength="120"></label><label>Super Admin name<input name="ownerName" required maxlength="120"></label><label>Owner username<input name="ownerUsername" required minlength="3" maxlength="120" pattern="[a-z0-9.@_+\\-]{3,120}"></label><button class="primary" type="submit">Create workspace</button></form>${table(['Workspace','Address','Status',''],entries.map(entry=>`<tr><td>${esc(entry.name)}</td><td><a href="${esc(entry.url)}" target="_blank" rel="noopener">Open workspace ↗</a></td><td>${esc(entry.state)}</td><td><a href="#workspaceUsers?workspace=${esc(entry.id)}">Manage users</a> <button data-workspace-state="${esc(entry.id)}" data-next-state="${entry.state==='active'?'suspended':'active'}">${entry.state==='active'?'Suspend':'Activate'}</button></td></tr>`))}</div>`);
}
function workspaceUsersPage(){
  if(!workspaceProfile?.permissions?.['users.manage'])return panel('Users & permissions','User management permission required.');
  const title=workspaceUserScope?workspaceDirectory?.workspaces.find(entry=>entry.id===workspaceUserScope)?.name||'Selected workspace':workspaceProfile.name;
  const roles=workspaceProfile.role==='owner'||workspaceProfile.crmOwner?workspaceRoles:workspaceRoles.filter(([value])=>value!=='owner');
  return panel('Users & permissions · '+esc(title),`<div class="panel-body"><p>Super Admin manages the workspace. Admin manages users and integrations. Manager manages team leads and reports. Caller sees assigned leads and calls. Access changes sign the affected user out on their devices.</p><form id="workspace-user-invite"><label>Name<input name="name" required maxlength="120"></label><label>Username<input name="username" required minlength="3" maxlength="120"></label><label>Email<input name="email" type="email"></label><label>Role<select name="role">${opts(roles,'member')}</select></label><label><input type="checkbox" name="sendEmail"> Send invitation email (SMTP required)</label><button class="primary" type="submit">Add user & create setup link</button></form>${table(['Name','Username','Role','Status',''],workspaceUsers.map(user=>`<tr><td>${esc(user.name)}</td><td>${esc(user.username)}</td><td>${esc(workspaceRoles.find(([role])=>role===user.role)?.[1]||user.role)}${user.crmOwner?' · Ultra Admin':''}</td><td>${user.active?'Active':'Disabled'}</td><td>${user.hasLogin?`<button data-user-permissions="${esc(user.id)}">Permissions</button><button data-user-setup="${esc(user.id)}">Setup link</button>${!workspaceUserScope&&user.email?`<button data-email-user-setup="${esc(user.id)}">Email password reset</button>`:""}`:`<button data-create-user-login="${esc(user.id)}">Create login</button>`}</td></tr>`))}</div>`);
}
function editUserPermissions(id){
  const user=workspaceUsers.find(user=>user.id===id);if(!user)return;
  const roles=workspaceProfile.role==='owner'||workspaceProfile.crmOwner?workspaceRoles:workspaceRoles.filter(([value])=>value!=='owner');
  modal('User permissions · '+esc(user.name),`<form id="workspace-permissions-form"><input name="userId" type="hidden" value="${esc(id)}"><label>Email<input name="email" type="email" value="${esc(user.email||'')}"></label><label>Role<select name="role" data-workspace-role>${opts(roles,user.role)}</select></label><label><input type="checkbox" name="active" ${user.active?'checked':''}> Active user</label><div class="form-grid">${Object.entries(permissionLabels).map(([key,label])=>`<label><input type="checkbox" data-user-permission="${key}" ${user.permissions[key]?'checked':''}> ${label}</label>`).join('')}</div><button class="primary" type="submit">Save access</button></form>`);
}
function applyWorkspacePermissions(container){
  if(!workspaceProfile)return;
  for(const button of container.querySelectorAll('button[data-action]')){
    const action=button.dataset.action,permission=['add-lead','edit-current','merge-leads','lead-activity'].includes(action)?'leads.write':['add-task','lead-task'].includes(action)?'tasks.write':action==='call-on-phone'?'calls.sync':'';
    if(permission&&!workspaceProfile.permissions[permission]){button.disabled=true;button.title='Your role does not allow this action';}
  }
  if(!workspaceProfile.permissions['leads.write'])container.querySelectorAll('[data-inline-lead-stage]').forEach(select=>select.disabled=true);
  if(container.id==='content')for(const [page,permission] of [['calls','calls.read'],['messages','messages.read']]){const link=$('#nav').querySelector(`a[href="#${page}"]`);if(link)link.hidden=!workspaceProfile.permissions[permission];}
}
function oauthConsentPanel(){
  if(!mcpConsent)return '';
  if(mcpConsent.error)return panel('Connection request',`<p class="warning-box">${esc(mcpConsent.error)}</p>`);
  return panel('Authorize MCP client',`<div class="panel-body"><h3>${esc(mcpConsent.clientName)}</h3><p>This client requests access to this CRM workspace. The client name is self-reported; verify the destination before approving.</p><p>Redirect destination: <code>${esc(mcpConsent.redirectUri)}</code></p><p>Permissions: ${esc(mcpConsent.scopes.join(', '))}</p><p>One-hour access tokens can refresh for up to seven days. You can revoke it in the connections list. Lead changes still require separate action approval.</p><div class="row"><button class="primary" data-oauth-consent="allow">Approve connection</button><button data-oauth-consent="deny">Deny</button></div></div>`);
}
function mcpConnectionsPage(){
  if(sharedIdentity?.user.role!=='admin')return panel('MCP','Workspace administrator access required.');
  return oauthConsentPanel()+panel('MCP connections',`<div class="panel-body"><p>Endpoint: <code>${esc(location.origin)}/mcp</code></p><p>Streamable HTTP / JSON-RPC. Connect with Authorization: Bearer your-token. Tokens expire after 30 days; secrets are shown once and stored as hashes. Use a client supporting bearer headers or the supplied local stdio bridge. OAuth clients can use this same endpoint and authorize through CRM login. PKCE authorization codes and dynamic client registration are supported; OAuth access tokens expire after one hour; rotating refresh tokens keep the connection active for up to seven days, unless revoked.</p><p>Tools: list/read leads, daily reports, existing call AI results and lead insights. Optional lead edits, assignments and transcription processing require approval here before execution.</p><form id="mcp-connection-form"><label>Connection name<input name="label" required maxlength="100" placeholder="e.g. My AI assistant"></label><label><input name="write" type="checkbox"> Allow proposing lead edits, assignments and transcription processing</label><button type="submit" class="primary">Create connection token</button></form>${table(['Connection','Permissions','Expires',''],mcpKeys.map(key=>`<tr><td>${esc(key.label)}</td><td>${esc(key.scopes.join(', '))}</td><td>${date(key.expires)}</td><td>${key.revoked?'Revoked':`<button data-mcp-revoke="${esc(key.id)}">Revoke</button>`}</td></tr>`))}<h3>Pending actions</h3>${mcpApprovals.length?mcpApprovals.map(item=>`<article class="event"><b>${esc(item.tool)}</b><pre style="white-space:pre-wrap">${esc(JSON.stringify(item.args,null,2))}</pre><small>Expires ${esc(date(item.expires))}</small>${item.approved?'<p>Approved · waiting for client to retry this action</p>':`<button data-mcp-approve="${esc(item.id)}">Approve this action</button>`}</article>`).join(''):'<p>No pending actions.</p>'}<button data-mcp-refresh>Refresh</button></div>`);
}
const keyProvider=provider=>provider==='openai-audio'?'openai':provider;
function savedKeyOptions(provider,selected=''){return opts(aiKeys.filter(key=>key.active&&key.provider===keyProvider(provider)).map(key=>[key.id,key.label]),selected,'Choose saved key');}
function updateSavedKey(part){
  const form=$('#call-ai-settings'),provider=form.elements[part+'Provider'].value;
  const selected=keyProvider(aiConfig?.[part]?.provider)===keyProvider(provider)?aiConfig?.[part]?.keyId||'':'';
  form.elements[part+'KeyId'].innerHTML=savedKeyOptions(provider,selected);
}
function apiKeyVaultPage(){
  if(sharedIdentity?.user.role!=='admin')return panel('API Key Vault','Administrator access required.');
  return panel('API Key Vault',`<div class="panel-body"><p>Save each provider key once. Select it in transcription, Call IQ and combined mode. OpenAI keys can be reused across both stages. Only admins manage keys; saved secrets are never displayed.</p><form id="api-key-vault-form"><input name="vaultId" type="hidden"><label>Key name<input name="label" required maxlength="100" placeholder="e.g. OpenAI · Company account"></label><label>Provider<select name="provider">${opts(['openai','google','sarvam','elevenlabs','claude','ollama','grok'])}</select></label><label>API key<input type="password" name="key" autocomplete="new-password" required placeholder="Paste provider API key"></label><button class="primary" type="submit">Save key</button></form>${table(['Name','Provider','Status',''],aiKeys.map(key=>`<tr><td>${esc(key.label)}</td><td>${esc(key.provider)}</td><td>${key.active?'Active':'Disabled'}</td><td><button data-rotate-key="${esc(key.id)}">Replace key</button><button data-toggle-key="${esc(key.id)}">${key.active?'Disable':'Enable'}</button></td></tr>`))}<a href="#callAI">Back to AI settings →</a></div>`);
}
const aiModelLists={stt:{openai:['gpt-transcribe'],'openai-audio':['gpt-audio-mini','gpt-audio-1.5','gpt-audio'],sarvam:['saaras:v4','saaras:v3'],elevenlabs:['scribe_v2','scribe_v1']},iq:{}};
function updateCombinedUI(){
  const form=$('#call-ai-settings');if(!form)return;
  const combined=form.elements.sttProvider.value==='openai-audio';
  const mode=form.querySelector('[data-ai-mode]');if(mode)mode.value=combined?'combined':'separate';
  for(const option of form.elements.sttProvider.options){option.hidden=combined?option.value!=='openai-audio':option.value==='openai-audio';option.disabled=option.hidden;}
  const iq=form.querySelector('[data-ai-part="iq"]');if(iq)iq.hidden=combined;
  form.elements.iqEnabled.disabled=combined;
  if(combined)form.elements.iqEnabled.checked=false;
  let note=form.querySelector('[data-combined-note]');
  if(!note){note=document.createElement('p');note.dataset.combinedNote='';note.className='note';form.querySelector('[data-ai-part="stt"]').after(note);}
  note.hidden=!combined;note.textContent='Combined mode: OpenAI Audio creates transcript, summary and call insights in one request. A separate Call IQ provider is not used. Recordings are converted privately to standard WAV on the server (20 MiB converted limit). Use separate transcription for longer calls.';
}
async function loadAIModels(part){
  const form=$('#call-ai-settings');if(!form)return;
  const provider=form.elements[part+'Provider'].value,select=form.elements[part+'Model'],previous=select.value;
  const requestId=String(Number(select.dataset.requestId||0)+1);select.dataset.requestId=requestId;
  const status=form.querySelector(`[data-model-status="${part}"]`),button=form.querySelector(`[data-refresh-models="${part}"]`);
  status.textContent='Loading models…';button.disabled=true;
  try{
    const result=await api('call-ai/models','POST',{part,provider,keyId:form.elements[part+'KeyId'].value});
    if(!form.isConnected||form.elements[part+'Provider'].value!==provider||select.dataset.requestId!==requestId)return;
    aiModelLists[part][provider]=result.models;
    select.innerHTML=opts(result.models, result.models.includes(previous)?previous:'','Choose model');
    status.textContent=result.models.length?result.source+(result.note?' · '+result.note:''):'No compatible models returned. Check this provider account.';
  }catch(error){if(form.isConnected&&form.elements[part+'Provider'].value===provider&&select.dataset.requestId===requestId)status.textContent=error.message;}
  finally{if(form.isConnected&&select.dataset.requestId===requestId)button.disabled=false;}
}
function callAISettings(){
  if(sharedIdentity?.user.role!=='admin')return panel('AI integration','<p>Administrator access required.</p>');
  const c=aiConfig||{stt:{provider:'openai',model:'gpt-transcribe'},iq:{provider:'openai',model:''}};
  const section=(key,title,providers)=>{const models=[...new Set([...(aiModelLists[key][c[key].provider]||[]),...(c[key].model?[c[key].model]:[])])];return `<fieldset data-ai-part="${key}"><legend>${title}</legend><label>Provider<select name="${key}Provider" data-ai-provider="${key}">${opts(providers,c[key].provider)}</select></label><label>Saved API key<select name="${key}KeyId">${savedKeyOptions(c[key].provider,c[key].keyId||'')}</select></label><a href="#apiKeys">Manage API Key Vault →</a><label>Model<select name="${key}Model">${opts(models,c[key].model||'','Choose model')}</select></label><button type="button" data-refresh-models="${key}">Refresh models</button><small data-model-status="${key}">Choose a provider and saved key, then refresh models. Saved model remains selected.</small></fieldset>`;};
  return panel('AI transcription & Call IQ',`<form id="call-ai-settings" class="panel-body"><label>Processing mode<select data-ai-mode><option value="separate">Separate · Transcription + Call IQ</option><option value="combined">Combined · One audio model</option></select></label><p>Choose a speech provider and a separate provider for Call IQ. Select keys saved in the API Key Vault; secrets are encrypted and never returned to the browser.</p>${section('stt','1. Transcription',[['openai','OpenAI transcription'],['openai-audio','OpenAI Audio · Combined'],['google','Google Gemini audio'],['sarvam','Sarvam · Batch API'],['elevenlabs','ElevenLabs']])}<p class="note">Examples: OpenAI gpt-transcribe; ElevenLabs scribe_v2; Sarvam saaras:v4. Google requires a Gemini audio-capable model. Sarvam uses Batch API for recordings up to two hours. Processing runs in the background; the CRM recording upload limit remains 20 MiB. Google inline audio is limited to 14 MiB here. Provider file formats and account limits apply.</p>${section('iq','2. Call IQ',[['openai','OpenAI / ChatGPT'],['claude','Claude'],['ollama','Ollama'],['grok','Grok']])}<p class="note">Select a model from the list. Refresh models after selecting your saved key. Ollama uses the server-configured CALL_AI_OLLAMA_URL; no Ollama runtime is installed by this feature.</p><label><input name="iqEnabled" type="checkbox" ${c.iqEnabled?'checked':''}> Generate Call IQ summary after transcription</label><label><input name="enabled" type="checkbox" ${c.enabled?'checked':''}> Enable Call AI</label><label><input name="automatic" type="checkbox" ${c.automatic?'checked':''}> Automatically process new calls after enabling (older calls stay manual)</label><label><input name="acknowledged" type="checkbox"> I authorize sending call audio to the selected transcription provider and transcript text to the selected Call IQ provider. Provider charges may apply.</label><button class="primary" type="submit">Save AI settings</button></form>`);
}
function attachCallAIButtons(container){
  container.querySelectorAll('audio[src^="/api/mobile/recordings/"]').forEach(audio=>{
    const id=audio.getAttribute('src').split('/').pop();
    if(!state.mobileCalls?.some(call=>call.recordingId===id))return;
    const button=document.createElement('button');button.textContent='✧ AI';button.title='Call summary and transcription';button.dataset.callAi=id;button.style.marginLeft='8px';audio.after(button);
  });
}
async function showCallAI(id, tab='Summary', polling=false){
  aiRecording=id; aiTab=tab;aiLead=state.mobileCalls?.find(call=>call.recordingId===id)?.leadId||'';
  const result=await api(`call-ai/recordings/${id}`);
  if(aiRecording!==id||aiTab!==tab||(polling&&!$('#modal').open))return;
  aiStatus=result.status;
  const content=tab==='Summary'?(result.summary|| (result.transcript?'Transcription ready. Call IQ summary is not enabled or has not completed.':'Summary will appear after processing.')):(result.transcript||'Transcript will appear after processing.');
  modal('Call AI',`<div data-ai-recording="${esc(id)}"><div class="detail-tabs">${['Summary','Transcription'].map(label=>`<button data-ai-tab="${label}">${label}</button>`).join('')}</div><p>${esc(result.status.replaceAll('_',' '))}${result.transcriptionProvider?' · '+esc(result.transcriptionProvider):''}${result.iqProvider?' → '+esc(result.iqProvider):''}</p>${result.error?`<p class="warning-box">${esc(result.error)}</p>`:''}<div style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(content)}</div><p class="note">AI-generated draft. Review against the recording.</p>${['not_started','error'].includes(result.status)?`<button class="primary" data-ai-run="${esc(id)}">${result.status==='error'?'Retry processing':'Transcribe & analyze'}</button>`:''}${aiLead?'<button data-ai-back>Back to lead</button>':''}</div>`);
}
setInterval(()=>{if(['queued','processing','waiting'].includes(aiStatus)&&$('#modal').open&&$('#modal-content').querySelector('[data-ai-recording]'))void showCallAI(aiRecording,aiTab,true).catch(()=>{});},4000);
let mobileDevices = [];
function mobilePanel() {
  return panel(
    "Android call & recording sync",
    `<div class="panel-body"><p>The Android mobile CRM includes leads, tasks, calls and settings. Call sync reads existing call logs and your selected recording folder; no microphone recording or automatic permission grants.</p>${
      sharedIdentity
        ? `<p class="warning-box">Sign in on mobile with the same CRM username and password. Calls automatically belong to that user ID; no separate owner or token setup. Device API: port 3101 via USB reverse for debug, or a private HTTPS proxy for production. Never expose the desktop admin port.</p>`
        : `<p class="warning-box">Enable company login using the account button to use shared mobile login. Legacy demo device tokens below stop working once company login is enabled.</p><form id="mobile-device"><label>Device label<input name="name" required maxlength="100" placeholder="Business Android phone"></label><label>Assigned CRM owner<select name="owner" required>${opts(
            state.users.filter((u) => u.active).map((u) => [u.id, u.name]),
            "",
            "Choose owner",
          )}</select></label><label><input type="checkbox" required> I authorize this device to sync this owner's business call metadata and consented recordings.</label><button class="primary" type="submit">Create device token</button></form>`
    }${table(
      ["Device", "Owner", "Access", "Action"],
      mobileDevices.map(
        (d) =>
          `<tr><td>${esc(d.name)}</td><td>${esc(user(d.owner))}</td><td>${d.revoked ? "Revoked" : "Active"}</td><td>${d.revoked ? "—" : `<button data-action="mobile-revoke" data-device="${esc(d.id)}">Revoke device</button>`}</td></tr>`,
      ),
    )}<h3>Synced phone calls</h3>${table(
      ["Lead", "Started", "Direction", "Duration", "Recording"],
      (state.mobileCalls || [])
        .slice(0, 100)
        .map(
          (c) =>
            `<tr><td>${leadButton(c.leadId)}</td><td>${esc(date(new Date(c.startedAt).toISOString()))}</td><td>${esc(c.direction)}</td><td>${Number(c.duration)}s</td><td>${c.recordingId ? `<audio controls preload="none" src="/api/mobile/recordings/${esc(c.recordingId)}"></audio><small>${esc(c.matchMode)} match</small>` : "Waiting for file / review"}</td></tr>`,
        ),
    )}</div>`,
  );
}
let callRefreshBusy = false;
async function refreshSyncedCalls() {
  if (
    callRefreshBusy ||
    !state ||
    document.hidden ||
    $("#modal").open ||
    document.activeElement?.closest("input, textarea, select") ||
    [...document.querySelectorAll("audio")].some((audio) => !audio.paused)
  )
    return;
  if (!["integrations", "calls", "activities", "engagements", "dashboard"].includes(view)) return;
  callRefreshBusy = true;
  const requestedView = view;
  try {
    const next = await api("state");
    if (
      requestedView !== view ||
      $("#modal").open ||
      document.activeElement?.closest("input, textarea, select")
    )
      return;
    if (JSON.stringify(next.mobileCalls || []) === JSON.stringify(state.mobileCalls || [])) return;
    const position = { x: window.scrollX, y: window.scrollY };
    if (view === "integrations") {
      const panel = $("#mobile-sync-panel");
      if (
        !panel ||
        panel.querySelector("form") ||
        [...panel.querySelectorAll("audio")].some((audio) => !audio.paused)
      )
        return;
      state = next;
      panel.innerHTML = mobilePanel();
    } else {
      if ([...document.querySelectorAll("audio")].some((audio) => !audio.paused)) return;
      state = next;
      render();
    }
    window.scrollTo(position.x, position.y);
  } catch {
    /* Keep existing calls while offline; the next poll retries. */
  } finally {
    callRefreshBusy = false;
  }
}
setInterval(refreshSyncedCalls, 3000);
function waStatusHtml() {
  const connected = waStatus.state === 'connected';
  const busy = ['connecting','reconnecting','qr'].includes(waStatus.state);
  const repair = ['logged_out','error'].includes(waStatus.state) || Boolean(waStatus.error);
  const controls = connected ? '<button data-action="wa-logout" aria-label="Logout WhatsApp" title="Logout WhatsApp">⏻</button>' : busy ? '<p>Connecting… Scan the QR when it appears.</p>' : `<button class="primary" data-action="${repair?'wa-repair':'wa-connect'}">${repair?'Repair connection':'Connect'}</button>`;
  return controls + `<p><b>${esc(waStatus.state)}</b> · Sync only</p>${waStatus.error ? `<p class="warning-box">${esc(waStatus.error)}</p>` : ""}${waStatus.qr ? `<img src="${esc(waStatus.qr)}" alt="Private WhatsApp pairing QR" width="280" height="280"><p>On your dedicated phone: WhatsApp → Linked devices → Link a device. Do not share this QR.</p>` : ""}<small>Unmatched texts this session: ${Number(waStatus.unmatched || 0)}. Incoming and manually outgoing individual text events match exactly one active lead's full international number. Groups, media and full history import are not supported.</small>`;
}
setInterval(async () => {
  if (
    view === "inbox" &&
    !$("#modal").open &&
    !document.activeElement?.closest("input, textarea, select")
  ) {
    try {
      await refresh();
    } catch {
      /* Keep existing records if the local server is unavailable. */
    }
    return;
  }
  if (!["integrations", "whatsapp"].includes(view) || !$("#wa-status")) return;
  try {
    waStatus = await api("whatsapp/status");
    if ($("#wa-status")) $("#wa-status").innerHTML = waStatusHtml();
  } catch {
    if ($("#wa-status"))
      $("#wa-status").textContent = "Unable to reach the local WhatsApp service.";
  }
}, 3000);
function whatsappConfiguration() {
  return panel('WhatsApp', `<div class="panel-body"><details class="message-thread"><summary><b>Official WhatsApp link</b></summary><p>Meta WhatsApp Business Platform</p><p class="note">Not configured. Official connection requires your business account and a verified API/webhook setup. This option does not use Baileys.</p></details><details class="message-thread" open><summary><b>Unofficial WhatsApp link</b></summary><label><input type="checkbox" id="wa-consent"> I understand this uses an unofficial linked-device client and authorize syncing incoming and manually sent WhatsApp text.</label><p class="note">Baileys · Sync only. Account restriction remains possible.</p><div id="wa-status">${waStatusHtml()}</div><p>To pair: WhatsApp → Linked devices → Link a device. Scan the private QR shown here. Existing CRM messages are kept when you reconnect or repair.</p></details></div>`);
}
function integrations() {
  return (
    '<details class="whatsapp-configuration"><summary class="primary">WhatsApp</summary>' +
    whatsappConfiguration() +
    '</details><br><div class="warning-box">Other external integrations below are not connected.</div><br><div class="integration-grid">' +
    [
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
  if (title === "Lead workspace") {
    const callButton = $("#modal-content").querySelector('[data-action="call-on-phone"]');
    const banner = $("#modal-content").querySelector(".lead-banner");
    if (callButton && banner) {
      callButton.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.79a2 2 0 0 1-.45 2.11L8.09 9.89a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.89.33 1.83.56 2.79.69A2 2 0 0 1 22 16.92z"/></svg>';
      callButton.setAttribute("aria-label", "Call");
      callButton.title = "Call";
      callButton.style.cssText = "margin-left:auto;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;padding:10px;border-radius:50%;background:#15803d;border-color:#15803d;color:#fff";
      banner.append(callButton);
    }
  }
  attachCallAIButtons($('#modal-content'));
  applyWorkspacePermissions($('#modal-content'));
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
function mergeLeadForm(){
  const key=l=>l.phoneKey||((String(l.phone||'').replace(/\D/g,'').length===10?'91':'')+String(l.phone||'').replace(/\D/g,''));
  const leads=state.leads.filter(l=>!l.archived&&key(l)&&state.leads.some(other=>other.id!==l.id&&key(other)===key(l))).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
  if(!leads.length){toast('No duplicate mobile numbers found.');return;}
  modal('Merge duplicate leads',`<form id="merge-leads-form"><label>Keep this lead<select id="merge-primary" name="targetId">${leads.map(l=>`<option value="${esc(l.id)}">${esc(l.name)} · ${esc(l.phone)}</option>`).join('')}</select></label><p>The primary lead keeps its owner and stage. Calls, recordings, notes and tasks move into it. Original details remain in merge history.</p><div id="merge-candidates"></div><button class="primary">Merge duplicates</button></form>`);
  const update=()=>{const target=leads.find(l=>l.id===$('#merge-primary').value);$('#merge-candidates').innerHTML=state.leads.filter(l=>l.id!==target.id&&key(l)===key(target)).map(l=>`<label><input type="checkbox" name="sourceIds" value="${esc(l.id)}" checked> ${esc(l.name)} · ${esc(user(l.owner))}${l.archived?' · Archived':''}</label>`).join('');};$('#merge-primary').addEventListener('change',update);update();
}
function leadForm(l = {}) {
  form(
    "leads",
    field("name", "Lead name", l.name, "text", true) +
      field("company", "Business / company", l.company) +
      field("countryCode", "Country code", "+"+(l.countryCode || "91"), "tel", true) +
      field("mobileNumber", "Mobile number", l.mobileNumber || (String(l.phone || "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "")), "tel", true) +
      field("email", "Email", l.email, "email") +
      selectField("owner", "Lead owner", ownerOptions(l.owner)) +
      selectField(
        "stage",
        "Lead stage",
        opts(leadStageOptions, l.stage || "New"),
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
function messageParticipant(message, leadRecord) {
  if (message.direction === "Incoming") return leadRecord?.name || "Customer";
  const senderId = message.senderUserId || (message.provider !== "baileys" ? message.userId : "");
  const sender = state.users.find(item => item.id === senderId);
  return sender?.name || "WhatsApp · sender not identified";
}
function showLead(id, tab = "Timeline") {
  const l = lead(id);
  if (!l) return;
  detailId = id;
  const acts = state.activities.filter((a) => a.leadId === id),
    tasks = state.tasks.filter((t) => t.leadId === id);
  let body = "";
  if (tab === "Timeline" || tab === "Activity log") {
    const entries = acts.filter(a => tab === "Activity log" || a.type === "Call" || a.type === "Message")
      .sort((a,b) => String(b.occurredAt || b.createdAt).localeCompare(String(a.occurredAt || a.createdAt)));
    body = `<div class="row"><button data-action="lead-activity">＋ Log activity</button><button data-action="lead-task">◷ Schedule follow-up</button></div><div class="timeline">${entries.length ? entries.map((a) => {
      const messageLabel = (a.direction === "Outgoing" ? "Message · Sent" : a.direction === "Incoming" ? "Message · Received" : "Message") + " · " + messageParticipant(a, l);
      return `<div class="event"><b>${esc(a.type === "Message" ? messageLabel : a.type)}</b><p>${esc(a.text)}</p>${a.type === "Call" ? `<small>${esc(a.direction)} · ${esc(a.outcome)} · ${Number(a.duration || 0)}s</small>` : ""}${a.recordingId ? `<audio controls preload="none" src="/api/mobile/recordings/${esc(a.recordingId)}"></audio>` : ""}${a.voiceNoteId ? `<small>Post-call voice feedback</small><audio controls preload="none" src="/api/mobile/recordings/${esc(a.voiceNoteId)}"></audio>` : ""}<small>${date(a.occurredAt || a.createdAt)}</small></div>`;
    }).join("") : '<p class="simple-empty">No ' + (tab === "Timeline" ? 'calls or messages' : 'activities') + ' yet.</p>'}</div>`;
  }
  if (tab === "Details")
    body = `<div class="form-grid">${[
      ["Country code", l.countryCode?"+"+l.countryCode:""],
      ["Mobile number", l.mobileNumber||l.phone],
      ["Email", l.email],
      ["City", l.city],
      ["Source", l.source],
      ["Owner", user(l.owner)],
      ["Stage", stageLabel(l.stage)],
      ["Created", date(l.createdAt)],
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
  if (tab === "Documents"){const docs=state.documents.filter(document=>document.leadId===id);body=(!sharedIdentity||sharedIdentity.user.role==='admin'?'<button data-action="lead-document">Add text document</button>':'')+(docs.length?docs.map(document=>`<details class="lead-document"><summary>${esc(document.name)}</summary><pre>${esc(document.content)}</pre></details>`).join(''):'<p class="simple-empty">No documents attached to this lead.</p>');}
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
    `<div class="lead-banner"><span class="avatar">${esc(initials(l.name))}</span><div><h2>${esc(l.name)}</h2><span class="muted">${esc(l.company)} · ${esc(user(l.owner))}</span></div><button class="primary" style="background:#15803d;border-color:#15803d;color:#fff" data-action="call-on-phone">☎ Call</button></div><div class="split"><div class="row">${pill(l.stage)}${l.repeat ? pill("Repeat enquiry") : ""}</div><span class="muted">${money(l.value)}</span></div><div class="detail-tabs">${["Timeline", "Details", "Tasks", "Documents", "Activity log"].map((t) => `<button data-detail-tab="${t}" class="${t === tab ? "active" : ""}">${t}</button>`).join("")}</div>${body}`,
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
  view = location.hash.slice(1).split('?')[0] || "dashboard";
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
  if(['workspaceUsers','workspaces'].includes(view)){void refresh().catch(error=>toast(error.message,true));return;}
  render();
});
document.querySelectorAll("[data-nav]").forEach((a) =>
  a.addEventListener("click", () => {
    queue = "";
    owner = "";
    if (location.hash === a.getAttribute("href")) render();
  }),
);
let automationStatus = { enabled: false };
let automationAccounts = [];
function automationPage(){
  $('#heading').innerHTML=heading('n8n automation','Workspace automation through an external n8n connection.');
  return panel('n8n connection',`<div class="panel-body"><p><b>Not configured</b></p><p>Your workspace needs an n8n API connection before workflows can run.</p><p>Automation settings are managed by your workspace administrator.</p></div>`);
}
async function openAutomation(button) {
  button.disabled = true;
  try {
    let browserId = localStorage.getItem("n8n-browserId");
    if (!browserId) {
      browserId = crypto.randomUUID();
      localStorage.setItem("n8n-browserId", browserId);
    }
    const handoff = await api("automation/ticket", "POST", { browserId });
    const response = await fetch("/automation/rest/salesdesk/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "browser-id": browserId },
      credentials: "same-origin",
      body: JSON.stringify({ ticket: handoff.ticket }),
    });
    if (!response.ok)
      throw Error(
        "Automation login could not complete. Check the private runtime, employee access and MFA policy.",
      );
    location.assign("/automation/");
  } finally {
    button.disabled = false;
  }
}
document.addEventListener("click", async (e) => {
  const activeStage=e.target.closest('[data-active-stage]');if(activeStage){stage=activeStage.dataset.activeStage;leadViewId="";page=1;render();return;}
  const category=e.target.closest('[data-lead-category]');if(category){leadTab=category.dataset.leadCategory;stage='';owner='';queue='';page=1;render();return;}
  const activity=e.target.closest('[data-activity-section]');if(activity){activitySection=activity.dataset.activitySection;render();return;}

  const b = e.target.closest("button");
  if (!b) return;
  try {
    if(b.dataset.emailUserSetup){await api('workspace/users/'+b.dataset.emailUserSetup+'/email-setup','POST',{});toast('Reset email accepted by SMTP');return;}
    if(b.dataset.createUserLogin){const user=workspaceUsers.find(user=>user.id===b.dataset.createUserLogin);modal('Create user login',`<form id="workspace-existing-login"><input name="userId" type="hidden" value="${esc(user.id)}"><label>Name<input name="name" required value="${esc(user.name)}"></label><label>Username<input name="username" required minlength="3" maxlength="120"></label><label>Email<input name="email" type="email"></label><label>Role<select name="role">${opts(workspaceRoles,'member')}</select></label><button class="primary" type="submit">Create login & setup link</button></form>`);return;}
    if(b.dataset.userPermissions){editUserPermissions(b.dataset.userPermissions);return;}
    if(b.dataset.userSetup){setupLinkModal(await api(workspaceUsersEndpoint()+'/'+b.dataset.userSetup+'/setup-link','POST',{}));return;}
    if(b.dataset.workspaceState){if(!confirm(`${b.dataset.nextState==='suspended'?'Suspend':'Activate'} this workspace?`))return;await api('workspaces/'+b.dataset.workspaceState,'PATCH',{state:b.dataset.nextState});await refresh();return;}
    if(b.dataset.oauthConsent){b.disabled=true;try{const result=await api('mcp/oauth/'+mcpConsent.id,'POST',{approved:b.dataset.oauthConsent==='allow'});location.assign(result.redirect);}finally{b.disabled=false;}return;}
    if(b.dataset.mcpRevoke){await api(`mcp/keys/${b.dataset.mcpRevoke}/revoke`,'POST',{});await refresh();return;}
    if(b.dataset.mcpApprove){await api(`mcp/approvals/${b.dataset.mcpApprove}`,'POST',{});await refresh();return;}
    if(b.hasAttribute('data-mcp-refresh')){await refresh();return;}
    if(b.dataset.rotateKey){const key=aiKeys.find(key=>key.id===b.dataset.rotateKey),form=$('#api-key-vault-form');form.elements.vaultId.value=key.id;form.elements.label.value=key.label;form.elements.provider.value=key.provider;form.elements.key.value='';form.elements.key.focus();toast('Enter the replacement key and Save');return;}
    if(b.dataset.toggleKey){const key=aiKeys.find(key=>key.id===b.dataset.toggleKey);await api('call-ai/keys','POST',{id:key.id,label:key.label,provider:key.provider,active:!key.active});await refresh();return;}
    if(b.dataset.refreshModels){await loadAIModels(b.dataset.refreshModels);return;}
    if(b.dataset.callAi){await showCallAI(b.dataset.callAi);return;}
    if(b.dataset.aiTab){await showCallAI(aiRecording,b.dataset.aiTab);return;}
    if(b.dataset.aiRun){b.disabled=true;try{await api(`call-ai/recordings/${b.dataset.aiRun}`,'POST',{});await showCallAI(b.dataset.aiRun,aiTab);}finally{b.disabled=false;}return;}
    if(b.hasAttribute('data-ai-back')){showLead(aiLead);return;}
    if (b.dataset.automationUser) {
      const enabled = b.dataset.automationAllow === "true";
      if (!confirm(`${enabled ? "Allow" : "Revoke"} Automation access for this user?`)) return;
      await api("automation/access", "POST", { userId: b.dataset.automationUser, enabled });
      await refresh();
      return;
    }
    if (b.dataset.action === "automation-open") {
      await openAutomation(b);
      return;
    }
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
    if (a === "call-on-phone") {
      const l = lead(detailId),
        devices = await api("click-to-call/devices");
      if (!devices.some((d) => d.ready))
        throw Error(
          "Your phone bridge is unavailable. Sign in with this same user, grant call-bridge permissions and enable Background click-to-call in mobile Settings. Check notification, network, battery settings and lock-screen preference.",
        );
      modal(
        "Call from your Android phone",
        `<form id="click-to-call"><input type="hidden" name="leadId" value="${esc(l.id)}"><input type="hidden" name="requestId" value="${crypto.randomUUID()}"><p>Call ${esc(l.name)} · ${esc(l.phone)} using your phone SIM? Carrier charges may apply. Salesdesk need not be open if its background bridge notification is active and connected.</p><label>My ready phone<select name="deviceId" required>${devices
          .filter((d) => d.ready)
          .map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`)
          .join(
            "",
          )}</select></label><button class="primary" type="submit">Call now</button><p>No automatic retry. A queued request expires after 30 seconds. Dual-SIM phones may ask you to choose a SIM.</p></form>`,
      );
      return;
    }
    if (a === "mobile-revoke") {
      await api(`mobile/devices/${b.dataset.device}/revoke`, "POST", {});
      await refresh();
      toast("Device token revoked; existing CRM records retained");
    }
    if (a === "wa-logout" || a === "wa-repair") {
      const repair = a === "wa-repair";
      if (repair && !$("#wa-consent")?.checked) throw Error("Select the WhatsApp acknowledgement before pairing.");
      if (!confirm("Clear this WhatsApp login session? Synced CRM messages are retained.")) return;
      b.disabled = true;
      try {
        waStatus = await api(`whatsapp/${repair ? "repair" : "logout"}`, "POST", { confirmed: true, acknowledged: repair });
        $("#wa-status").innerHTML = waStatusHtml();
        toast(repair ? "New pairing started. Scan the QR when it appears." : "WhatsApp logged out. CRM messages retained.");
      } finally { b.disabled = false; }
    }
    if (a === "wa-connect" || a === "wa-disconnect") {
      if (a === "wa-connect" && !$("#wa-consent")?.checked)
        throw Error("Please acknowledge the WhatsApp risks and local storage first.");
      b.disabled = true;
      try {
        waStatus = await api(`whatsapp/${a === "wa-connect" ? "connect" : "disconnect"}`, "POST", {
          acknowledged: true,
        });
        $("#wa-status").innerHTML = waStatusHtml();
      } finally {
        b.disabled = false;
      }
    }
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
    if (a === "merge-leads") mergeLeadForm();
    if(a === "lead-document"){form('documents',`<input type="hidden" name="leadId" value="${esc(detailId)}"><input type="hidden" name="mime" value="text/plain">`+field('name','Document name','note.txt','text',true)+'<label>Document text<textarea name="content" rows="8" maxlength="102400"></textarea></label>','','Add lead document');return;}
    if(a === "manage-accounts"){await openAccounts();return;}
    if(a === "sign-out"){await signOut();return;}
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
    if(el.hasAttribute('data-workspace-role')){
      const role=el.value;el.form.querySelectorAll('[data-user-permission]').forEach(box=>{const key=box.dataset.userPermission;box.checked=role==='owner'||role==='admin'||(!['integrations.manage','users.manage','data.export'].includes(key)&&(role!=='viewer'||['calls.read','messages.read','reports.read'].includes(key)));});return;
    }
    if(el.dataset.aiProvider){
      const part=el.dataset.aiProvider,form=el.form,provider=el.value;
      updateSavedKey(part);
      form.elements[part+'Model'].innerHTML=opts(aiModelLists[part][provider]||[],'','Choose model');
      updateCombinedUI();
      await loadAIModels(part);return;
    }
    if(el.hasAttribute('data-ai-mode')){
      const form=el.form,provider=el.value==='combined'?'openai-audio':'openai';
      form.elements.sttProvider.value=provider;updateSavedKey('stt');
      form.elements.sttModel.innerHTML=opts(aiModelLists.stt[provider]||[],'','Choose model');
      updateCombinedUI();await loadAIModels('stt');return;
    }
    if(el.form?.id==='call-ai-settings'&&/^(stt|iq)KeyId$/.test(el.name)){await loadAIModels(el.name.slice(0,-5));return;}
    if (el.id === "lead-layout") {
      leadLayout = el.value === "board" ? "board" : "list";
      selected.clear();
      render();
    }
    if (el.dataset.boardStage) {
      await moveBoardLead(el.dataset.boardStage, el.value);
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
    if(el.dataset.inlineLeadStage){await change("leads",el.dataset.inlineLeadStage,{stage:el.value});return;}
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
  if(e.target.id === "merge-leads-form"){e.preventDefault();const fields=new FormData(e.target),sourceIds=fields.getAll("sourceIds");if(!sourceIds.length){toast("Select a duplicate lead.",true);return;}if(!confirm("Merge selected duplicates into the primary lead? Original details will be retained in merge history."))return;const button=e.target.querySelector("button");button.disabled=true;try{await api("leads/merge","POST",{targetId:fields.get("targetId"),sourceIds});$("#modal").close();selected.clear();await refresh();toast("Leads merged. Calls and notes retained.");}catch(error){button.disabled=false;toast(error.message,true);}return;}
  e.preventDefault();
  const f = e.target,
    button = f.querySelector('button[type="submit"],button.primary');
  if (button) button.disabled = true;
  try {
    const p = Object.fromEntries(new FormData(f));
    if(f.id==='smtp-settings-form'){await api('email/settings','POST',{...p,enabled:p.enabled==='on'});await refresh();toast('SMTP settings saved');return;}
    if(f.id==='smtp-test-form'){await api('email/test','POST',p);toast('Test email accepted by SMTP');return;}
    if(f.id==='workspace-create-form'){const result=await api('workspaces','POST',p);await refresh();setupLinkModal(result);return;}
    if(['workspace-user-invite','workspace-existing-login'].includes(f.id)){const result=await api(workspaceUsersEndpoint(),'POST',p);await refresh();setupLinkModal(result);return;}
    if(f.id==='workspace-permissions-form'){const permissions=Object.fromEntries([...f.querySelectorAll('[data-user-permission]')].map(box=>[box.dataset.userPermission,box.checked]));await api(workspaceUsersEndpoint()+'/'+p.userId,'PATCH',{role:p.role,email:p.email,active:p.active==='on',permissions});$('#modal').close();await refresh();toast('User access updated');return;}
    if(f.id==='mcp-connection-form'){
      const scopes=['leads:read','reports:read','insights:read',...(p.write==='on'?['leads:edit','leads:assign','transcription:run','tasks:write']:[])];
      const connection=await api('mcp/keys','POST',{label:p.label,scopes});await refresh();
      modal('MCP token · shown once',`<p>Copy this token into your MCP client. It grants the selected permissions to this workspace. Do not share it in chat.</p><label>Bearer token<input type="password" readonly value="${esc(connection.token)}" autocomplete="off"></label><p>Endpoint: <code>${esc(location.origin)}/mcp</code></p><p>Header: Authorization: Bearer &lt;token&gt;</p><p>Copy the token now; closing this dialog hides it permanently. Revoke and create another connection if lost.</p>`);return;
    }
    if(f.getAttribute('id')==='api-key-vault-form'){await api('call-ai/keys','POST',{id:p.vaultId||undefined,label:p.label,provider:p.provider,key:p.key});await refresh();toast('API key saved securely');return;}
    if(f.id==='call-ai-settings'){
      aiConfig=await api('call-ai/settings','POST',{stt:{provider:p.sttProvider,model:p.sttModel,keyId:p.sttKeyId},iq:{provider:p.iqProvider,model:p.iqModel,keyId:p.iqKeyId},enabled:p.enabled==='on',automatic:p.automatic==='on',iqEnabled:p.iqEnabled==='on',acknowledged:p.acknowledged==='on'});
      render();toast('AI settings saved');return;
    }
    if (f.id === "mobile-device") {
      const device = await api("mobile/devices", "POST", p);
      await refresh();
      modal(
        "Private device token · shown once",
        `<p>Copy into the Android companion. This token grants access to the selected owner's business-call sync. Do not share it or paste it into chat.</p><label>Device token<input readonly value="${esc(device.token)}"></label><p>USB debug endpoint: http://127.0.0.1:3101. Revoke the device if this token is lost.</p>`,
      );
      return;
    }
    if (f.id === "click-to-call") {
      const submit = f.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        const result = await api("click-to-call/request", "POST", { ...p, confirmed: true });
        toast(
          `Call request ${result.status}. Check your phone; this is not confirmation of a connected call.`,
        );
        $("#modal").close();
      } catch (error) {
        submit.disabled = false;
        throw error;
      }
      return;
    }
    if (f.id === "wa-web-draft") {
      const recipient = state.leads.find((l) => l.id === p.leadId && !l.archived);
      const phone = String(recipient?.phone || "").replace(/\D/g, "");
      if (!/^[1-9]\d{7,14}$/.test(phone))
        throw Error("Choose a lead with a full international phone number.");
      const url = new URL("https://web.whatsapp.com/send");
      url.searchParams.set("phone", phone);
      if (p.text) url.searchParams.set("text", p.text);
      window.open(url.href, "_blank", "noopener,noreferrer");
      toast("WhatsApp Web draft opened. Review and press Send there; nothing was sent by CRM.");
      return;
    }
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
      `<p class="warning-box">Local records and drafts, plus Baileys text messages when paired. Drafts are never sent from this inbox; use Integrations for a single explicit WhatsApp send. Email and SMS are not connected.</p><label>Assigned user<select id="inbox-owner">${ownerOptions(inboxOwner, "All users")}</select></label>` +
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
      `<p>Attach plain text (up to 100 KB) or upload PDF, PNG, JPEG, DOCX and XLSX files (up to 512 KB). Downloads preserve the stored content.</p>` +
      add("documents", "Attach document") +
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
        ["WhatsApp individual text (Baileys)", `Pairing required · ${waStatus.state}`],
        ["Calling, SMS and email delivery", "Not connected"],
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
      `<label class="full">Upload file (PDF, PNG, JPEG, DOCX or XLSX, up to 512 KB)<input type="file" id="document-file" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx"></label>` +
      `<label class="full">Plain text content (leave empty when uploading a file)<textarea name="content" maxlength="100000"></textarea></label>` +
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
  if (e.target.id === "document-file") {
    const form = e.target.closest("form"),
      file = e.target.files[0];
    if (!file) return;
    const types = {
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
    const mime = types[file.name.split(".").pop().toLowerCase()];
    if (!mime || file.size > 524288) {
      e.target.value = "";
      return toast("Choose a PDF, PNG, JPEG, DOCX or XLSX file up to 512 KB");
    }
    const reader = new FileReader();
    reader.onload = () => {
      form.elements.content.value = String(reader.result).split(",")[1] || "";
      form.elements.mime.value = mime;
      form.elements.name.value = file.name;
    };
    reader.readAsDataURL(file);
  }
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
      modal(
        d.name,
        !d.mime || d.mime === "text/plain"
          ? `<pre class="document-preview">${esc(d.content)}</pre>`
          : `<p>${esc(d.mime)} · ${Math.round((d.content.length * 3) / 4 / 1024)} KB. Binary files are not previewed; use Download.</p>`,
      );
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
  sharedIdentity = await initializeAuth();
  view = location.hash.slice(1).split('?')[0] || "dashboard";
  await refresh();
} catch (e) {
  $("#content").innerHTML =
    '<div class="warning-box">Unable to load workspace. Check that the server is running, then reload.</div>';
  toast(e.message, true);
}
