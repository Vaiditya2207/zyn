/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function setup() {
  const frames = new Map();
  let nextFrame = 0;
  const calls = [];
  const context = {
    window: { closed: false },
    document: { documentElement: { hasAttribute: () => false } },
    gBrowser: { selectedTab: { closing: false } },
    gZenUIManager: { testingEnabled: false },
    gZenVerticalTabsManager: { _canReplaceNewTab: false },
    XPCOMUtils: {
      defineLazyPreferenceGetter(target, name, pref, value) {
        target[name] = value;
      },
    },
    gURLBar: {
      focused: false,
      userTypedValue: null,
      usertyping: false,
      hasAttribute(name) { return name === "usertyping" && this.usertyping; },
      selectionStart: 0,
      selectionEnd: 0,
      focus() {
        calls.push("focus");
        this.focused = true;
      },
      select() {
        calls.push("select");
        this.selectionStart = 0;
        this.selectionEnd = this.userTypedValue?.length ?? 0;
      },
      // Deliberately leave the view unopened: actual asynchronous providers
      // can still be running when another opener executes in the same frame.
      view: { autoOpen: ({ event }) => calls.push(event.type) },
    },
    requestAnimationFrame(callback) {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: id => frames.delete(id),
    CustomEvent: class {
      constructor(type) { this.type = type; }
    },
    console,
  };
  const source = readFileSync(
    new URL("../../src/zen/urlbar/ZenUrlbarController.mjs", import.meta.url),
    "utf8"
  ).replace(/^import .*;\n/gm, "").replace("export class", "class");
  vm.runInNewContext(`${source}\nthis.controller = new nsZenUrlbarController();`, context);
  context.controller.openOnNewTabPage = true;
  return {
    context,
    calls,
    frames,
    controller: context.controller,
    openTab() {
      assert.equal(context.controller.handleNewTab(false, false, "tab"), false);
      context.gBrowser.selectedTab = { closing: false };
    },
    flush() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback());
    },
  };
}

test("ordinary new tab opens the floating results view after selection", () => {
  const f = setup();
  f.openTab();
  assert.deepEqual(f.calls, []);
  f.flush();
  assert.deepEqual(f.calls, ["focus", "select", "command"]);
});

test("a burst of new tabs performs only one deferred focus and query request", () => {
  const f = setup();
  f.openTab();
  f.openTab();
  f.openTab();
  assert.equal(f.frames.size, 1);
  f.flush();
  assert.deepEqual(f.calls, ["focus", "select", "command"]);
  f.openTab();
  f.flush();
  assert.equal(f.calls.filter(call => call === "command").length, 2,
    "a later new tab can schedule again");
});

test("typing before the frame preserves the caret and avoids a duplicate query", () => {
  const f = setup();
  f.openTab();
  Object.assign(f.context.gURLBar, {
    focused: true,
    usertyping: true,
    userTypedValue: "github",
    selectionStart: 6,
    selectionEnd: 6,
  });
  f.flush();
  assert.deepEqual(f.calls, []);
  assert.equal(f.context.gURLBar.selectionStart, 6);
  assert.equal(f.context.gURLBar.selectionEnd, 6);
});

test("native new-tab focus is retained without a second focus or select", () => {
  const f = setup();
  f.openTab();
  f.context.gURLBar.focused = true;
  f.flush();
  assert.deepEqual(f.calls, ["command"]);
});

test("a loading extension home URL is not mistaken for user input", () => {
  const f = setup();
  f.openTab();
  // Tabbrowser can temporarily seed userTypedValue with the navigation URL.
  f.context.gURLBar.userTypedValue = "moz-extension://test-home/newtab.html";
  f.flush();
  assert.deepEqual(f.calls, ["focus", "select", "command"]);
});

for (const state of ["unchanged", "closing", "missing", "closed-window", "pref-disabled"]) {
  test(`deferred opener does no work when ${state}`, () => {
    const f = setup();
    const opener = f.context.gBrowser.selectedTab;
    f.openTab();
    if (state === "unchanged") f.context.gBrowser.selectedTab = opener;
    if (state === "closing") f.context.gBrowser.selectedTab.closing = true;
    if (state === "missing") f.context.gBrowser.selectedTab = null;
    if (state === "closed-window") f.context.window.closed = true;
    if (state === "pref-disabled") f.controller.openOnNewTabPage = false;
    f.flush();
    assert.deepEqual(f.calls, []);
  });
}

for (const args of [
  [true, false, "tab"],
  [false, true, "tab"],
  [false, false, "tabshifted"],
  [false, false, "window"],
]) {
  test(`navigation ${JSON.stringify(args)} does not schedule the home opener`, () => {
    const f = setup();
    assert.equal(f.controller.handleNewTab(...args), false);
    assert.equal(f.frames.size, 0);
  });
}
