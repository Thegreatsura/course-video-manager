# Landing a change

`main` is protected by a ruleset: a PR merges only once the `check` status is green on a branch that is up to date with `main` (strict). Every change lands through this sequence.

1. **Worktree.** `git fetch origin && git worktree add .claude/worktrees/<name> -b <branch> origin/main`, then `pnpm install --frozen-lockfile --prefer-offline` inside it. If you touch UI, verify with the `verify-cvm` skill — it runs on a clone of its own and needs no `.env`.
2. **Commit.** `pnpm run check` is green before you push. Every commit ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
3. **PR.** `gh pr create`; the body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
4. **Merge.** Done when the PR shows `MERGED` and your worktree is gone:
   1. Wait for `check` to pass (`gh pr checks <pr> --watch`).
   2. If `gh pr view <pr> --json mergeStateStatus` says `BEHIND`, run `gh pr update-branch <pr>` and go back to 4.1.
   3. `gh pr merge <pr> --merge`. Leave off `--delete-branch`: `main` is checked out in another worktree, so the local cleanup fails.
   4. `git push origin --delete <branch>`, then `git worktree remove .claude/worktrees/<name>`.

**Waiting and polling.** Prefer `gh pr checks <pr> --watch` to a hand-rolled loop. Any wait or poll loop you do write gets a timeout (`timeout 900 bash -c 'until …; do sleep 5; done'`) and writes its logs inside your own worktree, never shared `/tmp`: a loop waiting on a file that never appears there runs for hours after you finish. Before you finish, stop every background command you started.

The ruleset is the only gate, and it holds for agents without exception: merge through the loop above, every time. `--admin`, ruleset bypass and direct pushes to `main` are reserved for the human admin.

## A PR with a migration

Migrations are applied by hand (ADR 0026) but `apps/remote` deploys on merge, so code that needs a new column must never reach `main` before production has it. PR #1859 merged migration 0028 together with code that selects the new column, and production broke until Matt migrated. Ship schema changes as **expand/contract**, in separate PRs:

1. **Migration PR.** Only `packages/core/db/migrations/**`, `packages/core/db/migrations.test.ts` and `docs/`. Not `schema.ts`: a column in `schema.ts` is read by every `select()` of its table, so the schema is code that depends on the migration. Generate the migration from your branch (`pnpm db:generate`), then commit the migration files and revert `schema.ts` into the follow-up. The migration must be safe for the code already on `main`: additive, or with a default, never a drop or rename.
2. **Stop after it merges.** Do not open, update or merge the follow-up. Hand to Matt with the migration's tag and this exact command, run from the main checkout:

   ```
   git switch main && git pull --ff-only && pnpm db:migrate
   ```

3. **Follow-up PR.** `schema.ts` and the code that uses the new schema. CI fails it until Matt has migrated and added the `migration-applied` label (`migration guard` job, `scripts/check-migration-pr.ts`). Once he has, re-run the failed check: `gh run rerun <run-id> --failed`. Then merge as usual.

**Agents never add the `migration-applied` label** — not when asked to unblock a PR, not when the migration "must already be applied". It is Matt's statement that production has run every migration on `main`, and nothing else can make it. A Claude Code hook blocks the command.

**Contract (destructive) changes** — dropping or renaming a column or table, or making a column `NOT NULL` without a default — run the other way round: first a PR that stops the code using it (and removes it from `schema.ts`), merged and deployed; only then the migration PR that drops it. A rename is add-new → copy → switch the code → drop-old.

Backstop: the `apps/remote` build (`apps/remote/scripts/assert-migrations-applied.mjs`) reads production's Drizzle migrations table and fails the deploy if the commit's latest migration is not applied, so the previous deployment keeps serving. The deploy of a migration-only merge therefore fails until Matt migrates. That is expected and harmless: the code is unchanged.
