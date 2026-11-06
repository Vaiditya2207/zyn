/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import assert from "node:assert/strict";
import test from "node:test";
import { ZynIdleTabs } from "../../src/zen/common/modules/ZynIdleTabs.mjs";

function fixture() {
  const tab = {
    isConnected: true,
    lastAccessed: Date.now() - 61 * 60000,
    hasAttribute(name) {
      return this.attributes.has(name);
    },
    attributes: new Set(),
    linkedBrowser: {
      isConnected: true,
      isRemoteBrowser: true,
      currentURI: { spec: "https://example.com/reference" },
      browsingContext: {
        currentWindowGlobal: { hasActivePeerConnections: () => false },
      },
    },
  };
  const discarded = [];
  const prefs = {
    getIntPref: () => 60,
    getBoolPref: () => false,
  };
  const win = {
    closed: false,
    gZenWorkspaces: { allStoredTabs: [tab] },
    gBrowser: {
      prepareDiscardBrowser: async () => {},
      discardBrowser(t, force) {
        discarded.push({ t, force });
        return true;
      },
    },
  };
  tab.ownerGlobal = win;
  const service = new ZynIdleTabs(win, prefs, {
    browserHasStreams: b => !!b.streams,
  });
  return { tab, win, prefs, service, discarded };
}

test("unloads an idle tab only through non-forced discard", async () => {
  const { service, discarded } = fixture();
  assert.equal(await service.unloadIdleTabs(), 1);
  assert.equal(discarded.length, 1);
  assert.equal(discarded[0].force, false);
});

for (const property of [
  "selected",
  "closing",
  "undiscardable",
  "soundPlaying",
  "pictureinpicture",
  "zenModeActive",
]) {
  test(`protects ${property}`, async () => {
    const { service, tab, discarded } = fixture();
    tab[property] = true;
    assert.equal(await service.unloadIdleTabs(), 0);
    assert.equal(discarded.length, 0);
  });
}
for (const attr of [
  "zen-essential",
  "pending",
  "busy",
  "zen-empty-tab",
  "sharing",
]) {
  test(`protects ${attr}`, async () => {
    const { service, tab } = fixture();
    tab.attributes.add(attr);
    assert.equal(await service.unloadIdleTabs(), 0);
  });
}
for (const mutate of [
  t => {
    t.lastAccessed = Date.now();
  },
  t => {
    t.lastAccessed = NaN;
  },
  t => {
    t.isConnected = false;
  },
  t => {
    t.linkedBrowser.zenModeActive = true;
  },
  t => {
    t.splitview = { hasActiveTab: true };
  },
  t => {
    t.linkedBrowser.streams = true;
  },
  t => {
    t.linkedBrowser.browsingContext.currentWindowGlobal.hasActivePeerConnections =
      () => true;
  },
]) {
  test("protects recent, missing, visible split and active WebRTC state", async () => {
    const { service, tab } = fixture();
    mutate(tab);
    assert.equal(await service.unloadIdleTabs(), 0);
  });
}
for (const mutate of [
  ({ tab }) => {
    tab.selected = true;
  },
  ({ tab }) => {
    tab.soundPlaying = true;
  },
  ({ tab }) => {
    tab.linkedBrowser.streams = true;
  },
  ({ tab }) => {
    tab.lastAccessed = Date.now();
  },
  ({ win }) => {
    win.closed = true;
  },
  ({ tab }) => {
    tab.linkedBrowser.browsingContext.currentWindowGlobal = {};
  },
]) {
  test("rechecks tab and document after the asynchronous state flush", async () => {
    const f = fixture();
    f.win.gBrowser.prepareDiscardBrowser = async () => mutate(f);
    assert.equal(await f.service.unloadIdleTabs(), 0);
    assert.equal(f.discarded.length, 0);
  });
}
test("native veto is respected and concurrent scans are serialized", async () => {
  const f = fixture();
  let release;
  f.win.gBrowser.prepareDiscardBrowser = () =>
    new Promise(resolve => {
      release = resolve;
    });
  f.win.gBrowser.discardBrowser = () => false;
  const first = f.service.unloadIdleTabs();
  assert.equal(await f.service.unloadIdleTabs(), 0);
  release();
  assert.equal(await first, 0);
});
test("invalid thresholds fail closed", async () => {
  const f = fixture();
  f.prefs.getIntPref = () => 0;
  assert.equal(await f.service.unloadIdleTabs(), 0);
});

test("automatic mode requires opt-in and limits each scan to one tab", async () => {
  const f = fixture();
  assert.equal(await f.service.unloadIdleTabs({ automatic: true }), 0);
  f.prefs.getBoolPref = () => true;
  f.win.gZenWorkspaces.allStoredTabs.push({ ...f.tab });
  assert.equal(await f.service.unloadIdleTabs({ automatic: true }), 1);
  assert.equal(f.discarded.length, 1);
});

test("disabling automatic mode during a flush cancels its discard", async () => {
  const f = fixture();
  f.prefs.getBoolPref = () => true;
  f.win.gBrowser.prepareDiscardBrowser = async () => {
    f.prefs.getBoolPref = () => false;
  };
  assert.equal(await f.service.unloadIdleTabs({ automatic: true }), 0);
  assert.equal(f.discarded.length, 0);
});

