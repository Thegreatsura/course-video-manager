# Sourced by verify.sh: the database write guard behind `guard baseline`,
# `guard check` (the Write Ledger) and `guard forensics`. Uses verify.sh's
# run_dir, log, die, verify-db.sh's psql_ro and verify-ledger.sh's exact
# sources: the clone's trigger ledger and the app's statement log.
# shellcheck shell=bash

# --- database-wide counters (production only, a lead) ----------------------
# pg_stat_user_tables counts every insert, update and delete each table has
# taken — but LAGS: backends flush their counts only every so often. So it is
# never the verdict, only a lead on OTHER writers to production. See the top
# of verify-ledger.sh for what the verdict rests on instead.
counters() {
  psql_ro "$1" -c "select relname, n_tup_ins, n_tup_upd, n_tup_del
              from pg_stat_user_tables order by relname"
}

# --- the api_token background -----------------------------------------------
# Every `cvm` call any agent makes authenticates against the deployed
# apps/remote, and a successful authenticate bumps that token's last_used_at.
# So in production the api_token update counter moves during nearly every
# window, and it is not this run. To tell that bump apart from a real change,
# the guard fingerprints every token row MINUS last_used_at, before and after:
# updates to a table whose ids and fingerprints are all unchanged can only have
# moved last_used_at. Anything else — an insert, a delete, a revoke, a rename —
# changes the set or a fingerprint and is reported as a normal write.
API_TOKEN_TABLE='course-video-manager_api_token'

# --- the sidecar background --------------------------------------------------
# The tables only the run's sidecar writes on its own (apps/local/sidecar/):
# its lease, renewed every few seconds, and the Jobs it claims and settles.
SIDECAR_TABLES_RE='^course-video-manager_(job|job_event|sidecar_lease)\|'

# token_rows <run dir> — "id|fingerprint|last_used_at" per token, sorted by id;
# empty when the table does not exist (test clones carry no credential tables).
token_rows() {
  local exists
  exists="$(psql_ro "$1" -c "select to_regclass('public.\"$API_TOKEN_TABLE\"') is not null")"
  [ "$exists" = t ] || return 0
  psql_ro "$1" -c "select id,
                          md5(concat_ws('|', token_hash, name, expires_at, revoked_at, created_at)),
                          coalesce(last_used_at::text, '')
                     from \"$API_TOKEN_TABLE\" order by id"
}

# token_update_is_background <run dir> — true when the token rows before and
# after differ in last_used_at alone. Prints the ids whose last_used_at moved.
token_update_is_background() {
  local dir="$1"
  [ -f "$dir/guard-tokens-baseline.txt" ] && [ -f "$dir/guard-tokens-after.txt" ] || return 1
  [ -s "$dir/guard-tokens-after.txt" ] || return 1
  cmp -s <(cut -d'|' -f1,2 "$dir/guard-tokens-baseline.txt") \
         <(cut -d'|' -f1,2 "$dir/guard-tokens-after.txt") || return 1
  awk -F'|' 'NR == FNR { used[$1] = $3; next } used[$1] != $3 { print $1 }' \
    "$dir/guard-tokens-baseline.txt" "$dir/guard-tokens-after.txt"
}

cmd_guard_baseline() {
  local dir; dir="$(run_dir)"
  date --iso-8601=seconds > "$dir/guard-since.txt"
  sql_log_offset "$dir" > "$dir/guard-sql-offset.txt"
  if [ "$(run_mode "$dir")" = test-clone ]; then
    ledger_installed "$dir" ||
      die "this run's clone has no write ledger (launched by an older verify.sh?) — cleanup and launch again"
    ledger_snapshot "$dir" > "$dir/guard-snapshot.txt"
    local uncovered; uncovered="$(ledger_uncovered "$dir")"
    [ -z "$uncovered" ] || log "warn tables outside the write ledger (their writes will read UNKNOWN): $(printf '%s' "$uncovered" | paste -sd' ')"
    log "guard: baseline recorded (clone snapshot $(cat "$dir/guard-snapshot.txt"))"
    return 0
  fi
  # Tokens before counters: a change landing between the two reads then shows
  # up as a fingerprint difference — a false alarm, never a hidden write.
  token_rows "$dir" > "$dir/guard-tokens-baseline.txt"
  counters "$dir" > "$dir/guard-baseline.txt"
  log "guard: baseline recorded for $(wc -l < "$dir/guard-baseline.txt") tables"
}

