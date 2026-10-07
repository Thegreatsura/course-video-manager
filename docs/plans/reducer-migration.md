# Reducer migration

Move the 24 files in `scripts/frontend-state-allowlist.json` onto the pattern in
[`FRONTEND_STATE.md`](../FRONTEND_STATE.md): a pure reducer for the surface,
events that are facts, effects that are data, and a thin effect runner. The work
is split into nine batches. Each batch is sized so one agent can ship it in one
PR.

The point is fewer tests as well as better code. **Every batch deletes the
component and hook tests its reducer tests make redundant**, and it adds no new
component test. Most of these files have no component tests today. That is not
because the logic is covered somewhere else. It is because rendering a
13-`useState` route to test it was too costly for anyone to do. Each batch adds
the reducer tests that should have existed and, where its section says so,
deletes the old tests.

## How the batches were ranked

Score per file = (`useState` calls + 2 × effects that set state + 2 × commits
whose subject mentions fix/bug/regress) × commits in the last 90 days, measured
on 2026-10-07 with `git log --follow`. A batch's score is the sum of its
files' scores. The diagram playground goes first even though batch 2 has a
higher sum. Its last two fixes (`aaac954c` "opening a diagram no longer writes
its head" and `ed906519` "a diagram that hasn't loaded can't be edited", both
2026-10-06) were state-lifecycle bugs, which is exactly the class of bug this
migration removes.

| File (under `apps/local/app/`)                                 | useState | effect sets state | fixes | commits 90d | score | batch |
| -------------------------------------------------------------- | -------: | ----------------: | ----: | ----------: | ----: | ----: |
| `routes/diagram-playground.$diagramId.tsx`                     |        8 |                 3 |     4 |           9 |   198 |     1 |
| `features/video-editor/video-editor.tsx`                       |        6 |                 0 |     1 |          22 |   176 |     2 |
| `routes/_app.courses.$courseId.publish.tsx`                    |        5 |                 1 |     2 |          16 |   176 |     4 |
| `components/app-sidebar.tsx`                                   |        5 |                 1 |     3 |          13 |   169 |     2 |
| `features/diagrams/palette/use-palette.ts`                     |        9 |                 3 |     1 |           6 |   102 |     8 |
| `features/video-posting/shorts-posting-modal.tsx`              |        5 |                 2 |     0 |           8 |    72 |     5 |
| `features/video-posting/post-page.tsx`                         |       10 |                 2 |     0 |           5 |    70 |     5 |
| `features/video-editor/preloadable-clip.tsx`                   |        2 |                 2 |     1 |           7 |    56 |     7 |
| `features/video-editor/components/recording-session-panel.tsx` |        4 |                 3 |     0 |           5 |    50 |     7 |
| `routes/_app.pitches.$pitchId.tsx`                             |        7 |                 1 |     0 |           5 |    45 |     6 |
| `routes/_app.videos.$videoId.social.tsx`                       |       13 |                 0 |     0 |           3 |    39 |     3 |
| `features/article-writer/use-context-model.ts`                 |        5 |                 0 |     0 |           7 |    35 |     3 |
| `features/animatic/animatic-comments.tsx`                      |        6 |                 0 |     0 |           5 |    30 |     6 |
| `features/lesson-writer/autofill-description-modal.tsx`        |        2 |                 2 |     0 |           5 |    30 |     6 |
| `features/video-posting/ai-hero-page.tsx`                      |        5 |                 2 |     0 |           3 |    27 |     9 |
| `routes/_app.videos.$videoId.post.tsx`                         |       13 |                 0 |     0 |           2 |    26 |     3 |
| `routes/_app.videos.$videoId.skills-changelog.tsx`             |       13 |                 0 |     0 |           2 |    26 |     3 |
| `routes/_app.videos.$videoId.ai-hero.tsx`                      |       13 |                 0 |     0 |           2 |    26 |     3 |
| `routes/_app.videos.$videoId.newsletter.tsx`                   |       13 |                 0 |     0 |           2 |    26 |     3 |
| `features/video-posting/social-page.tsx`                       |        5 |                 1 |     0 |           3 |    21 |     9 |
| `features/video-posting/skills-changelog-page.tsx`             |        4 |                 2 |     0 |           2 |    16 |     9 |
| `components/video-file-paste-modal.tsx`                        |        2 |                 2 |     0 |           2 |    12 |     6 |
| `components/capture-camera-modal.tsx`                          |        3 |                 3 |     0 |           1 |     9 |     6 |
| `features/video-editor/use-speech-detector.ts`                 |        1 |                 2 |     0 |           1 |     5 |     7 |