test("default mode installs no timer; enabling then disabling clears it", () => {
  const f = fixture();
  let scheduled = 0;
  const cleared = [];
  f.win.clearInterval = id => cleared.push(id);
  f.win.setInterval = (fn, delay) => {
    assert.equal(delay, 60000);
    scheduled++;
    return 42;
  };
  f.service.updateTimer();
  assert.equal(scheduled, 0);
  f.prefs.getBoolPref = () => true;
  f.service.updateTimer();
  assert.equal(scheduled, 1);
  f.prefs.getBoolPref = () => false;
  f.service.updateTimer();
  assert.equal(f.service.timer, null);
  assert.ok(cleared.includes(42));
});

test("beforeunload handlers are skipped before any flush or native event-loop spin", async () => {
  const f = fixture();
  f.tab.linkedBrowser.hasBeforeUnload = true;
  f.win.gBrowser.prepareDiscardBrowser = () => {
    throw new Error("must not flush");
  };
  assert.equal(await f.service.unloadIdleTabs(), 0);
});

test("a beforeunload handler installed during the flush also protects the tab", async () => {
  const f = fixture();
  f.win.gBrowser.prepareDiscardBrowser = async () => {
    f.tab.linkedBrowser.hasBeforeUnload = true;
  };
  assert.equal(await f.service.unloadIdleTabs(), 0);
  assert.equal(f.discarded.length, 0);
});

test("a tab moved to another window during the flush is left alone", async () => {
  const f = fixture();
  f.win.gBrowser.prepareDiscardBrowser = async () => {
    f.tab.ownerGlobal = {};
  };
  assert.equal(await f.service.unloadIdleTabs(), 0);
  assert.equal(f.discarded.length, 0);
});

for (const url of [
  "https://web.whatsapp.com/",
  "https://WEB.WHATSAPP.COM./",
  "http://localhost:8233/",
  "https://app.localhost:3000/",
  "http://127.0.0.1:8768/",
  "http://127.12.34.56/",
  "http://127.1/",
  "http://[::1]:3000/",
  "http://LOCALHOST.:8085/",
  "about:blank",
  "moz-extension://extension-id/home.html",
  "not a URL",
]) {
  test(`keeps protected or non-web location loaded: ${url}`, async () => {
    const f = fixture();
    f.tab.linkedBrowser.currentURI.spec = url;
    let flushes = 0;
    f.win.gBrowser.prepareDiscardBrowser = async () => flushes++;
    assert.equal(await f.service.unloadIdleTabs(), 0);
    assert.equal(flushes, 0);
    assert.equal(f.discarded.length, 0);
  });
}

for (const url of [
  "https://github.com/example/repo/pull/1",
  "https://web.whatsapp.com.example.org/",
  "https://localhost.example.org/",
  "https://example.org/localhost",
  "https://example.org/?next=http://127.0.0.1/",
  "https://web.whatsapp.com@example.org/",
  "https://127.0.0.1.example.org/",
]) {
  test(`unloads eligible reference without hostname false positives: ${url}`, async () => {
    const f = fixture();
    f.tab.linkedBrowser.currentURI.spec = url;
    assert.equal(await f.service.unloadIdleTabs(), 1);
  });
}

test("missing or inaccessible location fails closed", async () => {
  const f = fixture();
  delete f.tab.linkedBrowser.currentURI;
  assert.equal(await f.service.unloadIdleTabs(), 0);
  Object.defineProperty(f.tab.linkedBrowser, "currentURI", {
    get() {
      throw new Error("browser detached");
    },
  });
  assert.equal(await f.service.unloadIdleTabs(), 0);
});

for (const url of ["https://web.whatsapp.com/", "http://localhost:3000/"]) {
  test(`rechecks protected location after session flush: ${url}`, async () => {
    const f = fixture();
    f.win.gBrowser.prepareDiscardBrowser = async () => {
      f.tab.linkedBrowser.currentURI.spec = url;
    };
    assert.equal(await f.service.unloadIdleTabs(), 0);
    assert.equal(f.discarded.length, 0);
  });
}

test("automatic scan skips protected sessions and unloads oldest eligible tab first", async () => {
  const f = fixture();
  f.prefs.getBoolPref = () => true;
  const old = { ...f.tab, lastAccessed: Date.now() - 180 * 60000 };
  const protectedTab = {
    ...f.tab,
    lastAccessed: Date.now() - 240 * 60000,
    linkedBrowser: {
      ...f.tab.linkedBrowser,
      currentURI: { spec: "https://web.whatsapp.com/" },
    },
  };
  f.win.gZenWorkspaces.allStoredTabs = [f.tab, protectedTab, old];
  assert.equal(await f.service.unloadIdleTabs({ automatic: true }), 1);
  assert.equal(f.discarded[0].t, old);
  assert.deepEqual(f.win.gZenWorkspaces.allStoredTabs, [f.tab, protectedTab, old]);
});

test("a candidate becoming active while an older tab flushes stays loaded", async () => {
  const f = fixture();
  const old = { ...f.tab, lastAccessed: Date.now() - 180 * 60000 };
  f.win.gZenWorkspaces.allStoredTabs = [f.tab, old];
  f.win.gBrowser.prepareDiscardBrowser = async tab => {
    if (tab === old) f.tab.selected = true;
  };
  assert.equal(await f.service.unloadIdleTabs(), 1);
  assert.equal(f.discarded[0].t, old);
});

test("native audio-icon grace protects a recently audible tab", async () => {
  const f = fixture();
  // Firefox retains soundplaying during its scheduled-removal grace period.
  f.tab.soundPlaying = true;
  f.tab.attributes.add("soundplaying-scheduledremoval");
  assert.equal(await f.service.unloadIdleTabs(), 0);
  assert.equal(f.discarded.length, 0);
});
