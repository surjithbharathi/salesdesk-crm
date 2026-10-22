import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("./public/app.js", import.meta.url), "utf8");
const poller = source.slice(
  source.indexOf("let callRefreshBusy = false;"),
  source.indexOf("setInterval(refreshSyncedCalls, 3000);"),
);
function setup(view = "calls") {
  const ui = {
    modal: false,
    focused: false,
    playing: false,
    form: false,
    hidden: false,
    renders: 0,
    requests: 0,
    panelUpdates: 0,
    scrolls: [],
  };
  const panel = {
    querySelector: () => ui.form,
    querySelectorAll: () => [],
    set innerHTML(value) {
      ui.panelUpdates++;
    },
  };
  const context = vm.createContext({
    state: { mobileCalls: [] },
    view,
    document: {
      get hidden() {
        return ui.hidden;
      },
      activeElement: { closest: () => ui.focused },
      querySelectorAll: () => (ui.playing ? [{ paused: false }] : []),
    },
    $: (selector) => (selector === "#modal" ? { open: ui.modal } : panel),
    window: { scrollX: 0, scrollY: 450, scrollTo: (x, y) => ui.scrolls.push([x, y]) },
    api: async () => {
      ui.requests++;
      return { mobileCalls: [{ id: "synthetic-call" }] };
    },
    render: () => ui.renders++,
    mobilePanel: () => "updated synthetic calls",
  });
  vm.runInContext(poller, context);
  return { ui, context, poll: () => vm.runInContext("refreshSyncedCalls()", context) };
}
test("new synced calls refresh visible history once and preserve scroll", async () => {
  const { ui, poll } = setup();
  await poll();
  await poll();
  assert.equal(ui.renders, 1);
  assert.deepEqual(ui.scrolls, [[0, 450]]);
});
test("integration poll changes only call panel, preserving WhatsApp forms", async () => {
  const { ui, poll } = setup("integrations");
  await poll();
  assert.equal(ui.panelUpdates, 1);
  assert.equal(ui.renders, 0);
  const legacy = setup("integrations");
  legacy.ui.form = true;
  await legacy.poll();
  assert.equal(legacy.ui.panelUpdates, 0);
});
test("polling respects hidden page, open modal, focused input and playing audio", async () => {
  for (const key of ["hidden", "modal", "focused", "playing"]) {
    const { ui, poll } = setup();
    ui[key] = true;
    await poll();
    assert.equal(ui.requests, 0, key);
  }
});
test("stale view responses and overlapping requests cannot replace the screen", async () => {
  const { ui, context, poll } = setup();
  let resolve;
  context.api = () => {
    ui.requests++;
    return new Promise((r) => (resolve = r));
  };
  const pending = poll();
  await poll();
  assert.equal(ui.requests, 1);
  context.view = "leads";
  resolve({ mobileCalls: [{ id: "synthetic-call" }] });
  await pending;
  assert.equal(ui.renders, 0);
});
test("network failure keeps existing history and permits the next retry", async () => {
  const { ui, context, poll } = setup();
  context.api = async () => {
    throw Error("offline");
  };
  await poll();
  assert.equal(ui.renders, 0);
  context.api = async () => ({ mobileCalls: [{ id: "synthetic-call" }] });
  await poll();
  assert.equal(ui.renders, 1);
});
