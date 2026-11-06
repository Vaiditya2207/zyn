import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../../src/zen/tabs/zen-tabs/vertical-tabs.css", import.meta.url), "utf8");
const glyphs = css.slice(
  css.indexOf(".tabbrowser-tab > .tab-stack > .tab-content > :is(.tab-close-button, .tab-reset-button) {"),
  css.indexOf("\n.tab-reset-pin-button {")
);

test("tab glyph animation has no per-frame geometry changes or permanent promotion hint", () => {
  assert.ok(glyphs.length > 0);
  const widths = [...glyphs.matchAll(/\bwidth:\s*([^;]+);/g)].map(match => match[1]);
  assert.deepEqual(widths, ["15px"]);
  assert.match(glyphs, /transition:\s*rotate 0\.12s ease,\s*scale 0\.12s ease;/);
  assert.doesNotMatch(glyphs, /will-change:/);
  assert.match(glyphs, /@media \(prefers-reduced-motion: reduce\)\s*{\s*transition: none;/);
});

test("close and reset glyph endpoints retain their lengths and thickness", () => {
  assert.match(glyphs, /--zen-tab-button-line-scale: 1;/);
  assert.match(glyphs, /--zen-tab-button-line-scale: 0\.8;/);
  assert.match(glyphs, /scale: var\(--zen-tab-button-line-scale\) 1;/);
  assert.match(glyphs, /height: 1\.5px;/);
  const starting = glyphs.slice(glyphs.indexOf("@starting-style"));
  assert.match(starting, /\.tab-close-button::after\s*{\s*rotate: 0deg;\s*scale: 0\.8 1;/);
  assert.match(starting, /\.tab-reset-button::before\s*{\s*rotate: 45deg;\s*scale: 1 1;/);
  assert.match(starting, /\.tab-reset-button::after\s*{\s*rotate: -45deg;\s*scale: 1 1;/);
});
