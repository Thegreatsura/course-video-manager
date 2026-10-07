# Run half of verify.sh — sourced by it, never run on its own. A run is
# addressed by the id `launch` printed and nothing else, and it belongs to the
# worktree that launched it. Expects log, die, REPO_ROOT and STATE_DIR from
# verify.sh.
# shellcheck shell=bash

# --- off Matt's desk --------------------------------------------------------
# The browser side of the CVM connects to the Stream Deck forwarder hub
# (ws://localhost:5172 — Stream Deck presses, teleprompter controls, browser
# link-capture) and to OBS (ws://localhost:4455). A run's editor on that hub
# acts on Matt's real button presses, and its OBS socket drives his real OBS.
# Every run points both at the discard port, where nothing answers: the run
# hears nothing from his desk and his desk hears nothing from the run.
# Read by apps/local/app/lib/live-channels.ts.
LIVE_CHANNELS_OFF=(
  "VITE_STREAM_DECK_HUB_URL=ws://127.0.0.1:9"
  "VITE_OBS_WEBSOCKET_URL=ws://127.0.0.1:9"
)

# Read the addresses back from the module the run's own server serves its
# pages: proof, not hope, that its editor cannot join Matt's hub or his OBS.
desk_isolated() {
  local src; src="$(curl -sf "http://localhost:$1/app/lib/live-channels.ts")" || return 1
  [ "$(grep -o 'ws://127\.0\.0\.1:9"' <<< "$src" | wc -l)" -ge 2 ]
}

# --- finding a run --------------------------------------------------------
# A run is live when the server it recorded is still alive. That is the only
# registry: no shared "current" pointer to clobber, so two runs never collide.
live_runs() {
  local d pid
  for d in "$STATE_DIR"/run-*; do
    [ -f "$d/server.pid" ] || continue
    run_owned "$d" || continue
    pid="$(cat "$d/server.pid")"
    kill -0 "$pid" 2>/dev/null && printf '%s\n' "$d"
  done
  return 0
}

RUN_ID_RE='^[0-9]{8}-[0-9]{6}-[0-9]+$'

# The checkout a run was launched from: the `checkout` file launch writes first,
# or run.txt's line for a run an older verify.sh launched.
run_checkout() {
  if [ -f "$1/checkout" ]; then cat "$1/checkout"
  else sed -n 's/^checkout:[[:space:]]*//p' "$1/run.txt" 2>/dev/null | head -1
  fi
}
run_owned() { [ "$(run_checkout "$1")" = "$REPO_ROOT" ]; }

# The run a verb acts on, from the id `launch` printed — and nothing else.
# Never a guess: a missing id, an id this worktree did not launch, or a path
# outside this worktree's .verify/ is an error, so one agent's command can
# never land on another agent's server, browser or database.
RUN_DIR=""
resolve_run() {
  local handle="${1:-}" id dir
  [ -n "$handle" ] || die "no run id — every verb after launch takes the id launch printed: verify.sh ${VERB:-<verb>} <run-id> …
  There is no default run. Your live runs in this worktree:
$(live_runs | sed 's#^.*/run-#    #' | grep . || echo '    (none)')"
  case "$handle" in
    */*)
      [ -d "$handle" ] || die "run $handle: no such directory"
      [ "$(cd "$handle" && pwd -P)" = "$(cd "$STATE_DIR" 2>/dev/null && pwd -P)/$(basename "$handle")" ] ||
        die "run $handle is not in this worktree's $STATE_DIR — it belongs to another checkout; refusing"
      handle="$(basename "$handle")" ;;
  esac
  id="${handle#run-}"
  [[ "$id" =~ $RUN_ID_RE ]] || die "'$handle' is not a run id (want e.g. 20261007-141025-2353133, as launch printed)"
  dir="$STATE_DIR/run-$id"
  [ -d "$dir" ] || die "no run $id in this worktree ($STATE_DIR) — a run belongs to the worktree that launched it"
  local owner; owner="$(run_checkout "$dir")"
  [ "$owner" = "$REPO_ROOT" ] ||
    die "run $id was launched from ${owner:-an unknown checkout}, not this worktree ($REPO_ROOT) — refusing to touch another agent's run"
  RUN_DIR="$dir"
}

# For the sourced guard verbs: the run the dispatcher resolved.
run_dir() {
  [ -n "$RUN_DIR" ] || die "internal: no run resolved"
  printf '%s\n' "$RUN_DIR"
}

run_port()    { cat "$(run_dir)/server.port"; }
run_session() { cat "$(run_dir)/browser-session"; }
run_base()    { printf 'http://localhost:%s\n' "$(run_port)"; }

# --- the browser ------------------------------------------------------------
# agent-browser, pinned to this run's session and this run's server. Nothing
# from the environment or the arguments can point it at another session.
AB_REFUSED_FLAGS='--session --session-name --profile --state --auto-connect --cdp'
run_ab() {
  local session port a; session="$(run_session)"; port="$(run_port)"
  for a in "$@"; do
    case " $AB_REFUSED_FLAGS " in *" ${a%%=*} "*)
      die "'$a' is not yours to set — 'verify.sh ab' pins this run's own session ($session)" ;; esac
    if [[ "$a" =~ ^(https?://)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:([0-9]+))? ]] &&
       [ "${BASH_REMATCH[4]:-80}" != "$port" ]; then
      die "$a is not this run's server (http://localhost:$port) — refusing to drive another server"
    fi
  done
  [ "${1:-}" = close ] && [ "${2:-}" = --all ] && die "'close --all' would close every agent's browser — use 'cleanup <run>'"
  # A path after open/goto/navigate means a page of this run's server.
  if [ "$#" -ge 2 ] && [[ "$1" =~ ^(open|goto|navigate)$ ]] && [[ "$2" == /* ]]; then
    set -- "$1" "http://localhost:$port$2" "${@:3}"
  fi
  env -u AGENT_BROWSER_SESSION -u AGENT_BROWSER_SESSION_NAME -u AGENT_BROWSER_PROFILE -u AGENT_BROWSER_STATE \
    agent-browser --session "$session" "$@"
}

evidence_name() {
  local name="${1:-}" ext="$2"
  name="${name%"$ext"}"
  [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] ||
    die "evidence name '${1:-}' must be a plain file name (letters, digits, . _ -) — it lands in this run's evidence directory"
  printf '%s/%s%s\n' "$(run_dir)" "$name" "$ext"
}

cmd_shot() {
  local f; f="$(evidence_name "${1:-}" .png)"; shift || true
  run_ab screenshot "$f" "$@" >&2
  echo "$f"
}

cmd_snap() {
  local f; f="$(evidence_name "${1:-}" .snapshot.txt)"; shift || true
  run_ab snapshot "$@" | tee "$f"
  log "snap: saved $f"
}

