/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import assert from "node:assert/strict";
import test from "node:test";
import { workspaceFixture } from "./helpers/workspace-fixture.mjs";

const PILL = ".zen-workspace-scroll-to-tab";

test("startup allocates a scroll-hint observer and selection listener only for the active space", () => {
  const f = workspaceFixture();
  f.browser.selectedTab = f.tab("one");
  f.space("one", { active: true, overflowing: true });
  const hidden = [f.space("two"), f.space("three")];
  assert.equal(f.observers.length, 1);
  assert.equal(f.tabContainer.listenerCount("TabSelect"), 1);
  for (const space of hidden) space.queries.length = 0;
  f.select(f.tab("one"));
  for (const space of hidden) {
    assert.equal(space.queries.length, 0);
    assert.equal(space.scrollbox.listenerCount("overflow"), 1, "only the base event forwarder");
  }
});

test("switching spaces releases old resources and follows the destination selection", () => {
  const f = workspaceFixture();
  const firstTab = f.tab("one");
  f.browser.selectedTab = firstTab;
  const first = f.space("one", { active: true, overflowing: true });
  const second = f.space("two", { overflowing: true });
  const oldObserver = f.observers[0];
  oldObserver.deliver(firstTab);
  assert.equal(first.querySelector(PILL).hidden, false);
  first.active = false;
  assert.equal(oldObserver.disconnected, true);
  assert.equal(oldObserver.observed.size, 0);
  assert.equal(first.querySelector(PILL).hidden, true);
  assert.equal(f.tabContainer.listenerCount("TabSelect"), 0);
  assert.equal(first.querySelector(PILL).listenerCount("click"), 0);
  const secondTab = f.tab("two");
  f.select(secondTab);
  second.active = true;
  assert.equal(f.observers.length, 2);
  assert.equal(f.tabContainer.listenerCount("TabSelect"), 1);
  assert.deepEqual([...f.observers[1].observed], [secondTab]);
  f.observers[1].deliver(secondTab);
  assert.equal(second.querySelector(PILL).hidden, false);
  second.querySelector(PILL).dispatchEvent({ type: "click" });
  assert.equal(f.scrollRequests(), 1);
});

test("repeated active writes and reconnects never duplicate listeners", () => {
  const f = workspaceFixture();
  f.browser.selectedTab = f.tab("one");
  const space = f.space("one", { active: true, overflowing: true });
  space.active = true;
  space.connectedCallback();
  assert.equal(f.observers.length, 1);
  assert.equal(f.tabContainer.listenerCount("TabSelect"), 1);
  space.isConnected = false;
  space.disconnectedCallback();
  assert.equal(f.tabContainer.listenerCount("TabSelect"), 0);
  space.active = true;
  assert.equal(f.observers.length, 1, "detached active changes do not allocate");
  space.isConnected = true;
  space.connectedCallback();
  assert.equal(f.observers.length, 2);
  assert.equal(f.tabContainer.listenerCount("TabSelect"), 1);
  space.active = false;
  space.isConnected = false;
  space.disconnectedCallback();
  space.isConnected = true;
  space.connectedCallback();
  assert.equal(f.observers.length, 2, "inactive reconnect remains lazy");
  assert.equal(f.tabContainer.listenerCount("TabSelect"), 0);
});

test("activation before markup connects is safe and allocation is deferred", () => {
  const f = workspaceFixture();
  const template = f.space("template");
  const space = new template.constructor();
  space.id = "one";
  space.isConnected = false;
  space.active = true;
  assert.equal(f.observers.length, 0);
  space.isConnected = true;
  space.connectedCallback();
  assert.equal(f.observers.length, 1);
  assert.equal(f.tabContainer.listenerCount("TabSelect"), 1);
});

test("a callback queued before deactivation cannot change a reactivated space", () => {
  const f = workspaceFixture();
  const tab = f.tab("one");
  f.browser.selectedTab = tab;
  const space = f.space("one", { active: true, overflowing: true });
  const oldObserver = f.observers[0];
  space.active = false;
  space.active = true;
  const newObserver = f.observers.at(-1);
  const pill = space.querySelector(PILL);
  oldObserver.deliver(tab);
  assert.equal(pill.hidden, true, "stale non-intersection cannot show the pill");
  newObserver.deliver(tab);
  assert.equal(pill.hidden, false);
  oldObserver.deliver(tab, true);
  assert.equal(pill.hidden, false, "stale intersection cannot hide the new pill");
});

test("deactivation invalidates pending hide animation completion", async () => {
  const f = workspaceFixture();
  const tab = f.tab("one");
  f.browser.selectedTab = tab;
  f.context.gReduceMotion = false;
  const completions = [];
  f.context.gZenUIManager.motion.animate = () => new Promise(resolve => completions.push(resolve));
  const space = f.space("one", { active: true, overflowing: true });
  const pill = space.querySelector(PILL);
  f.observers[0].deliver(tab);
  f.observers[0].deliver(tab, true);
  assert.equal(completions.length, 2);
  space.active = false;
  assert.equal(pill.hidden, true, "deactivation hides immediately");
  assert.equal(completions.length, 2, "deactivation starts no offscreen animation");
  space.active = true;
  f.observers.at(-1).deliver(tab);
  completions[1]();
  await Promise.resolve();
  assert.equal(pill.hidden, false, "old hide completion cannot hide a new hint");
});
