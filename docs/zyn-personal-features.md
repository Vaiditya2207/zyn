# Zyn personal defaults and idle unloading

Branch: `feat/zyn-personal-features`, based on `zyn`. Firefox 159.0.1 / Zen
1.24.1b. Maintained changes live in this worktree, not the generated engine.

## Defaults and integration

`prefs/zen/zyn.yaml` contains the requested appearance, navigation, privacy,
low-memory, HTTP/2 and local-extension defaults. Acrylic remains enabled.
No cache/connection-size, process-count or media-buffer overrides were added.

Surfer does **not** read these YAML files during `build:ui`. `npm run import`
first runs `npm run ffprefs`, which recursively parses `prefs/**/*.yaml`, then
runs the dump importer and `surfer import`. The generator now reserves
`prefs/zen/zyn.yaml` as a final **dynamic** overlay. All other files retain their
existing traversal and stable preference-name ordering. Equal upstream names
still retain the upstream ordering; the personal file does not rely on its
alphabetical position. Conditions remain evaluated by the C preprocessor.

`tools/ffprefs/src/main.rs` writes `engine/browser/app/profile/zen.js` and adds
`#include zen.js` at the end of `firefox.js`. The inspected Firefox source has
that include on its last line. Last dynamic defaults win except where an
upstream preference is already locked. The repeated locked privacy settings
have the same value and keep their locks (`Preferences.cpp`,
`Pref::SetDefaultValue`). Profile user values still override unlocked defaults.
Removing an old override from user.js alone does not reset prefs.js. This change
neither reads nor migrates the live profile. The older snapshot and the
subsequently supplied `user.current.js` were both compared. The current file restores cache/media/connection settings to Firefox
defaults and adds low-memory mask=3, warning response=true, Nimbus rollouts=false
and usage upload=false. Those choices already match this implementation: the
first group is inherited from Firefox and the four added gates are in the overlay.
No shared current-profile/overlay preference conflicts were found. The remaining
profile-only tweaks were not broadened into the explicitly requested build defaults.