Refresh the counts with `node scripts/check-frontend-state.ts --report`.

## Every batch, the same definition of done

- The surface's decisions live in a `*-reducer.ts` that does not import React,
  using `useEffectReducer`, with the effect handlers in one hook.
- The reducer tests send real event sequences through `ReducerTester` and
  assert `getEffects()` as a whole list.
- **Deleted:** every component or hook test that checks a rule the reducer
  tests now cover. The tests named under each batch are the ones that exist
  today. Look again when you start, because new ones may have been added.
- The batch's entries in `scripts/frontend-state-allowlist.json` are deleted,
  or lowered if a file is still over the limit for a reason the PR explains.
  `pnpm run check` fails until this is done.
- No behavior change. The PR is a refactor plus tests, with nothing else in it.

## Batch 1 — Diagram playground lifecycle (score 198)

`routes/diagram-playground.$diagramId.tsx`. There are eight `useState`s:
`headStatus`, `pendingRestore`, `preserving`, `creating`, `editorConnected`,
`windowFocused`, `isFocusMode` and `refreshKey`. Three effects write them. This
is the load → ready → editing → restore lifecycle that broke twice on
2026-10-06. Fold it into a `diagramPlaygroundReducer` with events such as
`head-loaded`, `head-load-failed`, `snapshot-restore-requested`,
`editor-connected`, `window-blurred` and `create-clicked`, and effects such as
`save-head`, `restore-snapshot` and `create-diagram`. Write regression tests
for the two fixes first, as event sequences.

- Delete or trim: in `features/diagrams/head-autosaver.test.ts` (which runs a
  real tldraw store on real timers), keep the debounce and store-boundary cases
  and delete any case that checks a status transition the reducer now owns.

## Batch 2 — Modal bags: sidebar and video editor (score 345)

`components/app-sidebar.tsx` has five booleans: `isAddCourseOpen`,
`isAddVideoOpen`, `isSpacedeskOpen`, `sheetOpen` and `isCreatingDiagram`.
`features/video-editor/video-editor.tsx` has five `is…ModalOpen` booleans and
`suggestionState`. Only one modal can be open at a time, so each set becomes
one `openModal` union in a small reducer. The video editor's `suggestionState`
moves into the reducer as well. The sidebar's two earlier bugs (#1682, #1697)
came from doing work in an effect. Keep creating a diagram as an effect the
reducer declares from `create-diagram-clicked`.

- Delete: no component test renders either file today. Add none.

## Batch 3 — Writer context panel, five routes and one hook (score 178)

The five posting routes `_app.videos.$videoId.{post,social,ai-hero,newsletter,skills-changelog}.tsx`
each declare the same 13 `useState`s for the context panel: enabled files,
sections and transcript, plus the preview, add-link, file, paste and delete
modals. `features/article-writer/use-context-model.ts` holds the same state for
the Article Writer. Write one `contextPanelReducer` and use it in all six
places. This batch removes about 70 `useState` calls, and each one is a place
where the five routes could drift apart.

- Delete: there are no route or hook tests for this today. The reducer tests
  replace all five copies, so add no per-route tests.

## Batch 4 — Publish page (score 176)

`routes/_app.courses.$courseId.publish.tsx`: `bumpLevel`, `description`,
`includeTodoLessons`, `publishStarted` and `autofillUploadId`, plus an effect
that follows the upload. Make it a `publishPageReducer`. Starting a publish or
an autofill becomes an effect, and the upload manager's progress comes back as
events.

- Delete: no tests render this page.

## Batch 5 — Posting pages, part 1: post page and Shorts modal (score 142)

