/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Personal idle unloading. Only the current URL's scheme/host is used for
 * session protection; no page contents or history are inspected or retained. */
export class ZynIdleTabs {
  constructor(win, prefs, webrtcUI) {
    this.window = win;
    this.prefs = prefs;
    this.webrtcUI = webrtcUI;
    this.running = false;
    this.timer = null;
  }

  init() {
    const doc = this.window.document;
    const item = doc.createXULElement("menuitem");
    item.id = "zyn-unload-idle-tabs";
    item.setAttribute("label", "Unload idle tabs in this window");
    item.setAttribute("command", "cmd_zynUnloadIdleTabs");
    doc.getElementById("tabContextMenu").appendChild(item);
    doc
      .getElementById("cmd_zynUnloadIdleTabs")
      .addEventListener("command", event => {
        event.stopPropagation();
        this.unloadIdleTabs().catch(console.error);
      });
    this.prefs.addObserver("zyn.tabs.auto-unload-idle", this);
    this.updateTimer();
    this.window.addEventListener(
      "unload",
      () => {
        this.prefs.removeObserver("zyn.tabs.auto-unload-idle", this);
        this.window.clearInterval(this.timer);
      },
      { once: true }
    );
  }

  observe() {
    this.updateTimer();
  }

  updateTimer() {
    this.window.clearInterval(this.timer);
    this.timer = null;
    if (this.prefs.getBoolPref("zyn.tabs.auto-unload-idle", false)) {
      // Opt-in only, at most one tab each minute. No timer in the default mode.
      this.timer = this.window.setInterval(() => {
        this.unloadIdleTabs({ automatic: true }).catch(console.error);
      }, 60000);
    }
  }

  isEligible(tab, now, idleMs) {
    const browser = tab?.linkedBrowser;
    if (
      this.window.closed ||
      !tab?.isConnected ||
      tab.ownerGlobal !== this.window ||
      !browser?.isConnected ||
      !browser.isRemoteBrowser ||
      // Conservatively skip every beforeunload handler. Besides avoiding
      // prompts, this avoids permitUnload spinning the event loop before the
      // native discard, where selection/media state could otherwise change.
      browser.hasBeforeUnload ||
      tab.selected ||
      tab.closing ||
      tab.undiscardable ||
      tab.zenModeActive ||
      browser.zenModeActive ||
      tab.splitview?.hasActiveTab ||
      tab.soundPlaying ||
      tab.pictureinpicture ||
      ["zen-essential", "pending", "busy", "zen-empty-tab", "sharing"].some(
        name => tab.hasAttribute(name)
      )
    ) {
      return false;
    }
    // Silent messaging and development pages can have live sessions without
    // media, WebRTC or beforeunload signals. Never flush/discard these here.
    // Parse locally; neither the URL nor its query is retained or logged.
    try {
      const url = new URL(browser.currentURI.spec);
      const host = url.hostname.replace(/\.$/, "");
      if (
        !["http:", "https:"].includes(url.protocol) ||
        host === "web.whatsapp.com" ||
        host === "localhost" ||
        host.endsWith(".localhost") ||
        /^127\.\d+\.\d+\.\d+$/.test(host) ||
        host === "[::1]"
      ) {
        return false;
      }
    } catch {
      // Missing/detached or unparseable locations must not abort the scan.
      return false;
    }
    // Match the native TabUnloader's stream AND peer-connection protections.
    if (
      this.webrtcUI.browserHasStreams(browser) ||
      browser.browsingContext?.currentWindowGlobal?.hasActivePeerConnections()
    ) {
      return false;
    }
    const lastAccessed = tab.lastAccessed;
    return Number.isFinite(lastAccessed) && now - lastAccessed >= idleMs;
  }

  async unloadIdleTabs({ automatic = false } = {}) {
    if (this.running || this.window.closed) {
      return 0;
    }
    const minutes = this.prefs.getIntPref("zyn.tabs.unload-idle-minutes", 60);
    if (minutes <= 0) {
      return 0;
    }
    const idleMs = minutes * 60000;
    const { gBrowser, gZenWorkspaces } = this.window;
    let count = 0;
    this.running = true;
    try {
      // Prefer the least recently used eligible tab, including inactive Zen
      // workspaces. No process enumeration/memory sampling for this small set.
      // Recheck live eligibility before and after each asynchronous flush.
      const now = Date.now();
      const candidates = [...gZenWorkspaces.allStoredTabs]
        .filter(tab => this.isEligible(tab, now, idleMs))
        .sort((a, b) => a.lastAccessed - b.lastAccessed);
      for (const tab of candidates) {
        if (
          automatic &&
          !this.prefs.getBoolPref("zyn.tabs.auto-unload-idle", false)
        ) {
          break;
        }
        if (!this.isEligible(tab, Date.now(), idleMs)) {
          continue;
        }
        const browser = tab.linkedBrowser;
        const document = browser.browsingContext?.currentWindowGlobal;
        await gBrowser.prepareDiscardBrowser(tab);
        if (
          (automatic &&
            !this.prefs.getBoolPref("zyn.tabs.auto-unload-idle", false)) ||
          tab.linkedBrowser !== browser ||
          browser.browsingContext?.currentWindowGlobal !== document ||
          !this.isEligible(tab, Date.now(), idleMs)
        ) {
          continue;
        }
        // Do not use explicitUnloadTabs: it may prompt and force-discard.
        // false retains Firefox's permitUnload("dontUnload") and dialog veto.
        if (gBrowser.discardBrowser(tab, false)) {
          count++;
          if (automatic) {
            break;
          }
        }
      }
    } finally {
      this.running = false;
    }
    return count;
  }
}

// Imported into each browser window by ZenPreloadedScripts, like other UI modules.
if (typeof window !== "undefined") {
  const { webrtcUI } = ChromeUtils.importESModule(
    "resource:///modules/webrtcUI.sys.mjs"
  );
  window.gZynIdleTabs = new ZynIdleTabs(window, Services.prefs, webrtcUI);
  document.addEventListener(
    "DOMContentLoaded",
    () => window.gZynIdleTabs.init(),
    { once: true }
  );
}
