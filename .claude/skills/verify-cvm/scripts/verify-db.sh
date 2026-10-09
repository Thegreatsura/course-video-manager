# Database half of verify.sh — sourced by it, never run on its own. Which
# database a run uses (test clone or production), how to reach it, how clones
# are made, aged and dropped. Expects log, die and REPO_ROOT from verify.sh.
# shellcheck shell=bash

# --- which database --------------------------------------------------------
# Every run is on a per-run clone of the TEMPLATE database unless `launch
# --production` asks otherwise. VERIFY_DATABASE_URL names that template, on a
# local Postgres (see scripts/setup-verify-db.sh). It is never production: a
# psdb.cloud host is refused outright. Read from the environment first, then
# from ~/.config/cvm/verify.env, which holds that one key and nothing else.
VERIFY_ENV_FILE="${VERIFY_ENV_FILE:-$HOME/.config/cvm/verify.env}"

verify_template_url() {
  if [ -n "${VERIFY_DATABASE_URL:-}" ]; then
    printf '%s\n' "$VERIFY_DATABASE_URL"
  elif [ -f "$VERIFY_ENV_FILE" ]; then
    grep -E '^VERIFY_DATABASE_URL=' "$VERIFY_ENV_FILE" | tail -1 |
      sed -e 's/^VERIFY_DATABASE_URL=//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
  fi
  return 0
}

# postgresql://user:pass@host:port/db?query → its parts, and the same URL
# pointed at another database.
url_host()    { sed -e 's#^[a-z]*://##' -e 's#^.*@##' -e 's#[/?].*##' <<< "$1"; }
url_db()      { sed -E -e 's#^[a-z]*://[^/]*/?##' -e 's#\?.*##' <<< "$1"; }
url_with_db() { sed -E "s#^([a-z]*://[^/?]*)/?[^?]*#\1/$2#" <<< "$1"; }
url_redact()  { sed -E 's#^([a-z]*://[^:/@]*):[^@]*@#\1:***@#' <<< "$1"; }

# Refuse a "test" URL that is shaped like production. Called before any
# connection in test-clone mode.
refuse_production_url() {
  case "$(url_host "$1")" in
    *psdb.cloud*) die "VERIFY_DATABASE_URL points at PlanetScale ($(url_host "$1")) — that is production, not a test template. Fix $VERIFY_ENV_FILE." ;;
  esac
  [ -n "$(url_db "$1")" ] || die "VERIFY_DATABASE_URL has no database name — it must name the template, e.g. …/cvm_verify_template"
}

# Clone names are cvm_verify_<run id>; the template is whatever the URL names.
clone_name_for() { printf 'cvm_verify_%s\n' "$(tr -c 'a-zA-Z0-9\n' '_' <<< "$1")"; }

# The run's recorded mode, so a run launched in one mode never drifts into the
# other because the environment changed under it.
run_mode()       { cat "$1/db-mode" 2>/dev/null || echo production; }
run_clone_name() { cat "$1/db-name"; }
run_clone_url()  {
  local t; t="$(verify_template_url)"
  [ -n "$t" ] || die "run $1 is a test-clone run but VERIFY_DATABASE_URL is no longer set"
  url_with_db "$t" "$(run_clone_name "$1")"
}

# Admin statements (CREATE / DROP DATABASE) go through the `postgres`
# maintenance database: Postgres refuses to clone a template anyone, including
# us, is connected to.
psql_admin() {
  local t; t="$(verify_template_url)"
  psql -X -v ON_ERROR_STOP=1 -q "$(url_with_db "$t" postgres)" "$@"
}

db_exists() {
  [ "$(psql_admin -At -c "select 1 from pg_database where datname = '$1'")" = 1 ]
}

drop_clone() {
  local name="$1"
  case "$name" in cvm_verify_[0-9]*) ;; *) die "refusing to drop '$name' — not a per-run clone" ;; esac
  # FORCE ends the dev server's pooled connections, which would otherwise
  # outlive a killed server by a few seconds and block the drop.
  psql_admin -c "drop database if exists \"$name\" with (force)"
}

# --- the template's age -------------------------------------------------------
# verify-snapshot.sh stamps the template with a comment when it swaps a fresh
# copy in: "cvm verify snapshot taken <ISO time>". A template made before it did
# has no stamp, so the age falls back to its newest created_at/updated_at — the
# data's "as of", which is the snapshot time give or take Matt's last edit.
TEMPLATE_STALE_DAYS="${VERIFY_TEMPLATE_STALE_DAYS:-14}"
SNAPSHOT_STAMP_PREFIX='cvm verify snapshot taken '

template_snapshot_stamp() {
  local name; name="$(url_db "$(verify_template_url)")"
  psql_admin -At -c "select shobj_description(oid, 'pg_database') from pg_database where datname = '$name'" |
    sed -n "s/^$SNAPSHOT_STAMP_PREFIX//p"
}

# newest_row_time <url> — newest created_at/updated_at across the CVM's tables.
newest_row_time() {
  local q
  q="$(PGOPTIONS="$PSQL_RO_OPTIONS" psql -X -At "$1" -c "
        select string_agg(format('select max(%I)::timestamptz from %I', column_name, table_name), ' union all ')
          from information_schema.columns
         where table_schema = 'public' and table_name like 'course-video-manager_%'
           and column_name in ('created_at', 'updated_at')")"
  [ -n "$q" ] || return 0
  PGOPTIONS="$PSQL_RO_OPTIONS" psql -X -At "$1" -c \
    "select to_char(max(m) at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') from ($q) s(m)"
}