`features/video-posting/post-page.tsx` has 10 `useState`s:
`isGeneratingTitle`/`Description`, `confirmOverwriteField`,
`pendingGeneratedText`, `currentFieldText`, `isCheckingExport`,
`isConvertingShortLinks`, and others. `shorts-posting-modal.tsx` has
`postState`, `postedStatus`, generation and link conversion. Put the flow they
share, "generate text → confirm overwrite if there is text already → apply",
into a `generatedFieldReducer` that batch 9 reuses. The rest of each page
becomes a reducer of its own.

- Keep `post-page-validation.test.ts`, which tests pure validation. If the
  validation moves into the reducer, fold those cases into the reducer tests
  and delete the file.

## Batch 6 — Small modals and forms (score 126)

`routes/_app.pitches.$pitchId.tsx` (the pitch form fields and the
`saveState` autosave), `features/animatic/animatic-comments.tsx` (comment
open/draft/edit), `features/lesson-writer/autofill-description-modal.tsx`
(`seeded` written from an effect), `components/video-file-paste-modal.tsx` and
`components/capture-camera-modal.tsx` (the media stream lifecycle). Each one is
small and independent. If the PR gets too big, ship the first two and the last
three separately.

- Delete: no component tests exist for these five. The camera modal's
  `getUserMedia` stays inside an effect handler, and `stream-acquired` and
  `stream-failed` come back as events.

## Batch 7 — Video editor media sync (score 111)

`features/video-editor/preloadable-clip.tsx` (`preloadState`, overlay time),
`components/recording-session-panel.tsx` (elapsed timer, focus flags) and
`use-speech-detector.ts`. These are effects that copy `<video>`, timer and focus
events into local state. Make them dispatch facts (`clip-preloaded`,
`window-focused`, `speech-started`) into small reducers, or into
`videoStateReducer` where that state already lives. The elapsed timer gets
its time from a `tick` event that carries `at`, so the reducer never reads the
clock.

- Delete: none render these. `use-audio-boost.test.ts` and
  `use-ensure-obs-profile.test.ts` cover other hooks and stay.

## Batch 8 — Command palette (score 102)

`features/diagrams/palette/use-palette.ts` is already half migrated:
`navReducer` holds navigation, but `open`, `hasSelection`, `selectedIcon`,
`busy`, `recentIcons`, `components`, `diagramHits` and `searching` sit beside
it in nine `useState`s, and three effects write them. Grow `navReducer` into a
`paletteReducer` that owns all of it. Searching and loading the component list
become effects that report their results as events.

- `palette-nav.test.ts` becomes the base of the palette reducer tests, so
  rename it and grow it. Do not keep two files. `palette-model.test.ts`,
  `recent-icons.test.ts` and `grid-nav.test.ts` test pure helpers and stay.

## Batch 9 — Posting pages, part 2 (score 64)

`features/video-posting/ai-hero-page.tsx`, `social-page.tsx` and
`skills-changelog-page.tsx` reuse batch 5's `generatedFieldReducer` for SEO and
caption generation, and share the "check export, then store the slug or id"
flow with `post-page`. `justCopied` and `justCopiedAll` are presentational and
can stay as `useState` once the page is under the limit.

- Delete: no component tests exist for these pages.

## Not in a batch

- **`course-view-reducer.ts` modal booleans.** It is already a reducer, so the
  guard does not flag it. Its nine `is…ModalOpen` flags should become one
  `openModal` union, the same change as batch 2. Do that whenever someone is
  next working in that file.
- **The upload manager's snapshot-diff planner** (`planUploadReactions`). It
  works, it has tests, and it is the one documented exception to the pattern.
  Moving it onto `exec` would also make most of
  `upload-manager-integration.test.ts` redundant, so it would make a
  reasonable batch 10 if churn there picks up.
- **`upload-row.test.tsx`** (285 lines, rendered). A rendered test of row
  labels and progress-bar visibility. Once those decisions are selectors in
  `upload-selectors.ts`, most of its cases can become selector tests. This
  belongs to the test-pruning plan, not this one.
