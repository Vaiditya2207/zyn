# Zyn on this Mac

Personal Apple Silicon build, retaining Zen icons and the existing `zen` profile root.
Target: M5 Pro / 24 GB, macOS 26.5, CommandLineTools SDK 26.5, Mozilla Clang
22.1.8 and Rust 1.95.0 (LLVM 22). No full build, package, signing, browser smoke,
installation or profile access was performed while preparing this change.

## Build

Run in a checkout with **its own engine** and installed lockfile dependencies.
Do not symlink another checkout's engine. The preparation worktree initially has
neither engine nor node_modules. The owner can apply these commits to `zyn` and
use its existing source tree, or explicitly provision an independent candidate
with `npm ci`, `npm run download` (only if engine is absent), then `npm run import`.
Do not download over the working engine. No helper installs dependencies or
bootstraps toolchains automatically on your behalf.

Keep these installed: `$HOME/.mozbuild/clang/bin/{clang,clang++,ld64.lld}`, the
`1.95.0-aarch64-apple-darwin` Rust toolchain, `$HOME/.mozbuild/sccache/sccache`, and
`/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk`. Keep your existing
working CLT environment. Do not set `ZEN_RELEASE`, `AUTOCLOBBER`,
`SCCACHE_GHA_ENABLED`, cross-compilation overrides, or a root custom mozconfig.

```bash
# Add this single switch to your existing environment script for daily releases:
export ZYN_RELEASE=1
unset ZYN_PGO
npm run import
npm run build                       # always four jobs; first release is full
npm run package                     # package, ad-hoc sign, two interactive smoke runs
npm run package -- --install         # same gates, then replace /Applications/Zyn.app

# Development: separate obj-zyn-dev, with tests/symbols retained.
unset ZYN_RELEASE ZYN_PGO
npm run import
npm run build
npm run build:ui                     # only after a successful native build/import
```

Lanes: `engine/obj-zyn-dev`, `obj-zyn-release`, `obj-zyn-pgo`. Existing
`obj-aarch64-apple-darwin` is preserved. Changing broad compiler settings requires
a full native rebuild; a new lane intentionally cannot reuse the old object files.
If mach requests a clobber, stop and inspect it; no helper enables AUTOCLOBBER or
runs clobber. Inventory free disk space before creating another native lane.
The UI command refuses native/config/deleted-overlay changes and compares against
the last successful build's file hashes, including previously uncommitted files.
Keep the same release switches when packaging as when building.

The small Surfer adapter is pinned to **1.14.9**; it changes the configuration in
memory, leaving `surfer.json` and node_modules untouched. It selects brand `zyn`
and refuses differing Firefox candidate/release pins pending review. It builds
version `<brands.release.release.displayVersion>-zyn` (currently
`1.24.1b-zyn`). Import creates Zyn strings using the existing Zen icon assets.
Always use the npm wrappers, not raw `surfer build`/`surfer package`. The latter
also attempts MAR/multi-locale operations that this updater-disabled fork does
not need. `ZEN_PERSONAL_BUILD=1` alone still disables the updater through the Zyn
config. Remove any old local duplicate updater hunk when applying these commits.

## Optional PGO

```bash
export ZYN_RELEASE=1 ZYN_PGO=1
npm run import
npm run build
npm run package
```

This adds `ac_add_options MOZ_PGO=1`. Mach builds `obj-zyn-pgo/instrumented`,
packages it, runs its own disposable-profile training corpus with the matching
LLVM profdata tool, and builds the profile-use result. LTO is disabled by Firefox
in the instrumentation phase and enabled for the final phase. No personal profile
or historical browsing data is training input. Do not combine PGO with `build:ui`.
Keep `ZYN_PGO=1` when packaging the result. A failed training stage is a failed
build, not permission to use unrelated cached profiles.

Planning estimates, **not benchmarks**: allow **6–12 hours** for a cold non-PGO
ThinLTO build, and **12–24+ hours** for PGO plus training, based only on the reported
previous ~10-hour native build. Warm UI changes were reported at ~1 minute;
import/package/smoke are additional. Reserve roughly **12–20 GB** free for a
native build; the link or PGO can reach **20–24+ GB**. These are conservative
planning ranges, not measured peaks or guarantees. Four compile jobs and one LLD
ThinLTO worker reduce parallelism but cannot bound the linker's total memory.
Use a quiet, powered build window; do not assume a sub-three-hour result or raise
jobs on a memory-tight laptop. Check memory pressure and sccache stats after the
first owner-run build before retuning. Cache directory: `~/Library/Caches/zyn-sccache`,
10 GB limit, completely separate from the browser cache; an already-running
sccache server may have been started with other cache settings, so inspect its
stats rather than stopping somebody else's server.

## Update and rollback

```bash
# On branch zyn, with a successful build receipt and a clean source tree:
bash scripts/zyn-update.sh plan upstream/dev       # cached refs only
bash scripts/zyn-update.sh update upstream/dev     # fetch, back up ref, rebase, review
# Add --full to permit full-build inputs; --install to install after smoke.
bash scripts/zyn-update.sh update upstream/dev --full --install
```

The updater keeps a `zyn-before-update-*` source reference. It requires interactive
range-diff review, re-imports and verifies source overlays/branding, classifies
UI/native/full work, builds, then packages/signs/smokes. Engine pin changes or
changed/deleted patches stop **before** rebase: prepare a separate candidate
engine or explicitly reconcile the old patches; never repeatedly import a changed
patch over the old one. Removed overlays stop too. Dependency-lock changes stop
for a separate reviewed `npm ci` and adapter review. No sync, reset-ff,
force-download, automatic clobber, push or default-profile modification is used.
The shared `.surfer/zyn-operation.lock` prevents concurrent helper operations;
a crash leaves it for inspection, never auto-removal. Raw mach/Surfer commands
and other editors are outside that cooperative lock.

Packaging uses direct `mach package` with TAR output, not a symlinked dist app.
It verifies profile/identity/version/build-ID/source-stamp, signs the extracted
bundle with `mach macos-sign -c release -e developer`, verifies the signature,
and launches it twice using `--new-instance --offline --profile <throwaway>`.
The signing channel selects the entitlement template; it does not change Zyn's
update channel. Type `PASS` only after checking both runs, including visible
branding, the throwaway path in about:support, tab/address-bar behavior and
restart persistence. Offline smoke does not validate network/media/real-account
flows. Test those separately without copying your daily profile into the smoke.
Ad-hoc developer signing is not notarization or production entitlement parity;
passkeys/restricted entitlements and Keychain prompts need owner validation.
Smoke may touch Firefox's global profile bookkeeping; it never selects the daily
profile, and no profile contents are read by the scripts.

Installation refuses a running `/Applications/Zyn.app`, preserves the previous
bundle as `/Applications/Zyn-backup-*.app`, stages on the same filesystem, and
moves the new app to the same path. It never uses sudo or kills the browser.
Before first daily-profile use, keep a cold backup of the complete profile, local
cache and registry files. Replacing the app at the same path preserves the install
hash, but does not undo database migrations. To roll back, close Zyn, retain the
candidate, restore the selected previous app **at `/Applications/Zyn.app`**, and
restore the matching pre-upgrade profile/cache snapshot if schemas changed.
Never force a downgrade or selectively replace databases. Source rollback uses
the saved source reference in a separate worktree; do not reset away unsaved work.

[Exact options, identity/profile proof and verification](ZYN-validation.md).
