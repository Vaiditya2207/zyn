import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const glass = read("src/zen/common/styles/zyn-glass.css");
const sidebar = read("src/zen/compact-mode/zen-compact-mode.css");
const omnibox = read("src/zen/common/styles/zen-omnibox.css");

test("glass is packaged after upstream chrome styles so equal-specificity overrides win", () => {
  const assets = read("src/browser/base/content/zen-assets.inc.xhtml");
  assert.ok(assets.indexOf("zyn-glass.css") > assets.indexOf("zen-compact-mode.css"));
  assert.ok(assets.indexOf("zyn-glass.css") > assets.indexOf("zen-omnibox.css"));
  assert.match(read("src/zen/common/jar.inc.mn"), /content\/browser\/zen-styles\/zyn-glass\.css\s+\(\.\.\/\.\.\/zen\/common\/styles\/zyn-glass\.css\)/);
});

test("radius changes retain upstream acrylic, accessibility gates and rollback radii", () => {
  assert.match(sidebar, /blur\(var\(--zyn-acrylic-blur-radius, 42px\)\)/);
  assert.match(omnibox, /var\(--zen-backdrop-underlay\) blur\(var\(--zyn-acrylic-blur-radius, 40px\)\)/);
  for (const [source, pref] of [[sidebar, "sidebar"], [omnibox, "urlbar"]]) {
    assert.ok(source.includes(`zen.theme.acrylic-${pref}`));
    assert.ok(source.includes("not (prefers-reduced-transparency: reduce)"));
  }
  assert.match(glass, /@media -moz-pref\("zyn.theme.enabled"\)/);
  assert.match(glass, /--zyn-acrylic-blur-radius: 20px;/);
  for (const radius of [12, 40]) {
    assert.ok(glass.includes(`@media -moz-pref("zyn.theme.blur-radius", ${radius}) {\n      --zyn-acrylic-blur-radius: ${radius}px;`));
  }
  assert.match(glass, /@media \(prefers-reduced-motion: reduce\)\s*{\s*--zyn-acrylic-blur-radius: 12px;/);
});

test("low-power fallback removes both blur and SVG filter with matching specificity", () => {
  const fallback = glass.slice(glass.indexOf('@media -moz-pref("zyn.theme.low-power")'));
  assert.ok(fallback.includes('or -moz-pref("zyn.theme.blur-radius", 0)'));
  assert.ok(fallback.includes(':is(#navigator-toolbox, .zen-library-space) .zen-toolbar-background:not(:-moz-window-inactive)'));
  assert.ok(fallback.includes('#urlbar[breakout-extend] .urlbar-background'));
  assert.match(fallback, /backdrop-filter: none !important;/);
  assert.match(fallback, /background-color: light-dark\(rgb\(233 233 233\), rgb\(19 19 19\)\) !important;/);
});

test("accents add no animated/filtering layer or layout changes", () => {
  assert.match(glass, /@media not \(forced-colors: active\)/);
  assert.match(glass, /143 107 255/); // #8f6bff
  assert.match(glass, /255 138 91/); // #ff8a5b
  assert.doesNotMatch(glass, /(?:animation|transition|will-change|content|position|contain|width|height):/);
  assert.equal([...glass.matchAll(/backdrop-filter:/g)].length, 1); // Only the removal rule.
});
