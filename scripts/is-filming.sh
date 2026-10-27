#!/usr/bin/env bash
# Is Matt filming right now? Exit 0 = filming, 1 = not filming.
#
#   scripts/is-filming.sh          # silent; the exit code is the answer
#   scripts/is-filming.sh -v       # also prints why, on stdout
#
# Filming means the recorder service is up: its log has a "listening" line
# after its last "stopped cleanly" line (or a "listening" line and no
# "stopped cleanly" at all). No log means not filming.
#
# The log is in Matt's main checkout, `.data/logs/recorder-service.log`, and
# never in a worktree, so the checkout is found through Git's common dir, from
# this script's own location: every worktree gets the same answer. Set
# CVM_RECORDER_LOG to read another file (tests).
#
# It only reads the log. It never contacts the recorder or Matt's app.
set -euo pipefail

verbose=0
[ "${1:-}" = "-v" ] && verbose=1
say() { [ "$verbose" -eq 0 ] || printf '%s\n' "$*"; }

log_path() {
  if [ -n "${CVM_RECORDER_LOG:-}" ]; then
    printf '%s\n' "$CVM_RECORDER_LOG"
    return
  fi
  local common
  common="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse \
    --path-format=absolute --git-common-dir)"
  printf '%s/.data/logs/recorder-service.log\n' "$(dirname "$common")"
}

LOG="$(log_path)"
if [ ! -f "$LOG" ]; then
  say "not filming: no recorder log at $LOG"
  exit 1
fi

last_line_number() { { grep -n -- "$1" "$LOG" || true; } | tail -n 1 | cut -d: -f1; }
listening="$(last_line_number "listening")"
stopped="$(last_line_number "stopped cleanly")"

if [ -n "$listening" ] && [ "$listening" -gt "${stopped:-0}" ]; then
  say "filming: $(sed -n "${listening}p" "$LOG")"
  exit 0
fi
say "not filming: ${stopped:+$(sed -n "${stopped}p" "$LOG")}"
exit 1
