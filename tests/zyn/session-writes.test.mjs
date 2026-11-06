/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Execute the actual Firefox saver and scheduler, mocking only native services.
// A source checkout is enough; no browser build or Node dependencies are needed.
const root = fileURLToPath(new URL("../../", import.meta.url));
const engine = process.env.ZYN_ENGINE_SOURCE || path.join(root, "engine");
const hasEngine = existsSync(
  path.join(engine, "toolkit/modules/JSONFile.sys.mjs")
);
const sessionTest = (name, fn) =>
  test(
    name,
    {
      skip: hasEngine
        ? false
        : "Set ZYN_ENGINE_SOURCE to the matching Firefox source checkout",
    },
    fn
  );
const tick = () => new Promise(resolve => setImmediate(resolve));

async function setup({
  holdWrites = false,
  holdCopies = false,
  copyFails = false,
} = {}) {
  const timers = [];
  const idle = [];
  const blockers = [];
  const writes = [];
  const copies = [];
  const liveSaves = [];
  const notifications = [];
  const errors = [];
  const modules = {};
  const shutdown = { addBlocker: (name, fn) => blockers.push(fn) };
  const native = {
    console: { error: e => errors.push(e), debug() {} },
    Components: {
      Constructor() {
        return class {
          constructor(fn, delay) {
            this.fn = fn;
            this.delay = delay;
            timers.push(this);
          }
          cancel() {
            this.cancelled = true;
          }
        };
      },
    },
    Ci: { nsITimer: { TYPE_ONE_SHOT: 0 } },
    Cu: { getGlobalForObject: () => ({}), cloneInto: structuredClone },
    Window: { isInstance: () => false },
    ChromeUtils: {
      addProfilerMarker() {},
      now: () => 0,
      idleDispatch: fn => idle.push(fn),
      defineESModuleGetters(target, getters) {
        for (const name of Object.keys(getters)) {
          Object.defineProperty(target, name, { get: () => modules[name] });
        }
      },
      defineLazyGetter(target, name, getter) {
        Object.defineProperty(target, name, { get: getter });
      },
    },
    XPCOMUtils: {
      defineLazyPreferenceGetter(target, name, pref, fallback) {
        target[name] = name === "gShouldLog" ? false : fallback;
      },
    },
    PathUtils: {
      profileDir: "/fixture-profile",
      join: path.join,
      filename: path.basename,
    },
    Services: {
      prefs: { getBoolPref: (name, fallback) => fallback },
      obs: { notifyObservers: (subject, topic) => notifications.push(topic) },
    },
    IOUtils: {
      profileBeforeChange: shutdown,
      readJSON: async () => ({ spaces: [{ uuid: "space" }], tabs: [] }),
      copy(from, to) {
        const completion = Promise.withResolvers();
        copies.push({ from, to, completion });
        if (copyFails) completion.reject(new Error("copy fixture failure"));
        else if (!holdCopies) completion.resolve();
        return completion.promise;
      },
      writeJSON(file, data, options) {
        // Like native IOUtils, serialize synchronously before asynchronous IO.
        const json = JSON.stringify(data);
        const completion = Promise.withResolvers();
        writes.push({
          file,
          json,
          data: JSON.parse(json),
          options,
          completion,
        });
        if (!holdWrites) completion.resolve({ jsonLength: json.length });
        return completion.promise;
      },
    },
  };
  function evaluate(source, result, extras = {}) {
    const context = vm.createContext({ ...native, ...extras });
    vm.runInContext(
      source
        .replace(/^import .*;\n/gm, "")
        .replace(/\bexport (?=class|function|const)/g, "") +
        `\nthis.result = ${result};`,
      context
    );
    return context.result;
  }
  modules.DeferredTask = evaluate(
    readFileSync(
      path.join(engine, "toolkit/modules/DeferredTask.sys.mjs"),
      "utf8"
    ),
    "DeferredTask"
  );
  modules.JSONFile = evaluate(
    readFileSync(path.join(engine, "toolkit/modules/JSONFile.sys.mjs"), "utf8"),
    "JSONFile"
  );
  modules.ZenLiveFoldersManager = { saveState: soon => liveSaves.push(soon) };
  const manager = evaluate(
    readFileSync(
      path.join(root, "src/zen/sessionstore/ZenSessionManager.sys.mjs"),
      "utf8"
    ),
    "ZenSessionStore",
    { JSONFile: modules.JSONFile }
  );
  await manager.readFile();
  return {
    manager,
    timers,
    idle,
    writes,
    copies,
    liveSaves,
    notifications,
    errors,
    async runSaves() {
      // Deliberately don't run idle callbacks: persistence must not require idle.
      for (const timer of timers.splice(0)) {
        if (!timer.cancelled && timer.delay === 0) timer.fn();
      }
      await tick();
    },
    shutdown: () => Promise.all(blockers.map(fn => fn())),
  };
}

function state(label) {
  return {
    windows: [
      {
        tabs: [
          {
            zenSyncId: "tab",
            entries: [{ url: `https://example.com/${label}` }],
          },
        ],
        spaces: [{ uuid: "space", name: label }],
      },
    ],
  };
}
const label = write => write.data.spaces[0].name;