Static declarations (including acrylic's `mirror: once`) are left unchanged.
The integration check proves the generated static include is byte-for-byte the
same with and without the overlay. A restart is needed for once-read defaults.

Parent integration steps, **not executed here**:

1. Integrate the commits on the intended build branch.
2. Regenerate preferences with `npm run ffprefs`; import the new UI source and
   localization through the normal `npm run import` workflow.
3. Run `npm run build:ui` and restart the resulting candidate. Check the effective
   preferences in that candidate, especially any existing user overrides.

Rebuild cost: **build:ui**, plus compiling the small Rust preference generator
if needed. No Firefox C++/Rust changes, static-pref changes or native browser
rebuild are intended. Packaging/import and the actual UI build remain unverified.

## Idle tabs

“Unload idle tabs in this window” is in the tab context menu and command palette.
It is also listed in `about:keyboard`, initially **unassigned** to avoid overriding
an existing shortcut. The action includes inactive workspaces in this window.
`zyn.tabs.unload-idle-minutes` defaults to 60; nonpositive values disable scans.

The new `ZynIdleTabs.mjs` snapshots tab membership, flushes each eligible tab's
session state with `prepareDiscardBrowser`, then rechecks live state, window ownership and document
identity before calling `discardBrowser(tab, false)`. It skips selected,
Essential, pending, closing, disconnected, busy, empty, undiscardable, audible,
PiP, sharing, active peer-connection and visible split/Zen-active tabs. Eligible HTTP(S) tabs are ordered by Firefox's `lastAccessed` timestamp, oldest
first, so automatic mode does not simply choose the first tab in sidebar order.
Scheme/hostname guards keep `web.whatsapp.com`, `localhost`, its subdomains,
IPv4 loopback (127/8) and IPv6 loopback (`::1`) loaded on every port. Missing,
unparseable and non-HTTP(S) locations are also left alone, including extension
home pages. Checks run before and after the session-state flush. URL parsing
is local and transient; no URLs, queries, page contents or history are retained.
These protections apply to this personal command/timer, not Firefox's separate
low-memory unloader or explicit native unload commands.

All tabs reporting a `beforeunload` handler are conservatively skipped. This is
stricter than skipping only handlers that would prompt; it avoids Firefox's
synchronous `permitUnload` event-loop spin. The native non-forced discard path
also retains its dialog and `permitUnload("dontUnload")` veto. Source references:

- Firefox `browser/components/tabbrowser/Tabbrowser.sys.mjs`,
  `#mayDiscardBrowser`, `prepareDiscardBrowser`, `discardBrowser`, and
  `explicitUnloadTabs` (the latter can prompt and force-discard, so is not used).
- Firefox `browser/components/tabbrowser/TabUnloader.sys.mjs`,
  `usingWebRTC`, `playingMedia`, and `usingPictureInPicture`.
- Firefox `toolkit/content/widgets/browser-custom-element.mjs`, `permitUnload`.
- Zen `src/zen/split-view/ZenViewSplitter.mjs`, `zenModeActive` on the browser.

`zyn.tabs.auto-unload-idle` defaults to false: no periodic timer is installed.
When enabled it scans once per minute, discards at most one tab per window per
scan, serializes with manual runs and stops when disabled/window closes. The
preference is checked again after an asynchronous flush.

Risks: a silent app can have unsaved work or a background job without a
beforeunload handler or WebRTC/media signal. Idle time cannot detect that.
Automatic mode remains opt-in. Low-memory unloading is a separate native policy:
its requested mask=3/warning=true defaults are not the same as this command's
60-minute or Essential protection policy. A 60-second sessionstore interval can
increase crash-recovery loss relative to shorter intervals. Unsigned extensions
are allowed as explicitly requested. No native pressure simulation was run.

Rebuild cost: **build:ui**. Browser runtime, menu/shortcut behavior, session
restoration, actual tab memory recovery and foreground interaction need candidate
verification. No measured RSS or page-load-speed claim is made.

## Small UI speed change

`src/zen/compact-mode/ZenCompactMode.mjs`, `hoverableElements` / `addMouseActions`:
the getter constructs an array, three records, reads a preference and looks up
UI elements. The binding loop previously called it seven times for three targets.
It now takes one local snapshot. The sidebar leave path previously called it
twice when keeping hover open; it now reads once in that event and still reflects
preference changes immediately. No lifetime cache or invalidation scheme is added.

`tests/zyn/compact-hover.test.mjs` executes the actual manager in a synthetic UI
and counts the relevant preference reads: **7 → 1 at binding, 2 → 1 per qualifying
sidebar leave**. It also changes the duration after binding and checks the new
value is used. This reduces deterministic work/allocations; it does not establish
an FPS or millisecond improvement. Blur, acrylic and animation timing are unchanged.
This is a narrow UI follow-up to the speed proposal's sidebar-hot-path guidance;
the proposal's larger cache and compositor hypotheses were not treated as proof.

Rebuild cost: **build:ui**. Risk: small upstream merge hunk in the hover handler;
verify sidebar/toolbar hover after integration.

Skipped: native canvas arithmetic patches, process/BFCache limits, disabling glass,
new URL-bar caches, animation removals, Zen Home extension changes, live profile
edits and any speculative performance claims. The proposals do not justify those
changes within this task's evidence and scope.

## Verification

Executed in this worktree:

- `node --test tests/zyn/*.test.mjs`: 34 passing checks, including async races,
  beforeunload exclusions, media/WebRTC, automatic-mode cancellation and hover work.
- `cargo test --offline --locked --manifest-path tools/ffprefs/Cargo.toml`: passing
  overlay ordering/static-declaration test, using the pinned Rust toolchain.
- `python3 tests/zyn/check-prefs.py`: real YAML parsing/generation in disposable
  fixture directories under the worktree's ignored target directory; checks
  final critical values, include idempotence and unchanged static output.
- `node --check` for every changed/new JS/MJS and `git diff --check`.

The Rust formatter component is unavailable; no tools were installed. Rust changes
were formatted manually. No browser build, installed-runtime test or profile
modification was performed. Local tests do not establish release readiness.

Run later in the parent's imported, built engine:

```sh
./mach mochitest zen/tests/tabs/browser_zyn_idle_tabs.js
./mach mochitest zen/tests/compact_mode/
./mach mochitest zen/tests/kbs/
./mach mochitest zen/tests/ub-actions/
./mach mochitest browser/components/tabbrowser/test/browser/tabs/browser_multiselect_tabs_unload_with_beforeunload.js
```

The new browser test checks real safe discard, beforeunload protection without a
prompt, retained selection, and menu/key registration. It is added to the existing
Zen tabs manifest but **not run here**. Manual candidate checks should also cover
PiP, calls/capture, two spaces, splits, restored tabs and changing prefs during a
scan using disposable pages. Temporal is not involved.

Local Workspace session logging is blocked: no enabled tools exposed, configured
transport is HTTP rather than the required local stdio, and the inherited key is
absent. No substitute log service or credential retrieval was used. Pending unsaved
summary: this branch's source changes/checks and remaining parent build/runtime
verification, as documented here. No push, PR, deployment or installed-app change.


## Safer idle-session selection follow-up

`src/zen/common/modules/ZynIdleTabs.mjs:82` avoids unnecessary session-state
flushes and destructive unload/reconnect cycles for silent messaging and local
development pages. Neither WebRTC nor beforeunload is guaranteed for a websocket
session. The supplied usage report includes WhatsApp and 127.0.0.1 among nine
open tabs. Canonical hostname matching covers case, trailing dots and abbreviated
IPv4; path/query/user-info text and lookalike suffixes do not trigger protection.
No DNS lookup, localhost probing or page execution is introduced.

`ZynIdleTabs.mjs:126` sorts eligible candidates oldest first and rechecks them
live at both sides of each async flush. It preserves the source tab collection,
60-minute default, opt-in timer and one-discard limit. This is an inexpensive LRU
policy, not a claim to identify the heaviest tab. Firefox's native memory estimate
uses `ChromeUtils.requestProcInfo()` and browsing-context/process mapping
(`engine/browser/components/tabbrowser/TabUnloader.sys.mjs:141`, `:448`); its own
small-tab-set threshold is 10 (`:21`) and primary sort uses recency (`:274`).
That extra sampling is not justified for this nine-tab workload.

Recently audible tabs retain the existing native `soundPlaying` guard:
`engine/browser/components/tabbrowser/content/tab.mjs:960` derives audibility
from the MediaController and keeps the flag until its removal timer fires
(`:1013`). This patch adds a regression test for that grace state; it does not
introduce a new audio timeout. Paused media can still unload after the native
grace expires. Existing PiP, WebRTC, beforeunload, split-view, document identity,
window ownership and native non-forced-discard checks remain in place.

Verified: 59 Node checks passed (25 added), both changed MJS files pass
`node --check`, the real YAML generator check passes and `git diff --check`
passes. Before implementation, the expanded idle suite had 17 expected failures
for missing protections/order; after implementation all 58 idle tests pass.
The broader npm test entry point needs an imported/built engine and is not run.
Run the existing `zen/tests/tabs/browser_zyn_idle_tabs.js` mochitest later, plus
candidate checks for loopback/WhatsApp retention, native audio grace, PiP, splits,
restoration and automatic oldest-first selection using disposable test pages.
No real account or browser was exercised. No memory/latency benefit is measured.
Rebuild cost: **build:ui** after normal import; runtime/release readiness remains
unverified. Temporal is not involved.

Limit: protected sessions deliberately retain their memory; aliases resolving to
loopback and arbitrary remote consoles are not detected. Silent remote apps can
still have unsaved work without a beforeunload handler. Automatic mode stays off.
Local Workspace logging remains blocked (no exposed tools/inherited auth); the
source/test/commit summary and later candidate checks have not been saved there.
