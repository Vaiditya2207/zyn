/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import assert from "node:assert/strict";
import test from "node:test";
import { workspaceFixture } from "./helpers/workspace-fixture.mjs";

const PILL = ".zen-workspace-scroll-to-tab";

test("fitting strip does not observe selected tabs or look up a hidden hint", () => {
  const f = workspaceFixture();
  const first = f.tab("one");
  f.browser.selectedTab = first;
  const space = f.space("one", { active: true });
  space.queries.length = 0;
  f.select(f.tab("one"));
  f.select(first);
  assert.equal(f.observers[0].observeCalls, 0);
  assert.equal(space.queries.filter(query => query === PILL).length, 0);
});

test("ineligible selection does not query an already hidden hint", () => {
  const f = workspaceFixture();
  const space = f.space("one", { active: true, overflowing: true });
  space.queries.length = 0;
  f.select(f.tab("one", { "zen-essential": "true" }));
  f.select(f.tab("one", { "zen-empty-tab": "true" }));
  f.select(f.tab("two"));
  assert.equal(f.observers[0].observeCalls, 0);
  assert.equal(space.queries.filter(query => query === PILL).length, 0);
});

test("overflow starts tracking, selection follows, underflow hides and releases target", () => {
  const f = workspaceFixture();
  const first = f.tab("one");
  f.browser.selectedTab = first;
  const space = f.space("one", { active: true });
  const observer = f.observers[0];
  const pill = space.querySelector(PILL);
  space.scrollbox.overflowing = true;
  space.scrollbox.dispatchEvent({ type: "overflow" });
  assert.ok(observer.observed.has(first));
  observer.deliver(first);
  assert.equal(pill.hidden, false);
  assert.equal(pill.getAttribute("direction"), "up");
  pill.dispatchEvent({ type: "click" });
  assert.equal(f.scrollRequests(), 1);
  const second = f.tab("one");
  f.select(second);
  assert.deepEqual([...observer.observed], [second]);
  space.scrollbox.overflowing = false;
  space.scrollbox.dispatchEvent({ type: "underflow" });
  assert.equal(observer.observed.size, 0);
  assert.equal(pill.hidden, true);
  space.scrollbox.overflowing = true;
  space.scrollbox.dispatchEvent({ type: "overflow" });
  assert.deepEqual([...observer.observed], [second]);
});

test("overflow respects live preference, hidden tabs and glance owner exclusions", () => {
  const f = workspaceFixture();
  const space = f.space("one", { active: true, overflowing: true });
  const observer = f.observers[0];
  const selected = f.tab("one");
  space._showScrollToSelectedTab = false;
  f.select(selected);
  assert.equal(observer.observed.size, 0);
  space._showScrollToSelectedTab = true;
  f.select(selected);
  assert.deepEqual([...observer.observed], [selected]);
  selected.hidden = true;
  f.select(selected);
  assert.equal(observer.observed.size, 0);
  const glance = f.tab("one");
  glance.glanceParent = f.tab("one", { "zen-essential": "true" });
  f.select(glance);
  assert.equal(observer.observed.size, 0);
});
