# Zyn glass chrome

The browser-only `zyn-glass.css` reuses the existing sidebar/toolbar and floating
URL-bar background surfaces. It adds no backdrop layers, JS observers or timers.
The default 20px blur replaces Zen's 42px sidebar and 40px URL-bar blur; native
macOS vibrancy is unchanged. Selected tabs and the floating bar get a static,
low-opacity violet (#8f6bff) to warm orange (#ff8a5b) tint. Text, focus indicators,
button geometry and floating-bar behavior are unchanged. Forced colors skip the
new accents.

Dynamic preferences in `prefs/zen/zyn-appearance.yaml`:

| Preference | Default | Behavior |
| --- | --- | --- |
| `zyn.theme.enabled` | `true` | Master gate for this stylesheet. False restores upstream blur radii and removes the accents. |
| `zyn.theme.blur-radius` | `20` | Supported integers: 12, 20, 40. Other integers use 20; 0 selects the opaque fallback. |
| `zyn.theme.low-power` | `false` | Manual opt-in: remove both CSS backdrop filters, including the URL-bar SVG underlay; use an opaque backing. Does not detect macOS Low Power Mode. |

Reduced motion caps the blur at 12px while the theme is enabled. Zen's acrylic-off
and reduced-transparency gates remain intact. Low-power/zero wins over radius and
reduced-motion choices. Turning off the master gate also disables the low-power
override. No website preference, live profile or extension style is modified.

Source evidence: `zen-compact-mode.css:40-46` and `zen-omnibox.css:270-289`
contain the existing backdrop paths. Firefox's `gfx/wr/webrender/src/render_task.rs:962-1036`
constructs downscale and separable blur tasks from the radius. Lower radius is
not a proportional speed claim: downscaling/caching changes the cost, and must
be profiled on the candidate. The explicit no-filter fallback removes those CSS
filter paths. Native vibrancy still has its own cost.

Verification: 38 Node tests pass, including source contracts for packaging order,
upstream fallbacks, exact override selectors and the no-filter option. The real
YAML generator check passes and validates all three defaults; `node --check` and
`git diff --check` pass. These do not parse CSS with Gecko or validate pixels.

Later: import/build:ui/package the exact candidate, then run Zen compact-mode,
tabs and ub-actions mochitests. Check light/dark, compact/full, inactive windows,
new-tab floating bar with Zen Home, reduced motion/transparency, forced colors,
all documented radii, master disable and low-power. Confirm Vimium focus, tab
reset/close, PiP/video and WhatsApp in an authorized disposable profile. Profile
frame/GPU cost before claiming a speedup. A custom userChrome important rule,
including the reported 48px URL-bar blur, can override this theme; inspect the
computed style on the candidate rather than assuming the built-in radius wins.
No browser build or runtime verification was performed. Temporal is not involved.
