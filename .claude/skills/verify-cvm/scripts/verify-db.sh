# Database half of verify.sh — sourced by it, never run on its own. Which
# database a run uses (test clone or production), how to reach it, and how
# clones are made and dropped. Expects log, die and REPO_ROOT from verify.sh.
# shellcheck shell=bash

# --- which database --------------------------------------------------------
# VERIFY_DATABASE_URL names the TEMPLATE database of a local Postgres the agent
# owns (see scripts/setup-verify-db.sh). It is never production: a psdb.cloud
# host is refused outright. Read from the environment first, then from
# ~/.config/cvm/verify.env, which holds that one key and nothing else.
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

clone_exists() {
  [ "$(psql_admin -At -c "select 1 from pg_database where datname = '$1'")" = 1 ]
}

drop_clone() {
  local name="$1"
  case "$name" in cvm_verify_[0-9]*) ;; *) die "refusing to drop '$name' — not a per-run clone" ;; esac
  # FORCE ends the dev server's pooled connections, which would otherwise
  # outlive a killed server by a few seconds and block the drop.
  psql_admin -c "drop database if exists \"$name\" with (force)"
}

# --- production database access ------------------------------------------
# PlanetScale rejects the connection without a root certificate; `system` uses
# the OS trust store, which is the only root available on this box. Set only
# for production connections: libpq turns `system` into sslmode=verify-full,
# which a local Postgres without TLS would refuse.
prod_ssl() { PGSSLROOTCERT=system "$@"; }

# default_transaction_read_only makes every psql statement THIS script runs
# against production incapable of writing, whatever it says. It is deliberately
# NOT exported: `launch` execs the dev server from here, so an exported copy was
# inherited by the app, and every write it tried came back a 500
# (`PreventCommandIfReadOnly`) — the skill's own "Writing to production"
# protocol could not be carried out. What proves a run changed nothing is the
# Write Ledger, not this variable.
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

# psql_ro <run dir> ARGS — read-only psql against the run's database.
psql_ro() {
  local dir="$1"; shift
  if [ "$(run_mode "$dir")" = test-clone ]; then
    PGOPTIONS="$PSQL_RO_OPTIONS" psql -X "$(run_clone_url "$dir")" -At -F'|' "$@"
  else
    PGOPTIONS="$PSQL_RO_OPTIONS" prod_ssl psql -X "$(db_url)" -At -F'|' "$@"
  fi
}
