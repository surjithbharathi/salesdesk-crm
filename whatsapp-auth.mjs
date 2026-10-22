import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";

// Auth keys are deliberately outside the exported records table.
export function encryptedAuth({ db, keyPath, BufferJSON, initAuthCreds, proto }) {
  mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  chmodSync(keyPath, 0o600);
  const key = readFileSync(keyPath);
  if (key.length !== 32) throw Error("Invalid WhatsApp encryption key");
  db.exec("CREATE TABLE IF NOT EXISTS whatsapp_auth (id TEXT PRIMARY KEY, value BLOB NOT NULL)");
  function read(id) {
    const row = db.prepare("SELECT value FROM whatsapp_auth WHERE id=?").get(id);
    if (!row) return undefined;
    const raw = Buffer.from(row.value),
      decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(id));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString(),
      BufferJSON.reviver,
    );
  }
  function write(id, value) {
    if (value == null) {
      db.prepare("DELETE FROM whatsapp_auth WHERE id=?").run(id);
      return;
    }
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(id));
    const content = Buffer.concat([
      cipher.update(JSON.stringify(value, BufferJSON.replacer)),
      cipher.final(),
    ]);
    db.prepare(
      "INSERT INTO whatsapp_auth VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    ).run(id, Buffer.concat([iv, cipher.getAuthTag(), content]));
  }
  const creds = read("creds") || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        async get(type, ids) {
          const result = {};
          for (const id of ids) {
            let value = read(`${type}:${id}`);
            if (value && type === "app-state-sync-key")
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            if (value) result[id] = value;
          }
          return result;
        },
        async set(data) {
          db.exec("BEGIN IMMEDIATE");
          try {
            for (const [type, entries] of Object.entries(data))
              for (const [id, value] of Object.entries(entries)) write(`${type}:${id}`, value);
            db.exec("COMMIT");
          } catch (e) {
            db.exec("ROLLBACK");
            throw e;
          }
        },
      },
    },
    saveCreds() {
      write("creds", creds);
    },
    clear() {
      db.exec("DELETE FROM whatsapp_auth");
    },
  };
}