# template_age <url to read rows from> — "when|days|how we know", or nothing.
# Pass a clone's URL when there is one: reading the template itself holds a
# connection on it, and Postgres will not clone a template anyone is on.
template_age() {
  local when how="snapshot stamp"
  when="$(template_snapshot_stamp)"
  if [ -z "$when" ]; then
    when="$(newest_row_time "$1")"
    how="newest row — the template has no snapshot stamp yet"
  fi
  [ -n "$when" ] || return 0
  printf '%s|%s|%s\n' "$when" "$(( ($(date +%s) - $(date -d "$when" +%s)) / 86400 ))" "$how"
}

# report_template_age <url> — one line on stderr; a stale template warns, never fails.
report_template_age() {
  local age when days how
  age="$(template_age "$1" 2>/dev/null || true)"
  if [ -z "$age" ]; then
    log "warn could not tell how old the template is — carry on, and mention it in your report"
    return 0
  fi
  IFS='|' read -r when days how <<< "$age"
  if [ "$days" -ge "$TEMPLATE_STALE_DAYS" ]; then
    log "warn template is $days days old (as of $when, from the $how) — $TEMPLATE_STALE_DAYS days or more."
    log "     Data newer than that is not in your clone. Carrying on. Tell Matt in your report"
    log "     that it wants a refresh: pnpm db:verify-snapshot — he runs it; you never do."
  else
    log "template: $days day(s) old (as of $when, from the $how)"
  fi
}

# --- production database access ------------------------------------------
# PlanetScale rejects the connection without a root certificate; `system` uses
# the OS trust store, which is the only root available on this box. Set only
# for production connections: libpq turns `system` into sslmode=verify-full,
# which a local Postgres without TLS would refuse.
prod_ssl() { PGSSLROOTCERT=system "$@"; }

# default_transaction_read_only makes every statement on the connection
# incapable of writing, whatever it says. Every psql this script runs uses it,
# in both modes. In production mode `launch` also hands it to the dev server
# (PGOPTIONS, which node-postgres reads), so the app ITSELF cannot write to
# production: a write comes back a 500 (`PreventCommandIfReadOnly`) instead of
# landing. Writes are what the test clone is for.
PSQL_RO_OPTIONS='-c default_transaction_read_only=on'

db_url() {
  # `.env` holds unquoted values with spaces in them, so sourcing it breaks.
  # Read the one key instead.
  local env_file="$REPO_ROOT/.env"
  [ -f "$env_file" ] || die "no .env at $env_file — the launch section says how to get one"
  grep -E '^DATABASE_URL=' "$env_file" | tail -1 |
    sed -e 's/^DATABASE_URL=//' -e 's/^"//' -e 's/"$//'
}

db_host() { url_host "$(db_url)"; }

# The database a run's guard and doctor read: its own clone, or production.
run_db_url() {
  if [ "$(run_mode "$1")" = test-clone ]; then run_clone_url "$1"; else db_url; fi
}
run_db_label() {
  if [ "$(run_mode "$1")" = test-clone ]; then
    printf 'test clone %s\n' "$(run_clone_name "$1")"
  else
    printf 'PRODUCTION (%s)\n' "$(db_host)"
  fi
}

# psql_clone_write <run dir> <application_name> ARGS — a WRITABLE psql on
# this run's own clone and nothing else: a production run is refused. The
# application_name is what the Write Ledger names the writer by.
psql_clone_write() {
  local dir="$1" app="$2"; shift 2
  [ "$(run_mode "$dir")" = test-clone ] ||
    die "refusing a writable psql: this run is on PRODUCTION, not a test clone"
  PGAPPNAME="$app" psql -X -v ON_ERROR_STOP=1 -q "$(run_clone_url "$dir")" "$@"
}

# psql_ro <run dir> ARGS — read-only psql against the run's database.
psql_ro() {
  local dir="$1"; shift
  if [ "$(run_mode "$dir")" = test-clone ]; then
    PGOPTIONS="$PSQL_RO_OPTIONS" psql -X "$(run_clone_url "$dir")" -At -F'|' "$@"
  else
    PGOPTIONS="$PSQL_RO_OPTIONS" prod_ssl psql -X "$(db_url)" -At -F'|' "$@"
  fi
}

# --- read-back --------------------------------------------------------------
# Plain `cvm` reads through the deployed apps/remote, which is PRODUCTION —
# it cannot see a test clone (`verify.sh cvm` can). Read a write back here. Read-only: the
# writes belong to the browser, the read-back only proves they landed.
cmd_sql() {
  local dir; dir="$(run_dir)"
  [ "$(run_mode "$dir")" = test-clone ] ||
    die "this run is on PRODUCTION — 'sql' only reads test clones. Read back with the cvm CLI."
  local query="${1:-}"
  [ -n "$query" ] || query="$(cat)"
  [ -n "$query" ] || die 'usage: verify.sh sql "<query>"   (or the query on stdin)'
  {
    printf -- '-- %s\n%s\n' "$(date --iso-8601=seconds)" "$query"
  } >> "$dir/sql.log"
  PGOPTIONS="$PSQL_RO_OPTIONS" psql -X -v ON_ERROR_STOP=1 "$(run_clone_url "$dir")" -c "$query" |
    tee -a "$dir/sql.log"
}
