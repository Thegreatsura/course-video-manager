#!/bin/bash

# Fail if the index holds a gitlink (mode 160000). This repo has no
# submodules, so a gitlink is always an accident — usually an agent worktree
# under .claude/worktrees/ swept up by `git add -A` — and it makes every CI
# checkout log "fatal: No url found for submodule path".

gitlinks=$(git ls-files -s | awk '$1 == "160000" { print $4 }')
if [ -n "$gitlinks" ]; then
  echo ""
  echo "ERROR: gitlinks (mode 160000) in the index — this repo has no submodules:"
  echo "$gitlinks" | sed 's/^/  /'
  echo ""
  echo "Remove with: git rm --cached <path>"
  exit 1
fi
