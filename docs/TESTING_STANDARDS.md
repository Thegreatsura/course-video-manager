# Testing standards

The worked examples behind the testing rules in
[`CODING_STANDARDS.md`](../CODING_STANDARDS.md). Read those two rules first —
behavior through public interfaces, and mocking at system boundaries only.
Everything here is how they look in practice.

## What earns a test its place

The rule: a test must be able to fail for a plausible real bug in behavior a
user or caller observes.

Worth a test: business rules; parsers and serialisers; data integrity
(constraints, cascades, the Draft guard, what a copy carries); regressions for a
real past bug (a test from a `fix:` commit stays); guard and convention tests
such as `entity-menus.test.ts` and `effect-guards.test.ts`.

Not worth a test:

- **Tautologies**: a mock returning what it was told, a restated constant,
  config or lookup table, a snapshot of static markup, a type being a type.
- **Implementation details**: call counts, call order, private helpers or
  internal state shape. Anything that breaks on a harmless refactor.
- **Near-duplicates**: the same rule at the same seam with another literal.
- **Glue**: a pass-through, a one-line mapping, a route that parses and
  delegates. Test what it delegates to.
- **Someone else's code**: that zod parses, React renders or drizzle inserts.

Prefer one test at the right seam over the same rule re-checked through the
CLI, the route and the component.
[`plans/test-pruning.md`](./plans/test-pruning.md) applies this to
the existing suite.

## Component tests: rare, and only for the wiring

`apps/local` can render a real component in headless Chromium
(`*.browser.test.tsx`, Vitest browser mode). Most UI changes still need no
component test. Logic belongs in a reducer or a plain function, and you test
that directly in a node test. Write a component test only for:

- **The wiring** between DOM events and what they dispatch or call: which
  key, click or blur does what.
- **Browser-only behaviour** that a function can't reproduce: focus and blur
  ordering, keyboard handling, media elements, Web Audio, and effect lifecycle
  (mount, unmount, Strict Mode remount).

If you can pull the behaviour out into a function, do that and skip the
component test. One component test per behaviour, not one per component.

How to write one:

- Act like a user: find elements by role, label or text, and act through
  `userEvent` or the locator's `.click()` / `.fill()`.
- Assert what a user or the parent sees: the text shown, or the callback prop
  a parent receives.
- No snapshots, no class names, no internal state, no reaching into hooks.

[`lesson-title-editor.browser.test.tsx`](../apps/local/app/features/course-view/lesson-title-editor.browser.test.tsx)
is the model. The rename rule is unit tested in `lesson-title-editor.test.ts`.
The component test covers only the Enter/Escape-then-blur ordering, because a
function can't reproduce that.

Run one: `pnpm --filter @cvm/local test:browser -- path/to/x.browser.test.tsx`.
The script installs Playwright's Chromium first. That takes a second when it's
already installed, and downloads it once when it isn't.

## Good tests

Integration-style tests that exercise real code paths through public APIs. They
describe _what_ the system does, not _how_.

```typescript
// GOOD: Tests observable behavior through the public interface
test("createUser makes user retrievable", async () => {
  const user = await createUser({ name: "Alice" });
  const retrieved = await getUser(user.id);
  expect(retrieved.name).toBe("Alice");
});
```

- Test behavior users/callers care about
- Use the public API only
- Survive internal refactors
- One logical assertion per test

## Bad tests

```typescript
// BAD: Mocks internal collaborator, tests HOW not WHAT
test("checkout calls paymentService.process", async () => {
  const mockPayment = jest.mock(paymentService);
  await checkout(cart, payment);
  expect(mockPayment.process).toHaveBeenCalledWith(cart.total);
});

// BAD: Bypasses the interface to verify via database
test("createUser saves to database", async () => {
  await createUser({ name: "Alice" });
  const row = await db.query("SELECT * FROM users WHERE name = ?", ["Alice"]);
  expect(row).toBeDefined();
});
```

```typescript
// BAD: Test restates the implementation — the function IS the spec
test("pitchHref includes from param", () => {
  expect(pitchHref("abc")).toBe("/pitches/abc?from=deliverables");
});
```

Red flags:

- Mocking internal collaborators (your own classes/modules)
- Testing private methods
- Asserting on call counts/order of internal calls
- Test breaks when refactoring without behavior change
- Test name describes HOW not WHAT
- Verifying through external means (e.g. querying a DB) instead of through the interface
- Testing a trivial function (one-liner, simple mapping, string concatenation) where the test just mirrors the code — these tests add no confidence and break on any refactor
- Thin delegation tests for route handlers — when a route's only job is to parse input and call a service method, testing that it "delegates correctly" by mocking the service duplicates the route code in the test. The real behavior lives in the service; test that instead.

## Mocking at a boundary

Prefer SDK-style interfaces over generic fetchers at boundaries — each function
is independently mockable with a single return shape, no conditional logic in
test setup.

## Remotion renderer packages

**Never write an automated test against a Remotion renderer package's actual
render output** — not for the packages that exist today, not for any added
later. A real render boots Chromium, takes minutes, downloads a browser on a
cold machine, and asserts on pixels that a deliberate branding change is
supposed to move; the test then fails for the one reason that is not a bug.

What is still fair game, and where the confidence comes from instead:

- The renderer's **props schema** — pure schema validation, no Chromium. Test
  it; it is the contract every caller writes against.
- The **orchestration around the render** — the props a service builds, and the
  arguments it spawns the renderer with. Test that, with the renderer faked at
  the process boundary like any other external process.
- The **look** is checked by a human in Remotion Studio (`pnpm run studio`),
  not by a test.

## TDD workflow: vertical slices

Write one test, make it pass, then write the next. Writing every test first
produces tests that verify _imagined_ behavior and are insensitive to real
changes.

```
RED→GREEN: test1→impl1
RED→GREEN: test2→impl2
RED→GREEN: test3→impl3
```

Each test responds to what you learned from the previous cycle. Get to GREEN
before you refactor.
