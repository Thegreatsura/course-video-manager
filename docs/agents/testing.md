# Testing: scoped locally, exhaustive in CI

Two tiers, on purpose — don't run the full suite by hand.

## While iterating: `pnpm run test:affected`

Scopes to what your change could actually break:

- **Package-level**: `turbo --affected` diffs against `origin/main` and only runs `test` for packages that changed plus their dependents (untouched packages are skipped outright, not just cache-hit).
- **File-level**: within an affected package, `vitest --changed=origin/main` further narrows to test files whose import graph actually touches the diff (it correctly widens to "everything" when the diff includes something broad, e.g. a shared module many files import, or root config — that's the safety net inside the narrowing, not a bug).

This is git-diff-based, not cache-based — it gives the same answer on a brand-new clone as it does on a long-lived one, which matters here since agent workspaces are ephemeral (no local Turbo cache survives between sessions, and there is no remote cache).

## The full suite: CI, not you

`.github/workflows/test.yml` runs `typecheck`, `lint:boundaries` and the **unfiltered** `pnpm run test` on every PR — no `--affected`, every package, every time. That's what makes it safe for `test:affected` to stay scoped: nothing merges without the exhaustive run passing regardless of what got skipped locally. Reach for the full `pnpm run test` yourself only if you have a specific reason to distrust the affected-scoping for your change (e.g. you suspect a cross-package regression `--changed` wouldn't see).

## Known noise: `packages/core`'s PGlite suite can look flaky under load

`packages/core` runs its DB-backed tests over in-process PGlite with up to 5 parallel forks (ADR 0014). On a CPU-constrained box (a shared/sandboxed agent workspace, not CI) that can produce sporadic per-test timeouts in otherwise-unrelated files — a symptom of contention, not a regression. Before treating a failure as real:

1. Re-run just that file in isolation (`npx vitest run <file>` from `packages/core`, or `apps/local`) — if it passes alone, that's contention, not a bug.
2. If still unsure, `git stash` your changes and re-run the same file against `main` — if it fails identically there, it's pre-existing.

Do **not** chase this by re-running the full suite with `--no-file-parallelism`; serializing ~150+ test files can take 10+ minutes and gives no more signal than step 1.

## One build-order gotcha

`packages/core` is consumed via its built `dist/` (its `package.json` `exports` map points there), even from tests — `pnpm run test`/`test:affected` build it first automatically (Turbo's `dependsOn: ["^build"]`), but a direct `vitest run` inside `apps/local` or `apps/remote` (bypassing Turbo for faster iteration) will fail to resolve `@cvm/core/...` imports unless you've run `pnpm --filter @cvm/core build` at least once first.
