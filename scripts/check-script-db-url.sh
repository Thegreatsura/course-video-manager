#!/bin/bash

# One-off DB scripts resolve their connection string through
# apps/local/scripts/script-database-url.ts (`scriptDatabaseUrl()`), which
# loads the repo-root .env the same way drizzle.config.ts does, lets the shell
# win, and prints the target host. A script that reads DATABASE_URL itself
# skips all three — so it can silently hit a different database than the
# operator thinks.
#
# Flags, in TS/JS under apps/local/scripts/ and packages/*/scripts/ (except
# the helper itself):
#   - process.env.DATABASE_URL / DIRECT_DATABASE_URL (dot or bracket access)
#   - process.loadEnvFile (hand-rolled .env loading)
#   - imports of @cvm/core/db/database-url (resolve via the helper instead)
#
# Shell scripts (clone-db-to-local.sh) can't call the helper and are exempt.

# Default: staged files (pre-commit). `--all`: every tracked file (CI).
file_list() {
  if [ "${1:-}" = "--all" ]; then
    git ls-files
  else
    git diff --cached --name-only --diff-filter=d
  fi
}

HELPER="apps/local/scripts/script-database-url.ts"
PATTERN='process\.env(\.|\[\s*["'"'"'`])(DIRECT_)?DATABASE_URL\b|\bloadEnvFile\b|@cvm/core/db/database-url'

found_violations=0

while IFS= read -r file; do
  case "$file" in
    "$HELPER") continue ;;
    apps/local/scripts/*|packages/*/scripts/*) ;;
    *) continue ;;
  esac
  case "$file" in
    *.ts|*.tsx|*.js|*.mjs|*.cjs) ;;
    *) continue ;;
  esac

  matches=$(grep -nP "$PATTERN" "$file" | grep -vP '^\d+:\s*(//|\*|/\*)' || true)
  if [ -n "$matches" ]; then
    if [ "$found_violations" -eq 0 ]; then
      echo ""
      echo "ERROR: DB script resolves its database URL by hand:"
      echo ""
    fi
    echo "$matches" | while IFS= read -r match; do
      echo "  $file:$match"
    done
    found_violations=1
  fi
done < <(file_list "${1:-}")

if [ "$found_violations" -eq 1 ]; then
  echo ""
  echo "Use scriptDatabaseUrl() from $HELPER instead:"
  echo "  const { url, host } = scriptDatabaseUrl();   // { direct: true } for schema work"
  exit 1
fi
