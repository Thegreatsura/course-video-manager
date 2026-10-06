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

Enforced by `@effect/tsgo` (`missingReturnYieldStar`, `tryCatchInEffectGen`,
`schemaSyncInEffect`, `catchUnfailableEffect`), errors in each package's
`tsconfig.json`.

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
or the `…` button on the entity itself) offer **the same set of actions**. They
are two doors into one list: an action added to one appears in the other, so
share the menu items between them rather than writing each list twice.

### Order the actions, and group the related ones

Both menus present that shared list in a deliberate order, most-reached action
first and the destructive ones (archive, delete) last. Related actions sit
together in a group — everything that moves the entity, everything that exports
it, everything that ends its life — with `DropdownMenuGroup` and a
`DropdownMenuSeparator` between groups, and a `DropdownMenuLabel` where the
group's name helps the reader. Adding an action means choosing the group it
belongs to, not appending to the end of the list.

### Context menu items carry an icon

Context menu items should always include a leading icon (from `lucide-react`),
matching the style of the surrounding items. When adding a new menu item, pick
an icon that conveys the action.

### Filters stay in sync with the entity

Filters must stay in sync with the shape of the data they filter. When a new
field is added to an entity that affects what something "is" (status, category,
state), every filter, count, and badge that surfaces that concept must be
updated to take the new field into account. Filters are part of the entity's
definition, not a one-time UI feature — drift between them and the data shape
produces silently-wrong results.

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

Writing, changing or reviewing a test — for the worked good and bad examples,
the red-flag list, the rule for Remotion renderer packages, and the
vertical-slice TDD loop, read
[`TESTING_STANDARDS.md`](./docs/TESTING_STANDARDS.md).
