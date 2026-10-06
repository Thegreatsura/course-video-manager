# Coding standards

The rules a human or an agent holds in their head while writing and reviewing
code here.

## Effect and configuration

Wherever possible, use Effect primitives like `FileSystem` over promises. This
is so that we can make use of DI and type-safe errors from Effect. However,
Effect should not leak out into the user-facing API.

Read every environment variable a run needs at its start, not at the moment of
use. A `Config.string(...)` inside a branch that runs rarely turns a missing
`.env` line into a failure that appears only when that branch first runs — a
video export that concats and normalizes for thirteen seconds, then fails
because nobody set `OVERLAY_RENDER_CACHE_DIRECTORY`, and does it again on every
retry. Resolve the config at the edge (the layer, or the command's entry point)
so a missing variable stops the process before any work starts, and let the
error name the variable.

### Effects are run, never dropped

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
errors in each package's `tsconfig.json`, run by `pnpm run lint:effect`). A
false positive gets `// @effect-diagnostics-next-line <rule>:off` and a reason.
See `docs/plans/effect-codebase-health.md`.

### Failures are handled in Effect, not around it

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

### Effects stay inside their boundary

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

## Control flow

### A switch over a union names every member

A `switch` on a union type lists every member as its own `case`, even the ones
that share a branch. A `default` that quietly absorbs the leftover members also
absorbs the member someone adds next month, and that new member takes the
fallback branch without anyone deciding it should — a new clip-service write
event would skip the Draft guard. Without a `default`, adding a member breaks
the lint until each switch says what to do with it.

Enforced by type-aware oxlint (`typescript/switch-exhaustiveness-check`, an
error in `.oxlintrc.json`).

## Errors

### Throw Errors, not values

Outside Effect, throw an `Error` or a subclass of one. A thrown string or plain
object has no stack and fails every `instanceof Error` check downstream, so the
handler that logs or maps it loses track of where it came from. Inside Effect,
fail with a tagged error instead (`Effect.fail(new XError(...))`), never with
`throw`. The one exception is React Router's `throw data(..., { status })` in
a loader or action, because that is how a route answers with an error status.

Enforced by type-aware oxlint (`typescript/only-throw-error`, an error in
`.oxlintrc.json` that allows `data()`).

### Every promise is awaited, handled or marked void

A promise nobody awaits loses its rejection: the failure turns into an
unhandled rejection rather than an error the caller sees, and the work it
started may still be running after the caller has moved on. Await it, or
`.catch` it where it is made. When fire-and-forget really is the intent (a
signal handler, a best-effort log line), write `void promise` with a comment
saying why nothing waits on it. Do not hand an async function to a slot that
expects a `void` callback either (an event listener, `forEach`), because
nothing there awaits or catches what it returns.

Enforced by type-aware oxlint (`typescript/no-floating-promises` and
`typescript/no-misused-promises`) as a ratchet. They are errors in the
directories listed in `.oxlintrc.json`'s `overrides`, which are services, CLI,
`.ts` routes, `apps/remote`, `packages` and scripts, and warnings in the
React UI. A file you touch should leave review with fewer warnings than it had.

## Function signatures

Optional parameters passed to functions should be scrutinised extremely
carefully. They are a huge source of bugs (by omission). Prioritise correctness
over backwards compatibility.

## Types

### Every `any` is a leak

An `any` switches the type checker off for every value that flows through it,
and those values keep flowing long after the line that produced them. Write the
type you actually mean. A shape you know gets a name — one `interface` at the
top beats a cast at each of thirteen call sites. A shape you do not know yet
gets `unknown`, and then gets narrowed, which is the honest form of `any`: it
makes the reader prove the shape before using it. A shape that varies by caller
gets a generic **constrained** to the real thing, because `<R extends
LayerLive>` says what a bare `<R>` does not. A symbol or brand a library owns
gets the library's own exported id (`Runtime.FiberFailureCauseId`) rather than a
cast.

What a leak costs, from this repo: `makeLoader` took `runtime:
ManagedRuntime<any, any>` and left its `R` unconstrained. A route asked for a
service the runtime did not provide, `tsgo` stayed green across all 111 route
modules, and the Animatic page returned a 500 on every load. The `any` did not
cause the missing service — it removed the one thing that would have caught it.

An `any` survives review when a third-party type is genuinely `any` at the
boundary and nothing narrower type-checks. Contain it: cast once at the edge
into a named type, and keep the `any` out of the signature everything else
calls. An `any` in an exported signature leaks to every caller; an `any` inside
one function body does not.

A new `any` needs a reason in the PR. An `any` already sitting in a file you are
touching is an invitation, the same way an oxlint `correctness` warning is — a
file should leave review with fewer of them than it had.

## Course Versions

### A write to anything a Version owns goes through the Draft guard

A Section, a Lesson, a Video and everything hanging off them belong to a
CourseVersion, and only a Draft accepts writes: Pending and Published Versions
are immutable. `packages/core/services/draft-guard.server.ts` is the single
place that decides this. Every DB write entry point resolves its target's owning
Version through the `requireDraftVersionFor…` that matches the noun it is
writing, and fails with a typed `VersionNotDraftError` when the Version is not a
Draft. The guard reads `commitState` with a `SELECT … FOR UPDATE`, so it is
only race-safe inside the SAME transaction as the write it protects.

**A NEW NOUN INHERITS THE GUARD FROM WHAT IT HANGS OFF.** If a row points at a
Video, a Clip or a Section, then a Version owns it too, however far from the
Course the noun feels while you are building it. Add its
`requireDraftVersionFor<Noun>` beside the others and call it from every write —
create, update, move and archive alike.

The guard's second job is the one that gets missed: it is the only thing that
catches a **stranded write**, a write that names a superseded row, succeeds, and
lands where nobody is looking. A Version copy gives every Video a new id, and
the old id still resolves, still names a real Video with the right title, and
still takes writes.

What the omission costs, from this repo: Clip Mockups and Clip Mockup Chapters
were left outside the closure on purpose, on the reasoning that a Clip Mockup is
pre-filming authoring data and sits outside the published write-closure. A
Version copy then gave one course a set of Draft Videos. Half an hour later an
authoring run wrote 190 Clip Mockups across six of those Videos — onto the
`v0.0.1` rows, a **published** Version — and ten hours after that a second run
wrote 57 Chapters onto eleven of them the same way. Every one of those ~250
writes succeeded and returned a row. The author opened the Animatic on the
Draft, which is the Version the app shows, and saw no Chapters and no Chapter
controls at all, because those controls hide themselves when a Video has none.
`requireDraftVersionForVideo` would have refused the first write of the first
run and the whole thing would have stopped there. The write-closure reasoning
was sound; it just did not account for a stranded write.

A noun survives review without a guard only when no Version owns it — a
standalone or pitch-bound Video belongs to no CourseVersion, and the guard
already passes for that case rather than needing to be skipped. "This noun is
not part of the published artifact" is not the test; "no row above this one
reaches a CourseVersion" is.

## Entities and their actions

### Every entity is right-clickable

Every entity the app renders — a Course, Section, Lesson, Video, Clip, Chapter,
Beat, Pitch, Deliverable — answers a right-click with a context menu. An entity
with actions and no right-click handler is an unfinished entity.

The right-click menu and the entity's **Actions menu** (the `Actions` dropdown,
or the `…` button) offer **the same set of actions** — see "Action menus".

