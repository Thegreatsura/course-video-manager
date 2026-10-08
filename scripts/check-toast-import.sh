#!/bin/bash

# Every toast goes through apps/local/app/components/ui/toast.tsx, which
# clamps its text, adds "Show more", and gives error toasts a "Copy" action.
# A toast imported straight from "sonner" skips all of that, so only the
# files that wrap sonner (and the wrapper's own test) may import it.

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
    apps/local/app/components/ui/sonner.tsx) continue ;;
    apps/local/app/components/ui/toast.tsx) continue ;;
    apps/local/app/components/ui/toast.test.ts) continue ;;
    *.ts|*.tsx) ;;
    *) continue ;;
  esac

  matches=$(grep -nP "from ['\"]sonner['\"]|vi\.mock\(['\"]sonner['\"]" "$file" || true)
  if [ -n "$matches" ]; then
    if [ "$found_violations" -eq 0 ]; then
      echo ""
      echo "ERROR: sonner imported directly — import toast from \"@/components/ui/toast\" instead:"
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
  echo "@/components/ui/toast bounds every toast (four-line clamp, Show more, Copy on errors)."
  echo "For a caught error, use toastError(error, fallback) from the same module."
  exit 1
fi
