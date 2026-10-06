# Plan: Effect codebase health and type-aware lint

Measured 2026-10-06 on `origin/main` (2795ec48) in a scratch worktree. Counts below
come from real runs, not estimates. The plan is advisory-first: a rule only
becomes an error once it is green and a documented coding standard says why.

## Current state

- **Typecheck:** `tsgo` from `@typescript/native-preview` 7.0.0-dev.20260707.2,
  one run per package through turbo. That build is stale: `typescript@7.0.2` is
  now `latest` on npm. No TS plugin runs in tsgo, so the Effect language service
  has never run in CI or in the typecheck. (Since replaced by `typescript@7.0.2`
  `tsc`. See the Phase 1 status.)
- **Lint:** `oxlint` 1.85, syntax-only, in 0.26s. `correctness` is set to `warn`,
  and today it gives **12 warnings**. The only error-level rule is
  `no-restricted-globals` (localStorage), because it encodes a standard.
  `require-yield` is off for Effect generators.
- **Other gates:** dependency-cruiser runs per package. Five `scripts/check-*.sh`
  grep guards run in pre-commit and CI with `--all`. `pnpm run check` is the CI
  job.
- **Effect:** 3.22 (`^3.17.1`), with `@effect/platform`, `cli`, `cluster` and
  `vitest`.
  - Usage counts: 396 files import `effect`, 1138 `Effect.gen`, 41
    `Effect.Service` classes and only 1 `Context.Tag`.
  - Layers are composed in `layer.server.ts`. Seven `ManagedRuntime`s exist.
  - Routes run Effects through `makeLoader`/`makeAction` in
    `route-action.server.ts`. That file maps tagged errors to HTTP statuses.
  - Errors use 67 `Data.TaggedError`s and 0 `Schema.TaggedError`s. Schema
    appears in 46 files.
  - Escape hatches outside tests: `Effect.promise` 48, `Effect.die` 68,
    `catchAll(() => succeed/void)` 32, `as any` 21, and `Effect.run*` 15 hits
    in 12 files.

## What the tools can do (Oct 2026)

- **`@effect/language-service` 0.87.3** is the TS 5/6 plugin. Its README
  points TS 7 users to `@effect/tsgo`.
  - Two ways to run it in CI: `effect-language-service patch` patches `tsc`, or
    `diagnostics --project` runs without patching. Neither runs inside tsgo.
  - On this repo the TS-5 `diagnostics` run took **264s for apps/local**.
- **`@effect/tsgo` 0.48.1** (2026-10-05) is Effect's answer for tsgo: TypeScript-Go
  with the language service built in. It supports **only `typescript@7.0.2`
  and 7.1-dev**.
  - `effect-tsgo diagnostics --project <tsconfig>` ran **all three packages in
    about 12s**, with the same findings as the TS-5 service.
  - `effect-tsgo patch` patches the `typescript@7` `tsc` binary, so the
    diagnostics then show up in the normal typecheck and in the editor.
  - `typescript@7.0.2` `tsc` typechecks core and local with 0 errors. That
    matches the pinned tsgo.
- **Oxlint type-aware (`--type-aware` + `oxlint-tsgolint` 7.0.2003)** is
  stable. 60 rules ported from typescript-eslint. All the rules below ran in
  **5s**.
  - It has no Effect awareness. `no-floating-promises` ignores Effects, which
    are not thenables, so `floatingEffect` covers them.
  - `effect-tsgo patch --oxlint` adds `effecttsgo/*` rules to oxlint, but pins
    oxlint to 1.82–1.86.
- **ESLint:** `@effect/eslint-plugin` 0.3.2 has had no release since 2025-04.
  Its only rules are `dprint` and a barrel-import rule, and neither is
  type-aware. No maintained community plugin exists. Oxlint `jsPlugins` are
  alpha and syntax-only.

## Findings

Hits are counted across core, local and remote. "Test" is the share of hits in
test files.

