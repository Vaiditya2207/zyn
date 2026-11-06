/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */

add_task(async function idle_unload_respects_native_beforeunload_veto() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["zyn.tabs.auto-unload-idle", false],
      ["zyn.tabs.unload-idle-minutes", 60],
      ["dom.require_user_interaction_for_beforeunload", false],
    ],
  });
  const win = await BrowserTestUtils.openNewBrowserWindow();
  try {
    const selected = win.gBrowser.selectedTab;
    const saved = await BrowserTestUtils.openNewForegroundTab(
      win.gBrowser,
      "https://example.com/"
    );
    const draft = await BrowserTestUtils.openNewForegroundTab(
      win.gBrowser,
      "https://example.com/"
    );
    await SpecialPowers.spawn(draft.linkedBrowser, [], () => {
      content.onbeforeunload = event => {
        event.preventDefault();
        event.returnValue = "Keep this draft";
      };
    });
    await BrowserTestUtils.switchTab(win.gBrowser, selected);
    for (const tab of [saved, draft]) {
      tab._lastAccessed = Date.now() - 61 * 60000;
    }
    Assert.ok(
      win.document.getElementById("zyn-unload-idle-tabs"),
      "tab menu action installed"
    );
    Assert.ok(
      win.document.getElementById("zyn-unload-idle-tabs-shortcut"),
      "customizable key installed"
    );
    Assert.equal(
      await win.gZynIdleTabs.unloadIdleTabs(),
      1,
      "only the safe idle document unloads"
    );
    Assert.ok(
      saved.hasAttribute("pending"),
      "safe tab retained for restoration"
    );
    Assert.ok(
      !draft.hasAttribute("pending"),
      "beforeunload document remains loaded"
    );
    Assert.equal(win.gBrowser.selectedTab, selected, "selection is unchanged");
    Assert.equal(
      win.gBrowser.getTabDialogBox(draft.linkedBrowser)._tabDialogManager
        ._dialogs.length,
      0,
      "no beforeunload prompt opened"
    );
    await SpecialPowers.spawn(draft.linkedBrowser, [], () => {
      content.onbeforeunload = null;
    });
  } finally {
    // Do not leave a beforeunload prompt behind if an assertion failed.
    for (const tab of win.gBrowser.tabs) {
      if (tab.linkedBrowser?.isRemoteBrowser && !tab.hasAttribute("pending")) {
        await SpecialPowers.spawn(tab.linkedBrowser, [], () => {
          content.onbeforeunload = null;
        });
      }
    }
    await BrowserTestUtils.closeWindow(win);
    await SpecialPowers.popPrefEnv();
  }
});
