# Source after resolving $root. Shared lock across update, build and packaging.
# An updater holds the lock while invoking its own nested build/package stages.
mkdir -p "$root/.surfer"
lock="$root/.surfer/zyn-operation.lock"
if test -n "${ZYN_LOCK_OWNER:-}" && test -f "$lock/owner" &&
   test "$ZYN_LOCK_OWNER" = "$(cat "$lock/owner")"; then
  : # Nested stage of this updater.
else
  mkdir "$lock" || { echo 'Another Zyn operation holds the lock; inspect before retrying' >&2; exit 1; }
  export ZYN_LOCK_OWNER=$$
  printf '%s\n' "$ZYN_LOCK_OWNER" > "$lock/owner"
  trap 'rm "$lock/owner"; rmdir "$lock"' EXIT
fi
