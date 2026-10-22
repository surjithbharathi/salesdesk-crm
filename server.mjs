import http from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { createExtensions } from "./extensions.mjs";

const port = Number(process.env.PORT || 3100);
await mkdir(new URL("./data/", import.meta.url), { recursive: true });
const db = new DatabaseSync(
  process.env.CRM_DB || new URL("./data/crm.sqlite", import.meta.url).pathname,
);
db.exec(
  "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(kind TEXT, id TEXT, body TEXT, PRIMARY KEY(kind,id))",
);
const kinds = ["leads", "activities", "tasks", "deals", "payments", "products", "users", "lists"];
const all = (kind) =>
  db
    .prepare("SELECT body FROM records WHERE kind=? ORDER BY rowid DESC")
    .all(kind)
    .map((r) => JSON.parse(r.body));
const get = (kind, id) => {
  const r = db.prepare("SELECT body FROM records WHERE kind=? AND id=?").get(kind, id);
  return r ? JSON.parse(r.body) : null;
};
const put = (kind, v) =>
  db
    .prepare(
      "INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body",
    )
    .run(kind, v.id, JSON.stringify(v));
const now = () => new Date().toISOString();
const stamp = (p) => ({ ...p, id: randomUUID(), createdAt: now(), updatedAt: now() });
function tx(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const v = fn();
    db.exec("COMMIT");
    return v;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
function log(leadId, type, text, extra = {}) {
  const a = stamp({ leadId, type, text, ...extra });
  put("activities", a);
  return a;
}
if (!all("users").length)
  tx(() => {
    const users = ["Priya Nair", "Arjun Kumar", "Meera Shah"].map((name, i) =>
      stamp({ name, role: i ? "Sales representative" : "Manager", active: true }),
    );
    users.forEach((u) => put("users", u));
    const samples = [
      ["Rahul Sharma", "Sharma Engineering", "IndiaMART", 340000, "Opportunity"],
      ["Anjali Verma", "Greenline Foods", "Website", 125000, "New"],
      ["Karthik Kumar", "Kumar Industries", "Referral", 280000, "Prospecting"],
      ["Neha Patel", "Northstar Trading", "Google Ads", 195000, "Closed"],
      ["Vikram Singh", "Singh Exports", "IndiaMART", 420000, "Opportunity"],
      ["Divya Menon", "Coastal Foods", "WhatsApp", 180000, "New"],
      ["Rohit Jain", "Jain Enterprises", "TradeIndia", 95000, "Prospecting"],
      ["Sneha Rao", "Rao Trading", "Referral", 220000, "New"],
    ];
    samples.forEach(([name, company, source, value, stage], i) => {
      const l = stamp({
        name,
        company,
        source,
        value,
        stage,
        owner: users[i % 3].id,
        phone: "+91900000000" + i,
        email: `demo${i + 1}@example.com`,
        city: ["Coimbatore", "Chennai", "Bengaluru"][i % 3],
        archived: false,
        repeat: i === 4,
        firstTouchAt: stage === "New" ? null : now(),
        list: "",
        disposition: i === 3 ? "Won" : "",
      });
      put("leads", l);
      log(l.id, "System", "Lead captured from " + source);
      if (i % 2 === 0)
        put(
          "tasks",
          stamp({
            leadId: l.id,
            title: "Discuss requirements and pricing",
            owner: l.owner,
            due: new Date(
              Date.now() + (i === 0 ? -86400000 : i === 2 ? 3600000 : 172800000),
            ).toISOString(),
            status: "Open",
            origin: "User",
          }),
        );
      if (stage === "Opportunity" || i === 3)
        put(
          "deals",
          stamp({
            leadId: l.id,
            title: company + " equipment enquiry",
            value,
            stage: i === 3 ? "Won" : "Proposal",
            owner: l.owner,
            closeDate: new Date(Date.now() + 604800000).toISOString().slice(0, 10),
          }),
        );
      if (i === 2)
        log(l.id, "Call", "Connected — requested pricing", {
          outcome: "Interested",
          direction: "Outgoing",
          duration: 184,
        });
    });
    put(
      "products",
      stamp({ name: "Oil extraction machine", sku: "OE-100", price: 195000, stock: 8 }),
    );
    put(
      "products",
      stamp({ name: "Commercial cold press", sku: "CP-200", price: 340000, stock: 3 }),
    );
    put("lists", stamp({ name: "October enquiries" }));
  });
function bad(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
const string = (v, key, max = 2000) => {
  if (typeof v !== "string" || v.length > max) bad("Invalid " + key);
  return v.trim();
};
const num = (v, key) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e12) bad("Invalid " + key);
  return v;
};
const one = (v, values, key) => {
  if (!values.includes(v)) bad("Invalid " + key);
  return v;
};
const ref = (kind, v, optional = false) => {
  if (!v && optional) return "";
  if (typeof v !== "string" || !get(kind, v)) bad("Unknown " + kind + " reference");
  return v;
};
function validate(kind, p, old = {}) {
  if (extensions.kinds.includes(kind)) return extensions.validate(kind, p, old);
  const v = { ...old },
    field = (k, fn, def) => {
      v[k] = k in p ? fn(p[k]) : (v[k] ?? def);
    };
  const s = (k, max = 2000) => field(k, (x) => string(x, k, max), "");
  const n = (k) => field(k, (x) => num(x, k), 0);
  const r = (k, kind, optional = true) => field(k, (x) => ref(kind, x, optional), "");
  const c = (k, values) => field(k, (x) => one(x, values, k), values[0]);
  const b = (k) =>
    field(
      k,
      (x) => {
        if (typeof x !== "boolean") bad("Invalid " + k);
        return x;
      },
      false,
    );
  if (kind === "leads") {
    for (const k of ["name", "company", "phone", "email", "source", "city", "disposition"])
      s(k, 200);
    if (!v.name) bad("Lead name required");
    if (v.phone && !/^[+\d ()-]{7,30}$/.test(v.phone)) bad("Invalid phone");
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) bad("Invalid email");
    n("value");
    r("owner", "users");
    r("list", "lists");
    c("stage", ["New", "Prospecting", "Opportunity", "Closed"]);
    b("archived");
    b("repeat");
  }
  if (kind === "tasks") {
    s("title", 300);
    r("leadId", "leads");
    r("owner", "users");
    c("status", ["Open", "In progress", "Done"]);
    field(
      "due",
      (x) => {
        if (typeof x !== "string" || !Number.isFinite(Date.parse(x))) bad("Invalid due date");
        return new Date(x).toISOString();
      },
      "",
    );
    v.origin = old.origin || "User";
    if (!v.title || !v.due) bad("Task title and due date required");
  }
  if (kind === "deals") {
    s("title", 300);
    r("leadId", "leads", false);
    r("owner", "users");
    n("value");
    c("stage", ["Qualified", "Proposal", "Negotiation", "Won", "Lost"]);
    s("closeDate", 30);
    if (
      !v.title ||
      !v.leadId ||
      !/^\d{4}-\d{2}-\d{2}$/.test(v.closeDate) ||
      !Number.isFinite(Date.parse(v.closeDate))
    )
      bad("Deal title, lead and valid close date required");
  }
  if (kind === "payments") {
    r("dealId", "deals", false);
    n("amount");
    s("reference", 200);
    if (!v.dealId || !v.amount) bad("Deal and positive amount required");
  }
  if (kind === "products") {
    s("name", 200);
    s("sku", 100);
    n("price");
    n("stock");
    if (!v.name || !Number.isInteger(v.stock)) bad("Name and whole stock count required");
  }
  if (kind === "users") {
    s("name", 120);
    c("role", ["Manager", "Sales representative"]);
    field(
      "active",
      (x) => {
        if (typeof x !== "boolean") bad("Invalid active");
        return x;
      },
      true,
    );
    if (!v.name) bad("Name required");
  }
  if (kind === "lists") {
    s("name", 120);
    if (!v.name) bad("Name required");
  }
  return v;
}
async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const p of req) {
    size += p.length;
    if (size > 1048576) bad("Request too large", 413);
    chunks.push(p);
  }
  let p;
  try {
    p = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    bad("Invalid JSON");
  }
  if (!p || typeof p !== "object" || Array.isArray(p)) bad("Expected object");
  return p;
}
const extensions = createExtensions({ all, get, put, tx, stamp, log, bad });
kinds.push(...extensions.kinds);
const files = {
  "/": ["public/index.html", "text/html"],
  "/app.js": ["public/app.js", "text/javascript"],
  "/csv.js": ["public/csv.js", "text/javascript"],
  "/reports.js": ["public/reports.js", "text/javascript"],
  "/lead-views.js": ["public/lead-views.js", "text/javascript"],
  "/style.css": ["public/style.css", "text/css"],
};
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  const send = (status, v, headers) => {
    res.writeHead(status, headers || { "Content-Type": "application/json" });
    res.end(headers ? v : JSON.stringify(v));
  };
  try {
    const url = new URL(req.url, "http://localhost");
    if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(req.headers.host))
      bad("Unrecognized host", 403);
    if (!["GET", "HEAD"].includes(req.method)) {
      if (
        req.headers.origin &&
        !["http://localhost:" + port, "http://127.0.0.1:" + port].includes(req.headers.origin)
      )
        bad("Cross-origin write refused", 403);
      if (req.headers["content-type"]?.split(";")[0] !== "application/json")
        bad("JSON content type required", 415);
    }
    if (url.pathname === "/api/state" && req.method === "GET") {
      send(200, Object.fromEntries(kinds.map((k) => [k, all(k)])));
      return;
    }
    if (url.pathname === "/api/import" && req.method === "POST") {
      const p = await body(req);
      if (!Array.isArray(p.leads) || !p.leads.length || p.leads.length > 500)
        bad("Import 1–500 leads");
      const result = tx(() => {
        let added = 0,
          skipped = 0;
        const phones = new Set(all("leads").map((l) => l.phone.replace(/\D/g, "")));
        for (const row of p.leads) {
          if (!row || typeof row !== "object" || Array.isArray(row)) bad("Invalid row");
          const v = validate("leads", row),
            phone = v.phone.replace(/\D/g, "");
          if (phone && phones.has(phone)) {
            skipped++;
            continue;
          }
          const l = stamp({ ...v, firstTouchAt: null });
          put("leads", l);
          log(l.id, "System", "Lead imported");
          extensions.onEvent("Lead created", { leadId: l.id, eventId: l.id });
          if (phone) phones.add(phone);
          added++;
        }
        return { added, skipped };
      });
      send(200, result);
      return;
    }
    if (await extensions.handle(req, url, body, send)) return;
    const match = url.pathname.match(/^\/api\/([a-zA-Z]+)(?:\/([a-zA-Z0-9-]+))?$/);
    if (match && !kinds.includes(match[1])) bad("Not found", 404);
    if (match && ["POST", "PATCH"].includes(req.method)) {
      const [, kind, id] = match;
      if ((req.method === "POST" && id) || (req.method === "PATCH" && !id))
        bad("Unsupported route", 405);
      const p = await body(req);
      const result = tx(() => {
        if (kind === "activities") {
          if (id) bad("Activities are immutable");
          const leadId = ref("leads", p.leadId),
            type = one(p.type, ["Note", "Call", "Message", "Visit"], "activity type"),
            content = string(p.text, "text", 4000);
          if (!content) bad("Activity text required");
          const extra = {};
          if (type === "Call") {
            extra.outcome = one(
              p.outcome,
              ["Interested", "Callback", "No answer", "Not interested", "Connected"],
              "outcome",
            );
            extra.direction = one(p.direction, ["Incoming", "Outgoing"], "direction");
            extra.duration = num(p.duration, "duration");
            if (extra.duration > 86400) bad("Duration exceeds one day");
          }
          const a = log(leadId, type, content, extra),
            l = get("leads", leadId);
          l.firstTouchAt ||= now();
          if (
            type === "Call" &&
            ["Interested", "Connected"].includes(extra.outcome) &&
            l.stage === "New"
          )
            l.stage = "Prospecting";
          l.updatedAt = now();
          put("leads", l);
          if (type === "Call") {
            extensions.onEvent("Call outcome", { leadId, eventId: a.id });
            if (extra.outcome === "No answer" && extra.direction === "Incoming")
              extensions.onEvent("Missed call", { leadId, eventId: a.id });
          }
          if (type === "Visit") extensions.onEvent("Visit recorded", { leadId, eventId: a.id });
          return a;
        }
        const old = id ? get(kind, id) : null;
        if (id && !old) bad("Record not found", 404);
        const v = validate(kind, p, old || {}),
          record = id ? { ...v, updatedAt: now() } : stamp(v);
        if (kind === "leads" && !id) record.firstTouchAt = null;
        put(kind, record);
        const eventId = randomUUID();
        const event = (trigger, leadId = record.leadId) =>
          extensions.onEvent(trigger, { leadId, eventId });
        if (kind === "leads") {
          if (!old) event("Lead created", record.id);
          if (record.owner && record.owner !== old?.owner) event("Lead assigned", record.id);
          if (record.repeat && !old?.repeat) event("Repeat enquiry", record.id);
          if (record.stage === "Closed" && old?.stage !== "Closed") event("Lead closed", record.id);
        }
        if (kind === "tasks" && !old) event("Task created");
        if (kind === "tasks" && record.status === "Done" && old?.status !== "Done")
          event("Task completed");
        if (kind === "deals" && record.stage !== old?.stage) event("Deal stage changed");
        if (kind === "payments" && !old)
          event("Payment received", get("deals", record.dealId)?.leadId);
        if (kind === "conversations" && !old) event("Conversation opened");
        if (kind === "conversations" && record.status === "Resolved" && old?.status !== "Resolved")
          event("Conversation resolved");
        if (kind === "leads")
          log(record.id, "System", old ? "Lead details updated" : "Lead created");
        if (kind === "tasks" && record.leadId)
          log(
            record.leadId,
            "System",
            `Task ${record.status === "Done" ? "completed" : old ? "updated" : "scheduled"}: ${record.title}`,
          );
        if (kind === "deals") {
          log(record.leadId, "System", `Deal ${record.stage}: ${record.title}`);
          for (const leadId of new Set([record.leadId, old?.leadId].filter(Boolean))) {
            const l = get("leads", leadId),
              related = all("deals").filter((d) => d.leadId === leadId),
              previous = l.stage;
            if (related.some((d) => !["Won", "Lost"].includes(d.stage))) {
              l.stage = "Opportunity";
              l.disposition = "";
            } else if (related.length) {
              l.stage = "Closed";
              l.disposition = related.some((d) => d.stage === "Won") ? "Won" : "Lost";
            } else {
              l.stage = "Prospecting";
              l.disposition = "";
            }
            l.updatedAt = now();
            put("leads", l);
            if (l.stage === "Closed" && previous !== "Closed") event("Lead closed", leadId);
          }
        }
        return record;
      });
      send(200, result);
      return;
    }
    if (req.method === "GET" && files[url.pathname]) {
      const [path, type] = files[url.pathname];
      res.writeHead(200, { "Content-Type": type + "; charset=utf-8" });
      res.end(await readFile(new URL(path, import.meta.url)));
      return;
    }
    send(404, { error: "Not found" });
  } catch (e) {
    send(e.status || 500, { error: e.status ? e.message : "Unable to complete request" });
    if (!e.status) console.error(e);
  }
});
server.listen(port, "127.0.0.1", () => console.log(`Salesdesk CRM: http://localhost:${port}`));
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
