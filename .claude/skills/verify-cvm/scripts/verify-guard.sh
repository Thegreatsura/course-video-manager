# Sourced by verify.sh: the database write guard behind `guard baseline`,
# `guard check` (the Write Ledger) and `guard forensics`. Uses verify.sh's
# run_dir, log, die and verify-db.sh's psql_ro.
# shellcheck shell=bash

# --- database write guard -------------------------------------------------
# pg_stat_user_tables counts every insert, update and delete each table has
# taken. Reading it costs one catalog scan, never a table scan, so the guard
# is cheap enough to run around every drive.
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
  # Tokens before counters: a change landing between the two reads then shows
  # up as a fingerprint difference — a false alarm, never a hidden write.
  token_rows "$dir" > "$dir/guard-tokens-baseline.txt"
  counters "$dir" > "$dir/guard-baseline.txt"
  log "guard: baseline recorded for $(wc -l < "$dir/guard-baseline.txt") tables"
}

cmd_guard_check() {
  local dir; dir="$(run_dir)"
  [ -f "$dir/guard-baseline.txt" ] || die "no baseline — call 'verify.sh guard baseline' before driving"
  counters "$dir" > "$dir/guard-after.txt"
  # Counters before tokens, for the same reason as in baseline.
  token_rows "$dir" > "$dir/guard-tokens-after.txt"

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
    if [ -n "$background" ]; then
      echo "No other table took an insert, update or delete during the window. Nothing else was modified." >> "$ledger"
      log "guard: clean — no writes beyond the background above"
    else
      echo "No table took an insert, update or delete during the window. Nothing was modified." >> "$ledger"
      log "guard: clean — no writes"
    fi
  else
    {
      echo "**Writes landed during this run.**"
      echo
      echo "| Table | Inserted | Updated | Deleted |"
      echo "| --- | --- | --- | --- |"
      printf '%s\n' "$moved" | awk -F'|' '{ printf "| %s | %d | %d | %d |\n", $1, $2, $3, $4 }'
      echo
      if [ "$(run_mode "$dir")" = test-clone ]; then
        echo "This run's database is its own test clone: nothing else writes to it, so"
        echo "every row here is this run's. Writes are allowed — check they are the ones"
        echo "you meant."
      else
        echo "These counters are database-wide. Matt's own CVM, the deployed apps/remote"
        echo "and any other live verification run write to the same tables, so a row here"
        echo "is a lead, not a verdict."
      fi
      echo "Run 'verify.sh guard forensics <table>' on each one to name the rows."
    } >> "$ledger"
    if [ "$(run_mode "$dir")" = test-clone ]; then
      log "guard: writes landed in this run's test clone (allowed) — see $ledger"
    else
      log "guard: WRITES DETECTED ON PRODUCTION — see $ledger"
    fi
    printf '%s\n' "$moved" >&2
  fi
  echo "$ledger"
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

