#!/bin/bash
# Explicitly invoked maintenance only. Default plan is read-only and never fetches.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd -P)
cd "$root"
action=${1:-plan}
target=${2:-upstream/dev}
case "$target" in upstream/*) ;; *) echo 'Target must be an explicit upstream/<branch>' >&2; exit 2;; esac
case "$action" in plan|update) ;; *) echo 'Usage: scripts/zyn-update.sh [plan|update] [upstream/dev] [--full] [--install]' >&2; exit 2;; esac
allow_full=0; install=0
for arg in "${@:3}"; do
  case "$arg" in --full) allow_full=1;; --install) install=1;; *) echo "Unknown argument: $arg" >&2; exit 2;; esac
done
if test "$action" = plan; then
  git log --oneline "HEAD..$target"
  base=$(git merge-base HEAD "$target")
  python3 scripts/zyn-state.py classify "$base" "$target"
  echo 'Cached refs only. update fetches/rebases zyn; --full permits a full native build.'
  exit 0
fi
test "$(git branch --show-current)" = zyn || { echo 'update must run on branch zyn' >&2; exit 1; }
test -z "$(git status --porcelain)" || { echo 'Save all source changes before updating' >&2; exit 1; }
case "$(git remote get-url upstream)" in
  https://github.com/zen-browser/desktop|https://github.com/zen-browser/desktop.git|git@github.com:zen-browser/desktop.git) ;;
  *) echo 'Unexpected upstream; inspect remotes' >&2; exit 1;;
esac
test -d engine && test ! -L engine || { echo 'Private engine required' >&2; exit 1; }
. "$root/scripts/zyn-lock.sh"
obj=engine/obj-zyn-dev
if test "${ZYN_RELEASE:-0}" = 1; then
  obj=engine/obj-zyn-release
  if test "${ZYN_PGO:-0}" = 1; then obj=engine/obj-zyn-pgo; fi
fi
python3 scripts/zyn-state.py verify-build "$obj"
old=$(git rev-parse HEAD)
before=$(git merge-base HEAD "$target")
git fetch upstream "${target#upstream/}"
new=$(git rev-parse FETCH_HEAD)
kind=$(python3 scripts/zyn-state.py classify "$before" "$new")
case "$kind" in
  no-change) echo 'No upstream changes; no rebase/build/package needed'; exit 0;;
  engine-change|reconcile-import)
    echo "$kind: prepare a separate candidate engine / reconcile old patches before re-import. No rebase or build performed." >&2
    exit 1;;
  full)
    test "$allow_full" = 1 || { echo 'Build inputs changed: rerun with --full in an approved build window' >&2; exit 1; };;
esac
rollback="zyn-before-update-$(date +%Y%m%d-%H%M%S)-$$"
git branch "$rollback" "$old"
printf '%s\n' "$old" "$new" "$kind" "$rollback" > .surfer/zyn-update-plan
git rebase --onto "$new" "$before" zyn
git range-diff "$before..$old" "$new..HEAD"
echo 'Review the rebased patch queue above before importing/building.'
test -t 0 || { echo 'Interactive rebase review required; stopped before import' >&2; exit 1; }
read -r -p 'Type BUILD to approve this candidate: ' answer
test "$answer" = BUILD || exit 1
# A changed lockfile needs an explicit dependency installation and adapter review.
if ! git diff --quiet "$old" HEAD -- package-lock.json; then
  echo 'Dependency lock changed: run/review npm ci separately; no implicit installation' >&2; exit 1
fi
npm run import
python3 scripts/zyn-state.py verify-import
if test "$kind" = ui && test "${ZYN_PGO:-0}" != 1; then
  bash scripts/zyn-build.sh --ui
else
  bash scripts/zyn-build.sh
fi
if test "$install" = 1; then
  bash scripts/zyn-package.sh --install
else
  bash scripts/zyn-package.sh
fi
echo "Update candidate complete. Rollback source reference: $rollback"
