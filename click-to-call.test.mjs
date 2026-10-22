import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { createClickToCall } from "./click-to-call.mjs";
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  let time = 100000;
  const leads = {
    lead: { id: "lead", owner: "u", phone: "+91 98765 43210" },
    other: { id: "other", owner: "v", phone: "919876543211" },
  };
  const devices = {
    phone: { id: "phone", owner: "u", name: "My phone" },
    other: { id: "other", owner: "v", name: "Other phone" },
  };
  return {
    service: createClickToCall({
      db,
      getLead: (id) => leads[id],
      getDevice: (id) => devices[id],
      now: () => time,
    }),
    leads,
    devices,
    advance: (n) => (time += n),
  };
}
const request = (f, extra = {}) =>
  f.service.request("u", {
    leadId: "lead",
    deviceId: "phone",
    requestId: randomUUID(),
    confirmed: true,
    ...extra,
  });
test("Ready same-user phone claims a web call only once and acknowledges without claiming a connected call", (t) => {
  const f = fixture(t);
  assert.equal(f.service.poll("u", "phone", true).command, null);
  const r = request(f);
  assert.equal(r.status, "Pending");
  assert.equal(r.phone, "+919876543210");
  const claimed = f.service.poll("u", "phone", true).command;
  assert.equal(claimed.id, r.id);
  assert.equal(f.service.poll("u", "phone", true).command, null);
  assert.equal(
    f.service.acknowledge("u", "phone", r.id, "Dialer launched").status,
    "Dialer launched",
  );
  assert.throws(() => request(f), /just sent/);
});
test("Offline, disarmed, expired and revoked phone requests never deliver", (t) => {
  const f = fixture(t);
  assert.throws(() => request(f), /enable click-to-call/);
  f.service.poll("u", "phone", true);
  f.advance(16000);
  assert.throws(() => request(f), /enable click-to-call/);
  f.service.poll("u", "phone", true);
  request(f);
  f.advance(31000);
  assert.equal(f.service.poll("u", "phone", true).command, null);
  f.devices.phone.revoked = true;
  assert.throws(() => f.service.poll("u", "phone", true), /not accessible/);
});
test("Ownership, consent and safe number checks reject tampered requests", (t) => {
  const f = fixture(t);
  f.service.poll("u", "phone", true);
  assert.throws(() => request(f, { leadId: "other" }), /assigned/);
  assert.throws(() => request(f, { deviceId: "other" }), /accessible/);
  assert.throws(() => request(f, { confirmed: false }), /Confirm/);
  f.leads.lead.phone = "*123#";
  assert.throws(() => request(f), /international/);
});
test("Idempotency survives repeated clicks, rejects request reuse and never reissues a claimed request", (t) => {
  const f = fixture(t);
  f.service.poll("u", "phone", true);
  const id = randomUUID();
  const a = request(f, { requestId: id });
  assert.equal(request(f, { requestId: id }).id, a.id);
  f.service.poll("u", "phone", true);
  assert.equal(request(f, { requestId: id }).status, "Claimed");
  f.leads.lead.phone = "919111112222";
  assert.throws(() => request(f, { requestId: id }), /already used/);
});
test("Pending calls cancel if lead changes owner/number or the bridge is paused", (t) => {
  const f = fixture(t);
  f.service.poll("u", "phone", true);
  request(f);
  f.leads.lead.owner = "v";
  assert.equal(f.service.poll("u", "phone", true).command, null);
  f.leads.lead.owner = "u";
  f.advance(11000);
  request(f);
  assert.equal(f.service.poll("u", "phone", false).command, null);
  assert.equal(f.service.poll("u", "phone", true).command, null);
});
