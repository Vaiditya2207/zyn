/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../../src/zen/downloads/ZenDownloadAnimation.mjs", import.meta.url),
  "utf8"
).replace(/import \{[\s\S]*?\} from "[^"]+";/, "");
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup({ pendingList = false } = {}) {
  const startup = Promise.withResolvers();
  const downloads = Promise.withResolvers();
  const idle = [];
  const added = [];
  const removed = [];
  const errors = [];
  let init;
  let reads = 0;
  let unload;
  const list = {
    addView: view => added.push(view),
    removeView: view => removed.push(view),
  };
  const window = {
    closed: false,
    Downloads: {
      ALL: "all",
      getList(type) {
        assert.equal(type, "all");
        reads++;
        return pendingList ? downloads.promise : Promise.resolve(list);
      },
    },
    requestIdleCallback(fn, options) {
      idle.push({ fn, options });
    },
    addEventListener(type, fn) {
      assert.equal(type, "unload");
      unload = fn;
    },
  };
  vm.runInNewContext(source, {
    window,
    gZenStartup: { promiseInitialized: startup.promise },
    nsZenDOMOperatedFeature: class {
      constructor() {
        init = () => this.init();
      }
    },
    nsZenMultiWindowFeature: {},
    HTMLElement: class {},
    customElements: { define() {} },
    console: { error: error => errors.push(error) },
  });
  return {
    window, startup, downloads, list, idle, added, removed, errors,
    init: () => init(), reads: () => reads, unload: () => unload(),
  };
}

test("download animation loads history only after startup and idle, then cleans up", async () => {
  const f = setup();
  const initialized = f.init();
  assert.equal(f.reads(), 0);
  assert.equal(f.idle.length, 0);
  f.startup.resolve();
  await initialized;
  assert.equal(f.reads(), 0);
  assert.equal(f.idle.length, 1);
  assert.ok(f.idle[0].options.timeout > 0, "busy windows still initialize eventually");
  f.idle[0].fn();
  await tick();
  assert.equal(f.reads(), 1);
  assert.equal(f.added.length, 1);
  f.unload();
  assert.equal(f.removed[0], f.added[0]);
});

test("closing before startup avoids scheduling download work", async () => {
  const f = setup();
  const initialized = f.init();
  f.window.closed = true;
  f.startup.resolve();
  await initialized;
  assert.equal(f.idle.length, 0);
  assert.equal(f.reads(), 0);
});

test("closing while idle work is queued avoids loading downloads", async () => {
  const f = setup();
  f.startup.resolve();
  await f.init();
  f.window.closed = true;
  for (const task of f.idle) task.fn();
  await tick();
  assert.equal(f.reads(), 0);
  assert.equal(f.added.length, 0);
});

test("closing while the download list loads does not attach a view", async () => {
  const f = setup({ pendingList: true });
  f.startup.resolve();
  const initialized = f.init();
  await tick();
  for (const task of f.idle) task.fn();
  f.window.closed = true;
  f.downloads.resolve(f.list);
  await initialized;
  await tick();
  assert.equal(f.added.length, 0);
});

test("a failed download load is reported without attaching a view", async () => {
  const f = setup({ pendingList: true });
  f.startup.resolve();
  const initialized = f.init();
  await tick();
  for (const task of f.idle) task.fn();
  f.downloads.reject(new Error("fixture load failure"));
  await initialized;
  await tick();
  assert.equal(f.added.length, 0);
  assert.equal(f.errors.length, 1);
});
