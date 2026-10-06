# Action menus: audit and migration plan

The rules are in [`CODING_STANDARDS.md`, "Action menus"](../../CODING_STANDARDS.md#action-menus).
This file is the audit that motivated them and the migration still in flight.
Delete it when `apps/local/app/features/action-menu/raw-menus-allowlist.json`
is empty (`{}`).

## The primitive

`apps/local/app/features/action-menu/`:

| File                       | What it is                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `action-menu.tsx`          | `EntityMenuContent` (entity menus: adds Copy Link / Copy ID) and `ActionMenuContent` (menus not about an entity). Replaces `ContextMenuContent` / `DropdownMenuContent`. |
| `action-menu-model.ts`     | `ActionMenuGroups` (the caller's declaration), `layoutActionMenu` (order, separators, destructive, ellipsis) and `labelProblems` (Title Case check).                     |
| `standard-actions.ts`      | `STANDARD_ACTIONS`: one label and icon per common action.                                                                                                                |
| `action-menus.test.ts`     | The guard. Raw `ContextMenu*` / `DropdownMenu*` parts are held to the allowlist; literal labels must pass `labelProblems`.                                               |
| `raw-menus-allowlist.json` | Shrink-only: raw menu parts per not-yet-migrated file.                                                                                                                   |

Reference migrations: `features/course-view/section-context-menu.tsx` (one door,
hide vs disable, conditional confirm) and `features/animatic/animatic-comments.tsx`
(`CommentItem`: one `groups` object rendered from the right-click AND the `…`
button).

## How to migrate a menu

1. Build the entity's `groups: ActionMenuGroups` **once** — a hook or function
   beside the entity (`useVideoMenuGroups(…)`), not inside one menu — and
   render it from every door: `<EntityMenuContent menu="context" …>` on the
   right-click, `menu="dropdown"` on the Actions / `…` button.
2. Sort each action into its group by what it does, not where it sat. Take
   labels and icons from `STANDARD_ACTIONS`; drop the menu's own noun ("Rename",
   not "Rename Video"); set `opensDialog` instead of typing "…".
3. Hide what does not apply (`cond && {…}`); disable what is blocked right now
   (`disabled`). Put destructive actions in `danger`; give an irreversible one a
   confirmation if it lacks one.
4. Delete the hand-built items, then lower or remove the file's entry in
   `raw-menus-allowlist.json`. Run
   `pnpm --filter @cvm/local test -- app/features/action-menu`.
5. Verify in the browser (`verify-cvm`): right-click and open the dropdown;
   the two lists match.

`EntityMenuContent` deliberately has no escape hatch for arbitrary JSX. If a
menu needs something the model lacks (a radio picker inside an action menu, a
trailing warning badge), extend `action-menu-model.ts` with a test, in its own
small PR, rather than leaving the menu hand-built.

**Merge conflicts.** Every batch edits `raw-menus-allowlist.json`. Each touches
only its own files' entries, so a conflict there is always resolved by keeping
both sides' deletions.

## Batches

Each batch owns a disjoint set of files, so the five can run in parallel. One
entity's menus live in one batch, because rule 1 (one list, two doors) needs a
single owner for the shared `groups`.

### Batch 1 — Course view: Course, Lesson (3 menus)

| File                                           | Menus | Notes                                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `components/app-sidebar.tsx`                   | 1     | Course right-click: Copy Link/ID + "Archive" (immediate). Must offer the same list as the Course Actions dropdown.                                                                                                                                                             |
| `features/course-view/actions-menu.tsx`        | 1     | Course "Actions" dropdown. Two-line items with descriptions and `mr-2` icons; Copy Link/ID in the middle; "Archive Course" not in danger; "Purge Exports" red via `className`. Version/Storage groups become `run`/`danger`. Share one `useCourseMenuGroups` with the sidebar. |
| `features/course-view/lesson-context-menu.tsx` | 1     | Lesson right-click. The per-Video "open" items belong in `open`; Mark as TODO/Done → `edit`; Move to Section submenu → `move`; Delete already confirms. Lesson has no dropdown door yet.                                                                                       |

### Batch 2 — Video, everywhere it is listed (9 menus)

The Video menu is hand-copied four ways and has drifted (course view, /videos,
archived /videos, /shorts, plus the editor's two Actions dropdowns). Build one
`useVideoMenuGroups` and let each surface hide what does not apply there.

| File                                                           | Menus | Notes                                                                                                                                                                                                                                           |
| -------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features/course-view/video-context-menu.tsx`                  | 1     | Sentence-case "Autofill description/chapters", "Add beat"; Delete has **no confirm** here but confirms on /videos and /shorts. Uses `AddBeatSubMenu` — build the leaves from `BEAT_KINDS` directly so Batch 4 can rework `beat-menu-items.tsx`. |
| `features/course-view/export-status.tsx`                       | 0     | `PurgeExportMenuItem` (raw item, no confirm). Fold into the shared groups; Purge Export is irreversible, so it confirms.                                                                                                                        |
| `routes/_app.videos._index.tsx`                                | 2     | Active + archived lists. Archived menu has **no Copy Link/ID**, no Unarchive, no separators; Purge Export inlined twice.                                                                                                                        |
| `routes/_app.shorts._index.tsx`                                | 1     | Copy Link/ID mid-menu; three Post items share one icon.                                                                                                                                                                                         |
| `features/video-editor/components/actions-dropdown.tsx`        | 1     | Editor "Actions": 20+ items, mixed casing, "Copy" submenu vs "Copy Video" (= Duplicate), "Export" submenu containing "Export". Over the length limit: move rare items to the page.                                                              |
| `features/video-editor/components/studio-actions-dropdown.tsx` | 1     | Studio "Actions": copies Render/Export from the above, Export flat here.                                                                                                                                                                        |
| `features/video-editor/components/shared-action-items.tsx`     | 0     | Dropdown-only Rename/Copy Video/Reveal items. Becomes part of the shared groups.                                                                                                                                                                |
| `features/video-editor/components/transcript-word-actions.tsx` | 0     | `RetranscribeAllClipsItem` (raw item).                                                                                                                                                                                                          |
| `features/video-editor/components/editor-compact-header.tsx`   | 1     | Breadcrumb right-click: Copy Link/ID only. Should be the full Video list.                                                                                                                                                                       |
| `routes/_app.videos.$videoId.tsx`                              | 2     | Breadcrumb right-click (Copy only — should be the full Video list) and the "Next" button's "Add New Video" (acts on the Lesson; `ActionMenuContent` is wrong here, use the Lesson entity).                                                      |

### Batch 3 — Video editor timeline: Clip, Chapter (4 menus)

| File                                                   | Menus | Notes                                                                                                                                                                            |
| ------------------------------------------------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features/video-editor/components/clip-item.tsx`       | 1     | 25 items, 8 separators. Insert/Add Chapter/Move/Create Video from Selection/Delete copy-pasted with chapter-item. Zoom hidden but Re-transcribe disabled for the same condition. |
| `features/video-editor/components/chapter-item.tsx`    | 1     | Shares most items with clip-item: extract shared timeline groups.                                                                                                                |
| `features/video-editor/components/reference-panel.tsx` | 2     | Chapter menu orders Edit before Add Chapter (timeline does the reverse); Clip menu is a subset. Delete archives with no confirm.                                                 |

### Batch 4 — Pitches, Beats, Diagrams, Thumbnails (9 menus)

| File                                                      | Menus | Notes                                                                                                                                                               |
| --------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routes/_app.pitches.$pitchId.tsx`                        | 2     | Pitch `…` dropdown ("New video", "Delete pitch": sentence case, no confirm) and the linked-Video menu ("Remove from pitch"). Share Pitch groups with the index.     |
| `routes/_app.pitches._index.tsx`                          | 1     | Pitch card right-click: only Delete, duplicated from the dropdown, not disabled while pending.                                                                      |
| `features/beats/beat-list.tsx` + `beat-menu-items.tsx`    | 3     | "+ Add beat" dropdown (rebuilds the kind list without descriptions), read-only and editable Beat menus. Sentence case throughout; Copy Link/ID after "Change kind". |
| `features/diagrams/diagram-rail.tsx`                      | 1     | "Copy contents" (sentence case) with no separator before Copy Link; Delete archives with no confirm.                                                                |
| `routes/_app.videos.$videoId.thumbnails.tsx`              | 1     | Thumbnail menu; native `window.confirm`; `onClick` instead of `onSelect`. Share groups with the post page.                                                          |
| `features/video-posting/post-page-thumbnail-selector.tsx` | 1     | Same Thumbnail, different list ("Copy to clipboard", "Edit" as a link).                                                                                             |

### Batch 5 — Deliverables calendar and non-entity menus (12 menus)

| File                                                   | Menus | Notes                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features/deliverables-calendar/deliverable-card.tsx`  | 4     | Deliverable menu ("Edit…" opens an inline form; Status submenu marks the current one by disabling it — use `checked`; "Delete" archives), Course and Pitch badge menus mix a radio picker into an action menu (extend the model, or split the picker out), date-area "Add new for …". |
| `features/deliverables-calendar/week-actions-menu.tsx` | 1     | Not an entity → `ActionMenuContent`. Sentence case.                                                                                                                                                                                                                                   |
| `features/article-writer/document-panel.tsx`           | 2     | Copy as Markdown/Rich Text and Readme menus, duplicated with write-toolbar. "Write to …/readme.md" overwrites a file with no warning.                                                                                                                                                 |
| `features/article-writer/write-toolbar.tsx`            | 3     | Same two menus again plus Copy Conversation. Share one implementation with document-panel.                                                                                                                                                                                            |
| `features/video-posting/ai-hero-page.tsx`              | 1     | Inlines a copy of `ImageUploadDropdown` instead of importing it.                                                                                                                                                                                                                      |
| `features/video-posting/skills-changelog-helpers.tsx`  | 1     | `ImageUploadDropdown`. "Upload and delete local files" is destructive with no confirm.                                                                                                                                                                                                |

### Exempt for good: value pickers (4)

`components/effort-selector.tsx`, `components/priority-selector.tsx`,
`features/article-writer/write-mode-dropdown.tsx`,
`features/deliverables-calendar/deliverable-form.tsx` — listed in the guard's
`PICKERS`. (Effort and Priority mark the current value with `bg-accent` rather
than radio items; worth fixing, but not as part of this plan.)

## Audit summary (October 2026)

45 menu contents in 31 files: 41 action menus, 4 pickers. Context and dropdown
shared their items in exactly one place (the Animatic comment menu). Across the
rest:

- **Order.** Copy Link/ID sat first in most menus, mid-menu in five, and after
  the primary actions in three. The same entity's actions came in different
  orders on different pages (Video: four orders).
- **Casing.** Title Case and sentence case mixed, often inside one menu
  ("Edit Script" beside "Autofill chapters").
- **Ellipsis.** One item had one ("Edit…", which opens no dialog); none of the
  ~20 items that do open a dialog did.
- **Destructive.** Styled three ways (`variant`, `className`, none). Delete
  confirmed on /videos but not in the course view; "Delete" often archived;
  Archive Course and the sidebar Archive were not styled at all.
- **Hidden vs disabled.** No rule: clip Re-transcribe disabled and Zoom hidden
  for the same condition; Studio's Post items disabled where Render was hidden.
- **Vocabulary.** "Copy" meant both the clipboard and Duplicate; "Add Video",
  "Add New Video" and "New video" for one action; "Rename" vs "Rename Video".
- **Icons.** `w-4 h-4`, `size-4`, `size-3.5`, `w-3.5`, plus `mr-2` that doubles
  the primitive's own gap; two menus with descriptions under every item.
- **Duplication.** Video menu ×4, Clip/Chapter, Copy-as/Readme menus ×2, the
  image-upload dropdown ×2, the Beat kind list ×2.
