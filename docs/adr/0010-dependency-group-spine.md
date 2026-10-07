# Dependency Group spine drawn from measured icon positions

The compact course view marks **Dependency Groups** — contiguous runs of dependency-linked lessons within a section — with dashed vertical lines connecting adjacent lesson-type icons, plus extra vertical spacing separating each group from its neighbours. The lines are drawn by a `MeasuredSpine` overlay (`dep-group-spine.tsx`) that **measures the rendered icon positions** (`getBoundingClientRect`) and draws each segment between two real icon centres, re-measuring via a `ResizeObserver` on any reflow. Grouping is computed per-section in `section-grid.tsx` (`computeDependencyGroupConnections` / `groupIntoRuns`).

## Scope

- **Compact view only.** Expanded view passes no group connections, so every run is a lone lesson and nothing is drawn.
- **Suppressed under any active filter/search.** A filtered list no longer reflects true adjacency, so drawing adjacency lines would lie. Grouping is computed only when `!hasActiveFilters`.
- **Renders in read-only / published versions.** The treatment is a derived reading aid, never stored; it shows wherever the compact view shows.
- **Ghost Lessons participate** as ordinary members of the walk.
- The grouping rule itself (within-section, contiguous-only, directed-backward, direct-deps-only) is specified under **Dependency Group** in `GLOSSARY.md`.

## Why this shape

- **Fixed-pixel line heights cannot survive title wrapping** — the deciding constraint. The icon sits in a flex row whose height changes when a lesson title wraps to two lines, so any hard-coded segment height drifts off the icon centres. Several fixed-height attempts (18px, 24px) all broke the moment a row grew. Measuring the actual icon rects is the only approach that stays anchored.
- **A bounded settle loop for first paint, plus a `ResizeObserver` and a data-derived re-validate key, over a one-shot measure.** Three distinct timing problems, three mechanisms:
  - _First load._ A single measure (even with a couple of speculative re-measures) routinely runs before the rows are positioned — data is still streaming in, the web font hasn't swapped, thumbnails are still loading — so the icon rects are collapsed, every segment is dropped, and nothing reliably re-fires. Instead the effect polls each animation frame until every pair resolves to a drawable segment _and_ the result holds steady for a few frames, capped at ~2s so a pair that can never resolve doesn't spin. This is what fixed the line failing to appear on load.
  - _Later reflows_ (a title rewraps, the window resizes, a late image shifts rows) are caught by a `ResizeObserver` on the list container.
  - _In-place edits that don't change the container box_ (a reorder that leaves the list's height unchanged) wouldn't trip the observer and often leave `spinePairs` identical, so neither would re-run the effect. The section instead hashes its rendered items (`JSON.stringify(filteredLessons)`) into a `revalidateKey` that the effect depends on, so any reorder / title edit / dependency change restarts the settle loop deterministically. A `MutationObserver` was tried for this but fires on unrelated subtree churn (thumbnail loads); the data key is precise.
- **Overlay keyed off a `[data-dep-icon]` attribute** rather than threading refs through `SortableLessonItem` — the spine lives entirely in the list container and finds icons by selector, so the lesson item stays unaware of grouping (it only tags its icon).
- **The overlay measures from its OWN element (`overlayRef`), deriving the list container as `overlay.parentElement`.** It must not read a ref handed down from the parent list. React attaches host refs and runs layout effects bottom-up, so a ref on the parent `<div>` is still `null` when the overlay's own layout effect fires on mount — the effect early-returns before measuring and never draws. It only recovered on a later re-render (streamed data / an edit) once the parent had committed, which is what made the line look "temperamental" rather than simply broken. The settle loop's first-load handling (above) is real, but it could never run while the container ref was null; the ref fix is what actually makes the line appear on a clean load. Basing coords on the overlay box (not the container's) also removes a latent skew equal to the list's padding.
- **Spacing tuned to 20px (`mt-5/mb-5`), edges zeroed, lone lessons untouched** — the inter-group gap must stay comfortably larger than the ~14px intra-group row spacing or the blocks stop reading as distinct. Adjacent group margins collapse so two touching groups share one gap; `first:/last:` zero the list's outer edges.

## Known limitations

- During an active drag the overlay does not track the moving icon; segments settle on drop.
- The overlay is the container's last DOM child, so the final run is not technically `:last-child` — a benign edge case for `last:mb-0`.
