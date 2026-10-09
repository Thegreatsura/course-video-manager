# The real `cvm`, on one run's test clone — sourced by verify.sh, never run on
# its own. Expects log, die, REPO_ROOT and the run helpers from verify.sh.
# shellcheck shell=bash
#
#   verify.sh cvm <run> <cvm args…>
#
# `cvm` from a worktree is refused its local-only verbs, and its transport
# (CVM_API_URL) is the deployed API — production. This verb is the one
# sanctioned way to run a worktree's `cvm` for real, and it reaches the run's
# clone and nothing else:
#
#   1. the run's own apps/remote (apps/local/scripts/verify-api.ts), started
#      once per run on 127.0.0.1 against the clone, with a token minted IN the
#      clone — reused by every later call, stopped by cleanup;
#   2. `cvm` with CVM_API_URL at that API, DATABASE_URL at the clone, the
#      clone's scratch directories, and CVM_VERIFY_CLONE naming the clone —
#      which is what opens the local-only gate, and only while the API is
#      loopback and the database is that clone (app/cli/verify-clone.ts).
#
# Every URL is asserted here before anything starts, and again inside `cvm`:
# a non-loopback API or a database other than the run's clone is refused.

# The Ledger names writes made through the run's API by this application_name.
LEDGER_APP_API=cvm-verify-api

# clone_app_env <run dir> <clone url> — CLONE_APP_ENV: the environment every
# process of a test-clone run gets. Its database, its own scratch directories
# (a run's file writes never land on Matt's disk) and the offline services.
CLONE_APP_ENV=()
clone_app_env() {
  local dir="$1" url="$2" scratch="$1/scratch"
  mkdir -p "$scratch/video-files" "$scratch/clip-mockups" "$scratch/diagram-thumbnails" "$scratch/overlay-renders" \
           "$scratch/finished-videos" "$scratch/obs-recordings" "$scratch/dropbox"
  CLONE_APP_ENV=(
    "DATABASE_URL=$url"
    "DIRECT_DATABASE_URL=$url"
    "VIDEO_FILES_DIR=$scratch/video-files"
    "CLIP_MOCKUP_DIR=$scratch/clip-mockups"
    "DIAGRAM_THUMBNAILS_DIR=$scratch/diagram-thumbnails"
    "OVERLAY_RENDER_CACHE_DIRECTORY=$scratch/overlay-renders"
    "FINISHED_VIDEOS_DIRECTORY=$scratch/finished-videos"
    "OBS_RECORDING_DIR=$scratch/obs-recordings"
    "DROPBOX_REMOTE_PATH=$scratch/dropbox"
    "${OFFLINE_SERVICES_ENV[@]}"
    # One ffmpeg and one Dropbox upload at a time (verify-clones.sh).
    "${CLONE_ENCODE_CAPS_ENV[@]}"
  )
}

# --- the assertions -----------------------------------------------------------
# url_is_loopback <url> — plain http to 127.x, localhost or ::1, nothing else.
url_is_loopback() {
  local rest host
  case "$1" in http://*) rest="${1#http://}" ;; *) return 1 ;; esac
  rest="${rest%%/*}"; rest="${rest%%\?*}"
  case "$rest" in *@*) return 1 ;; esac
  case "$rest" in
    \[*\]*) host="${rest#\[}"; host="${host%%\]*}" ;;
    *)      host="${rest%%:*}" ;;
  esac
  case "$host" in
    localhost|::1) return 0 ;;
  esac
  [[ "$host" =~ ^127(\.[0-9]{1,3}){3}$ ]]
}

# assert_loopback_url <what> <url> — die unless the URL is loopback http.
assert_loopback_url() {
  url_is_loopback "$2" ||
    die "refusing: $1 is $2 — not loopback http. verify.sh cvm only ever talks to this run's own API on 127.0.0.1; nothing here may reach production."
}

# assert_clone_db_url <clone> <url> — die unless the URL is on a loopback host
# and names exactly this run's clone.
assert_clone_db_url() {
  local clone="$1" url="$2" host
  case "$clone" in cvm_verify_[0-9]*) ;; *) die "refusing: '$clone' is not a per-run clone" ;; esac
  host="$(url_host "$url")"; host="${host%:*}"
  case "$host" in
    localhost|127.*|\[::1\]) ;;
    *) die "refusing: the run's database host '$host' is not loopback — this is not a verify-cvm clone" ;;
  esac
  [ "$(url_db "$url")" = "$clone" ] ||
    die "refusing: the database URL names '$(url_db "$url")', not this run's clone $clone"
}

# --- the run's API ------------------------------------------------------------
api_state()  { printf '%s/api.json\n' "$1"; }
api_field()  { sed -n "s/.*\"$2\":\"\{0,1\}\([^\",}]*\).*/\1/p" "$(api_state "$1")" 2>/dev/null || true; }
api_pid()    { api_field "$1" pid; }
api_url()    { printf 'http://127.0.0.1:%s\n' "$(api_field "$1" port)"; }

api_alive() {
  local pid; pid="$(api_pid "$1")"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null &&
    curl -sf --max-time 3 -o /dev/null "$(api_url "$1")/health"
}

