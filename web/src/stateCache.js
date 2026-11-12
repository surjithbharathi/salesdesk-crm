// Keeps the last CRM state in this browser (IndexedDB), so opening the app again shows the data at once and only asks the
// server for what changed since. The full state is kept as the server's own JSON text plus the small change lists that
// came after it; the text is rewritten only now and then, so a save never re-serialises the whole CRM.
// Everything is per person and cleared on sign-out. Any failure here only means the app loads from the server as before.

const DB = "salesdesk-state";
const STORE = "s";
const VERSION = 2; // raise when the state's shape changes, so old copies are dropped
const REBASE_AFTER = 40; // change lists kept before the text is rewritten

// The whole CRM is over 100 MB of text, more than the browser keeps as one IndexedDB value (about 128 MB in Chrome), so
// the copy was silently never saved. It is kept gzipped (a tenth of the size) where the browser can do that.
const canZip = typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
async function packText(text) {
  if (!canZip) return { text };
  return { gz: await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).blob() };
}
async function unpackText(base) {
  if (typeof base.text === "string") return base.text;
  if (base.gz instanceof Blob && canZip) return new Response(base.gz.stream().pipeThrough(new DecompressionStream("gzip"))).text();
  return null;
}

let dbPromise = null;
function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") return reject(new Error("No IndexedDB"));
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((e) => { dbPromise = null; throw e; });
  }
  return dbPromise;
}
function run(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const out = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(out?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

// The saved state for this person, with its change lists applied by `merge`, or null.
export async function readState(userId, merge) {
  try {
    const [base, deltas] = await Promise.all([run("readonly", (s) => s.get("base:" + userId)), run("readonly", (s) => s.get("deltas:" + userId))]);
    if (!base || base.v !== VERSION) return null;
    const text = await unpackText(base);
    if (typeof text !== "string") return null;
    let state = JSON.parse(text);
    let seq = base.seq;
    for (const d of Array.isArray(deltas) ? deltas : []) {
      if (d.from !== seq) break; // a gap: keep what is consistent, the server fills in the rest
      state = merge(state, d.delta);
      seq = d.delta.syncSeq;
    }
    if (!Number.isInteger(seq)) return null;
    return { state: { ...state, syncSeq: seq }, seq, count: Array.isArray(deltas) ? deltas.length : 0 };
  } catch {
    return null;
  }
}

// saves run one after another, so a newer copy is never overwritten by an older one
let pending = Promise.resolve();

// After a full download: keep the server's text as it came (gzipped).
export function saveFull(userId, seq, text) {
  if (!Number.isInteger(seq)) return;
  pending = pending.then(async () => {
    const packed = await packText(text);
    return run("readwrite", (s) => { s.put({ v: VERSION, seq, ...packed }, "base:" + userId); s.delete("deltas:" + userId); });
  }).catch((e) => console.warn("Could not keep the CRM in this browser:", e?.message || e));
}

// After a change list: add it, and rewrite the text once many have piled up (when the browser is idle).
export function saveDelta(userId, from, delta, current) {
  pending = pending.then(async () => {
    const list = (await run("readonly", (s) => s.get("deltas:" + userId))) || [];
    list.push({ from, delta });
    if (list.length < REBASE_AFTER) return run("readwrite", (s) => s.put(list, "deltas:" + userId));
    const state = current();
    if (!state || !Number.isInteger(state.syncSeq)) return run("readwrite", (s) => s.put(list, "deltas:" + userId));
    await new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 5000 }) : setTimeout(r, 1000)));
    const packed = await packText(JSON.stringify(state));
    return run("readwrite", (s) => { s.put({ v: VERSION, seq: state.syncSeq, ...packed }, "base:" + userId); s.delete("deltas:" + userId); });
  }).catch((e) => console.warn("Could not keep the CRM changes in this browser:", e?.message || e));
}

export function clearState() {
  return run("readwrite", (s) => s.clear()).catch(() => {});
}
