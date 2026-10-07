#!/bin/bash

# A CVM link on the clipboard is built by `entityDeepLink`
# (apps/local/app/features/entity-links/), which names the entity's whole
# hierarchy and which `cvm` reads back. Fail on the two ways around it:
#   - a clipboard write of a raw id (`….id`, `…Id`) or a hand-built app path
#     (`/videos/…`, `/courses/…`, `/pitches/…`, `/diagram-playground/…`);
#   - `location.origin`, which only a hand-built absolute app URL needs.
# See CODING_STANDARDS.md, "Every entity menu can copy its link".

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
    apps/*.ts|apps/*.tsx) ;;
    *) continue ;;
  esac
  case "$file" in
    */features/entity-links/*|*.test.ts|*.test.tsx) continue ;;
  esac

  matches=$(perl -0777 -ne '
    while (/clipboard\.writeText\(\s*([^;]*?)\)\s*(?:[;,.\n])/g) {
      my $arg = $1;
      my $line = 1 + (() = substr($_, 0, $-[0]) =~ /\n/g);
      if ($arg =~ /(?:\.id|[a-z]Id)\s*$/ || $arg =~ m#^[`"\x27](?:\$\{[^}]*\})?/(?:videos|courses|pitches|diagram-playground)/#) {
        (my $flat = $arg) =~ s/\s+/ /g;
        print "$line: clipboard.writeText($flat)\n";
      }
    }
    while (/location\.origin/g) {
      my $line = 1 + (() = substr($_, 0, $-[0]) =~ /\n/g);
      print "$line: location.origin\n";
    }
  ' "$file")
  if [ -n "$matches" ]; then
    if [ "$found_violations" -eq 0 ]; then
      echo ""
      echo "ERROR: a CVM link or raw id put on the clipboard by hand:"
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
  echo "Render the entity's menu with EntityMenuContent, whose Copy Link builds the"
  echo "URL with entityDeepLink (features/entity-links/). It names the whole"
  echo "hierarchy, and cvm takes it wherever it takes an id."
  exit 1
fi
