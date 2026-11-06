/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function setup() {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        handlers: {},
        addEventListener(type, fn) {
          this.handlers[type] = fn;
        },
        matches: () => false,
        hasAttribute: name => name === "zen-has-hover",
        getAttribute: () => null,
      });
    }
    return elements.get(id);
  }
  let reads = 0;
  let duration = 100;
  const context = {
    window: {},
    document: {
      addEventListener() {},
      getElementById: element,
      documentElement: element("root"),
    },
    gURLBar: element("urlbar"),
    gZenVerticalTabsManager: { actualWindowButtons: element("buttons") },
    XPCOMUtils: {
      defineLazyPreferenceGetter() {},
      defineLazyServiceGetter() {},
    },
    ChromeUtils: { defineLazyGetter() {}, defineESModuleGetters() {} },
    Ci: {},
    Services: {
      prefs: {
        getIntPref: name => {
          if (name === "zen.view.compact.sidebar-keep-hover.duration") {
            reads++;
          }
          return duration;
        },
      },
    },
    AppConstants: { platform: "linux" },
    setTimeout: fn => fn(),
    clearTimeout() {},
  };
  vm.runInNewContext(
    readFileSync(
      new URL("../../src/zen/compact-mode/ZenCompactMode.mjs", import.meta.url),
      "utf8"
    ),
    context
  );
  const manager = context.window.gZenCompactModeManager;
  Object.defineProperty(manager, "sidebar", { value: element("sidebar") });
  Object.defineProperty(manager, "sidebarIsOnRight", { value: false });
  const flashed = [];
  manager.flashElement = (target, value) => flashed.push(value);
  return {
    manager,
    element,
    flashed,
    reads: () => reads,
    setDuration: value => {
      duration = value;
    },
  };
}

test("hover setup reads one fresh list; each leave reads the live duration once", () => {
  const f = setup();
  f.manager.addMouseActions();
  assert.equal(
    f.reads(),
    1,
    "one pref read and one list construction while binding three targets"
  );
  f.setDuration(321);
  f.element("sidebar").handlers.mouseleave({ type: "mouseleave" });
  assert.deepEqual(
    f.flashed,
    [321],
    "a changed duration takes effect without rebinding listeners"
  );
  assert.equal(f.reads(), 2, "one live pref read on hover leave");
});
