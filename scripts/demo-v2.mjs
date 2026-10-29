// Usage: npm run demo:v2   (then open http://localhost:3100/next/)
// Builds a throw-away demo database with ~400 synthetic leads (data/demo-v2.sqlite, git-ignored), applies the new
// schema, and starts the server with ENABLE_V2=true. Everything here is invented; no real customer data.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { migrate } from "../db-migrate.mjs";
import { createStore } from "../store.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const dataDir = fileURLToPath(new URL("../data/", import.meta.url));
const file = process.env.DEMO_DB || `${dataDir}demo-v2.sqlite`;
const port = process.env.PORT || "3100";

function build() {
  mkdirSync(dataDir, { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) if (existsSync(file + suffix)) rmSync(file + suffix);
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL");
  migrate(db, fileURLToPath(new URL("../migrations/", import.meta.url)));
  let seed = 20261029;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (list) => list[Math.floor(random() * list.length)];
  let clock = Date.now() - 75 * 86400000;
  const store = createStore(db, { now: () => new Date(clock).toISOString() });
  const reps = [["u1", "Asha"], ["u2", "Ravi"], ["u3", "Meena"], ["u4", "Karthik"]];
  db.exec("CREATE TABLE IF NOT EXISTS records(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))");
  for (const [id, name] of reps) {
    db.prepare("INSERT INTO users(id,name,role_id,created_at,updated_at) VALUES(?,?,?,?,?)").run(id, name, "role_caller", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    // the classic server needs users too, otherwise it would seed its own demo data
    db.prepare("INSERT INTO records VALUES('users',?,?)").run(id, JSON.stringify({ id, name, role: "Sales representative", active: true }));
  }
  // quality profile per source: share of leads, contact, answered, quotation, win, junk, hours to first call
  const sources = [
    ["IndiaMart", 0.42, 0.93, 0.72, 0.38, 0.15, 0.05, 0.5],
    ["Website", 0.14, 0.85, 0.65, 0.3, 0.13, 0.04, 2],
    ["Meta Ads", 0.22, 0.62, 0.38, 0.14, 0.04, 0.27, 9],
    ["Whatsapp", 0.1, 0.8, 0.6, 0.28, 0.1, 0.06, 1],
    ["Customer Referral", 0.06, 0.97, 0.85, 0.55, 0.3, 0.01, 0.3],
    ["Exhibition", 0.06, 0.7, 0.5, 0.25, 0.1, 0.1, 24],
  ];
  const lostFor = (label) =>
    label === "Meta Ads"
      ? ["No response after multiple attempts", "No response after multiple attempts", "Wrong number", "Price / budget issue", "No Need"]
      : ["Price / budget issue", "Lost to competitor", "Purchase postponed", "Finance not approved", "No Need", "Product not suitable"];
  const machines = ["Wooden cold press 20 kg/hr", "Automatic rotary oil machine", "Filter press", "Commercial oil expeller", "Groundnut decorticator"];
  const towns = ["Coimbatore", "Salem", "Erode", "Madurai", "Tiruppur", "Hosur", "Bengaluru", "Hyderabad"];
  const total = 400;
  let phone = 9840000000;
  const times = Array.from({ length: total }, () => Date.now() - 74 * 86400000 + random() * 74 * 86400000).sort((a, b) => a - b);
  times.forEach((created, index) => {
    let r = random(), profile = sources[0];
    for (const s of sources) {
      if (r < s[1]) { profile = s; break; }
      r -= s[1];
    }
    const [label, , contactRate, answerRate, quoteRate, winRate, junkRate, delayHours] = profile;
    const owner = reps[index % reps.length][0];
    clock = created;
    const lead = store.createLead({
      name: `${pick(["Sri", "Sakthi", "Annai", "Murugan", "Lakshmi", "Vel", "Kumaran", "Balaji"])} ${pick(["Oils", "Agro", "Traders", "Industries", "Mills", "Enterprises"])}`,
      phone: String(++phone), source: label, owner, company: pick(["", "", "Pvt Ltd"]), city: pick(towns),
      productInterested: pick(machines), expectedValue: Math.round((150000 + random() * 600000) / 1000) * 1000,
    });
    const stamp = (extraMinutes) => { clock = created + extraMinutes * 60000; return new Date(clock).toISOString(); };
    if (random() < 0.07) { stamp(5); store.captureLead({ name: lead.name, phone: lead.phone_e164, source: pick(["Whatsapp", "IndiaMart"]) }); }
    if (random() > contactRate) {
      if (random() < 0.4) { stamp(60 * 24 * 3); store.setStatus(lead.id, "Lost", { lostReason: pick(lostFor(label)) }); }
      return; // never contacted
    }
    const start = created + (delayHours * 60 + random() * 90) * 60000;
    const answered = random() < answerRate;
    const call = store.logCall({
      phone: lead.phone_e164, direction: "Outgoing", startedAt: new Date(start).toISOString(),
      duration: answered ? 30 + Math.floor(random() * 420) : 0, deviceId: "demo", localId: lead.id, userId: owner,
    }).call;
    clock = start + 600000;
    if (!answered) {
      if (random() < 0.35) { clock = start + 86400000 * 4; store.setStatus(lead.id, "Lost", { lostReason: pick(lostFor(label)) }); }
      else store.addTask({ leadId: lead.id, ownerId: owner, title: "Call again", dueAt: new Date(Date.now() + (random() * 6 - 3) * 86400000).toISOString() });
      return;
    }
    if (random() < junkRate / Math.max(answerRate, 0.01)) {
      store.setCallOutcome(call.id, "Wrong number");
      return;
    }
    if (random() > 0.55 + quoteRate) { store.setCallOutcome(call.id, "Not interested"); return; }
    store.setCallOutcome(call.id, "Interested");
    if (random() < quoteRate / 0.6) {
      clock = start + 2 * 86400000;
      store.setStatus(lead.id, "Quotation Shared", { userId: owner });
      const outcomeRoll = random();
      clock = start + 9 * 86400000;
      if (outcomeRoll < winRate / quoteRate * 1.0) store.setStatus(lead.id, "Won", { userId: owner });
      else if (outcomeRoll < 0.75) store.setStatus(lead.id, "Lost", { lostReason: pick(lostFor(label)) });
      else store.addTask({ leadId: lead.id, ownerId: owner, title: "Follow up on quotation", dueAt: new Date(Date.now() + (random() * 4 - 1.5) * 86400000).toISOString() });
    } else if (random() < 0.5) {
      store.addTask({ leadId: lead.id, ownerId: owner, title: "Send machine details", dueAt: new Date(Date.now() + (random() * 3 - 1) * 86400000).toISOString() });
    }
  });
  // Recent working days, so the scorecard has something to show: calls per day for each person (today first).
  const perDay = { u1: [44, 41, 40, 43, 42, 22, 41], u2: [31, 38, 20, 36, 41, 40, 12], u3: [18, 25, 33, 19, 28, 30, 22], u4: [6, 14, 9, 21, 17, 12, 8] };
  const istMidnight = (daysAgo) => {
    const ist = new Date(Date.now() + 330 * 60000);
    return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - daysAgo) - 330 * 60000;
  };
  let serial = 0;
  for (const [userId, counts] of Object.entries(perDay)) {
    const leads = db.prepare("SELECT phone_e164 p FROM leads WHERE owner_id=? ORDER BY phone_e164").all(userId);
    counts.forEach((n, daysAgo) => {
      for (let i = 0; i < n; i++) {
        const t = Math.min(istMidnight(daysAgo) + (9 * 60 + 15 + i * (8 * 60 / n)) * 60000, Date.now() - 60000);
        store.logCall({
          phone: leads[(i + daysAgo * 7) % leads.length].p, direction: "Outgoing", startedAt: new Date(t).toISOString(),
          duration: random() < 0.33 ? 40 + Math.floor(random() * 300) : 0, deviceId: "demo-day", localId: `d${++serial}`, userId,
        });
      }
    });
  }
  const counts = db.prepare("SELECT (SELECT count(*) FROM leads) l, (SELECT count(*) FROM calls) c, (SELECT count(*) FROM activities) a").get();
  console.log(`Demo database ready: ${counts.l} leads, ${counts.c} calls, ${counts.a} activities`);
  db.close();
}

build();
console.log(`Starting the CRM with the new data layer on http://localhost:${port}/next/  (Ctrl+C to stop)`);
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, CRM_DB: file, PORT: port, MOBILE_PORT: String(Number(port) + 1), ENABLE_V2: "true" },
});
server.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