# The statements this run's server sent in the window, from its own log.
# Prints to the Ledger; returns the verdict word on stdout:
#   none | writes | override | unknown
statement_section() {
  local dir="$1" ledger="$2" offset window writes overrides n_writes
  offset="$(cat "$dir/guard-sql-offset.txt" 2>/dev/null || echo 0)"
  window="$(sql_window "$dir" "$offset")"
  writes="$(printf '%s\n' "$window" | sql_writes)"
  overrides="$(printf '%s\n' "$window" | sql_overrides)"
  n_writes="$(printf '%s' "$writes" | grep -c . || true)"
  printf '%s\n' "$writes" > "$dir/guard-write-statements.txt"
  {
    echo "## Statements this run's server sent"
    echo
    if ! sql_log_active "$dir"; then
      echo "**UNKNOWN.** server.log holds no \`[cvm-sql]\` line at all, so the server is"
      echo "not logging its statements (CVM_LOG_SQL unset, or a checkout from before the"
      echo "log existed). Its silence proves nothing."
    else
      echo "$(printf '%s' "$window" | grep -c . || true) statement(s) in the window; $n_writes could write."
      if [ -n "$overrides" ]; then
        echo
        echo "**Read-only override attempted:**"
        printf '%s\n' "$overrides" | sed 's/^/    /'
      fi
      if [ "$n_writes" -gt 0 ]; then
        echo
        echo "Write statements (full list in guard-write-statements.txt):"
        printf '%s\n' "$writes" | cut -c1-160 | sort | uniq -c | sort -rn | head -20 | sed 's/^/    /'
      fi
    fi
    echo
  } >> "$ledger"
  if ! sql_log_active "$dir"; then echo unknown
  elif [ -n "$overrides" ]; then echo override
  elif [ "$n_writes" -gt 0 ]; then echo writes
  else echo none; fi
}

cmd_guard_check() {
  local dir; dir="$(run_dir)"
  [ -f "$dir/guard-since.txt" ] || die "no baseline — call 'verify.sh guard baseline' before driving"
  local ledger="$dir/WRITE-LEDGER.md"
  {
    echo "# Write Ledger"
    echo
    echo "Run: $dir"
    echo "Window opened: $(cat "$dir/guard-since.txt")"
    echo "Window closed: $(date --iso-8601=seconds)"
    echo "Database: $(run_db_label "$dir")"
    echo
  } > "$ledger"
  if [ "$(run_mode "$dir")" = test-clone ]; then
    guard_check_clone "$dir" "$ledger"
  else
    guard_check_production "$dir" "$ledger"
  fi
  echo "$ledger"
}

