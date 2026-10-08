#!/bin/bash

# Every duration on screen reads the same way — `m:ss`, and `h:mm:ss` from an
# hour — because it goes through `formatDuration` (apps/local/app/lib/
# format-duration.ts). A hand-rolled `m:ss` formatter is how a Video read
# "61:18" in the editor and "1:01:18" on the teleprompter. Fail on its
# signature: a file that takes seconds modulo 60 and zero-pads to two digits.
# See CODING_STANDARDS.md, "One duration formatter".

# Default: staged files (pre-commit). `--all`: every tracked file (CI).
file_list() {
  if [ "${1:-}" = "--all" ]; then
    git ls-files
  else
    git diff --cached --name-only --diff-filter=d
  fi
}

found_violations=0

while IFS= read -r file; do
  case "$file" in
    apps/*.ts|apps/*.tsx|packages/*.ts|packages/*.tsx) ;;
    *) continue ;;
  esac
  case "$file" in
    apps/local/app/lib/format-duration.ts|*.test.ts|*.test.tsx) continue ;;
  esac

  if grep -qE '%[[:space:]]*60\b' "$file" && grep -qE 'padStart\([[:space:]]*2' "$file"; then
    if [ "$found_violations" -eq 0 ]; then
      echo ""
      echo "ERROR: a duration formatted by hand:"
      echo ""
    fi
    grep -nE '%[[:space:]]*60\b' "$file" | while IFS= read -r match; do
      echo "  $file:$match"
    done
    found_violations=1
  fi
done < <(file_list "${1:-}")

if [ "$found_violations" -eq 1 ]; then
  echo ""
  echo "Format the duration with formatDuration from @/lib/format-duration. It"
  echo "reads m:ss under an hour and h:mm:ss from one, the same everywhere."
  exit 1
fi
