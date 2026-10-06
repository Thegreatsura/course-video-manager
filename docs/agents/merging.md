# Landing a change

`main` is protected by a ruleset: a PR merges only once the `check` status is green on a branch that is up to date with `main` (strict). Every change lands through this sequence.

1. **Worktree.** `git fetch origin && git worktree add .claude/worktrees/<name> -b <branch> origin/main`, then `pnpm install --frozen-lockfile --prefer-offline` inside it. If you touch UI, symlink the main checkout's `.env` into the worktree and verify with the `verify-cvm` skill.
2. **Commit.** `pnpm run check` is green before you push. Every commit ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
3. **PR.** `gh pr create`; the body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
4. **Merge.** Done when the PR shows `MERGED` and your worktree is gone:
   1. Wait for `check` to pass (`gh pr checks <pr> --watch`).
   2. If `gh pr view <pr> --json mergeStateStatus` says `BEHIND`, run `gh pr update-branch <pr>` and go back to 4.1.
   3. `gh pr merge <pr> --merge`. Leave off `--delete-branch`: `main` is checked out in another worktree, so the local cleanup fails.
   4. `git push origin --delete <branch>`, then `git worktree remove .claude/worktrees/<name>`.

The ruleset is the only gate, and it holds for agents without exception: merge through the loop above, every time. `--admin`, ruleset bypass and direct pushes to `main` are reserved for the human admin.
