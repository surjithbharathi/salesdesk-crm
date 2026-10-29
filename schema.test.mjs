import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate, listMigrations } from "./db-migrate.mjs";

const migrationsDir = fileURLToPath(new URL("./migrations/", import.meta.url));

function freshDb(t) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  t.after(() => db.close());
  migrate(db, migrationsDir);
  return db;
}
const now = "2026-10-29T10:00:00.000Z";
function addLead(db, id, fields = {}) {
  const row = {
    id,
    name: "Lead " + id,
    status_id: "st_new_lead",
    created_at: now,
    updated_at: now,
    ...fields,
  };
  const columns = Object.keys(row);
  db.prepare(
    `INSERT INTO leads (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
  ).run(...Object.values(row));
  return id;
}
const throwsSql = (fn, pattern) => assert.throws(fn, pattern);

test("migrations apply in order, are idempotent and dry-run changes nothing", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const dry = migrate(db, migrationsDir, { dryRun: true });
    assert.deepEqual(dry.pending, listMigrations(migrationsDir).map((m) => m.file));
    assert.equal(db.prepare("SELECT count(*) c FROM sqlite_master WHERE name='leads'").get().c, 0);
    const first = migrate(db, migrationsDir);
    assert.deepEqual(first.applied, ["001_core.sql", "002_ai.sql", "003_seed.sql"]);
    assert.equal(first.to, 3);
    const second = migrate(db, migrationsDir);
    assert.deepEqual(second.applied, []);
    assert.deepEqual(second.pending, []);
    assert.equal(db.prepare("SELECT count(*) c FROM schema_migrations").get().c, 3);
  } finally {
    db.close();
  }
});

test("an edited, removed or failing migration is refused and rolled back", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "salesdesk-mig-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(migrationsDir, dir, { recursive: true });
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  migrate(db, dir);
  appendFileSync(join(dir, "001_core.sql"), "\n-- edited later\n");
  assert.throws(() => migrate(db, dir), /modified after it was applied/);
  rmSync(join(dir, "003_seed.sql"));
  cpSync(join(migrationsDir, "003_seed.sql"), join(dir, "003_seed.sql"));
  cpSync(join(migrationsDir, "001_core.sql"), join(dir, "001_core.sql"));
  writeFileSync(join(dir, "004_bad.sql"), "CREATE TABLE ok_table(x); INSERT INTO nonexistent VALUES(1);");
  assert.throws(() => migrate(db, dir), /004_bad\.sql failed and was rolled back/);
  assert.equal(db.prepare("SELECT count(*) c FROM sqlite_master WHERE name='ok_table'").get().c, 0);
  assert.equal(db.prepare("SELECT count(*) c FROM schema_migrations").get().c, 3);
  rmSync(join(dir, "002_ai.sql"));
  rmSync(join(dir, "004_bad.sql"));
  assert.throws(() => migrate(db, dir), /missing from/);
  assert.ok(readdirSync(dir).length >= 2);
});

test("migrate CLI works from a path with spaces, keeps legacy tables and honours --dry-run", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "salesdesk cli "));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "crm copy.sqlite");
  const seed = new DatabaseSync(file);
  seed.exec("CREATE TABLE records(kind TEXT,id TEXT,body TEXT); INSERT INTO records VALUES('leads','1','{}')");
  seed.close();
  const run = (...args) =>
    spawnSync(process.execPath, [fileURLToPath(new URL("./scripts/migrate.mjs", import.meta.url)), file, ...args], {
      encoding: "utf8",
    });
  const dry = run("--dry-run");
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Dry run/);
  const check = new DatabaseSync(file);
  assert.equal(check.prepare("SELECT count(*) c FROM sqlite_master WHERE name='leads'").get().c, 0);
  check.close();
  const real = run();
  assert.equal(real.status, 0, real.stderr);
  assert.match(real.stdout, /003_seed\.sql/);
  const after = new DatabaseSync(file);
  assert.equal(after.prepare("SELECT count(*) c FROM statuses").get().c, 17);
  assert.equal(after.prepare("SELECT count(*) c FROM records").get().c, 1); // legacy data untouched
  after.close();
  assert.equal(run("--bogus").status, 2);
  assert.equal(spawnSync(process.execPath, [fileURLToPath(new URL("./scripts/migrate.mjs", import.meta.url)), join(dir, "missing.sqlite")]).status, 2);
});

test("seed data: 17 statuses in four groups, aliases, merged lost reasons, outcomes, roles, agents off", (t) => {
  const db = freshDb(t);
  const groups = Object.fromEntries(
    db.prepare("SELECT stage_group g, count(*) c FROM statuses GROUP BY stage_group").all().map((r) => [r.g, r.c]),
  );
  assert.deepEqual(groups, { ACTIVE: 14, FRESH: 1, LOST: 1, WON: 1 });
  assert.equal(db.prepare("SELECT count(*) c FROM statuses").get().c, 17);
  const status = (alias) =>
    db.prepare("SELECT s.label FROM status_aliases a JOIN statuses s ON s.id=a.status_id WHERE a.alias=?").get(alias)?.label;
  assert.equal(status("Intrested Customer"), "Interested Customer");
  assert.equal(status("intrested customer"), "Interested Customer"); // case-insensitive
  assert.equal(status("New"), "New Lead");
  assert.equal(status("Opportunity"), "Interested Customer");
  const reason = (alias) =>
    db.prepare("SELECT r.label FROM lost_reason_aliases a JOIN lost_reasons r ON r.id=a.lost_reason_id WHERE a.alias=?").get(alias)?.label;
  assert.equal(reason("Budget Issues"), reason("Price / Budget Issue"));
  assert.equal(reason("Unable to Connect"), "No response after multiple attempts");
  assert.equal(reason("Product does not fit need"), "Product not suitable");
  assert.equal(db.prepare("SELECT count(*) c FROM lost_reasons WHERE is_default=1").get().c, 1);
  throwsSql(() => db.prepare("UPDATE lost_reasons SET is_default=1 WHERE id='lr_no_need'").run(), /UNIQUE/);
  const outcome = db.prepare("SELECT effect FROM call_outcomes WHERE label='Interested'").get();
  assert.equal(outcome.effect, "open_opportunity");
  assert.equal(db.prepare("SELECT count(*) c FROM roles").get().c, 4);
  assert.equal(db.prepare("SELECT count(*) c FROM agents WHERE enabled=0").get().c, 7);
  assert.equal(db.prepare("SELECT value v FROM policy WHERE key='kill_switch'").get().v, "0");
  assert.equal(db.prepare("SELECT count(*) c FROM lead_sources").get().c, 25);
});

test("phone numbers: canonical format enforced, unique across leads and alternate numbers", (t) => {
  const db = freshDb(t);
  addLead(db, "a", { phone_e164: "919876543210" });
  for (const bad of ["0123456789", "98765", "91987654321012345", "+919876543210", "91 9876543210", "abcdefghij"])
    throwsSql(() => addLead(db, "bad-" + bad, { phone_e164: bad }), /CHECK/);
  throwsSql(() => addLead(db, "dup", { phone_e164: "919876543210" }), /UNIQUE/);
  addLead(db, "nophone-1"); // legacy leads without a number are allowed
  addLead(db, "nophone-2");
  addLead(db, "b", { phone_e164: "919876543211" });
  db.prepare("INSERT INTO lead_phones(phone_e164, lead_id, created_at) VALUES(?,?,?)").run("919000000001", "a", now);
  // an alternate number cannot belong to another lead, nor equal another lead's main number
  throwsSql(
    () => db.prepare("INSERT INTO lead_phones(phone_e164, lead_id, created_at) VALUES(?,?,?)").run("919000000001", "b", now),
    /UNIQUE/,
  );
  throwsSql(
    () => db.prepare("INSERT INTO lead_phones(phone_e164, lead_id, created_at) VALUES(?,?,?)").run("919876543211", "a", now),
    /already belongs to another lead/,
  );
  // and a lead cannot take a number that is another lead's alternate number
  throwsSql(() => addLead(db, "c", { phone_e164: "919000000001" }), /already belongs to another lead/);
  throwsSql(
    () => db.prepare("UPDATE leads SET phone_e164='919000000001' WHERE id='b'").run(),
    /already belongs to another lead/,
  );
  // the same lead may list its own main number as an alternate
  db.prepare("INSERT INTO lead_phones(phone_e164, lead_id, created_at) VALUES(?,?,?)").run("919876543210", "a", now);
});

test("integrity: status and group rules, write-once first source, JSON validity, foreign keys", (t) => {
  const db = freshDb(t);
  throwsSql(() => addLead(db, "x", { status_id: "st_missing" }), /FOREIGN KEY/);
  throwsSql(() => addLead(db, "x", { custom: "{not json" }), /CHECK/);
  throwsSql(() => addLead(db, "x", { rating: 6 }), /CHECK/);
  throwsSql(() => addLead(db, "x", { lead_protection: "Maybe" }), /CHECK/);
  addLead(db, "s", { first_source_id: "src_indiamart", latest_source_id: "src_indiamart" });
  db.prepare("UPDATE leads SET latest_source_id='src_whatsapp' WHERE id='s'").run(); // repeat enquiry
  throwsSql(() => db.prepare("UPDATE leads SET first_source_id='src_whatsapp' WHERE id='s'").run(), /cannot be changed/);
  db.prepare("UPDATE leads SET first_source_id='src_indiamart' WHERE id='s'").run(); // unchanged value is fine
  addLead(db, "n"); // first source can be set once when it was unknown
  db.prepare("UPDATE leads SET first_source_id='src_manual' WHERE id='n'").run();
  throwsSql(() => db.prepare("INSERT INTO statuses VALUES('z','Z','NOPE','new',99,0)").run(), /CHECK/);
  db.prepare("INSERT INTO lead_tags VALUES('s','tag_hot')").run();
  db.prepare("DELETE FROM leads WHERE id='s'").run();
  assert.equal(db.prepare("SELECT count(*) c FROM lead_tags").get().c, 0); // cascade
});

test("calls, activities, tasks and recordings enforce their rules", (t) => {
  const db = freshDb(t);
  addLead(db, "l", { phone_e164: "919876543210" });
  const call = (id, over = {}) =>
    db
      .prepare(
        "INSERT INTO calls(id,lead_id,device_id,local_id,phone_e164,direction,started_at,duration_seconds,connected,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(id, "l", over.device ?? "d1", over.local ?? id, "919876543210", over.direction ?? "Outgoing", now, over.duration ?? 30, 1, now);
  call("c1");
  throwsSql(() => call("c1b", { local: "c1" }), /UNIQUE/); // same device + local id
  call("c2", { device: "d2", local: "c1" }); // other device may reuse the local id
  throwsSql(() => call("c3", { direction: "Sideways" }), /CHECK/);
  throwsSql(() => call("c3", { duration: 90000 }), /CHECK/);
  assert.equal(
    db.prepare("SELECT count(*) c FROM calls WHERE outcome_id IS NULL AND connected=1").get().c,
    2,
  );
  db.prepare(
    "INSERT INTO recordings(id,call_id,device_id,sha256,mime,size_bytes,storage_path,iv,tag,created_at) VALUES('r1','c1','d1','abc','audio/ogg',10,'ab/r1.enc',x'00',x'00',?)",
  ).run(now);
  throwsSql(
    () =>
      db
        .prepare(
          "INSERT INTO recordings(id,call_id,device_id,sha256,mime,size_bytes,storage_path,iv,tag,created_at) VALUES('r2','c1','d1','def','audio/ogg',10,'ab/r2.enc',x'00',x'00',?)",
        )
        .run(now),
    /UNIQUE/,
  ); // one recording per call
  db.prepare("INSERT INTO activities(id,lead_id,type,occurred_at,created_at,call_id) VALUES('a1','l','call',?,?,'c1')").run(now, now);
  throwsSql(
    () => db.prepare("INSERT INTO activities(id,lead_id,type,occurred_at,created_at,data) VALUES('a2','l','note',?,?,'oops')").run(now, now),
    /CHECK/,
  );
  throwsSql(
    () => db.prepare("INSERT INTO tasks(id,lead_id,title,due_at,status,created_at,updated_at) VALUES('t1','l','x',?, 'Maybe',?,?)").run(now, now, now),
    /CHECK/,
  );
});

test("AI tables: queue, proposals, insights and Tamil-capable transcript search", (t) => {
  const db = freshDb(t);
  addLead(db, "l", { phone_e164: "919876543210" });
  db.prepare(
    "INSERT INTO calls(id,lead_id,phone_e164,direction,started_at,duration_seconds,connected,created_at) VALUES('c','l','919876543210','Outgoing',?,60,1,?)",
  ).run(now, now);
  const transcript = (id, call, text) =>
    db
      .prepare("INSERT INTO transcripts(id,call_id,language,segments,full_text,created_at) VALUES(?,?,?,?,?,?)")
      .run(id, call, "ta", JSON.stringify([{ start: 0, end: 5, speaker: "customer", text }]), text, now);
  transcript("tr1", "c", "எனக்கு ஆயில் மெஷின் வேணும், cold press 20 kg capacity");
  const search = (term) => db.prepare("SELECT t.id FROM transcripts_fts f JOIN transcripts t ON t.rowid=f.rowid WHERE transcripts_fts MATCH ?").all(term).map((r) => r.id);
  assert.deepEqual(search("மெஷின்"), ["tr1"]); // whole Tamil word, vowel signs intact
  assert.deepEqual(search("ஆயில்"), ["tr1"]);
  assert.deepEqual(search("capacity"), ["tr1"]);
  assert.deepEqual(search("மெஷ"), []); // prefix of a word is not a match without *
  assert.deepEqual(search("மெஷ*"), ["tr1"]);
  db.prepare("UPDATE transcripts SET full_text='quotation தேவை' WHERE id='tr1'").run();
  assert.deepEqual(search("மெஷின்"), []);
  assert.deepEqual(search("quotation"), ["tr1"]);
  db.prepare("DELETE FROM transcripts WHERE id='tr1'").run();
  assert.deepEqual(search("quotation"), []);

  db.prepare("INSERT INTO ai_jobs(id,kind,created_at) VALUES('j1','transcribe',?)").run(now);
  assert.equal(db.prepare("SELECT status FROM ai_jobs WHERE id='j1'").get().status, "queued");
  throwsSql(() => db.prepare("UPDATE ai_jobs SET status='stuck' WHERE id='j1'").run(), /CHECK/);
  db.prepare("INSERT INTO insights(id,lead_id,source_type,source_id,kind,data,confidence,created_at) VALUES('i1','l','call','c','call_summary','{\"machines\":[\"cold press 20kg\"]}',0.9,?)").run(now);
  throwsSql(() => db.prepare("UPDATE insights SET confidence=1.5 WHERE id='i1'").run(), /CHECK/);
  db.prepare("INSERT INTO proposals(id,agent_id,lead_id,action,payload,risk,created_at) VALUES('p1','agent_sales','l','create_task','{\"title\":\"Prepare quotation\"}','low',?)").run(now);
  assert.equal(db.prepare("SELECT status FROM proposals WHERE id='p1'").get().status, "pending");
  throwsSql(() => db.prepare("INSERT INTO proposals(id,agent_id,action,payload,risk,created_at) VALUES('p2','agent_sales','x','{}','whenever',?)").run(now), /CHECK/);
  throwsSql(() => db.prepare("UPDATE agents SET autonomy=5 WHERE id='agent_sales'").run(), /CHECK/);
});

test("25,000 leads: key lookups use indexes and stay fast", (t) => {
  const db = freshDb(t);
  const insert = db.prepare(
    "INSERT INTO leads(id,name,phone_e164,status_id,owner_id,first_source_id,created_at,updated_at,next_followup_at) VALUES(?,?,?,?,?,?,?,?,?)",
  );
  db.exec("INSERT INTO users(id,name,created_at,updated_at) VALUES('u1','A','x','x'),('u2','B','x','x'),('u3','C','x','x')");
  const statuses = db.prepare("SELECT id FROM statuses").all().map((r) => r.id);
  const sources = db.prepare("SELECT id FROM lead_sources").all().map((r) => r.id);
  db.exec("BEGIN");
  for (let i = 0; i < 25000; i++)
    insert.run(
      "lead-" + i,
      "Lead " + i,
      String(919000000000 + i),
      statuses[i % statuses.length],
      "u" + ((i % 3) + 1),
      sources[i % sources.length],
      new Date(1790000000000 + i * 1000).toISOString(),
      new Date(1790000000000 + i * 1000).toISOString(),
      i % 5 === 0 ? new Date(1790000000000 + i * 60000).toISOString() : null,
    );
  db.exec("COMMIT");
  const plan = (sql, ...args) =>
    db.prepare("EXPLAIN QUERY PLAN " + sql).all(...args).map((r) => r.detail).join(" | ");
  const timed = (fn) => {
    const start = performance.now();
    const value = fn();
    return { value, ms: performance.now() - start };
  };
  // call matching: one indexed lookup by canonical phone
  assert.match(plan("SELECT id FROM leads WHERE phone_e164=?", "919000012345"), /USING (COVERING )?INDEX/);
  const lookup = timed(() => db.prepare("SELECT id FROM leads WHERE phone_e164=?").get("919000012345"));
  assert.equal(lookup.value.id, "lead-12345");
  assert.ok(lookup.ms < 50, `phone lookup took ${lookup.ms}ms`);
  // an owner's active leads in one status
  assert.match(plan("SELECT id FROM leads WHERE owner_id=? AND status_id=? AND archived_at IS NULL", "u1", "st_new_lead"), /leads_owner_status/);
  // keyset page of the newest leads
  const page = plan("SELECT id FROM leads WHERE (created_at, id) < (?,?) ORDER BY created_at DESC, id DESC LIMIT 50", "2999", "z");
  assert.match(page, /USING (COVERING )?INDEX/);
  const paged = timed(() => db.prepare("SELECT id FROM leads ORDER BY created_at DESC, id DESC LIMIT 50").all());
  assert.equal(paged.value.length, 50);
  assert.ok(paged.ms < 100, `list page took ${paged.ms}ms`);
  // dashboard-style counts and per-source report
  const counts = timed(() =>
    db.prepare("SELECT status_id, count(*) c FROM leads WHERE owner_id=? AND archived_at IS NULL GROUP BY status_id").all("u1"),
  );
  assert.equal(counts.value.length, 17);
  assert.ok(counts.ms < 150, `dashboard counts took ${counts.ms}ms`);
  const bySource = timed(() =>
    db.prepare("SELECT first_source_id, count(*) c FROM leads GROUP BY first_source_id").all(),
  );
  assert.equal(bySource.value.length, 25);
  assert.ok(bySource.ms < 200, `source report took ${bySource.ms}ms`);
});
