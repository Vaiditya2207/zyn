/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import { readFileSync } from "node:fs";
import vm from "node:vm";

export class Element {
  attributes = new Map();
  listeners = new Map();
  nodes = new Map();
  queries = [];
  children = [];
  hidden = true;
  isConnected = true;
  style = { setProperty() {}, removeProperty() {} };

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, listener, { signal } = {}) {
    if (signal?.aborted) return;
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    signal?.addEventListener("abort", () => this.listeners.get(type).delete(listener));
  }
  dispatchEvent(event) {
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
  }
  listenerCount(type) { return this.listeners.get(type)?.size ?? 0; }
  querySelector(selector) {
    this.queries.push(selector);
    if (!this.nodes.has(selector)) this.nodes.set(selector, new Element());
    return this.nodes.get(selector);
  }
  appendChild() {}
  prepend() {}
  delayConnectedCallback() { return false; }
  initializeAttributeInheritance() {}
}

// Execute the shipping class; only chrome imports and platform/DOM APIs are stubbed.
export function workspaceFixture() {
  const observers = [];
  const registry = new Map();
  const tabContainer = new Element();
  tabContainer.handleEvent = () => {};
  let scrollRequests = 0;
  tabContainer._handleTabSelect = () => scrollRequests++;
  const browser = {
    tabContainer,
    selectedTab: null,
    isTab: element => element?.isTab,
    getIcon: () => "test-icon",
  };
  const animations = [];
  const context = {
    MozXULElement: Element,
    nsZenFolder: Element,
    customElements: { define: (name, ctor) => registry.set(name, ctor) },
    AbortController,
    CustomEvent: class { constructor(type) { this.type = type; } },
    XPCOMUtils: {
      defineLazyPreferenceGetter: (object, key, pref, value) => { object[key] = value; },
    },
    Services: { prefs: { getBoolPref: (name, value) => value } },
    document: { documentElement: new Element(), createXULElement: () => new Element() },
    window: { windowUtils: { getBoundsWithoutFlushing: () => ({ top: 0, bottom: 300 }) } },
    gBrowser: browser,
    gZenWorkspaces: { currentWindowIsSyncing: true },
    gZenGlanceManager: { getTabOrGlanceParent: tab => tab?.glanceParent ?? tab },
    gZenUIManager: { motion: { animate: (...args) => {
      animations.push(args);
      return Promise.resolve();
    } } },
    gReduceMotion: true,
    IntersectionObserver: class {
      observed = new Set();
      observeCalls = 0;
      disconnected = false;
      constructor(callback, options) {
        this.callback = callback;
        this.options = options;
        observers.push(this);
      }
      observe(tab) { this.observeCalls++; this.observed.add(tab); }
      unobserve(tab) { this.observed.delete(tab); }
      disconnect() { this.disconnected = true; this.observed.clear(); }
      deliver(tab, isIntersecting = false) {
        this.callback([{
          target: tab, isIntersecting,
          boundingClientRect: { bottom: -1 }, rootBounds: { top: 0 },
        }]);
      }
    },
  };
  const source = readFileSync(new URL("../../../src/zen/spaces/ZenSpace.mjs", import.meta.url), "utf8")
    .replace(/^import .*;$/m, "")
    .replace("export class nsZenWorkspace", "class nsZenWorkspace");
  vm.runInNewContext(source, context);

  function tab(id, attrs = {}) {
    const node = new Element();
    node.isTab = true;
    node.hidden = false;
    node.setAttribute("zen-workspace-id", id);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  }
  function space(id, { active = false, overflowing = false } = {}) {
    const node = new (registry.get("zen-workspace"))();
    node.id = id;
    if (active) node.setAttribute("active", "true");
    const scrollbox = node.querySelector("arrowscrollbox");
    scrollbox.overflowing = overflowing;
    scrollbox.scrollClientRect = { top: 20, bottom: 280 };
    node.connectedCallback();
    return node;
  }
  function select(selected) {
    browser.selectedTab = selected;
    tabContainer.dispatchEvent({ type: "TabSelect" });
  }
  return { space, tab, select, browser, observers, tabContainer, animations, context,
    scrollRequests: () => scrollRequests };
}