| Rule                                                                                                     | Tool        | Catches                                                               | Hits (test)                 | Cost                          | Recommendation                                    |
| -------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------- | --------------------------- | ----------------------------- | ------------------------------------------------- |
| floatingEffect                                                                                           | effect-tsgo | Effect built and dropped, never run                                   | **0**                       | none                          | **Error now**                                     |
| missingStarInYieldEffectGen                                                                              | effect-tsgo | `yield eff` without `*`                                               | **0**                       | none                          | **Error now**                                     |
| runEffectInsideEffect                                                                                    | effect-tsgo | `Effect.run*` inside a gen                                            | **0**                       | none                          | **Error now**                                     |
| returnEffectInGen / effectInVoidSuccess / effectInFailure / unknownInEffectCatch                         | effect-tsgo | Effect-of-Effect, an Effect lost in `void` or `E`, an `unknown` catch | **0**                       | none                          | **Error now**                                     |
| await-thenable                                                                                           | oxlint TA   | `await` on a non-promise                                              | **0**                       | none                          | **Error now**                                     |
| missingReturnYieldStar                                                                                   | effect-tsgo | `yield* fail` without `return` (default is error)                     | 7 (0) / 5 files             | small                         | Fix, then error                                   |
| catchUnfailableEffect                                                                                    | effect-tsgo | dead `catch*` on an Effect that never fails                           | 3 (0)                       | small                         | Fix, then error                                   |
| tryCatchInEffectGen                                                                                      | effect-tsgo | `try/catch` inside `Effect.gen`                                       | 3 (0)                       | small                         | Fix, then error                                   |
| globalErrorInEffectFailure / Catch                                                                       | effect-tsgo | untagged `Error` in `E`                                               | 14 (9)                      | small                         | Fix, then error. Encodes "type-safe errors"       |
| schemaSyncInEffect                                                                                       | effect-tsgo | `decodeUnknownSync` inside a gen                                      | 1                           | trivial                       | Fix, then error                                   |
| switch-exhaustiveness-check                                                                              | oxlint TA   | a union case with no branch                                           | 7 (0)                       | small                         | Fix, then error                                   |
| only-throw-error                                                                                         | oxlint TA   | throwing a non-Error                                                  | 7 (0)                       | small                         | Fix, then error                                   |
| no-floating-promises                                                                                     | oxlint TA   | unawaited promise                                                     | **139 (0) / 70 files**      | medium, mostly React handlers | Warn now. Ratchet per file                        |
| no-misused-promises                                                                                      | oxlint TA   | async fn where void is expected                                       | 99 (0) / 58 files           | medium                        | Warn now. Ratchet                                 |
| leakingRequirements                                                                                      | effect-tsgo | service methods that leak `CommandExecutor`                           | 2                           | design                        | Warn, then fix in ffmpeg services                 |
| anyUnknownInErrorContext / unsafeEffectTypeAssertion                                                     | effect-tsgo | `any`/`unknown` in E or R, Effect casts                               | 65 (51) / 6 (6)             | medium                        | Warn. Feeds "every `any` is a leak"               |
| Effect.run* outside boundary files                                                                       | grep guard  | runtimes escaping their edge                                          | 15 / 12 files               | allowlist                     | **Custom guard**, shrink-only list                |
| `catchAll(() => succeed/void)`                                                                           | grep guard  | errors swallowed silently                                             | 32 / 17 files               | review each                   | **Custom guard**, shrink-only list                |
| `Effect.promise(` in product code                                                                        | grep guard  | a rejection turned into a defect                                      | 48 / 11 files               | medium                        | **Custom guard** → `tryPromise`                   |
| missingEffectServiceDependency                                                                           | effect-tsgo | `DrizzleService` missing from `dependencies`                          | 24                          | n/a                           | Noise: provided at composition by design          |
| strictBooleanExpressions (both tools)                                                                    | both        | non-boolean conditions                                                | 3580 / 709                  | huge                          | Not doing                                         |
| asyncFunction, strictEffectProvide, effect-native globals (Date/Console/fetch/process.env/node builtins) | effect-tsgo | style choices toward Effect-native code                               | 1888, 531, ~800             | huge, mostly tests            | Not doing                                         |
| no-unsafe-* family, no-unnecessary-type-assertion/condition                                              | oxlint TA   | `any` flow                                                            | 1502 (~70% tests), 227, 176 | large                         | Not doing now. Revisit once the `any` count falls |

`yield` without `*` and `Effect.orDie` turned out not to be problems: the
missing-star rule has 0 hits, and `Effect.orDie` appears once.

## Phased rollout

**Phase 1 — 0-hit rules as errors (one PR, about 1 hour).**

