# Zyn configuration validation — 2026-11-07

Scope: configuration and scripts only in `zyn-wt-build`, branch
`feat/zyn-build-branding`. Main `zyn/engine` and installed Surfer were read-only.
No full build/configure, package, signing, app launch, installation, production
profile access, fetch/rebase or push was performed.

## Resolved release options

Actual Surfer 1.14.9 `commands/build.js` generated the mozconfig in a private
fixture with `SURFER_MOZCONFIG_ONLY=1`. `/bin/sh` evaluated it with stub
`ac_add_options` / `mk_add_options`. These are the resulting unique configure
options (later duplicate values win, as documented by Firefox
`python/mozbuild/mozbuild/configure/options.py:508`). `$TOPSRCDIR` below means this
checkout's private engine. Optional API-key-file options appear only when the
corresponding existing files are present; none were read or added.

```text
--with-app-name=zen
--with-app-basename=Zen
--with-l10n-base=$TOPSRCDIR/browser/locales
--with-distribution-id=app.zyn
--enable-application=browser
--with-unsigned-addon-scopes=app,system
MOZ_DATA_REPORTING=
MOZ_TELEMETRY_REPORTING=
--disable-updater
--enable-release
--enable-optimize
--disable-debug
--disable-debug-symbols
--disable-debug-js-modules
--disable-tests
--disable-crashreporter
--disable-geckodriver
--disable-rust-tests
--enable-rust-simd
--enable-lto=cross,thin
--enable-linker=lld
--with-macos-sdk=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk
--with-ccache=$HOME/.mozbuild/sccache/sccache
--disable-dmd
--enable-eme=widevine
--target=aarch64-apple-darwin
--with-branding=browser/branding/zyn
--enable-update-channel=zyn
```

```text
MOZ_MAKE_FLAGS=-j4
MOZ_OBJDIR=@TOPSRCDIR@/obj-zyn-release
MOZ_LTO=cross,thin
CC=$HOME/.mozbuild/clang/bin/clang
CXX=$HOME/.mozbuild/clang/bin/clang++
RUSTC=$HOME/.rustup/toolchains/1.95.0-aarch64-apple-darwin/bin/rustc
CARGO=$HOME/.rustup/toolchains/1.95.0-aarch64-apple-darwin/bin/cargo
CFLAGS= -mcpu=apple-m5
CXXFLAGS= -mcpu=apple-m5
RUSTFLAGS= -C target-cpu=apple-m5
LDFLAGS= -Wl,--threads=1,--thinlto-jobs=1
SCCACHE_DIR=$HOME/Library/Caches/zyn-sccache
SCCACHE_CACHE_SIZE=10G
MOZ_APP_BASENAME=Zen
MOZ_APP_REMOTINGNAME=zyn
MOZ_PKG_FORMAT=TAR
MOZ_REQUIRE_SIGNING=
```

Additional inherited upstream exports include branding directories,
`MOZ_SOURCE_CHANGESET`, `MOZ_INCLUDE_SOURCE_INFO=1`, `ZEN_FIREFOX_VERSION=159.0.1`,
MAR channel `zyn` and the existing Zen update hostname (updater is compiled out).
The pre-existing `MOZ_DATA_REPORTING=` / `MOZ_TELEMETRY_REPORTING=` assignments
are preserved; they are not evidence all telemetry/healthreport code is absent.
`MOZILLA_OFFICIAL`, AUTOCLOBBER, upstream PGO profile paths and the upstream
clang-plugin/bootstrap switches are not added. Explicit `--enable-release`
selects Firefox's non-developer compiler defaults. Rust opt-level remains 2.
The dev lane omits release/LTO/CPU/cache switches and retains tests and symbols.
PGO changes the objdir to `obj-zyn-pgo` and adds `MOZ_PGO=1` only.

