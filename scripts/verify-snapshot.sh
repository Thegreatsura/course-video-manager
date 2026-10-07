#!/usr/bin/env bash
#
# ┌──────────────────────────────────────────────────────────────────────────┐
# │  AGENTS: NEVER RUN THIS SCRIPT. NOT TO TEST IT, NOT WITH --help, NEVER.  │
# │                                                                          │
# │  It is the ONE step of the verify-cvm test database that reads           │
# │  PRODUCTION. Matt runs it himself, from his own terminal. If a verify    │
# │  run needs fresher data or the template is missing, say so in your       │
# │  reply and stop — do not run this, and do not work around it.            │
# └──────────────────────────────────────────────────────────────────────────┘
#
# Refreshes the verify-cvm template database (VERIFY_DATABASE_URL, usually
# cvm_verify_template on a local Postgres 17) from production:
#
#   1. pg_dump production (.env's DATABASE_URL) — the public and drizzle schemas,
#      WITHOUT the data of the four credential tables (youtube_auth,
#      ai_hero_auth, dropbox_auth, api_token) — into ~/.cache/cvm/verify-seed.dump.
#   2. pg_restore it into a fresh <template>_next database.
#   3. Sanity-check it: tables present, Courses present, credential tables empty.
#   4. Swap it in for the template, and drop the old one.
#
# Verify runs already launched keep their own clones; runs launched after
# this clone the new template.
#
# Usage (Matt, in his own terminal):   pnpm db:verify-snapshot
#
# Needs pg_dump/pg_restore 17 — either on PATH (apt postgresql-17 /
# postgresql-client-17), or inside the cvm-local-postgres Docker container
# (`pnpm db:clone-local` creates it). Set up once with scripts/setup-verify-db.sh.
set -euo pipefail

# --- the guard: humans only -----------------------------------------------
# Claude Code sets CLAUDECODE in every shell it starts, and an agent's shell has
# no terminal. Either one means the caller is not Matt at his keyboard.
if [ -n "${CLAUDECODE:-}" ] || [ ! -t 0 ] || [ ! -t 1 ]; then
  echo "verify-snapshot: refusing — this reads PRODUCTION and only Matt runs it, from his own terminal." >&2
  echo "verify-snapshot: agents: stop here and tell Matt the verify template needs refreshing." >&2
  exit 2
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
# The main checkout, for when this runs from a worktree with no .env.
MAIN_ROOT="$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"
VERIFY_ENV_FILE="${VERIFY_ENV_FILE:-$HOME/.config/cvm/verify.env}"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/cvm"
DUMP_FILE="$CACHE_DIR/verify-seed.dump"
CONTAINER="${VERIFY_PG_CONTAINER:-cvm-local-postgres}"

PREFIX="course-video-manager_"
CREDENTIAL_TABLES=(youtube_auth ai_hero_auth dropbox_auth api_token)

say()  { printf '%s\n' "$*"; }
die()  { printf 'verify-snapshot: FAIL: %s\n' "$*" >&2; exit 1; }

read_key() { # read_key FILE KEY — one key, without sourcing the file
  [ -f "$1" ] || return 0
  grep -E "^$2=" "$1" | tail -1 |
    sed -e "s/^$2=//" -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

url_host()    { sed -e 's#^[a-z]*://##' -e 's#^.*@##' -e 's#[/?].*##' <<< "$1"; }
url_db()      { sed -E -e 's#^[a-z]*://[^/]*/?##' -e 's#\?.*##' <<< "$1"; }
url_user()    { sed -E -e 's#^[a-z]*://##' -e 's#[:@].*##' <<< "$1"; }
url_with_db() { sed -E "s#^([a-z]*://[^/?]*)/?[^?]*#\\1/$2#" <<< "$1"; }

# url_direct URL PORT — the same URL on PORT, with any `|bouncer` suffix taken
# off the username. pg_dump needs a session, and PlanetScale refuses it on the
# PgBouncer port (6432): "pg_dump is not allowed to use pooled connections,
# please use the direct port 5432". Host and password are the same on both
# ports; only a dedicated bouncer adds `|<bouncer-name>` to the username.
url_direct() {
  local scheme="${1%%://*}" rest="${1#*://}" auth tail userinfo="" hostport user pass=""
  auth="${rest%%[/?]*}"
  tail="${rest:${#auth}}"
  hostport="$auth"
  if [[ $auth == *@* ]]; then userinfo="${auth%@*}"; hostport="${auth##*@}"; fi
  [[ $hostport == *:* ]] && hostport="${hostport%:*}"
  if [ -n "$userinfo" ]; then
    user="${userinfo%%:*}"
    [[ $userinfo == *:* ]] && pass=":${userinfo#*:}"
    user="${user%%|*}"; user="${user%%%7[Cc]*}"
    userinfo="$user$pass@"
  fi
  printf '%s://%s%s:%s%s\n' "$scheme" "$userinfo" "$hostport" "$2" "$tail"
}

# --- the two databases ------------------------------------------------------
PROD_URL=""
for f in "$REPO_ROOT/.env" "$MAIN_ROOT/.env"; do
  PROD_URL="$(read_key "$f" DATABASE_URL)"
  [ -n "$PROD_URL" ] && break
done
[ -n "$PROD_URL" ] || die "no DATABASE_URL in $REPO_ROOT/.env or $MAIN_ROOT/.env"
# The dump goes to the direct port, never the pooled one (see url_direct).
DUMP_URL="$(url_direct "$PROD_URL" "${VERIFY_PROD_DUMP_PORT:-5432}")"

TEMPLATE_URL="${VERIFY_DATABASE_URL:-$(read_key "$VERIFY_ENV_FILE" VERIFY_DATABASE_URL)}"
[ -n "$TEMPLATE_URL" ] || die "VERIFY_DATABASE_URL is not set and $VERIFY_ENV_FILE has none — run scripts/setup-verify-db.sh first"

case "$(url_host "$TEMPLATE_URL")" in
  *psdb.cloud*) die "VERIFY_DATABASE_URL points at PlanetScale — it must be the LOCAL template, never production" ;;
