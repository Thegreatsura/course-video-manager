#!/bin/bash
# The `migration-applied` label is Matt's attestation that production has run
# every migration on main (docs/agents/merging.md). An agent adding it would
# defeat the migration guard in CI, and agents act through Matt's own GitHub
# credentials, so GitHub cannot tell the difference — this hook is what can.
#
# Blocks a `gh` invocation that both names the label and adds a label
# (`--add-label`, or a write to a `/labels` endpoint). Reading labels, and
# merely mentioning the label in a commit message or doc, are untouched.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Split on shell separators; judge each segment that starts with `gh`.
while IFS= read -r segment; do
  segment="${segment#"${segment%%[![:space:]]*}"}"
  case "$segment" in
    gh\ *) ;;
    *) continue ;;
  esac
  echo "$segment" | grep -q 'migration-applied' || continue
  if echo "$segment" | grep -qE -- '--add-label|/labels'; then
    echo 'Agents never add the `migration-applied` label. Only Matt adds it, after running `pnpm db:migrate` against production. Stop and hand the PR to Matt (docs/agents/merging.md).' >&2
    exit 2
  fi
done < <(echo "$COMMAND" | sed -E 's/(&&|\|\||;|\|)/\n/g')

exit 0