sessionTest(
  "same-turn saves serialize and back up once with the latest state",
  async () => {
    const f = await setup();
    f.manager.saveState(state("one"));
    f.manager.saveState(state("two"));
    f.manager.saveState(state("three"));
    assert.equal(f.manager.getSidebarData().spaces[0].name, "three");
    assert.equal(
      f.notifications.length,
      3,
      "in-memory consumers still see each update"
    );
    await f.runSaves();
    assert.equal(f.writes.length, 1);
    assert.equal(label(f.writes[0]), "three");
    assert.equal(f.copies.length, 1);
    assert.equal(f.idle.length, 0, "crash persistence never waits for idle");
    assert.equal(f.writes[0].options.compress, true);
    assert.equal(
      f.writes[0].options.tmpPath,
      "/fixture-profile/zen-sessions.jsonlz4.tmp"
    );
    assert.equal(
      f.writes[0].options.backupTo,
      "/fixture-profile/zen-sessions-backup/recovery.baklz4"
    );
    assert.equal(
      f.copies[0].to,
      "/fixture-profile/zen-sessions-backup/clean.jsonlz4"
    );
    await f.shutdown();
  }
);

sessionTest(
  "in-flight updates become one serialized trailing save and shutdown waits",
  async () => {
    const f = await setup({ holdWrites: true });
    f.manager.saveState(state("first"));
    await f.runSaves();
    assert.equal(f.writes.length, 1);
    f.manager.saveState(state("intermediate"));
    f.manager.saveState(state("latest"));
    assert.equal(f.writes.length, 1, "no overlapping IO or serialization");
    let stopped = false;
    const stopping = f.shutdown().then(() => {
      stopped = true;
    });
    await tick();
    assert.equal(stopped, false);
    f.writes[0].completion.resolve({ jsonLength: 100 });
    await tick();
    assert.equal(f.writes.length, 2);
    assert.equal(label(f.writes[1]), "latest");
    assert.equal(stopped, false);
    f.writes[1].completion.resolve({ jsonLength: 100 });
    await stopping;
    assert.equal(stopped, true);
    assert.equal(f.copies.length, 2);
  }
);

sessionTest(
  "shutdown before a timer fires flushes the latest state",
  async () => {
    const f = await setup();
    f.manager.saveState(state("first"), true);
    f.manager.saveState(state("latest"));
    await f.shutdown();
    assert.equal(f.writes.length, 1);
    assert.equal(label(f.writes[0]), "latest");
    assert.equal(f.copies.length, 1);
    assert.deepEqual(f.liveSaves, [true, false]);
  }
);

sessionTest(
  "a clean backup completes before its corresponding atomic save",
  async () => {
    const f = await setup({ holdCopies: true });
    f.manager.saveState(state("latest"));
    await f.runSaves();
    assert.equal(f.copies.length, 1);
    assert.equal(f.writes.length, 0);
    f.copies[0].completion.resolve();
    await tick();
    assert.equal(f.writes.length, 1);
    await f.shutdown();
  }
);

sessionTest(
  "a failed optional clean backup does not suppress persistence",
  async () => {
    const f = await setup({ copyFails: true });
    f.manager.saveState(state("latest"));
    await f.runSaves();
    assert.equal(f.writes.length, 1);
    assert.equal(label(f.writes[0]), "latest");
    await f.shutdown();
  }
);

sessionTest(
  "excluded windows do not replace a queued valid snapshot",
  async () => {
    const f = await setup();
    f.manager.saveState(state("valid"));
    for (const field of ["isPopup", "isTaskbarTab", "isZenUnsynced"]) {
      const excluded = state("excluded");
      excluded.windows[0][field] = true;
      f.manager.saveState(excluded);
    }
    f.manager.saveState({ windows: [] });
    await f.runSaves();
    assert.equal(f.writes.length, 1);
    assert.equal(label(f.writes[0]), "valid");
    assert.equal(f.notifications.length, 1);
    await f.shutdown();
  }
);

sessionTest(
  "normal completion schedules one trailing write without waiting for idle",
  async () => {
    const f = await setup({ holdWrites: true });
    f.manager.saveState(state("first"));
    await f.runSaves();
    f.manager.saveState(state("second"));
    f.manager.saveState(state("third"), true);
    await f.runSaves();
    assert.equal(f.writes.length, 1);
    f.writes[0].completion.resolve({ jsonLength: 100 });
    await tick();
    await f.runSaves();
    assert.equal(f.writes.length, 2);
    assert.equal(label(f.writes[1]), "third");
    assert.equal(f.idle.length, 0);
    f.writes[1].completion.resolve({ jsonLength: 100 });
    await f.shutdown();
  }
);

sessionTest(
  "a failed write releases the saver so a newer snapshot can persist",
  async () => {
    const f = await setup({ holdWrites: true });
    f.manager.saveState(state("first"));
    await f.runSaves();
    f.manager.saveState(state("latest"));
    f.writes[0].completion.reject(new Error("write fixture failure"));
    await tick();
    await f.runSaves();
    assert.equal(f.writes.length, 2);
    assert.equal(label(f.writes[1]), "latest");
    f.writes[1].completion.resolve({ jsonLength: 100 });
    await f.shutdown();
  }
);

sessionTest(
  "an isolated saveSoon caller persists without waiting for idle",
  async () => {
    const f = await setup();
    f.manager.saveState(state("closed-window"), true);
    await f.runSaves();
    assert.equal(f.writes.length, 1);
    assert.equal(label(f.writes[0]), "closed-window");
    assert.equal(f.idle.length, 0);
    await f.shutdown();
  }
);

sessionTest(
  "Firefox shutdown history trimming cannot change the queued Zen tab",
  async () => {
    const f = await setup();
    const snapshot = state("latest");
    const tab = snapshot.windows[0].tabs[0];
    tab.entries = [
      { url: "https://example.com/previous" },
      { url: "https://example.com/current" },
    ];
    tab.index = 2;
    f.manager.saveState(snapshot);
    // SessionWriter.#write replaces entries and adjusts index on final writes.
    tab.entries = tab.entries.slice(1);
    tab.index = 1;
    await f.shutdown();
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].data.tabs[0].entries.length, 2);
    assert.equal(f.writes[0].data.tabs[0].index, 2);
  }
);