# ensure_api <run dir> <clone url> — reuse the run's API, or start it.
ensure_api() {
  local dir="$1" url="$2" clone pid _
  clone="$(run_clone_name "$dir")"
  if api_alive "$dir"; then return 0; fi
  rm -f "$(api_state "$dir")"
  clone_app_env "$dir" "$url"
  ( cd "$REPO_ROOT/apps/local" &&
    exec env "${CLONE_APP_ENV[@]}" "CVM_VERIFY_CLONE=$clone" "PGAPPNAME=$LEDGER_APP_API" \
      "TSX_TSCONFIG_PATH=$REPO_ROOT/apps/local/tsconfig.json" \
      nohup node --import tsx scripts/verify-api.ts "$(api_state "$dir")" >> "$dir/api.log" 2>&1 ) &
  pid=$!
  for _ in $(seq 1 60); do
    if [ -s "$(api_state "$dir")" ] && api_alive "$dir"; then
      log "cvm: started this run's API on $(api_url "$dir") (pid $(api_pid "$dir")), on $clone only"
      return 0
    fi
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  tail -20 "$dir/api.log" >&2
  kill -TERM "$pid" 2>/dev/null || true
  die "the run's API did not come up — see $dir/api.log"
}

# stop_api <run dir> — cleanup's step, before the clone is dropped.
stop_api() {
  local dir="$1" pid
  pid="$(api_pid "$dir")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    sleep 1
    kill -KILL "$pid" 2>/dev/null || true
    log "cleanup: stopped the run's API pid $pid"
  fi
  rm -f "$(api_state "$dir")"
}

# --- the run's app, warm ----------------------------------------------------------
# `cvm diagram` renders through the run's app: a browser opens /diagram-render
# and waits for the page to install its render function. On a fresh run Vite
# compiles that page (tldraw and all) on the first visit, which takes longer
# than the render's own 30s timeout. So before the first `diagram` call, the
# run's app is made to answer for real: a throwaway browser session opens the
# render page and polls until the render function exists, bounded by
# APP_READY_TIMEOUT seconds. Done once per run (app-ready marks it); Vite keeps
# what it compiled for every later call.
APP_READY_TIMEOUT="${APP_READY_TIMEOUT:-180}"
APP_READY_REOPEN=20
DIAGRAM_RENDER_PATH=/diagram-render
DIAGRAM_RENDER_GLOBAL=__cvmRenderDiagram

ensure_app_ready() {
  local dir="$1" app="$2" session deadline ok=1
  [ -f "$dir/app-ready" ] && return 0
  assert_loopback_url "the run's app" "$app"
  session="$(run_session)-warmup"
  deadline=$(( SECONDS + APP_READY_TIMEOUT ))
  log "cvm: waiting for this run's app to compile $DIAGRAM_RENDER_PATH (up to ${APP_READY_TIMEOUT}s, once per run)"
  local ab=(env -u AGENT_BROWSER_SESSION -u AGENT_BROWSER_SESSION_NAME -u AGENT_BROWSER_PROFILE -u AGENT_BROWSER_STATE
            agent-browser --session "$session")
  until curl -sf --max-time 5 -o /dev/null "$app/"; do
    [ "$SECONDS" -lt "$deadline" ] || break
    sleep 2
  done
  # The first visit does not recover on its own: Vite optimises tldraw's
  # dependencies mid-load and reloads, and that page never installs the render
  # function. So the page is opened afresh every APP_READY_REOPEN seconds until
  # one does; Vite keeps what it compiled between visits.
  local got opened_at=-1
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ "$opened_at" -lt 0 ] || [ $(( SECONDS - opened_at )) -ge "$APP_READY_REOPEN" ]; then
      opened_at=$SECONDS
      timeout 60 "${ab[@]}" open "$app$DIAGRAM_RENDER_PATH" >> "$dir/app-ready.log" 2>&1 || true
    fi
    got="$(timeout 10 "${ab[@]}" eval "typeof window.$DIAGRAM_RENDER_GLOBAL" 2>>"$dir/app-ready.log" | tr -d '"[:space:]')"
    printf '%s eval: %s\n' "$(date +%T)" "${got:-<no answer>}" >> "$dir/app-ready.log"
    [ "$got" = function ] && { ok=0; break; }
    sleep 2
  done
  "${ab[@]}" close >/dev/null 2>&1 || true
  [ "$ok" = 0 ] ||
    die "this run's app at $app never served a working $DIAGRAM_RENDER_PATH within ${APP_READY_TIMEOUT}s — see $dir/app-ready.log and $dir/server.log"
  date --iso-8601=seconds > "$dir/app-ready"
  log "cvm: this run's app is ready ($app$DIAGRAM_RENDER_PATH)"
}

# --- the verb -------------------------------------------------------------------
cmd_cvm() {
  local dir clone url api app code=0
  dir="$(run_dir)"
  [ "$(run_mode "$dir")" = test-clone ] ||
    die "this run is on PRODUCTION — verify.sh cvm runs on a test clone only. Launch without --production."
  [ "$#" -gt 0 ] || die "usage: verify.sh cvm <run> <cvm args…>   e.g. verify.sh cvm <run> course list"

  clone="$(run_clone_name "$dir")"
  url="$(run_clone_url "$dir")"
  assert_clone_db_url "$clone" "$url"
  ensure_api "$dir" "$url"
  api="$(api_url "$dir")"
  assert_loopback_url "the run's API" "$api"
  app="$(run_base)"
  assert_loopback_url "the run's app" "$app"
  [ "$1" = diagram ] && ensure_app_ready "$dir" "$app"

  clone_app_env "$dir" "$url"
  printf '%s cvm %s\n' "$(date --iso-8601=seconds)" "$*" >> "$dir/cvm.log"
  env "${CLONE_APP_ENV[@]}" \
    "CVM_API_URL=$api" \
    "CVM_API_TOKEN=$(api_field "$dir" token)" \
    "CVM_VERIFY_CLONE=$clone" \
    "CVM_LOCAL_MACHINE=true" \
    "CVM_APP_URL=$app" \
    "CVM_SIDECAR_SOCKET=$(run_sidecar_socket "$dir")" \
    "PGAPPNAME=$LEDGER_APP_API" \
    node "$REPO_ROOT/apps/local/app/cli/bin.mjs" "$@" || code=$?
  return "$code"
}
