import test from "node:test";
import assert from "node:assert/strict";
import { othersLeads } from "./user-scope.mjs";
import { waThreads } from "./web/src/waThreads.js";

const leads = [
  { id: "a", name: "Jithender Reddy", phone: "+918125177774", owner: "u2", stage: "Prospecting", updatedAt: "2026-11-16" },
  { id: "b", name: "Mine", phone: "+919000000001", owner: "u1", stage: "New" },
  { id: "c", name: "Open one", phone: "+919000000002", owner: "", stage: "New" },
  { id: "d", name: "Merged", phone: "+918125177774", owner: "u2", mergedInto: "a" },
];
const all = (k) => (k === "leads" ? leads : []);
const names = { u2: "Balaji" };

test("a search tells a member whose lead a number is, view only, never their own or open leads", () => {
  const hit = othersLeads(all, "u1", "81251 77774", (id) => names[id]);
  assert.deepEqual(hit, [{ id: "a", name: "Jithender Reddy", phone: "+918125177774", owner: "Balaji", stage: "Prospecting", archived: false }]);
  assert.deepEqual(othersLeads(all, "u1", "9000000001", (id) => names[id]), []);
  assert.deepEqual(othersLeads(all, "u1", "9000000002", (id) => names[id]), []);
  assert.equal(othersLeads(all, "u1", "jithender", (id) => names[id]).length, 1);
  assert.deepEqual(othersLeads(all, "u1", "81", (id) => names[id]), []);
});

test("WhatsApp chats of one lead through several numbers and systems are one thread, a copied message kept once", () => {
  const conversations = [
    { id: "g", leadId: "L", channel: "WhatsApp", provider: "gateway" },
    { id: "t", leadId: "L", channel: "WhatsApp", provider: "telecrm" },
    { id: "x", leadId: "", channel: "WhatsApp" },
  ];
  const messages = [
    { id: 1, conversationId: "t", direction: "Incoming", text: "Hi", occurredAt: "2026-11-12T10:00:10Z", numberLabel: "Sales 90390 36589" },
    { id: 2, conversationId: "g", direction: "Incoming", text: "Hi", occurredAt: "2026-11-12T10:00:40Z", numberLabel: "Sales 90390 36589" },
    { id: 3, conversationId: "g", direction: "Incoming", text: "Price?", occurredAt: "2026-11-12T11:00:00Z", numberLabel: "Sales 82828 27732" },
    { id: 4, conversationId: "x", direction: "Incoming", text: "?", occurredAt: "2026-11-12T09:00:00Z" },
  ];
  const threads = waThreads(conversations, messages, (m) => m.occurredAt);
  assert.equal(threads.length, 2);
  const lead = threads.find((t) => t.leadId === "L");
  assert.deepEqual(lead.messages.map((m) => m.id), [1, 3]);
  assert.deepEqual(lead.conversationIds, ["g", "t"]);
});
