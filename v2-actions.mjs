// Write side of the v2 API. Every change goes through store.mjs so the CRM rules (lead protection, lost reasons,
// metrics, follow-ups) apply the same way here as anywhere else. This module only decides who may do what.
export function createActions(db, store) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const fail = (message, status = 400) => Object.assign(new Error(message), { status });
  const isAdmin = (actor) => actor.role === "admin";

  // Callers work only on their own leads; the owner and managers on any.
  function leadFor(actor, id) {
    const lead = one("SELECT id, owner_id FROM leads WHERE id=?", id);
    if (!lead || (!isAdmin(actor) && lead.owner_id !== actor.id)) throw fail("Lead not found", 404);
    return lead;
  }
  const text = (value, what, max = 2000) => {
    const out = String(value ?? "").trim();
    if (!out) throw fail(`${what} required`);
    if (out.length > max) throw fail(`${what} is too long`);
    return out;
  };
  const ctx = (actor) => ({ userId: actor.id, source: "web" });
  const detail = (id) => store.getLead(id);

  const handlers = {
    createLead(actor, _id, input) {
      const owner = isAdmin(actor) ? input.owner ?? null : actor.id; // a caller's new lead is always their own
      const lead = store.createLead({ ...input, owner }, ctx(actor));
      return { lead: detail(lead.id) };
    },
    captureLead(actor, _id, input) {
      const owner = isAdmin(actor) ? input.owner ?? null : actor.id;
      const out = store.captureLead({ ...input, owner }, ctx(actor));
      return { created: out.created, lead: detail(out.lead.id) };
    },
    updateLead(actor, id, patch) {
      leadFor(actor, id);
      if (!isAdmin(actor)) for (const k of ["owner_id"]) delete patch[k];
      return { lead: detail(store.updateLead(id, patch, ctx(actor)).id) };
    },
    setStatus(actor, id, { status, lostReason, note }) {
      leadFor(actor, id);
      // Reports explain why leads are lost, so a person closing a lead must pick the reason (imports may default it).
      if (store.statusOf(text(status, "Status", 80)).stage_group === "LOST" && !lostReason) throw fail("Choose the lost reason");
      return { lead: detail(store.setStatus(id, text(status, "Status", 80), { ...ctx(actor), lostReason, note }).id) };
    },
    assign(actor, id, { owner }) {
      if (!isAdmin(actor)) throw fail("Only the owner or a manager can reassign leads", 403);
      leadFor(actor, id);
      return { lead: detail(store.assign(id, owner || null, ctx(actor)).id) };
    },
    addNote(actor, id, { text: body }) {
      leadFor(actor, id);
      const activity = store.addActivity(id, "note", text(body, "Note"), { userId: actor.id, source: "web" });
      return { id: activity };
    },
    addTask(actor, id, { title, dueAt }) {
      const lead = leadFor(actor, id);
      const task = store.addTask({ leadId: id, ownerId: lead.owner_id ?? actor.id, title: text(title, "Title", 200), dueAt }, ctx(actor));
      return { task, lead: detail(id) };
    },
    closeTask(actor, taskId, { status = "Done" }) {
      const task = one("SELECT id, lead_id, owner_id FROM tasks WHERE id=?", taskId);
      if (!task || (!isAdmin(actor) && task.owner_id !== actor.id)) throw fail("Task not found", 404);
      if (!["Done", "Cancelled"].includes(status)) throw fail("Status must be Done or Cancelled");
      return { task: (status === "Done" ? store.completeTask : store.cancelTask)(taskId, ctx(actor)), lead: task.lead_id ? detail(task.lead_id) : null };
    },
    setCallOutcome(actor, callId, { outcome, note }) {
      const call = one("SELECT c.id, c.lead_id, l.owner_id, c.user_id FROM calls c JOIN leads l ON l.id=c.lead_id WHERE c.id=?", callId);
      if (!call || (!isAdmin(actor) && call.owner_id !== actor.id && call.user_id !== actor.id)) throw fail("Call not found", 404);
      store.setCallOutcome(callId, text(outcome, "Outcome", 80), { ...ctx(actor), note: note ? String(note).slice(0, 2000) : undefined });
      return { lead: detail(call.lead_id) };
    },
    addTag(actor, id, { tag }) {
      leadFor(actor, id);
      return { lead: detail(store.addTag(id, text(tag, "Tag", 40)).id) };
    },
  };

  // Routes: [method, pattern, handler]. Patterns capture the id.
  const routes = [
    ["POST", /^\/leads$/, "createLead"],
    ["POST", /^\/leads\/capture$/, "captureLead"],
    ["PATCH", /^\/leads\/([\w-]+)$/, "updateLead"],
    ["POST", /^\/leads\/([\w-]+)\/status$/, "setStatus"],
    ["POST", /^\/leads\/([\w-]+)\/assign$/, "assign"],
    ["POST", /^\/leads\/([\w-]+)\/notes$/, "addNote"],
    ["POST", /^\/leads\/([\w-]+)\/tasks$/, "addTask"],
    ["POST", /^\/leads\/([\w-]+)\/tags$/, "addTag"],
    ["POST", /^\/tasks\/([\w-]+)\/close$/, "closeTask"],
    ["POST", /^\/calls\/([\w-]+)\/outcome$/, "setCallOutcome"],
  ];
  function perform(method, path, actor, input) {
    for (const [verb, pattern, name] of routes) {
      const match = verb === method && pattern.exec(path);
      if (match) return handlers[name](actor, match[1], input && typeof input === "object" ? input : {});
    }
    throw fail("Not found", 404);
  }
  return { perform };
}
