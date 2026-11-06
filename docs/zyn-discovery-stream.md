# Skip the unused Discovery Stream feed

The personal defaults disable
`browser.newtabpage.activity-stream.feeds.discoverystreamfeed`. The existing
`feeds.section.topstories=false` hides recommendations but does not prevent
their feed from being constructed. Zen Home is the user's new-tab surface.

## Source evidence

References below are relative to the inspected Firefox 159.0.1 engine under
`/Users/vaiditya/dev/personal/zyn/engine`; this worktree does not modify it.

- `browser/extensions/newtab/lib/ActivityStream.sys.mjs:2565` registers the
  Discovery Stream feed with an enabled default.
- `browser/extensions/newtab/lib/Store.sys.mjs:133` constructs only enabled
  feeds. Its middleware at line 48 dispatches each action to every active feed.
- `browser/extensions/newtab/lib/DiscoveryStreamFeed.sys.mjs:164` constructs a
  preloading `PersistentCache`. `PersistentCache.sys.mjs:20` starts loading;
  line 64 reads/parses the JSON file. This happens before the stories gate.
- `DiscoveryStreamFeed.sys.mjs:2698` initializes config/prefs and registers a
  Nimbus listener. Line 2714 also reads cached devtools state. In contrast,
  story/ad fetching is already conditional on `showStories` at line 2214.
- `browser/extensions/newtab/lib/ActivityStreamPrefs.sys.mjs:85` preserves an
  existing default, so the YAML-generated value survives feed initialization.

This removes one feed instance, its cache preload, initial dispatches, Nimbus
listener and ongoing action callbacks. It does not establish a measured startup,
RSS or network improvement; hidden stories already suppress their main fetches.

Telemetry, Normandy and rollout gates already exist. Connectivity probes already
wait for idle startup. HTTP/3, DNS prefetch and Early Hints are already enabled.
Safe Browsing/update cadence, certificate revocation, security Remote Settings,
extension blocklists and connectivity detection retain their existing settings.
Labs can still keep Nimbus active; this is not a claim that all Nimbus polling
has stopped. No broad Remote Settings endpoint or enrollment workaround is added.

## Verification and limitations

`python3 tests/zyn/check-prefs.py` checks the emitted default through the real
YAML generator and verifies static declarations are unchanged: passed.
`node --test tests/zyn/*.test.mjs`: 34 passed. `git diff --check`: passed.
There is no new runtime JavaScript or C++ logic.

Rebuild cost: **build:ui**, after the normal preference-generation/import step;
editing YAML alone does not update a packaged browser. No browser build, import,
launch or profile edit is performed for this change. Existing user overrides
can supersede this unlocked default.

Later candidate checks: inspect the effective pref, cold-start with Zen Home,
open a new tab and verify its floating URL bar, normal Places/topSites extension
results, favicons, wallpapers and recommendations-off behavior. Check the feed
map in a disposable profile and confirm Discovery Stream is absent. If returning
to built-in recommendations, set this feed pref back to true as well as enabling
stories. The feed toggle is supported by Store's normal init/uninit path.
Run `./mach mochitest browser/extensions/newtab/test/browser/` after building;
it was not run here. Sign-ins, Vimium, playback/PiP, WhatsApp, localhost and glass
appearance need the owner's normal candidate smoke test. Release readiness is
runtime-unverified; Temporal is not involved.
