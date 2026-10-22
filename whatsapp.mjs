export const phoneDigits = (value) => String(value || "").replace(/\D/g, "");
export function incomingText(message) {
  if (!message?.key?.id || message.key.fromMe) return null;
  if (!["@s.whatsapp.net", "@lid"].some((suffix) => (message.key.remoteJid || "").endsWith(suffix)))
    return null;
  const jid = [message.key.remoteJid, message.key.remoteJidAlt].find((j) =>
    /^\d+@s\.whatsapp\.net$/.test(j || ""),
  );
  if (!jid || (message.key.remoteJid || "").endsWith("@g.us")) return null;
  const content = message.message?.ephemeralMessage?.message || message.message;
  const text = content?.conversation || content?.extendedTextMessage?.text;
  if (typeof text !== "string" || !text.trim()) return null;
  return { providerId: message.key.id, jid, phone: jid.split("@")[0], text: text.slice(0, 10000) };
}

export function createWhatsApp({ load, receive, sent, lookupRequest, sendTimeoutMs = 20000 }) {
  let socket,
    auth,
    deps,
    generation = 0,
    timer,
    attempts = 0,
    sending = false;
  let status = { state: "disconnected", qr: null, error: "", unmatched: 0 };
  const snapshot = () => ({ ...status });
  async function open() {
    const current = ++generation;
    status = { ...status, state: "connecting", qr: null, error: "" };
    try {
      deps ||= await load();
      if (current !== generation) return;
      auth ||= deps.auth();
      const sock = deps.makeSocket({
        auth: auth.state,
        logger: deps.logger,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        getMessage: async () => undefined,
      });
      socket = sock;
      sock.ev.on("creds.update", () => {
        if (current !== generation) return;
        try {
          auth.saveCreds();
        } catch {
          stop();
          status.error = "Session storage failed; connection stopped.";
        }
      });
      sock.ev.on("connection.update", async (update) => {
        if (current !== generation) return;
        if (update.qr) {
          try {
            const qr = await deps.qr(update.qr);
            if (current === generation && socket === sock && status.state !== "connected")
              status = { ...status, state: "qr", qr };
          } catch {
            status.error = "Unable to render pairing QR.";
          }
        }
        if (update.connection === "open") {
          attempts = 0;
          status = { ...status, state: "connected", qr: null, error: "" };
        }
        if (update.connection === "close") {
          socket = undefined;
          const code = update.lastDisconnect?.error?.output?.statusCode;
          status = { ...status, state: "disconnected", qr: null };
          if (code === deps.loggedOut) {
            status.state = "logged_out";
            status.error = "Session expired or revoked. Connect to pair again.";
            return;
          }
          if (++attempts > 5) {
            status.error = "Reconnect limit reached. Press Connect to retry.";
            return;
          }
          status.state = "reconnecting";
          timer = setTimeout(
            () => {
              void open();
            },
            code === deps.restartRequired ? 500 : Math.min(30000, 1000 * 2 ** attempts),
          );
          timer.unref?.();
        }
      });
      sock.ev.on("messages.upsert", (event) => {
        if (current !== generation || event.type !== "notify") return;
        for (const raw of event.messages || []) {
          const message = incomingText(raw);
          if (!message) continue;
          try {
            if (!receive(message)) status.unmatched++;
          } catch {
            status.error = "An incoming message could not be saved.";
          }
        }
      });
    } catch {
      if (current === generation) {
        stop();
        status.error =
          "WhatsApp could not start. Check dependencies, local key access and network.";
      }
    }
  }
  function stop() {
    generation++;
    clearTimeout(timer);
    const old = socket;
    socket = undefined;
    old?.end?.(Error("Local connection paused"));
    status = { ...status, state: "disconnected", qr: null };
  }
  return {
    snapshot,
    async connect() {
      if (["connecting", "qr", "connected", "reconnecting"].includes(status.state))
        return snapshot();
      clearTimeout(timer);
      attempts = 0;
      if (status.state === "logged_out" && auth) {
        auth.clear();
        auth = undefined;
      }
      await open();
      return snapshot();
    },
    stop,
    async send({ requestId, leadId, phone, text }) {
      const existing = lookupRequest(requestId);
      if (existing) return existing;
      if (!socket || status.state !== "connected")
        throw Object.assign(Error("WhatsApp is not connected"), { status: 409 });
      if (sending) throw Object.assign(Error("Another send is in progress"), { status: 429 });
      const digits = phoneDigits(phone);
      if (!/^[1-9]\d{7,14}$/.test(digits))
        throw Object.assign(Error("Use a full international phone number with country code"), {
          status: 400,
        });
      const jid = `${digits}@s.whatsapp.net`;
      sending = true;
      // Persist the attempt before network I/O. Uncertain sends are never retried automatically.
      let record;
      try {
        record = sent({ requestId, leadId, jid, text, status: "Sending" });
        let sendTimer;
        let result;
        try {
          result = await Promise.race([
            socket.sendMessage(jid, { text }),
            new Promise((_, reject) => {
              sendTimer = setTimeout(() => reject(Error("Send timed out")), sendTimeoutMs);
            }),
          ]);
        } finally {
          clearTimeout(sendTimer);
        }
        return sent({
          ...record,
          status: result?.key?.id ? "Sent" : "Unknown",
          providerId: result?.key?.id || "",
        });
      } catch {
        if (record) return sent({ ...record, status: "Unknown" });
        throw Object.assign(Error("Unable to save outgoing message"), { status: 500 });
      } finally {
        sending = false;
      }
    },
  };
}