# Test clone: the trigger ledger is the verdict. Exact, committed rows only.
guard_check_clone() {
  local dir="$1" ledger="$2" in_flight uncovered moved verdict
  [ -f "$dir/guard-snapshot.txt" ] || die "no clone baseline — call 'verify.sh guard baseline' again"
  # First: the window closes here. A write still in flight gets a few seconds
  # to commit — the click that just happened, usually — before it reads PENDING.
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    in_flight="$(ledger_in_flight "$dir")"
    [ "$in_flight" = 0 ] && break
    sleep 0.5
  done
  uncovered="$(ledger_uncovered "$dir")"
  moved="$(ledger_writes "$dir" "$(cat "$dir/guard-snapshot.txt")")"
  printf '%s\n' "$moved" > "$dir/guard-writes.txt"
  # The run's sidecar renews its lease every few seconds and writes every Job
  # it runs: real writes, and this run's, but background to the click being
  # verified. They get their own section rather than drown the table.
  local background
  background="$(printf '%s\n' "$moved" | grep -E "$SIDECAR_TABLES_RE" || true)"
  moved="$(printf '%s\n' "$moved" | grep -vE "$SIDECAR_TABLES_RE" | grep . || true)"
  {
    echo "Source: the clone's write-ledger triggers — every committed insert, update,"
    echo "delete and truncate, recorded in the writing transaction itself. Nothing"
    echo "else writes to this clone, so every row below is this run's."
    echo
    if [ -n "$background" ]; then
      echo "Background (this run's sidecar — its lease and its Jobs):"
      echo
      echo "| Table | Inserted | Updated | Deleted | Truncated |"
      echo "| --- | --- | --- | --- | --- |"
      printf '%s\n' "$background" | awk -F'|' '{ printf "| %s | %d | %d | %d | %d |\n", $1, $2, $3, $4, $5 }'
      echo
    fi
    if [ -n "$moved" ]; then
      echo "**Writes landed during this run.**"
      echo
      echo "| Table | Inserted | Updated | Deleted | Truncated |"
      echo "| --- | --- | --- | --- | --- |"
      printf '%s\n' "$moved" | awk -F'|' '{ printf "| %s | %d | %d | %d | %d |\n", $1, $2, $3, $4, $5 }'
      echo
      echo "Writes are allowed — check they are the ones you meant. Run"
      echo "'verify.sh guard forensics <table>' to name the rows."
      echo
    fi
    if [ "$in_flight" != 0 ]; then
      echo "**PENDING:** $in_flight session(s) still held an uncommitted write after 5s, so"
      echo "it may be missing above. Run 'verify.sh guard check' again once the page settles."
      echo
    fi
    if [ -n "$uncovered" ]; then
      echo "**UNKNOWN for tables outside the ledger** (no trigger, so their writes are"
      echo "invisible here): $(printf '%s' "$uncovered" | paste -sd' ')"
      echo
    fi
    if [ -z "$moved" ] && [ "$in_flight" = 0 ] && [ -z "$uncovered" ]; then
      echo "No table took an insert, update, delete or truncate during the window${background:+, beyond the sidecar background above}."
      echo "Nothing was modified."
      echo
    fi
  } >> "$ledger"
  verdict="$(statement_section "$dir" "$ledger")"
  [ "$verdict" = writes ] && [ -z "$moved" ] &&
    echo "The server sent write statements but none committed a row: rolled back, rejected, or matched nothing." >> "$ledger"

  if [ "$in_flight" != 0 ]; then
    log "guard: PENDING — $in_flight uncommitted write(s) in flight; check again — see $ledger"
  elif [ -n "$uncovered" ]; then
    log "guard: UNKNOWN — tables outside the ledger: $(printf '%s' "$uncovered" | paste -sd' ') — see $ledger"
  elif [ -n "$moved" ]; then
    log "guard: writes landed in this run's test clone (allowed) — see $ledger"
  else
    log "guard: clean — no writes"
  fi
  [ -z "$moved" ] || printf '%s\n' "$moved" >&2
}

# Production: this run's own statements are the verdict (the server's
# connections are read-only, so any write it tried was refused). The
# database-wide counters are other writers' leads — and they lag.
guard_check_production() {
  local dir="$1" ledger="$2" verdict offset rejected
  [ -f "$dir/guard-baseline.txt" ] || die "no baseline — call 'verify.sh guard baseline' before driving"
  verdict="$(statement_section "$dir" "$ledger")"
  offset="$(cat "$dir/guard-sql-offset.txt" 2>/dev/null || echo 0)"
  rejected="$(read_only_rejections "$dir" "$offset")"
  case "$verdict" in
    none)     echo "This run's server sent no write statement. Its connections are read-only besides." >> "$ledger"
              log "guard: clean — this run's server sent no write statement" ;;
    writes)   echo "**This run's server attempted writes.** Its connections are read-only, so Postgres refused them ($rejected read-only rejection(s) in server.log). Report what you pressed." >> "$ledger"
              log "guard: WRITE ATTEMPTED ON PRODUCTION (refused by read-only; $rejected rejection(s)) — see $ledger" ;;
    override) echo "**A statement tried to lift the read-only guard. Treat this as a possible production write and tell Matt at once.**" >> "$ledger"
              log "guard: READ-ONLY OVERRIDE ATTEMPTED ON PRODUCTION — see $ledger" ;;
    *)        echo "**UNKNOWN whether this run wrote.** Do not report it clean." >> "$ledger"
              log "guard: UNKNOWN — the server is not logging its statements — see $ledger" ;;
  esac
  echo >> "$ledger"
  database_wide_section "$dir" "$ledger"
}