> **Status (2026-10-06): shipped.** Steps 1 and 5 landed first (#1784): the
> coding standard and type-aware `await-thenable` as an error. Steps 2–4 then
> waited on TypeScript 7, because `effect-tsgo diagnostics` discovers an
> installed native `tsc` under the package name `typescript` and refused the
> old `@typescript/native-preview`. The follow-up PR (`chore/typescript-7`):
>
> - moves `typescript` to exactly `7.0.2` in every package except
>   `overlay-renderer`, which Remotion keeps on 5.8.2 and turbo already filters
>   out. `tsc` replaces `tsgo` in every `typecheck` script, and
>   `@typescript/native-preview` is gone.
> - adds `@effect/tsgo` 0.48.1 and a plugin block in the core, local and remote
>   `tsconfig.json`. `floatingEffect`, `missingStarInYieldEffectGen`,
>   `returnEffectInGen` and `runEffectInsideEffect` are errors, all at 0 hits.
>   The other rules that default to error are demoted to `warning`. The rest
>   keep their defaults and do not gate.
> - adds `lint:effect` (a turbo task, `dependsOn: ["^build"]`) after `typecheck`
>   in `pnpm run check` and in pre-commit. It costs about 13s.
>
> Step 3 differs from the plan: the ratchet rules are not yet set to `warning`.
> Only `--severity error` gates. Two caveats came out of the move:
>
> - dependency-cruiser 18.x only supports `typescript` <7, because it uses the
>   TS 5 JS API, which TS 7 no longer ships. A `pnpm.packageExtensions` entry
>   gives it its own `typescript@5.9.3`.
> - Vercel builds `apps/remote` with the project's `typescript`. Against TS 7,
>   `@vercel/node` ≥15 takes its native-compiler path (`tsc` binary) and no
>   longer uses `transpileModule`.
>
> The "Fix, then error" rows (Phase 2) are next.

1. Add a short Effect section to `CODING_STANDARDS.md`: "an Effect is always
   yielded or returned, never dropped; never `Effect.run*` inside an Effect;
   errors in `E` are tagged." That makes the rules eligible to be errors under
   the advisory policy.
2. Add `@effect/tsgo` as a dev dependency.
3. Add a `"plugins": [{ "name": "@effect/language-service", "diagnosticSeverity": {...} }]`
   block to each package `tsconfig.json`. Set the Phase-1 rules to `error`, the
   ratchet rules to `warning`, and every rule marked "not doing" to `off`.
4. Add a turbo task `lint:effect` that runs
   `effect-tsgo diagnostics --project tsconfig.json --format github-actions` in
   each package, with `dependsOn: ["^build"]` because remote needs core built.
5. Add `--type-aware` to `oxlint`, with `oxlint-tsgolint`. Make
   `await-thenable` an error. `no-floating-promises` and `no-misused-promises`
   go in as `warn`, matching how `correctness` is handled today.

**Phase 2 — clean up, then promote (about 6 small PRs).** Work through the
"Fix, then error" rows, one rule per PR, and promote each rule as it reaches 0.

> **Status — effect-tsgo rules (2026-10-06): done.** All hits were in
> `apps/local`; core and remote had none. Every effect-tsgo "Fix, then error"
> row is now an error in all three `tsconfig.json`s, backed by the "Failures
> are handled in Effect, not around it" standard.
>
> - `missingReturnYieldStar` (7), `catchUnfailableEffect` (3),
>   `tryCatchInEffectGen` (3) and `schemaSyncInEffect` (1) landed together
>   (#1789). One `catchUnfailableEffect` hit was a real bug: the export's
>   best-effort stage-failure log used `catchAll`, which never sees the defect
>   a sync `appendFileSync` throws, so a full disk would have replaced the
>   export's own error. It is now `catchAllDefect`, with a test.
> - `globalErrorInEffectFailure` / `globalErrorInEffectCatch` (14, 9 in tests)
>   landed on their own. Product code fails with new tagged errors
>   (`AutofillNoValidChaptersError`, `WslPathConversionError`,
>   `RevealInExplorerError`) carrying the same messages; tests fail with real
>   tagged errors (`FFmpegError`) or local ones. Two hits are suppressed with a
>   reason: the Clip Mockup daemon's `throw` inside a plain async HTTP handler
>   (not an Effect failure), and one `route-action` test that pins the
>   untagged-error fallback on purpose.

The two promise rules ratchet per directory with `overrides`, for example once
`app/services/**` is clean.

> **Status — type-aware oxlint rules (2026-10-06):**
>
> - `switch-exhaustiveness-check`: **error.** Re-measured at 10, not 7: the
>   rule's default counts a `default` branch over a union as not exhaustive.
>   Every switch now names each member; no branch changed what it returns.
>   (#1788)
> - `only-throw-error`: **error.** 7 hits. Two threw non-Errors (the
>   transaction rollback signal in `with-db-transaction` and `.sandcastle`'s
>   retry wrapper); both now throw an `Error`. The other five are React
>   Router's `throw data(..., { status })`, which is allowed by type
>   (`DataWithResponseInit`), because rewriting it would change the responses.
>   (#1790)
> - `no-floating-promises` / `no-misused-promises`: **warn, ratcheting.**
>   Re-measured at 139 / 99, which matches the table. They were already nearly
>   absent outside the React UI: 3 hits, all fixed with the semantics kept. A
>   daemon signal handler and a clip-service log line stay fire-and-forget,
>   now as `void` with a reason. A `.sandcastle` semaphore drops a comma
>   expression that tripped the rule. They are **errors** in
>   `apps/local/app/services/**`, `apps/local/app/cli/**`,
>   `apps/local/app/routes/**/*.ts`, `apps/remote/**`, `packages/**`,
>   `.sandcastle/**` and `scripts/**`. They stay warnings elsewhere: 138 / 97,
>   almost all in `features/`, `components/`, `hooks/` and `.tsx` routes,
>   mostly React event handlers. Each of those needs a judgement on whether
>   the handler should await, so that work is left for a per-directory pass
>   rather than a mass `void`.

**Phase 3 — custom guards.** Add `scripts/check-effect-boundaries.sh` in the
style of the existing guards.

- It flags `Effect.run*` outside an allowlist: `route-action.server.ts`,
  `layer.server.ts`, `cli/`, `*-test-setup.ts`, the daemon entry points and
  `with-db-transaction`.
- It also flags new `catchAll(() => Effect.succeed|void)` and `Effect.promise(`
  in non-test code, each against a **shrink-only** legacy list, the same way
  `.oxlintrc.json` handles localStorage.

**Phase 4 (optional) — one checker instead of two.** Replace
`@typescript/native-preview` with `typescript@7.0.2` and run
`effect-tsgo patch` in `prepare`. `tsc` then reports Effect diagnostics during
`typecheck` and in the editor, and `lint:effect` can be removed.

## CI and pre-commit

- **`pnpm run check`:** typecheck → **lint:effect** → oxlint `--type-aware` →
  boundaries → guards → tests. The new steps add about 17s, against a CI job
  dominated by the test suite.
- **Pre-commit:** add `lint:effect`, which takes about 12s warm, next to
  `typecheck`. Add the Phase-3 guard in staged mode. Type-aware oxlint stays
  CI-only, which matches the split `check:response-body` already uses.
- **Policy:** only rules backed by a standard (Phase 1 now, Phase 2 as each
  reaches 0) are `error`. Everything else is `warning`, an invitation, as
  `CLAUDE.md` says. A false positive gets
  `// @effect-diagnostics-next-line <rule>:off` with a reason.

## Risks

- **TypeScript version lockstep.** `@effect/tsgo` supports exactly 7.0.2 and
  7.1-dev, and its `--oxlint` patch pins oxlint to 1.86 or lower. Upgrades of
  typescript, oxlint and `@effect/tsgo` must move together. Pin them exactly,
  not with `^`.
- **Separate pass versus patch.** Phase 1 runs a separate diagnostics pass, so
  tsgo stays the typechecker. It costs two program builds but has no patching
  fragility. Phase 4 trades that for a patched `tsc`.
- **Effect 4** is out (4.0.1, 2026-10-05), and rule names and defaults are
  v4-first. A v4 migration means re-measuring this table.
- **0.x churn.** Both `@effect/tsgo` and the diagnostics' JSON shape can change
  between minor versions.

## Not doing

- No ESLint and no `@effect/eslint-plugin`. It has no type-aware rules, and
  `effect-tsgo` plus `tsgolint` cover everything ESLint would add.
- No `effecttsgo/*` oxlint plugin yet, because of the oxlint version pin. The
  same rules run via `diagnostics`.
- No Effect-native rules (globalDate, globalConsole, processEnv, asyncFunction,
  nodeBuiltinImport) and no `strictBooleanExpressions` or `strictEffectProvide`.
  That is about 7000 hits of style.
- No `no-unsafe-*` family until the `any` count falls.
- No custom oxlint JS plugin for Effect. It is alpha and syntax-only, and the
  grep guards are enough.
- No change to `missingEffectServiceDependency`: providing `DrizzleService` at
  composition is the design.
