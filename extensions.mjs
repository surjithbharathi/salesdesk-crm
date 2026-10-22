export function createExtensions({ all, get, put, tx, stamp, log, bad }) {
  const kinds = [
    "conversations",
    "messages",
    "tickets",
    "campaigns",
    "automationRules",
    "documents",
    "attendance",
    "savedReports",
    "autoReplies",
    "teamChannels",
    "teamMessages",
  ];
  const triggers = [
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
  ];
  function validate(kind, p, old = {}) {
    const v = { ...old };
    const field = (k, fn, d) => (v[k] = k in p ? fn(p[k]) : (v[k] ?? d));
    const s = (k, max = 500, required = false) => {
      field(
        k,
        (x) => {
          if (typeof x !== "string" || x.length > max) bad("Invalid " + k);
          return x.trim();
        },
        "",
      );
      if (required && !v[k]) bad(k + " required");
    };
    const ref = (k, type, required = false) => {
      s(k, 100, required);
      if (v[k] && !get(type, v[k])) bad("Unknown " + k);
    };
    const choice = (k, values) =>
      field(
        k,
        (x) => {
          if (!values.includes(x)) bad("Invalid " + k);
          return x;
        },
        values[0],
      );
    if (kind === "teamChannels") {
      s("name", 200, true);
      s("description", 2000);
      field(
        "memberIds",
        (x) => {
          if (
            !Array.isArray(x) ||
            x.length > 100 ||
            x.some((id) => typeof id !== "string" || !get("users", id))
          )
            bad("Invalid channel members");
          return [...new Set(x)];
        },
        [],
      );
    }
    if (kind === "teamMessages") {
      ref("channelId", "teamChannels", true);
      ref("userId", "users", true);
      s("text", 10000, true);
      const channel = get("teamChannels", v.channelId);
      if (!channel.memberIds.includes(v.userId)) bad("User must be a channel member");
    }
    if (kind === "autoReplies") {
      s("name", 200, true);
      s("text", 10000, true);
      choice("trigger", triggers);
      field(
        "enabled",
        (x) => {
          if (typeof x !== "boolean") bad("Invalid enabled");
          return x;
        },
        false,
      );
    }
    if (kind === "conversations") {
      ref("leadId", "leads", true);
      ref("owner", "users");
      s("subject");
      choice("status", ["Open", "Resolved"]);
      choice("channel", ["WhatsApp", "Email", "SMS"]);
    }
    if (kind === "messages") {
      ref("conversationId", "conversations", true);
      s("text", 10000, true);
      choice("direction", ["Incoming", "Outgoing"]);
      choice("status", ["Recorded", "Draft"]);
    }
    if (kind === "tickets") {
      ref("leadId", "leads");
      ref("owner", "users");
      s("subject", 500, true);
      s("description", 10000);
      field(
        "category",
        (x) => {
          if (typeof x !== "string" || x.length > 100) bad("Invalid category");
          return x.trim();
        },
        "Service",
      );
      choice("priority", ["Low", "Normal", "High", "Urgent"]);
      choice("status", [
        "Open",
        "Payment Pending",
        "Service Scheduled",
        "In progress",
        "Spare Paid",
        "Issue Solved",
        "Spare Sent",
        "Closed",
        "Resolved",
      ]);
    }
    if (kind === "campaigns") {
      s("name", 200, true);
      ref("listId", "lists", true);
      s("text", 10000, true);
      choice("status", ["Draft", "Prepared"]);
      if (v.status === "Prepared" && old.status !== "Prepared") bad("Use prepare action");
    }
    if (kind === "automationRules") {
      s("name", 200, true);
      s("source", 200, true);
      ref("owner", "users", true);
      field(
        "enabled",
        (x) => {
          if (typeof x !== "boolean") bad("Invalid enabled");
          return x;
        },
        false,
      );
      field(
        "followupHours",
        (x) => {
          if (typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 8760)
            bad("Invalid followupHours");
          return x;
        },
        0,
      );
    }
    if (kind === "documents") {
      ref("leadId", "leads");
      s("name", 200, true);
      field(
        "content",
        (x) => {
          if (
            typeof x !== "string" ||
            Buffer.byteLength(x) > 102400 ||
            x.includes("\0") ||
            /[\uD800-\uDFFF]/u.test(x)
          )
            bad("Text document exceeds limit or contains invalid text");
          return x;
        },
        "",
      );
      choice("mime", ["text/plain"]);
    }
    if (kind === "attendance") {
      ref("userId", "users", true);
      s("date", 10, true);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(v.date) ||
        !Number.isFinite(Date.parse(v.date)) ||
        new Date(v.date).toISOString().slice(0, 10) !== v.date
      )
        bad("Invalid date");
      for (const k of ["checkIn", "checkOut"])
        field(
          k,
          (x) => {
            if (x === null && k === "checkOut") return null;
            if (
              typeof x !== "string" ||
              !/^\d{4}-\d\d-\d\dT/.test(x) ||
              !Number.isFinite(Date.parse(x))
            )
              bad("Invalid " + k);
            return new Date(x).toISOString();
          },
          null,
        );
      if (!v.checkIn || (v.checkOut && v.checkOut < v.checkIn)) bad("Invalid attendance times");
      if (all(kind).some((x) => x.id !== old.id && x.userId === v.userId && x.date === v.date))
        bad("Attendance already exists");
    }
    if (kind === "savedReports") {
      s("name", 200, true);
      choice("entity", ["leads", "deals", "calls", "payments"]);
      choice("measure", ["count", "value"]);
      field(
        "days",
        (x) => {
          if (typeof x !== "number" || !Number.isInteger(x) || x < 0 || x > 365)
            bad("Invalid days");
          return x;
        },
        0,
      );
      choice("groupBy", ["source", "owner", "stage", "direction", "outcome"]);
      choice("stage", ["", "New", "Prospecting", "Opportunity", "Closed"]);
    }
    if (kind === "savedReports") {
      if (v.entity === "calls" && v.measure === "value")
        bad("Call reports support counts; monetary value is not recorded for calls");
      if (v.entity !== "calls" && ["direction", "outcome"].includes(v.groupBy))
        bad("Direction and outcome grouping apply only to calls");
    }
    return v;
  }
  async function handle(req, url, body, send) {
    if (url.pathname === "/api/rules/run" && req.method === "POST") {
      await body(req);
      const result = tx(() => {
        let assigned = 0,
          tasks = 0;
        const rules = all("automationRules")
          .filter((r) => r.enabled)
          .sort((a, b) => a.id.localeCompare(b.id));
        for (const lead of all("leads")) {
          if (lead.owner || lead.archived) continue;
          const rule = rules.find((r) => r.source === lead.source && get("users", r.owner)?.active);
          if (!rule) continue;
          put("leads", { ...lead, owner: rule.owner, updatedAt: new Date().toISOString() });
          assigned++;
          log(lead.id, "System", "Assigned by rule: " + rule.name);
          onEvent("Lead assigned", {
            leadId: lead.id,
            eventId: `assignment:${rule.id}:${lead.id}`,
          });
          if (rule.followupHours > 0) {
            const task = stamp({
              leadId: lead.id,
              owner: rule.owner,
              title: "Follow up: " + rule.name,
              due: new Date(Date.now() + rule.followupHours * 3600000).toISOString(),
              status: "Open",
              origin: "System",
              ruleId: rule.id,
            });
            put("tasks", task);
            onEvent("Task created", { leadId: lead.id, eventId: task.id });
            tasks++;
          }
        }
        return { assigned, tasks };
      });
      send(200, result);
      return true;
    }
    const prepare = url.pathname.match(/^\/api\/campaigns\/([a-zA-Z0-9-]+)\/prepare$/);
    if (prepare && req.method === "POST") {
      await body(req);
      const result = tx(() => {
        const c = get("campaigns", prepare[1]);
        if (!c) bad("Campaign not found", 404);
        let prepared = 0;
        for (const l of all("leads").filter((l) => !l.archived && l.list === c.listId)) {
          if (all("messages").some((m) => m.campaignId === c.id && m.leadId === l.id)) continue;
          const conversation = stamp({
            leadId: l.id,
            owner: l.owner,
            status: "Open",
            channel: "WhatsApp",
            subject: c.name,
          });
          put("conversations", conversation);
          put(
            "messages",
            stamp({
              conversationId: conversation.id,
              leadId: l.id,
              campaignId: c.id,
              direction: "Outgoing",
              text: c.text,
              status: "Draft",
            }),
          );
          prepared++;
        }
        put("campaigns", { ...c, status: "Prepared", updatedAt: new Date().toISOString() });
        return { prepared };
      });
      send(200, result);
      return true;
    }
    const download = url.pathname.match(/^\/api\/documents\/([a-zA-Z0-9-]+)\/download$/);
    if (download && req.method === "GET") {
      const d = get("documents", download[1]);
      if (!d) bad("Document not found", 404);
      send(200, d.content, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="' + d.name.replace(/[^a-zA-Z0-9._-]/g, "_") + '"',
      });
      return true;
    }
    return false;
  }
  function onEvent(trigger, { leadId, eventId }) {
    const lead = get("leads", leadId);
    if (!lead || lead.archived || !eventId) return;
    for (const rule of all("autoReplies").filter((r) => r.enabled && r.trigger === trigger)) {
      if (all("messages").some((m) => m.ruleId === rule.id && m.eventId === eventId)) continue;
      const conversation = stamp({
        leadId,
        owner: lead.owner,
        status: "Open",
        channel: "WhatsApp",
        subject: rule.name,
      });
      put("conversations", conversation);
      put(
        "messages",
        stamp({
          conversationId: conversation.id,
          leadId,
          ruleId: rule.id,
          eventId,
          direction: "Outgoing",
          text: rule.text,
          status: "Draft",
        }),
      );
    }
  }
  return { kinds, validate, handle, onEvent };
}