### Every entity menu can copy its link and ID

Every entity's right-click menu and Actions menu ends its copy group with
"Copy Link", which copies the full app URL that opens the entity, and
"Copy ID", which copies the id that `cvm` takes. Build entity URLs only in `entityDeepLink`, and
read them back only with its inverse `parseEntityRef`; `cvm` accepts a link anywhere it takes an id
because every id argument is declared through `cli/entity-id.ts`. A link names its exact entity:
one shown on a parent's page carries its own id in a `?<type>=<id>` query param. A new entity type
gets its route in both functions and a test case beside them, which checks they stay inverses. Never hand-roll a URL or a clipboard item in a menu: `EntityMenuContent` (below) adds both.

### Filters stay in sync with the entity

Filters must stay in sync with the shape of the data they filter. When a new
field is added to an entity that affects what something "is" (status, category,
state), every filter, count, and badge that surfaces that concept must be
updated to take the new field into account. Filters are part of the entity's
definition, not a one-time UI feature — drift between them and the data shape
produces silently-wrong results.

## Action menus

An action menu lists verbs that act on one thing; a value picker (Effort,
Priority) is exempt. Distilled from Apple's HIG, NN/g and Fluent.

**Build every action menu with `EntityMenuContent`** (`ActionMenuContent` for
one not about an entity) from `features/action-menu/`. Declare each action
under its kind of group, taking common labels and icons from
`STANDARD_ACTIONS`; the component owns order, separators, destructive styling,
the ellipsis and Copy Link / Copy ID.

1. **One list, two doors.** An entity's right-click menu and its Actions / `…`
   dropdown render the same `groups`, built once beside the entity. A door
   that can't run an action in place still lists it and navigates to the
   entity's page to run it there (`CourseMenuIntent`).
2. **Groups come in one order:** `open` → `edit` → `create` → `move` → `run`
   (export, render, post) → `copy` (clipboard; Copy Link / Copy ID close it) →
   `danger`. Separators sit between groups only. A new action picks its group;
   it is never appended to the end.
3. **Labels are verb-first Title Case, without articles** ("Add Lesson
   Before"). An action on the menu's own entity drops its noun ("Rename", not
   "Rename Video"). A toggle names what it will do ("Mark as Done").
4. **Same action, same words, same icon** everywhere (`STANDARD_ACTIONS`).
   "Copy …" only means the clipboard; a second entity is "Duplicate". Say
   "Archive" when the app offers Unarchive, "Remove from …" when only a link is
   cut, "Delete" otherwise.
