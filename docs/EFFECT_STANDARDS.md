# Effect standards

The detail behind the Effect rules in
[`CODING_STANDARDS.md`](../CODING_STANDARDS.md). Each rule's one-line essence
lives there; the reasoning, the variants and the enforcement live here.

## Effects are run, never dropped

An Effect is a description of work, not the work. Building one does nothing
until something runs it, so an Effect that is neither yielded nor returned is
silently skipped — no error, no log, the write just never happens.

- **Yield or return every Effect.** Inside `Effect.gen`, write `yield* eff`.
  A bare `eff;` statement is dropped, and `yield eff` without the `*` yields the
  Effect object itself instead of its result.
- **Never return an Effect from a generator to be run later.** `return eff`
  inside `Effect.gen` gives you `Effect<Effect<A>>`, and the inner one is
  usually dropped by the caller. Write `return yield* eff`.
- **Never `Effect.run*` inside an Effect.** `runPromise`/`runSync` inside a
  generator starts a second, detached runtime: it loses the services, the
  interruption and the typed errors of the one you are in. Yield the Effect, or
  take a `Runtime` and use `Runtime.run*` at a real boundary.
- **Never `await` an Effect.** It is not a promise; `await eff` resolves to the
  Effect object and runs nothing. `await` only what is actually thenable.

Enforced by type-aware oxlint (`typescript/await-thenable`, an error in
`.oxlintrc.json`) and by `@effect/tsgo` (`floatingEffect`,
`missingStarInYieldEffectGen`, `returnEffectInGen`, `runEffectInsideEffect`,
errors in each package's `tsconfig.json`, reported by `pnpm run typecheck`,
whose `tsc` the root `prepare` script patches with `effect-tsgo patch`). A
false positive gets `// @effect-diagnostics-next-line <rule>:off` and a reason.
See [`plans/effect-codebase-health.md`](./plans/effect-codebase-health.md).

## Failures are handled in Effect, not around it

Inside `Effect.gen`, a failure is a value in `E`, not a thrown exception. Code
that throws, or that catches by hand, hides the failure from the type that is
meant to name it.

- **`return yield*` a failure.** `return yield* new FooError(...)` tells the
  reader, and the type checker, that the generator ends there. A bare
  `yield* new FooError(...)` reads as if the code below it could still run.
- **No `try/catch` inside a generator.** Wrap the throwing call in
  `Effect.try` (or `Effect.tryPromise`) so its failure lands in `E`; if the call
  cannot throw, delete the `try`.
- **No `*Sync` Schema decode inside an Effect.** `Schema.decodeUnknownSync`
  throws; `Schema.decodeUnknown` fails with a typed `ParseError`.
- **Never `catch*` an Effect that cannot fail.** The handler is dead code, and
  it reads like protection it does not give: `catchAll` never sees a defect —
  a sync throw inside `Effect.sync`, say. If you mean to swallow defects, say
  so with `catchAllDefect`.
- **Every error in `E` is tagged.** Fail with a `Data.TaggedError` (or
  `Schema.TaggedError`), never the global `Error`: untagged errors merge into
  one indistinct `Error` in `E`, so nothing downstream can `catchTag` one or map
  it to a status in `makeAction`. Keep the underlying error as `cause`. This
  applies in tests too; a test that pins the untagged fallback says so beside a
  suppression comment.

Enforced by `@effect/tsgo` (`missingReturnYieldStar`, `tryCatchInEffectGen`,
`schemaSyncInEffect`, `catchUnfailableEffect`, `globalErrorInEffectFailure`,
`globalErrorInEffectCatch`), errors in each package's `tsconfig.json`.

## Effects stay inside their boundary

An Effect keeps its services, interruption and typed errors only while it stays
inside one run. Each of these patterns drops one of them without a word.

- **Run an Effect only at a boundary.** A route goes through `makeLoader` /
  `makeAction` (`route-action.server.ts`). The CLI, a daemon's entry point,
  `createSseResponse` and `withDbTransaction` are the other edges. An
  `Effect.run*` or `runtime.run*` anywhere else is a second, detached run. A
  callback that must return a Promise is the usual cause: make it return an
  Effect instead. For a module-level semaphore, write
  `Effect.unsafeMakeSemaphore(1)`, not `Effect.runSync(Effect.makeSemaphore(1))`.
- **Never swallow a failure silently.** `catchAll(() => Effect.succeed(x))` or
  `catchAll(() => Effect.void)` turns every failure into a normal value with no
  log, including the ones nobody foresaw. Catch the tag you expect
  (`catchTag`), or log what you drop (`Effect.tapError` + `Effect.logWarning`).
  To clean up a temp file, use `removeBestEffort` (`services/remove-best-effort.ts`):
  it is silent when the file is already gone and logs anything else. When
  silence really is the behaviour, keep the catch and say why in the
  allowlist.
- **`Effect.tryPromise`, not `Effect.promise`, for anything that can reject.**
  `Effect.promise` turns a rejection into a defect. A defect is not in `E`,
  `catchAll` never sees it, and `makeAction` cannot map it to a status. Write
  `Effect.tryPromise({ try, catch: (cause) => new FooError({ cause }) })`. For
  a Drizzle call, the error is `UnknownDBServiceError`.

Enforced by `scripts/check-effect-guards.ts`, which runs in `pnpm run check`,
CI and the pre-commit hook. It parses each non-test file and holds the three
patterns to a shrink-only allowlist, `scripts/effect-guards-allowlist.json`: a
count per file and a one-line reason. A new hit fails. So does an entry whose
count is higher than its file's, so a fix must also lower the list. Test code
(`*.test.ts`, `test-utils/`, `*-test-setup.ts`, `*-test-harness.ts`) is out of
scope.