The LLD 22 help lists both `--threads` and `--thinlto-jobs`; both are set to one.
[LLVM's ThinLTO documentation](https://clang.llvm.org/docs/ThinLTO.html) documents
the backend jobs switch. The [Mozilla PGO interface](https://firefox-source-docs.mozilla.org/build/buildsystem/pgo.html)
is `MOZ_PGO=1`. Local Firefox `build/moz.configure/lto-pgo.configure:414` disables
LTO during instrumentation; `python/mozbuild/mozbuild/build_commands.py:273-370`
implements the instrument/package/train/use sequence.

## Identity and profile-path proof

All engine references below are to the inspected Firefox 159.0.1 source with the
current Zen patches; they are source proof, not built/runtime acceptance.

- `scripts/zyn-brand.cjs` derives `1.24.1b-zyn` from the unchanged upstream
  release displayVersion. `scripts/zyn-surfer.cjs` selects brand `zyn` before
  import/build. Surfer `dist/commands/build.js:76-82` writes that version to
  both browser version files; `dist/constants/mozconfig.js:43-69` selects the
  branding/channel. Generated fixture version files were verified.
- Surfer `template/branding.optional/configure.sh:5-6` expands display name
  `Zyn` and bundle component `browser`. `toolkit/moz.configure:4015-4031`
  combines distribution ID `app.zyn`, component `browser`, and an empty debug
  suffix: **app.zyn.browser**. `browser/app/moz.build:46` uses display name for
  the mac app name; `browser/app/generate_info_plist.py:32-40` populates plist
  name/version/ID. Localized brand short/full names are all Zyn; Zen icons are
  linked as assets in `configs/branding/zyn`.
- **Do not rename the internal basename.** It remains `Zen` in common mozconfig.
  `toolkit/modules/OSKeyStore.sys.mjs:33` constructs `Zen Encrypted Storage`
  from that basename. Keeping it avoids gratuitously changing the Keychain
  label. A new ad-hoc binary/bundle identity may still trigger access prompts.
- `src/toolkit/moz-configure.patch:15-19` sets `MOZ_APP_PROFILE` default `zen`;
  imported `engine/toolkit/moz.configure:35-40` retains it. It is a project flag,
  so this patch is preserved and verified by the import guard instead of assuming
  an arbitrary environment override can replace it. `build/moz.build:88-89`
  passes it through. `build/application.ini.in:20-32` yields `[App] Name=Zen`,
  `RemotingName=zyn`, `CodeName=Zyn`, `Version=1.24.1b-zyn`, `Profile=zen`.
  `build/appini_header.py:32-75` also embeds the data used by the executable;
  merely editing a packaged application.ini would not rebrand the executable.
- `toolkit/xre/nsXREDirProvider.cpp:1121-1140` obtains macOS user Application
  Support for the root and Caches for the local directory.
  `AppendProfilePath` at `:1561-1579` uses **gAppData->profile first**, and appends
  `zen` for both. With no profile value it would use the app name; macOS ignores
  vendor there. Therefore the product directories remain
  **~/Library/Application Support/zen** and **~/Library/Caches/zen**.
  The existing registered profile is resolved beneath those roots. A profile
  supplied explicitly outside the registered root can use a different local
  cache mapping (`nsToolkitProfileService.cpp:2976`); the installer does not
  select or move such a profile.
- `MOZ_APP_REMOTINGNAME=zyn` is an explicit supported option at
  `toolkit/moz.configure:3385-3403`, separate from profile root selection.
  The channel stays non-release (`zyn`, formerly `unofficial`) even though
  optimization uses `--enable-release`. `modules/libpref/init/all.js:3004`
  consequently retains the same non-release password-storage default. This is
  source reasoning, not proof of effective prefs or migration on the cloned profile.

## Install hash

`nsXREDirProvider.cpp:443-444` uses `XRE_GetBinaryPath`. Its `GetInstallHash`
`:847-899` takes the executable's parent directory and on macOS normalizes case
by round-tripping through an FSRef. For a normal install that directory is
`/Applications/Zyn.app/Contents/MacOS`, **not just the .app path**.
`toolkit/mozapps/update/common/commonupdatedir.cpp:404-419` hashes the UTF-16
path bytes (no trailing NUL) with the bundled CityHash64 and formats uppercase
hex with no mandatory zero padding. A tiny standalone program linked against
that exact `other-licenses/nsis/Contrib/CityHash/cityhash/city.cpp` produced:

```text
/Applications/Zyn.app/Contents/MacOS -> A4646879380C2F85
```

The app's version, bundle ID and file contents are not hash inputs.
`nsToolkitProfileService.cpp:1103-1113` uses that hash for the install's default
profile mapping (`[InstallA4646879380C2F85]` in profiles.ini; corresponding hash
section in installs.ini). Replacing the app at the same canonical path preserves
that key, including replacement of the earlier unofficial build. Case aliases,
translocation, alternate install locations or unusual symlink arrangements need
runtime verification. No live installs.ini was opened or changed. Existing mapping
presence/correctness and the actual selected cloned profile remain owner checks.

## Executed checks and remaining gates

- `/bin/bash -n` for each shell script; Node syntax checks; Python AST parse.
- Actual installed Surfer 1.14.9 generation-only fixtures plus sh option evaluation:
  dev/release/PGO passed; generated version, branding, job/object lanes, PGO opt-in,
  release flags, and absence of AUTOCLOBBER verified. This never calls mach.
- Installed Clang 22.1.8 and pinned Rust 1.95.0 (LLVM 22.1.2): trivial C/C++/Rust
  compile-and-run for apple-m4 and apple-m5; cross-language Rust bitcode + C
  ThinLTO link-and-run with apple-m5 and both one-thread linker flags.
- Update classification checks cover UI, native, build config, lockfile, changed
  patch, deleted overlay and changed engine version. Runtime guards block an
  external engine symlink, unsupported Surfer version, conflicting config,
  config-only build receipts, stale build inputs and external package symlinks.
- Source review confirms no implicit sync/reset-ff/download/clobber or push.
  The original main-checkout updater hunk was uncommitted and absent from this
  branch's base. This branch contains its behavior only in configs/zyn/mozconfig;
  the parent must remove that duplicate local hunk when applying these commits.

Reproduce lightweight checks with installed dependencies, or point at a read-only
installed Surfer using `ZYN_TEST_SURFER=/absolute/node_modules/@zen-browser/surfer`:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 scripts/tests/zyn-check.py
bash scripts/tests/zyn-toolchain.sh
```

**Still unverified:** full Gecko configure/compile and memory/time, actual large
C++/Rust link, sccache cache behavior, PGO training, package self-containment,
signing, visible branding, user profile selection, Keychain/password access,
media/JIT/extensions, install/rollback and upstream rebase/import integration.
Shell/mock/source checks do not prove these. The owner must run the first full
candidate and exact packaged smoke before replacing the daily app. No speedup
or RAM reduction has been benchmarked.

**Local Workspace update pending — not saved:** tools were not exposed and the
required inherited authentication was absent. Session task: prepare Zyn optimized
release configuration/branding/update/package scripts in feat/zyn-build-branding;
validation is limited to the checks above. Next: owner-run full build and runtime
acceptance. No credential fallback or substitute logging service was used.