5. **An ellipsis means "asks for more first".** Set `opensDialog` on an item
   that opens a dialog, form or thread; never type "…" into a label.
6. **Destructive goes last, in red, in `danger`.** One that cannot be undone
   (Delete, Purge Export) confirms first, so carries the ellipsis; an undoable
   one (Archive, Remove from Pitch) acts at once.
7. **Hide what does not apply; disable what cannot run yet.** Omit an action
   that never applies in this state (read-only Version, Video never exported);
   disable one that applies but is blocked (first item's Move Up, a request in
   flight, transcription unfinished).
8. **Every item has an icon**, drawn by the primitive at one size. Show a
   `shortcut` wherever the action has one.
9. **One level of submenu at most**, for a choice among siblings (a Beat kind,
   a target Section). Past about a dozen items, move rare actions to the page.

Enforced by `action-menus.test.ts`: any raw `ContextMenu*` / `DropdownMenu*`
part outside a picker fails; a missing feature goes into `action-menu-model.ts`.

## React Router data flow

### Redirect from the action, not from an effect

When a fetcher action's sole job after success is to navigate, return
`redirect(...)` from the action instead of returning data and navigating from a
client-side `useEffect`. React Router handles fetcher redirects automatically.
The `useEffect` pattern is fragile: if any dep (e.g. an inline `onOpenChange`
prop) changes between renders, the effect re-fires and re-issues
`navigate(...)`, cancelling and restarting the in-flight navigation in a loop.

### Derive optimistic UI from `fetcher.formData`

For optimistic UI on fetcher mutations, derive the optimistic value from
`fetcher.formData` instead of mirroring it into `useState` + syncing back with
`useEffect`. When the fetcher is in-flight, `fetcher.formData.get("value")`
holds the pending value; when it settles, `formData` becomes `undefined` and the
component falls back to the revalidated loader data. Example:
`const optimistic = (fetcher.formData?.get("value") ?? loaderValue) as MyType;`.
This eliminates state-sync bugs and removes the need for `useEffect` entirely.

## Keyboard shortcuts

### The Animatic page answers the Video page's keys

The author walks an Animatic with the same habit he walks a filmed Video with,
so the two screens must not disagree about a key. Every shortcut the Video page
has (`features/video-editor/hooks/use-keyboard-shortcuts.ts`) is **ported to the
Animatic page where it has a meaning there**, and it keeps the same meaning:
SPACE plays and pauses where the playhead is, RETURN plays the selected item
from its start, the arrows move the selection and do not touch playback, HOME and
END go to the ends, L and K are 2x and 1x.

One pair differs ON PURPOSE: ARROW LEFT and ARROW RIGHT. On the Video page they
are a second UP and DOWN; on the Animatic they step the PLAYHEAD to the previous
or next Clip Mockup, folded or not, because the author is watching the picture
and a selection does not move it. UP and DOWN keep the Video page's meaning.

Port a key only if the Animatic has something for it to act on — the Animatic is
read-only, so DELETE, ALT+ARROW (reorder) and B (pause marker) have no
equivalent and are left out. When a shortcut is ADDED to the Video page, decide
at that moment whether it makes sense on the Animatic page, and add it there too
or say in the code why it cannot be. The two screens also hold the same shape:
the list of moments on the left, the picture on the right.

Both pages share one guard for when a key is not the page's to take —
`app/hooks/should-ignore-keyboard-shortcut.ts`. A new keyboard surface uses it
rather than writing its own test for inputs, Monaco and dialogs.

A surface that lives INSIDE a dialog — the Article Writer preview, whose L and K
step through its ChooseScreenshot placeholders — cannot use that guard whole, so
it uses the guard's `isTypingTarget` half and scopes itself to keys from its own
dialog. The Video and Animatic pages refuse every key from a dialog, so the two
L/K meanings never both act on one press.

## Interface design

### Deep modules

Prefer deep modules: small interface, deep implementation. A few methods with
simple params hiding complex logic behind them.

Avoid shallow modules: large interface with many methods that just pass through
to thin implementation. When designing, ask: can I reduce the number of methods?
Can I simplify the parameters? Can I hide more complexity inside?

### Design for testability

1. **Accept dependencies, don't create them** — pass external dependencies in rather than constructing them internally.
2. **Return results, don't produce side effects** — a function that returns a value is easier to test than one that mutates state.
3. **Small surface area** — fewer methods = fewer tests needed, fewer params = simpler test setup.

## Testing

Tests verify behavior through public interfaces, not implementation details.
Code can change entirely; tests shouldn't break unless behavior changed.

Mock at **system boundaries** only — external APIs, time and randomness, and the
file system or a database when a real instance isn't practical. Everything
inside the boundary goes in real: never mock your own classes, modules or
internal collaborators. When something is hard to test without mocking an
internal, redesign the interface.

Every test must be able to fail for a plausible real bug a user or caller
would see; if you can't name the bug, don't write it. For what earns a place,
worked examples, red flags, Remotion and TDD, read
[`TESTING_STANDARDS.md`](./docs/TESTING_STANDARDS.md).
