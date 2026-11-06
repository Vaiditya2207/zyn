/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function setup() {
  const frames = [];
  const timers = [];
  const styles = new Map();
  const formats = [];
  let rebuilds = 0;
  const context = {
    window: {
      innerHeight: 1000,
      innerWidth: 1500,
      windowUtils: { getBoundsWithoutFlushing: () => ({ height: 200 }) },
    },
    Services: { prefs: { getBoolPref: () => false } },
    ChromeUtils: { defineLazyGetter() {} },
    nsZenToastManager: class {},
    nsZenUrlbarController: class {},
    gURLBar: { style: { setProperty: (key, value) => styles.set(key, value) } },
    gZenVerticalTabsManager: {
      actualWindowButtons: { removeAttribute() {} },
      recalculateURLBarHeight: format => formats.push(format),
    },
    gZenWorkspaces: { updateTabsContainers: () => rebuilds++ },
    requestAnimationFrame: callback => frames.push(callback),
    setTimeout: callback => timers.push(callback),
  };
  const source = readFileSync(
    new URL("../../src/zen/common/modules/ZenUIManager.mjs", import.meta.url),
    "utf8"
  ).replace(/^import .*;\n/gm, "");
  vm.runInNewContext(source, context);
  return {
    manager: context.window.gZenUIManager,
    context,
    styles,
    formats,
    rebuilds: () => rebuilds,
    flush() {
      while (frames.length) frames.shift()();
      while (timers.length) timers.shift()();
    },
  };
}

test("floating open positions the bar without rebuilding workspaces or formatting input", () => {
  const f = setup();
  f.manager.onFloatingURLBarOpen();
  f.flush();
  assert.equal(f.styles.get("--zen-urlbar-top"), "333.5px");
  assert.equal(f.styles.get("--zen-urlbar-width"), "750px");
  assert.deepEqual(f.formats, [false], "keep geometry refresh, skip URL reformat");
  assert.equal(f.rebuilds(), 0, "opening the overlay does not change tab membership");
});

test("floating geometry uses current window dimensions on each open", () => {
  const f = setup();
  f.manager.onFloatingURLBarOpen();
  f.flush();
  f.context.window.innerHeight = 800;
  f.context.window.innerWidth = 900;
  f.manager.onFloatingURLBarOpen();
  f.flush();
  assert.equal(f.styles.get("--zen-urlbar-top"), "233.5px");
  assert.equal(f.styles.get("--zen-urlbar-width"), "600px");
});

test("tab close retains workspace rebuild and URL formatting", () => {
  const f = setup();
  f.manager.onTabClose();
  f.flush();
  assert.deepEqual(f.formats, [true]);
  assert.equal(f.rebuilds(), 1);
});

test("resize still updates geometry without rebuilding workspaces", () => {
  const f = setup();
  f.manager.updateTabsToolbar(true);
  f.flush();
  assert.deepEqual(f.formats, [false]);
  assert.equal(f.rebuilds(), 0);
  assert.equal(f.styles.get("--zen-urlbar-width"), "750px");
});
