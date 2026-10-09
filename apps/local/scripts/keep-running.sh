#!/bin/bash
# keep-running.sh <command…> — `start:sidecar`'s supervisor.
#
# The sidecar restarts its own runs (sidecar/supervise.ts) and exits 0 when
# it means to stop: a signal, another sidecar's lease, a checkout that must
# not run one. Anything else — a crash, an uncaught exception, an OOM kill —
# ends the process non-zero, and nothing else would start it again: Jobs
# would wait in the queue, silently. This runs it again after 1 s, 2 s, 4 s …
# up to a minute (back to 1 s after a run that stayed up five minutes).
#
# A SIGINT/SIGTERM to this script (Ctrl-C, pnpm stopping) is passed to the
# command, and nothing is restarted after it.

set -u
delay="${KEEP_RUNNING_FIRST_DELAY:-1}"
first_delay="$delay"
child=""
stopping=""
trap 'stopping=1; [ -n "$child" ] && kill -TERM "$child" 2>/dev/null' INT TERM

while true; do
  started=$(date +%s)
  "$@" &
  child=$!
  # `wait` returns early when a trapped signal arrives; wait again until the
  # command itself has finished.
  wait "$child"
  code=$?
  while kill -0 "$child" 2>/dev/null; do
    wait "$child"
    code=$?
  done
  child=""
  if [ -n "$stopping" ] || [ "$code" -eq 0 ]; then exit 0; fi
  if [ $(($(date +%s) - started)) -ge 300 ]; then delay="$first_delay"; fi
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [sidecar] CRASHED (exit $code) — starting it again in ${delay} s. Jobs wait in the queue until then."
  sleep "$delay" &
  wait $!
  if [ -n "$stopping" ]; then exit 0; fi
  delay=$((delay * 2 > 60 ? 60 : delay * 2))
done
