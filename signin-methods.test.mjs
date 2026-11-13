import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUserAuth } from "./user-auth.mjs";
import { createSigninMethods, mobileKey, maskMobile } from "./signin-methods.mjs";

function fixture({ gatewayOn = true, fetchImpl } = {}) {
  const db = new DatabaseSync(":memory:");
  const people = [
    { id: "u1", name: "Priya Nair", email: "priya@devi.example", active: true },
    { id: "u2", name: "No Login", email: "nologin@devi.example", active: true },
    { id: "u3", name: "Left Company", email: "left@devi.example", active: false },
  ];
  const getUser = (id) => people.find((p) => p.id === id);
  let clock = 1_800_000_000_000;
  const now = () => clock;
  const auth = createUserAuth({ db, getUser, now });
  auth.bootstrap({ userId: "u1", username: "priya", password: "a sufficiently long password", company: "Devi" });
  db.prepare("INSERT INTO auth_accounts VALUES('u3','left','00','00','member')").run();
  const sent = [];
  const waGateway = {
    settings: () => ({ enabled: gatewayOn, baseUrl: "https://gw.example", hasKey: true }),
    sendSystem: async (to, input) => { sent.push({ to, ...input }); return {}; },
  };
  const s = createSigninMethods({ db, getUser, users: () => people, userAuth: auth, waGateway, checkUrl: async (u) => u, publicOrigin: "https://crm.example", keyPath: join(mkdtempSync(join(tmpdir(), "signin-")), "k"), now, fetchImpl });
  return { db, s, sent, people, advance: (ms) => (clock += ms) };
}

test("mobile numbers are normalised to 91XXXXXXXXXX and masked", () => {
  assert.equal(mobileKey("98765 00008"), "919876500008");
  assert.equal(mobileKey("+91 98765-00008"), "919876500008");
  assert.equal(mobileKey("09876500008"), "919876500008");
  assert.equal(mobileKey("12345"), "");
  assert.equal(maskMobile("919876500008"), "+91 98xxx xx008");
});

test("WhatsApp code signs in only the person who owns the saved number", async () => {
  const { s, sent, people, advance } = fixture();
  await assert.rejects(s.otpStart({ mobile: "9876500008" }), /not turned on/);
  await s.save({ otpEnabled: true, mobiles: { u1: "98765 00008" } }, people);
  assert.deepEqual(s.methods(), { otp: true, erp: false });
  const r = await s.otpStart({ mobile: "+91 9876500008" });
  assert.equal(r.sentTo, "+91 98xxx xx008");
  assert.equal(sent.length, 1);
  const code = sent[0].text.slice(0, 6);
  assert.match(code, /^\d{6}$/);
  await assert.rejects(s.otpStart({ mobile: "9876500008" }), /Wait a few seconds/);
  assert.throws(() => s.otpVerify({ mobile: "9876500008", code: code === "000000" ? "111111" : "000000" }), /not right/);
  const session = s.otpVerify({ mobile: "9876500008", code });
  assert.equal(session.user.id, "u1");
  assert.match(session.token, /^[A-Za-z0-9_-]{43}$/);
  assert.throws(() => s.otpVerify({ mobile: "9876500008", code }), /not right/, "a code works once");
  advance(31_000);
  await s.otpStart({ mobile: "9876500008" });
  advance(5 * 60 * 1000 + 1);
  assert.throws(() => s.otpVerify({ mobile: "9876500008", code: sent[1].text.slice(0, 6) }), /expired/, "codes expire after 5 minutes");
});

test("unknown numbers get the same answer but no message", async () => {
  const { s, sent, people } = fixture();
  await s.save({ otpEnabled: true, mobiles: { u1: "9876500008" } }, people);
  const r = await s.otpStart({ mobile: "9000000031" });
  assert.equal(r.ok, true);
  assert.equal(sent.length, 0);
});

test("five wrong codes end the code", async () => {
  const { s, sent, people } = fixture();
  await s.save({ otpEnabled: true, mobiles: { u1: "9876500008" } }, people);
  await s.otpStart({ mobile: "9876500008" });
  const code = sent[0].text.slice(0, 6);
  const wrong = code === "123456" ? "654321" : "123456";
  for (let i = 0; i < 5; i++) assert.throws(() => s.otpVerify({ mobile: "9876500008", code: wrong }));
  assert.throws(() => s.otpVerify({ mobile: "9876500008", code }), /not right/);
});

test("mobiles can only be saved for active people with a login, and not shared", async () => {
  const { s, people } = fixture();
  await assert.rejects(s.save({ mobiles: { u2: "9876500008" } }, people), /have a login/);
  await assert.rejects(s.save({ mobiles: { u1: "123" } }, people), /does not look right/);
  await assert.rejects(s.save({ otpEnabled: true }, fixture({ gatewayOn: false }).people).then(() => fixture({ gatewayOn: false }).s.save({ otpEnabled: true }, people)), /gateway first/);
});

test("Devi ERP sign-in checks state, then matches the ERP email to one login", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    if (url.endsWith("get_token")) return { ok: true, json: async () => ({ access_token: "tok" }) };
    return { ok: true, json: async () => ({ email: "Priya@Devi.example", email_verified: true }) };
  };
  const { s, people } = fixture({ fetchImpl });
  await assert.rejects(s.save({ erpEnabled: true }, people), /client secret first/);
  const view = await s.save({ erpBaseUrl: "https://erp.example/", erpClientId: "abc", erpClientSecret: "shh", erpEnabled: true }, people);
  assert.equal(view.erpHasSecret, true);
  assert.ok(!JSON.stringify(view).includes("shh"), "the secret is never sent back");
  const start = s.erpStart();
  assert.match(start.url, /^https:\/\/erp\.example\/api\/method\/frappe\.integrations\.oauth2\.authorize\?/);
  assert.match(start.url, /redirect_uri=https%3A%2F%2Fcrm\.example%2Fapi%2Fauth%2Ferp%2Fcallback/);
  await assert.rejects(s.erpCallback({ code: "c", state: start.state, browserState: "someone-elses-state-value" }), /expired/);
  const again = s.erpStart();
  const session = await s.erpCallback({ code: "c", state: again.state, browserState: again.state });
  assert.equal(session.user.id, "u1");
  await assert.rejects(s.erpCallback({ code: "c", state: again.state, browserState: again.state }), /expired/, "state works once");
});

test("Devi ERP emails with no matching login are refused", async () => {
  const fetchImpl = async (url) => (url.endsWith("get_token") ? { ok: true, json: async () => ({ access_token: "t" }) } : { ok: true, json: async () => ({ email: "left@devi.example" }) });
  const { s, people } = fixture({ fetchImpl });
  await s.save({ erpBaseUrl: "https://erp.example", erpClientId: "abc", erpClientSecret: "shh", erpEnabled: true }, people);
  const st = s.erpStart();
  await assert.rejects(s.erpCallback({ code: "c", state: st.state, browserState: st.state }), /No Salesdesk login/);
});