esac
[ "$(url_host "$TEMPLATE_URL")" != "$(url_host "$PROD_URL")" ] ||
  die "VERIFY_DATABASE_URL and production share a host — refusing to restore over production"

TEMPLATE_DB="$(url_db "$TEMPLATE_URL")"
NEXT_DB="${TEMPLATE_DB}_next"
OLD_DB="${TEMPLATE_DB}_old"
ROLE="$(url_user "$TEMPLATE_URL")"
[ -n "$TEMPLATE_DB" ] || die "VERIFY_DATABASE_URL names no database"
ADMIN_URL="$(url_with_db "$TEMPLATE_URL" postgres)"

# client_min_messages=warning quiets "does not exist, skipping" NOTICEs.
admin() { PGOPTIONS="-c client_min_messages=warning" psql -X -v ON_ERROR_STOP=1 -q "$ADMIN_URL" "$@"; }
admin -c 'select 1' > /dev/null ||
  die "cannot reach the verify Postgres at $(url_host "$TEMPLATE_URL") — start it first"

# --- pg tools, version 17 ---------------------------------------------------
# pg_dump refuses a server newer than itself, and production is Postgres 17.
pg_major() { "$1" --version 2>/dev/null | grep -oE '[0-9]+' | head -1; }

TOOLS=""
for bin in /usr/lib/postgresql/17/bin "$(dirname "$(command -v pg_dump 2>/dev/null || echo /nonexistent/x)")"; do
  if [ -x "$bin/pg_dump" ] && [ "$(pg_major "$bin/pg_dump")" -ge 17 ]; then
    TOOLS="local:$bin"; break
  fi
done
if [ -z "$TOOLS" ] && command -v docker > /dev/null &&
   docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  TOOLS="docker:$CONTAINER"
fi
[ -n "$TOOLS" ] ||
  die "no pg_dump 17: install postgresql-client-17, or start the $CONTAINER container (scripts/setup-verify-db.sh)"

EXCLUDES=()
for t in "${CREDENTIAL_TABLES[@]}"; do
  EXCLUDES+=("--exclude-table-data=\"${PREFIX}${t}\"")
done
DUMP_ARGS=(-Fc --no-owner --no-acl -n public -n drizzle "${EXCLUDES[@]}")

# Production's sslmode verifies the server certificate, so libpq needs root
# certificates. On the host, `sslrootcert=system` finds them. Inside the
# postgres:17 container it does not: the image ships no ca-certificates, so
# its system store is empty, and without a root libpq looks for
# /root/.postgresql/root.crt and fails. So copy the HOST's CA bundle into the
# container and point PGSSLROOTCERT at it — verification stays fully on.
CONTAINER_CA="/tmp/cvm-host-ca.crt"
host_ca_bundle() {
  local f
  for f in "${VERIFY_PG_CA_BUNDLE:-}" /etc/ssl/certs/ca-certificates.crt \
           /etc/pki/tls/certs/ca-bundle.crt /etc/ssl/cert.pem; do
    [ -n "$f" ] && [ -s "$f" ] && { printf '%s\n' "$f"; return 0; }
  done
  return 1
}

