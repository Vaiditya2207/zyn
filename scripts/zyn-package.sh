#!/bin/bash
# Package an already-built candidate. Never builds, changes profiles or kills apps.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd -P)
cd "$root"
install=0
case "${1:-}" in
  '') ;;
  --install) install=1 ;;
  *) echo 'Usage: scripts/zyn-package.sh [--install]' >&2; exit 2 ;;
esac
test "$#" -le 1
export ZYN_BUILD=1
test "$(uname -s)" = Darwin
test -d engine && test ! -L engine || { echo 'Private engine required' >&2; exit 1; }
test -z "${AUTOCLOBBER:-}" || { echo 'Unset AUTOCLOBBER' >&2; exit 1; }
. "$root/scripts/zyn-lock.sh"
obj=engine/obj-zyn-dev
if test "${ZYN_RELEASE:-0}" = 1; then
  obj=engine/obj-zyn-release
  if test "${ZYN_PGO:-0}" = 1; then obj=engine/obj-zyn-pgo; fi
fi
python3 scripts/zyn-state.py verify-build "$obj"
stage=$(mktemp -d "$root/.surfer/zyn-package.XXXXXX")
printf 'Candidate and smoke evidence retained in %s\n' "$stage"
touch "$stage/package-start"
(cd engine && MOZCONFIG="$root/engine/mozconfig" ./mach package)
archive=$(python3 - "$obj/dist" "$stage/package-start" <<'PY'
import pathlib,sys
dist,mark=map(pathlib.Path,sys.argv[1:])
archives=[p for p in dist.glob('*.tar') if p.stat().st_mtime_ns >= mark.stat().st_mtime_ns]
if len(archives)!=1: raise SystemExit(f'Expected one freshly packaged TAR, found {len(archives)}')
print(archives[0].resolve())
PY
)
mkdir "$stage/extracted"
tar -xf "$archive" -C "$stage/extracted"
candidate=$(python3 scripts/zyn-state.py verify-app "$stage/extracted")
(cd engine && MOZCONFIG="$root/engine/mozconfig" ./mach macos-sign -c release -e developer -a "$candidate")
codesign --verify --deep --strict --verbose=2 "$candidate"
python3 scripts/zyn-state.py verify-app "$stage/extracted" > /dev/null
smoke=$(mktemp -d "$stage/profile.XXXXXX")
cat <<EOF
Smoke the exact signed candidate using the empty profile: $smoke
Check Zyn in Dock/menu/About, version, about:support profile path, Cmd+T/Cmd+L,
navigation, content rendering, extensions/video as appropriate, then quit normally.
No account login or personal profile is needed. Startup alone is not a pass.
EOF
"$candidate/Contents/MacOS/zen" --new-instance --offline --profile "$smoke" about:blank
echo 'Restarting the same disposable profile: check persistence, then quit again.'
"$candidate/Contents/MacOS/zen" --new-instance --offline --profile "$smoke" about:blank
test -t 0 || { echo 'Interactive smoke approval required; candidate retained' >&2; exit 1; }
read -r -p 'Type PASS only if both smoke runs passed: ' result
test "$result" = PASS || { echo 'Candidate not accepted or installed' >&2; exit 1; }
python3 scripts/zyn-state.py verify-build "$obj"
shasum -a 256 "$archive" > "$stage/archive.sha256"
git rev-parse HEAD > "$stage/source-commit"
printf '%s\n' "$candidate" > "$stage/smoke-passed"
if test "$install" = 0; then
  echo "Accepted staged candidate: $candidate (not installed)"
  exit 0
fi
if pgrep -f '/Applications/Zyn[.]app/Contents/' >/dev/null; then
  echo 'Quit the installed Zyn normally and rerun; no processes were stopped' >&2
  exit 1
fi
test ! -L /Applications/Zyn.app || { echo 'Refusing symlink install target' >&2; exit 1; }
if test -e /Applications/Zyn.app && ! test -f /Applications/Zyn.app/Contents/Info.plist; then
  echo 'Existing install target is not an app bundle; refusing replacement' >&2; exit 1
fi
test -w /Applications || { echo '/Applications is not writable; no sudo used' >&2; exit 1; }
incoming=$(mktemp -d /Applications/.zyn-stage.XXXXXX)
ditto "$candidate" "$incoming/Zyn.app"
codesign --verify --deep --strict "$incoming/Zyn.app"
# Recheck immediately before replacing; never replace a running daily browser.
if pgrep -f '/Applications/Zyn[.]app/Contents/' >/dev/null; then
  echo "Zyn started during staging; preserved $incoming" >&2; exit 1
fi
backup="/Applications/Zyn-backup-$(date +%Y%m%d-%H%M%S)-$$.app"
if test -e /Applications/Zyn.app; then mv /Applications/Zyn.app "$backup"; fi
if ! mv "$incoming/Zyn.app" /Applications/Zyn.app; then
  if test -e "$backup"; then mv "$backup" /Applications/Zyn.app; fi
  echo "Install failed; candidate retained in $incoming" >&2; exit 1
fi
rmdir "$incoming"
echo "Installed /Applications/Zyn.app; previous app (if present): $backup"
echo 'The installer did not copy or delete profiles; smoke ran only with the recorded disposable profile.'
