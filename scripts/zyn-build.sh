#!/bin/bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd -P)
cd "$root"
case "${1:-}" in ''|--ui) ;; *) echo 'Usage: scripts/zyn-build.sh [--ui]' >&2; exit 2;; esac
test "$#" -le 1
test -z "${SURFER_MOZCONFIG_ONLY:-}" || { echo 'Config-only mode cannot produce a build receipt' >&2; exit 1; }
. "$root/scripts/zyn-lock.sh"
before=$(python3 scripts/zyn-state.py fingerprint)
python3 scripts/zyn-state.py verify-import
if test "${1:-}" = --ui; then python3 scripts/zyn-state.py verify-ui; fi
node scripts/zyn-surfer.cjs build "$@" --jobs 4
after=$(python3 scripts/zyn-state.py fingerprint)
test "$before" = "$after" || { echo 'Source/environment changed during build; refusing receipt' >&2; exit 1; }
obj=engine/obj-zyn-dev
if test "${ZYN_RELEASE:-0}" = 1; then
  obj=engine/obj-zyn-release
  if test "${ZYN_PGO:-0}" = 1; then obj=engine/obj-zyn-pgo; fi
fi
python3 scripts/zyn-state.py record-build "$obj"