dump_production() {
  case "$TOOLS" in
    # PlanetScale wants the system root certificate on this box (see verify.sh).
    local:*)  PGSSLROOTCERT=system "${TOOLS#local:}/pg_dump" "${DUMP_ARGS[@]}" -d "$DUMP_URL" ;;
    docker:*)
      local ca
      ca="$(host_ca_bundle)" ||
        die "no CA bundle on this host to hand the $CONTAINER container — install ca-certificates, or set VERIFY_PG_CA_BUNDLE"
      docker cp -L "$ca" "${TOOLS#docker:}:$CONTAINER_CA" > /dev/null ||
        die "could not copy $ca into the $CONTAINER container"
      docker exec -e PGSSLROOTCERT="$CONTAINER_CA" "${TOOLS#docker:}" \
        pg_dump "${DUMP_ARGS[@]}" -d "$DUMP_URL" ;;
  esac
}

# --exit-on-error + --single-transaction: any restore error is real and fatal,
# and leaves the database empty rather than half-restored.
RESTORE_ARGS=(--no-owner --no-acl --exit-on-error --single-transaction)

restore_into() { # restore_into DB < dump
  case "$TOOLS" in
    local:*)  "${TOOLS#local:}/pg_restore" "${RESTORE_ARGS[@]}" -d "$(url_with_db "$TEMPLATE_URL" "$1")" ;;
    # Inside the container the server is on its own unix socket, as $ROLE.
    docker:*) docker exec -i "${TOOLS#docker:}" pg_restore "${RESTORE_ARGS[@]}" -U "$ROLE" -d "$1" ;;
  esac
}

# --- go ---------------------------------------------------------------------
say ""
say "  verify-snapshot: production  →  $(url_host "$TEMPLATE_URL")/$TEMPLATE_DB"
say "  dumping from:    $(url_host "$DUMP_URL") (direct port; override with VERIFY_PROD_DUMP_PORT)"
say "  pg tools:        $TOOLS"
say "  credential tables dumped schema-only: ${CREDENTIAL_TABLES[*]}"
say ""
printf '  This READS production and REPLACES %s. Type "snapshot" to go: ' "$TEMPLATE_DB"
read -r answer
[ "$answer" = snapshot ] || die "not confirmed — nothing done"

mkdir -p "$CACHE_DIR"
chmod 700 "$CACHE_DIR"
say "1/4 dumping production → $DUMP_FILE"
dump_production > "$DUMP_FILE.partial"
mv "$DUMP_FILE.partial" "$DUMP_FILE"
say "    $(du -h "$DUMP_FILE" | cut -f1)"

say "2/4 restoring into $NEXT_DB"
admin -c "drop database if exists \"$NEXT_DB\""
admin -c "create database \"$NEXT_DB\" template template0"
# A fresh database already has an empty public schema, and the dump (taken
# with -n public) creates it again. Drop the empty one so the restore is
# error-free — then any pg_restore error is a real one.
psql -X -q -v ON_ERROR_STOP=1 "$(url_with_db "$TEMPLATE_URL" "$NEXT_DB")" -c 'drop schema public' ||
  die "could not clear the empty public schema in $NEXT_DB"
restore_into "$NEXT_DB" < "$DUMP_FILE" ||
  die "pg_restore failed (errors above) — $NEXT_DB left in place for a look, template untouched"

say "3/4 checking $NEXT_DB"
next() { psql -X -At -v ON_ERROR_STOP=1 "$(url_with_db "$TEMPLATE_URL" "$NEXT_DB")" -c "$1"; }
tables="$(next "select count(*) from pg_tables where schemaname = 'public' and tablename like '${PREFIX}%'")"
courses="$(next "select count(*) from \"${PREFIX}course\"")"
say "    $tables tables, $courses courses"
[ "$tables" -ge 25 ] || die "only $tables tables restored — $NEXT_DB left in place for a look, template untouched"
[ "$courses" -gt 0 ]  || die "no courses restored — $NEXT_DB left in place for a look, template untouched"
for t in "${CREDENTIAL_TABLES[@]}"; do
  n="$(next "select count(*) from \"${PREFIX}${t}\"")"
  [ "$n" = 0 ] || die "${PREFIX}${t} has $n rows — credentials leaked into the copy; template untouched"
done
say "    credential tables empty"

say "4/4 swapping $NEXT_DB in as $TEMPLATE_DB"
admin -c "drop database if exists \"$OLD_DB\""
if [ "$(admin -At -c "select 1 from pg_database where datname = '$TEMPLATE_DB'")" = 1 ]; then
  admin -c "alter database \"$TEMPLATE_DB\" rename to \"$OLD_DB\"" ||
    die "could not move the old template aside — is a session connected to it? $NEXT_DB is ready; rerun"
fi
admin -c "alter database \"$NEXT_DB\" rename to \"$TEMPLATE_DB\""
admin -c "drop database if exists \"$OLD_DB\""

say ""
say "  done — $TEMPLATE_DB refreshed $(date --iso-8601=seconds)."
say "  New verify runs clone it; runs already live keep their own copy."
