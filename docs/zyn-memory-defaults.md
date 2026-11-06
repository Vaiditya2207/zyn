# Zyn spare-process budget

For the personal 24 GB Mac / roughly nine-tab workload, default
`dom.ipc.processPrelaunch.fission.number` to **1**, down from desktop **3**.
Keep prelaunch enabled, Fission enabled and active per-site process limits intact.
This removes up to two unused spare processes when the queue would otherwise be
full; it is not a measured RSS saving or a cap on loaded tabs.

## Source evidence (Firefox 159.0.1)

Paths below are relative to the imported `engine/`, inspected read-only:

- `modules/libpref/init/StaticPrefList.yaml:3736`: Fission spare queue defaults to
  three on desktop, one on Android; low-memory cutoff defaults to 4096 MB.
- `dom/ipc/PreallocatedProcessManager.cpp:165`: Fission reads that number;
  24 GB does not qualify for its automatic one-process low-memory override.
- `dom/ipc/PreallocatedProcessManager.cpp:304`: allocation makes a content
  process, retains it in the queue and schedules further allocations up to the
  configured count. `:196` takes a warm process; `:156` clears spare processes on
  memory pressure. The change avoids retaining two extra spares before pressure.
- `dom/ipc/ContentParent.cpp:885`: creation can consume a preallocated process.
  One spare preserves this warm path, but a burst can exhaust it sooner.

Other candidates were evaluated and deliberately left at upstream defaults:

- `dom.ipc.processCount.webIsolated`: desktop 4, per-origin rather than global
  (`modules/libpref/init/all.js:1879`). Four GitHub tabs are a plausible trial
  case, but lowering the cap can increase same-site contention and crash scope.
  No process-pool or runtime timing measurement justifies that tradeoff yet.
- `browser.sessionhistory.max_total_viewers`: -1 (`modules/libpref/init/all.js:174`),
  calculated with a cap of eight (`docshell/shistory/nsSHistory.cpp:287`). Preserve
  fast back/forward navigation rather than introduce history reload churn.
- Image discard is already enabled, including animated frames
  (`modules/libpref/init/StaticPrefList.yaml:9170`). Pressure discard factor is
  already 1 (`:9215`), and unused-surface expiration is 60 seconds (`:9228`).
  Reducing capacity/expiration without occupancy evidence risks repeat decoding.

## Verification and rollout

`python3 tests/zyn/check-prefs.py` validates the actual YAML generator output,
including the final dynamic default and unchanged static declarations.
`node --test tests/zyn/*.test.mjs` and `git diff --check` cover existing logic and
patch hygiene. No browser build or runtime benchmark is part of this change.

Rebuild cost: **prefs only** (normal preference regeneration/import and packaging
are still needed; no native source/static declaration changes). Existing user
prefs override this default. Restart the eventual candidate and inspect the
effective pref and spare-process count in `about:processes`. Compare cold bursts
of new sites and normal GitHub/SSO/YouTube/WhatsApp navigation. If burst latency
regresses, restore 3. No profile migration, install, push or live runtime test was
performed; runtime/release readiness remains unverified. Temporal is not involved.
