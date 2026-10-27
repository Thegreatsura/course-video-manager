#!/usr/bin/env bash
# Sourced by verify.sh, which sets VERB and log(). See ../filming.md.
# --- never while Matt is filming ---------------------------------------------
# Every verb that starts the server or drives the app checks first, every
# time: an agent that read the recorder log once at the start of its task
# cannot know he has started filming since. While he films, the verb pauses
# and re-checks every minute, then carries on by itself once he stops. The
# check is scripts/is-filming.sh, shared with any other tooling that needs it.
IS_FILMING="$(dirname "${BASH_SOURCE[0]}")/../../../../scripts/is-filming.sh"
FILMING_POLL_SECONDS="${VERIFY_FILMING_POLL_SECONDS:-60}"

wait_while_filming() {
  local why paused=0
  while why="$("$IS_FILMING" -v)"; do
    log "PAUSED: Matt is filming, so \`verify.sh $VERB\` waits. Do not work around this."
    log "  $why"
    log "  Re-checking every ${FILMING_POLL_SECONDS}s; it carries on by itself when he stops."
    paused=1
    sleep "$FILMING_POLL_SECONDS"
  done
  [ "$paused" -eq 0 ] || log "RESUMED: Matt has stopped filming. Carrying on with \`verify.sh $VERB\`."
}
