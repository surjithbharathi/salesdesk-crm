import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWhatsApp, incomingText } from "./whatsapp.mjs";
import { encryptedAuth } from "./whatsapp-auth.mjs";
import { BufferJSON, initAuthCreds, proto } from "baileys";

test("encrypted auth persists credentials and Signal keys without exporting plaintext", async () => {
  const dir = mkdtempSync(join(tmpdir(), "salesdesk-wa-")),
    db = new DatabaseSync(":memory:");
  try {
    const options = { db, keyPath: join(dir, "key"), BufferJSON, initAuthCreds, proto };
    const auth = encryptedAuth(options);
    auth.state.creds.testMarker = "private-test-value";
    auth.saveCreds();
    await auth.state.keys.set({ session: { a: Buffer.from("signal-test") } });
    const restored = encryptedAuth(options);
    assert.equal(restored.state.creds.testMarker, "private-test-value");
    assert.deepEqual(
      (await restored.state.keys.get("session", ["a"])).a,
      Buffer.from("signal-test"),
    );
    assert.equal(
      Buffer.from(
        db.prepare("SELECT value FROM whatsapp_auth WHERE id='creds'").get().value,
      ).includes(Buffer.from("private-test-value")),
      false,
    );
    assert.equal(statSync(options.keyPath).mode & 0o777, 0o600);
    assert.equal(readFileSync(options.keyPath).length, 32);
    await restored.state.keys.set({ session: { a: null } });
    assert.deepEqual(await restored.state.keys.get("session", ["a"]), {});
    db.prepare("UPDATE whatsapp_auth SET value=? WHERE id='creds'").run(Buffer.alloc(40));
    assert.throws(() => encryptedAuth(options));
  } finally {
    db.close();
    rmSync(dir, { recursive: true });
  }
});

test("text sync accepts incoming and manually outgoing text, alternate JIDs; ignores groups/media", () => {
  const key = { id: "one", remoteJid: "919999999999@s.whatsapp.net", fromMe: false };
  assert.equal(incomingText({ key, message: { conversation: "Hi" } }).phone, "919999999999");
  assert.equal(
    incomingText({
      key: { ...key, remoteJid: "abc@lid", remoteJidAlt: key.remoteJid },
      message: { extendedTextMessage: { text: "Hello" } },
    }).text,
    "Hello",
  );
  assert.equal(
    incomingText({ key: { ...key, fromMe: true }, message: { conversation: "Hi" } }).direction,
    "Outgoing",
  );
  assert.equal(
    incomingText({
      key: { ...key, remoteJid: "1@g.us", remoteJidAlt: key.remoteJid },
      message: { conversation: "Hi" },
    }),
    null,
  );
  assert.equal(incomingText({ key, message: { imageMessage: {} } }), null);
});

test("connection requires explicit start, handles QR/open/pause, and ignores stale socket events", async () => {
  const ev = new EventEmitter();
  let starts = 0,
    saves = 0,
    received = 0;
  const wa = createWhatsApp({
    load: async () => ({
      makeSocket: () => {
        starts++;
        return { ev, end() {} };
      },
      auth: () => ({
        state: {},
        saveCreds() {
          saves++;
        },
      }),
      qr: async () => "data:image/png;base64,test",
      loggedOut: 401,
      restartRequired: 515,
    }),
    receive: () => {
      received++;
      return true;
    },
    sent() {},
    lookupRequest() {},
  });
  assert.equal(starts, 0);
  await wa.connect();
  await wa.connect();
  assert.equal(starts, 1);
  ev.emit("connection.update", { qr: "secret-qr" });
  await Promise.resolve();
  assert.equal(wa.snapshot().state, "qr");
  ev.emit("connection.update", { connection: "open" });
  assert.equal(wa.snapshot().qr, null);
  ev.emit("creds.update", {});
  assert.equal(saves, 1);
  const message = {
    key: { id: "1", remoteJid: "919999999999@s.whatsapp.net" },
    message: { conversation: "Hi" },
  };
  ev.emit("messages.upsert", { type: "append", messages: [message] });
  assert.equal(received, 1);
  ev.emit("messages.upsert", { type: "notify", messages: [message] });
  assert.equal(received, 2);
  wa.stop();
  ev.emit("connection.update", { connection: "open" });
  ev.emit("messages.upsert", { type: "notify", messages: [message] });
  assert.equal(wa.snapshot().state, "disconnected");
  assert.equal(received, 2);
});

test("sync-only adapter exposes no send method and never invokes socket sendMessage", async () => {
  const ev = new EventEmitter();
  let sends = 0;
  const received = [];
  const wa = createWhatsApp({
    load: async () => ({
      makeSocket: () => ({
        ev,
        end() {},
        async sendMessage() {
          sends++;
          return { key: { id: "provider1" } };
        },
      }),
      auth: () => ({ state: {}, saveCreds() {} }),
    }),
    receive(message) {
      received.push(message);
      return true;
    },
  });
  assert.equal(wa.send, undefined);
  await wa.connect();
  ev.emit("connection.update", { connection: "open" });
  const raw = {
    key: { id: "manual1", remoteJid: "919999999999@s.whatsapp.net", fromMe: true },
    messageTimestamp: 1780000000,
    message: { conversation: "Manually sent" },
  };
  ev.emit("messages.upsert", { type: "append", messages: [raw] });
  ev.emit("messages.upsert", {
    type: "notify",
    messages: [{ ...raw, key: { ...raw.key, id: "incoming1", fromMe: false } }],
  });
  assert.deepEqual(
    received.map((m) => m.direction),
    ["Outgoing", "Incoming"],
  );
  assert.equal(received[0].occurredAt, "2026-05-28T20:26:40.000Z");
  assert.equal(wa.snapshot().sendingEnabled, false);
  assert.equal(sends, 0);
  wa.stop();
});