database_wide_section() {
  local dir="$1" ledger="$2"
  counters "$dir" > "$dir/guard-after.txt"
  # Counters before tokens, for the same reason as in baseline.
  token_rows "$dir" > "$dir/guard-tokens-after.txt"
  {
    echo "## Database-wide counters (other writers — lagging, a lead only)"
    echo
    echo "pg_stat_user_tables is shared by Matt's own CVM, the deployed apps/remote and"
    echo "sibling runs, and each backend flushes its counts only every so often: a write"
    echo "can show up a window late, or not yet. Movement is a lead; no movement is not"
    echo "proof of anything."
    echo
  } >> "$ledger"

  local moved
  moved="$(join -t'|' -j1 "$dir/guard-baseline.txt" "$dir/guard-after.txt" |
    awk -F'|' '{ ins=$5-$2; upd=$6-$3; del=$7-$4;
                 if (ins||upd||del) printf "%s|%d|%d|%d\n", $1, ins, upd, del }')"
  # Split the api_token last-used bump out of the writes, when that is all it is.
  local background="" token_line bumped
  token_line="$(printf '%s\n' "$moved" | grep "^$API_TOKEN_TABLE|" || true)"
  if [ -n "$token_line" ] &&
     [ "$(printf '%s' "$token_line" | cut -d'|' -f2,4)" = "0|0" ] &&
     bumped="$(token_update_is_background "$dir")"; then
    background="$API_TOKEN_TABLE: $(printf '%s' "$token_line" | cut -d'|' -f3) update(s), last_used_at only (tokens: $(printf '%s' "$bumped" | paste -sd, | sed 's/,/, /g' | grep . || echo 'none moved by the time of check'))"
    moved="$(printf '%s\n' "$moved" | grep -v "^$API_TOKEN_TABLE|" || true)"
  fi

  if [ -n "$background" ]; then
    {
      echo "Background (apps/remote token usage — expected): $background."
      echo "Every authenticated \`cvm\` call bumps its token's last_used_at; every other"
      echo "token column was fingerprinted and is unchanged. Not this run, and not a"
      echo "write to report."
      echo
    } >> "$ledger"
    log "guard: background (apps/remote token usage — expected): $background"
  fi

  if [ -z "$moved" ]; then
    echo "No counter moved (yet) beyond any background above." >> "$ledger"
  else
    {
      echo "**Counters moved during the window.**"
      echo
      echo "| Table | Inserted | Updated | Deleted |"
      echo "| --- | --- | --- | --- |"
      printf '%s\n' "$moved" | awk -F'|' '{ printf "| %s | %d | %d | %d |\n", $1, $2, $3, $4 }'
      echo
      echo "Run 'verify.sh guard forensics <table>' on each one to name the rows."
    } >> "$ledger"
    log "guard: database-wide counters moved (other writers, a lead) — see $ledger"
    printf '%s\n' "$moved" >&2
  fi
}


cmd_guard_forensics() {
  local table="$1"
  local dir; dir="$(run_dir)"
  local since="${2:-$(cat "$dir/guard-since.txt")}"

  # api_token has no updated_at; its last_used_at is what moves. Its hash
  # column stays out of the output — a fingerprint stands in for it.
  local select='*'
  [ "$table" = "$API_TOKEN_TABLE" ] &&
    select="id, name, expires_at, revoked_at, last_used_at, created_at, left(md5(token_hash), 8) as token_hash_md5"

  local cols
  cols="$(psql_ro "$dir" -c "select column_name from information_schema.columns
                      where table_schema='public' and table_name='$table'
                        and column_name in ('created_at','updated_at','last_used_at')")"
  [ -n "$cols" ] || die "$table has no created_at, updated_at or last_used_at — inspect it by hand"

  local where="" c
  for c in $cols; do
    [ -n "$where" ] && where="$where or "
    where="$where\"$c\" > '$since'"
  done

  psql_ro "$dir" -c "select $select from \"$table\" where $where" |
    tee "$dir/forensics-$table.txt"
  log "guard: rows of $table touched since $since written to $dir/forensics-$table.txt"
}

