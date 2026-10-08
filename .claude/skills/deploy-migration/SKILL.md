---
name: deploy-migration
description: Ship a Drizzle schema change end to end — generate the migration, merge, hand Matt the migrate command, redeploy apps/remote, confirm it is green. Use whenever a change adds or edits a file under packages/core/db/migrations/ or changes packages/core/db/schema.ts, or when an apps/remote deploy failed with "production has not applied".
---

# Deploy a migration

Production is migrated **by hand, by Matt** (ADR 0026). `apps/remote` deploys on every merge, and its build (`apps/remote/scripts/assert-migrations-applied.mjs`) fails on purpose when production lacks the commit's latest migration, so the previous deployment keeps serving. You merge, Matt migrates, then you redeploy.

**You never run `pnpm db:migrate` against production, and you never write to production by any other route either.** `packages/core/drizzle-guard.ts` refuses most wrong runs, but don't rely on it.

## 1. Generate and merge

1. Change `packages/core/db/schema.ts`, then run `pnpm db:generate`. Commit the generated SQL and the `meta/` files unedited.
2. The migration and the code that uses it may ship in **one PR**. It must be additive: a new table, a nullable column, or a column with a default. For anything destructive, see section 4.
3. Land it the usual way (`docs/agents/merging.md`).

## 2. The deploy fails, and Matt migrates

The `apps/remote` deploy for the merge commit fails with `production has not applied <tag>`. That failure is expected and harmless: the old deployment is still serving.

Send Matt **exactly one message** with the migration tag and this command, run from his main checkout:

```
git switch main && git pull --ff-only && pnpm db:migrate
```

Then wait. Do not redeploy, retry or poll until Matt confirms he has run it.

## 3. Redeploy and confirm

1. Find the failed deployment for the merge commit:

   ```
   npx vercel@latest ls course-video-manager-remote --scope matt-pococks-projects -m githubCommitSha=<merge-sha> --json
   ```

   Take the `url` of the `production` deployment whose `state` is `ERROR`.

2. Rebuild it. The CLI is already logged in on Matt's machine. The command waits for the build and prints `Ready` on success.

   ```
   npx vercel@latest redeploy <url> --scope matt-pococks-projects
   ```

   If the build fails again with `production has not applied`, Matt's migrate did not take. Tell him, quoting the tag. Do not redeploy in a loop.

   `redeploy` of the merge commit's deployment is the **only** way you put anything on production. Never run `vercel deploy --prod` (or `vercel --prod`): it uploads your working tree, not `main`. The build refuses it anyway (`apps/remote/scripts/assert-production-source.mjs` fails any production build that is not a GitHub clone of `main`), but don't rely on that. If `redeploy` fails with `assert-production-source`, you redeployed the wrong deployment: stop and tell Matt.

3. Confirm on GitHub. Read the commit's status contexts and check that `Vercel` is `SUCCESS` with a `createdAt` after your redeploy:

   ```
   gh api graphql -f query='{repository(owner:"mattpocock",name:"course-video-manager"){object(expression:"<merge-sha>"){... on Commit{status{contexts{context state description targetUrl createdAt}}}}}}'
   ```

   Use GraphQL. The REST `commits/<sha>/statuses` endpoint has returned HTTP 500 for this repo.

   > **Unproven.** The `vercel redeploy` command has been proven to rebuild and promote production. Whether that redeploy posts a fresh `Vercel` status to the commit has not been confirmed yet. Until Matt confirms it once, also report the `Ready` line and the URL that `vercel redeploy` printed.

## 4. Destructive changes go contract-first

Dropping or renaming a column or table, or making a column `NOT NULL` without a default, would break the code already serving. Run it in two PRs:

1. **Stop using it.** Remove the column from `schema.ts` and every read and write of it. Merge, and let `apps/remote` deploy green.
2. **Drop it.** Only then generate and merge the migration that drops it, and follow sections 2 and 3.

A rename is add-new → copy the data → switch the code → drop-old, with each step shipped as above.

## Local development

On Matt's machine, `apps/local` uses the production database too. `pnpm dev` and `pnpm start` print a loud warning when that database is behind the checkout's migrations (`apps/local/scripts/warn-pending-migrations.ts`). The fix is the same command from section 2, run by Matt.
