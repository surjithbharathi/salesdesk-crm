// Usage: node scripts/demo-kpi.mjs   (then open http://localhost:3188/next/)
// Starts the CRM on a throw-away database, adds a week of invented calls, stage changes and tasks for the demo users,
// and restarts it so the scorecard screens have something to show. Nothing here is real data.
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

const root = fileURLToPath(new URL("../", import.meta.url));
const dir = fileURLToPath(new URL("../data/", import.meta.url));
const file = `${dir}demo-kpi.sqlite`;
const port = process.env.PORT || "3188";
mkdirSync(dir, { recursive: true });
for (const s of ["", "-wal", "-shm", ".mobile-key", ".wa-key", ".ai-key", ".smtp-key"]) if (existsSync(file + s)) rmSync(file + s);
const env = { ...process.env, CRM_DB: file, PORT: port, MOBILE_PORT: String(Number(port) + 1), BIND_HOST: "127.0.0.1" };
const run = () => spawn(process.execPath, ["server.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "inherit"] });

// 1) first start seeds the demo users and leads
let child = run();
await new Promise((resolve) => child.stdout.on("data", (d) => String(d).includes("Salesdesk CRM:") && resolve()));
child.kill("SIGTERM");
await once(child, "exit");

// 2) add invented activity
const db = new DatabaseSync(file);
db.exec("PRAGMA busy_timeout=5000");
const rows = (kind) => db.prepare("SELECT body FROM records WHERE kind=?").all(kind).map((r) => JSON.parse(r.body));
const put = (kind, v) => db.prepare("INSERT OR REPLACE INTO records VALUES(?,?,?)").run(kind, v.id, JSON.stringify(v));
let seed = 11;
const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const users = rows("users").filter((u) => u.active !== false);
const make = (id, extra) => ({ id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...extra });
const perDay = [[44, 41, 40, 43, 42, 22, 41], [31, 38, 20, 36, 41, 40, 12], [18, 25, 33, 19, 28, 30, 22]];
const istMidnight = (daysAgo) => {
  const ist = new Date(Date.now() + 330 * 60000);
  return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - daysAgo) - 330 * 60000;
};
let n = 0;
users.forEach((user, ui) => {
  db.prepare("INSERT OR REPLACE INTO mobile_devices(id,token_hash,body) VALUES(?,NULL,?)").run(`demo-dev-${ui}`, JSON.stringify({ id: `demo-dev-${ui}`, owner: user.id, name: `${user.name} phone` }));
  const mine = [];
  for (let i = 0; i < 60; i++) {
    const lead = make(`demo-lead-${ui}-${i}`, {
      name: `${["Sri", "Sakthi", "Annai", "Vel"][i % 4]} ${["Oils", "Agro", "Traders", "Mills"][i % 4]} ${i}`, phone: `+9198400${String(ui * 100 + i).padStart(5, "0")}`,
      owner: user.id, stage: i % 9 === 0 ? "Closed" : i % 5 === 0 ? "Quotation given" : i % 3 === 0 ? "Prospecting" : "New",
      disposition: i % 9 === 0 ? "Won" : "", value: 150000 + (i % 7) * 90000, source: "IndiaMART", city: "Coimbatore", product: "20 kg wooden press",
      firstTouchAt: i % 3 ? "2026-10-20T10:00:00.000Z" : null,
    });
    put("leads", lead);
    mine.push(lead);
    if (i % 9 === 0 && i < 40) put("activities", make(`demo-win-${ui}-${i}`, { leadId: lead.id, type: "System", text: "Lead stage changed: Quotation given → Closed", createdAt: new Date(Date.now() - (i % 20) * 86400000).toISOString() }));
    if (i % 5 === 0 && i < 30) put("activities", make(`demo-quote-${ui}-${i}`, { leadId: lead.id, type: "System", text: "Lead stage changed: Opportunity → Quotation given", createdAt: new Date(Date.now() - (i % 4) * 3600000).toISOString() }));
    if (i % 7 === 0) put("tasks", make(`demo-task-${ui}-${i}`, { leadId: lead.id, title: "Call again", owner: user.id, due: new Date(Date.now() + (i % 3 - 1) * 86400000).toISOString(), status: "Open" }));
  }
  (perDay[ui % perDay.length]).forEach((count, daysAgo) => {
    for (let i = 0; i < count; i++) {
      const t = Math.min(istMidnight(daysAgo) + (9 * 60 + 15 + i * ((8 * 60) / count)) * 60000, Date.now() - 60000);
      put("mobileCalls", make(`demo-call-${++n}`, { localId: String(n), phone: mine[(i + daysAgo * 7) % mine.length].phone, direction: "Outgoing", startedAt: t, duration: random() < 0.33 ? 40 + Math.floor(random() * 300) : 0, deviceId: `demo-dev-${ui}`, leadId: mine[(i + daysAgo * 7) % mine.length].id }));
    }
  });
});
db.close();

// 3) start for real
child = run();
child.stdout.pipe(process.stdout);
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
