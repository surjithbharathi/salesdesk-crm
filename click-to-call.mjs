import { randomUUID } from "node:crypto";
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
// canCall: a person may dial their own leads; the server also lets them dial unassigned leads, and administrators any lead
export function createClickToCall({ db, getLead, getDevice, canCall = (userId, l) => l.owner === userId, now = () => Date.now() }) {
  db.exec(`CREATE TABLE IF NOT EXISTS call_receiver(device_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,seen INTEGER NOT NULL,armed INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS company_sim(user_id TEXT PRIMARY KEY,sim_key TEXT NOT NULL,label TEXT NOT NULL,set_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS call_commands(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,device_id TEXT NOT NULL,request_id TEXT NOT NULL,lead_id TEXT NOT NULL,phone TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,status TEXT NOT NULL,UNIQUE(user_id,request_id));`);
  const expose = (r) => ({
    id: r.id,
    leadId: r.lead_id,
    deviceId: r.device_id,
    phone: r.phone,
    status: r.status,
    expiresAt: r.expires,
  });
  function checkDevice(userId, id) {
    const d = getDevice(id);
    if (!d || d.revoked || d.owner !== userId) fail("Phone not accessible", 403);
    return d;
  }
  function checkLead(userId, id) {
    const l = getLead(id);
    if (!l || l.archived || !canCall(userId, l)) fail("Choose your assigned active lead", 403);
    return l;
  }
  function expire() {
    db.prepare(
      "UPDATE call_commands SET status='Expired' WHERE status='Pending' AND expires<=?",
    ).run(now());
  }
  function receivers(userId) {
    expire();
    return db
      .prepare("SELECT * FROM call_receiver WHERE user_id=?")
      .all(userId)
      .filter((r) => {
        try {
          checkDevice(userId, r.device_id);
          return true;
        } catch {
          return false;
        }
      })
      .map((r) => ({
        id: r.device_id,
        name: getDevice(r.device_id).name,
        ready: !!r.armed && now() - r.seen < 15000,
        lastSeenAt: r.seen,
      }));
  }
  function request(userId, { leadId, deviceId, requestId, confirmed }) {
    if (confirmed !== true) fail("Confirm this phone call");
    if (!/^[a-f0-9-]{36}$/i.test(requestId || "")) fail("Request ID required");
    checkDevice(userId, deviceId);
    const l = checkLead(userId, leadId);
    const phone = String(l.phone || "").replace(/[ ()-]/g, "");
    if (!/^\+?[1-9]\d{7,14}$/.test(phone))
      fail("Lead needs a full international number; extensions/USSD are not allowed");
    expire();
    const old = db
      .prepare("SELECT * FROM call_commands WHERE user_id=? AND request_id=?")
      .get(userId, requestId);
    if (old) {
      if (old.lead_id !== leadId || old.device_id !== deviceId || old.phone !== phone)
        fail("Request ID already used", 409);
      return expose(old);
    }
    if (!receivers(userId).some((d) => d.id === deviceId && d.ready))
      fail("Open Salesdesk on your phone and enable click-to-call first", 409);
    const recent = db
      .prepare("SELECT 1 FROM call_commands WHERE user_id=? AND (status='Pending' OR created>?)")
      .get(userId, now() - 10000);
    if (recent)
      fail("A call request is pending or was just sent. Check your phone before retrying.", 409);
    const id = randomUUID();
    db.prepare("INSERT INTO call_commands VALUES(?,?,?,?,?,?,?,?,?)").run(
      id,
      userId,
      deviceId,
      requestId,
      leadId,
      phone,
      now(),
      now() + 30000,
      "Pending",
    );
    return expose(db.prepare("SELECT * FROM call_commands WHERE id=?").get(id));
  }
  function poll(userId, deviceId, armed) {
    checkDevice(userId, deviceId);
    expire();
    db.prepare(
      "INSERT INTO call_receiver VALUES(?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET user_id=excluded.user_id,seen=excluded.seen,armed=excluded.armed",
    ).run(deviceId, userId, now(), armed === true ? 1 : 0);
    if (armed !== true) {
      db.prepare(
        "UPDATE call_commands SET status='Cancelled' WHERE device_id=? AND status='Pending'",
      ).run(deviceId);
      return { command: null };
    }
    const r = db
      .prepare(
        "SELECT * FROM call_commands WHERE device_id=? AND user_id=? AND status='Pending' ORDER BY created LIMIT 1",
      )
      .get(deviceId, userId);
    if (!r) return { command: null };
    try {
      const l = checkLead(userId, r.lead_id);
      if (String(l.phone || "").replace(/[ ()-]/g, "") !== r.phone) throw Error();
    } catch {
      db.prepare("UPDATE call_commands SET status='Cancelled' WHERE id=?").run(r.id);
      return { command: null };
    }
    // Claim before responding: a lost response must never redial automatically.
    db.prepare("UPDATE call_commands SET status='Claimed' WHERE id=? AND status='Pending'").run(
      r.id,
    );
    return { command: { ...expose(r), status: "Claimed" } };
  }
  function acknowledge(userId, deviceId, id, status) {
    checkDevice(userId, deviceId);
    if (!["Dialer launched", "Failed", "Company SIM missing"].includes(status)) fail("Invalid call status");
    const r = db
      .prepare("SELECT * FROM call_commands WHERE id=? AND user_id=? AND device_id=?")
      .get(id, userId, deviceId);
    if (!r) fail("Call request not found", 404);
    if (r.status === "Claimed")
      db.prepare("UPDATE call_commands SET status=? WHERE id=?").run(status, id);
    return { status: db.prepare("SELECT status FROM call_commands WHERE id=?").get(id).status };
  }
  // the status of one of this person's call requests, so the web screen can say what the phone did
  function status(userId, id) {
    expire();
    const r = db.prepare("SELECT * FROM call_commands WHERE id=? AND user_id=?").get(id, userId);
    if (!r) fail("Call request not found", 404);
    return expose(r);
  }
  // The company SIM: the SIM a person's CRM calls always go through. The phone app sets it once; after that only an
  // admin can clear it (resetCompanySim), so nobody switches CRM calls to a personal SIM.
  const simOf = (r) => (r ? { key: r.sim_key, label: r.label, setAt: r.set_at } : { key: null, label: "", setAt: null });
  function companySim(userId) {
    return simOf(db.prepare("SELECT * FROM company_sim WHERE user_id=?").get(userId));
  }
  function setCompanySim(userId, { key, label } = {}) {
    if (!/^[a-f0-9]{64}$/.test(key || "")) fail("Invalid SIM");
    const name = String(label || "").trim().slice(0, 80) || "Company SIM";
    const old = db.prepare("SELECT * FROM company_sim WHERE user_id=?").get(userId);
    if (old && old.sim_key !== key) fail("Only your admin can change the company SIM", 409);
    if (!old) db.prepare("INSERT INTO company_sim VALUES(?,?,?,?)").run(userId, key, name, now());
    return companySim(userId);
  }
  function companySims() {
    return Object.fromEntries(db.prepare("SELECT * FROM company_sim").all().map((r) => [r.user_id, simOf(r)]));
  }
  function resetCompanySim(userId) {
    db.prepare("DELETE FROM company_sim WHERE user_id=?").run(userId);
    return companySim(userId);
  }
  return { receivers, request, poll, acknowledge, status, companySim, setCompanySim, companySims, resetCompanySim };
}
