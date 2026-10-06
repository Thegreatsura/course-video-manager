import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { labelProblems } from "./action-menu-model";
import allowlist from "./raw-menus-allowlist.json";

/**
 * The guard behind CODING_STANDARDS.md's "Action menus". Every action menu in
 * `app/` renders through `EntityMenuContent` (or `ActionMenuContent`, for a
 * menu not about an entity), which owns the order, the separators, the
 * destructive styling, the ellipsis and Copy Link / Copy ID. Hand-built menu
 * code — a raw `ContextMenuItem`, `DropdownMenuSeparator`… — is held to a
 * shrink-only allowlist, `raw-menus-allowlist.json`, while
 * docs/plans/action-menus.md migrates it: a new hit fails, and so does an
 * entry whose count is higher than its file's, so a migration must also
 * lower (or drop) its entry.
 */

/** Value pickers: they choose a value, they do not act on a thing. Exempt for good. */
const PICKERS: Record<string, string> = {
  "components/effort-selector.tsx": "picks a Pitch's effort",
  "components/priority-selector.tsx": "picks a Pitch's priority",
  "features/article-writer/write-mode-dropdown.tsx": "picks the writer's mode",
  "features/deliverables-calendar/deliverable-form.tsx":
    "a multi-select picker inside the Deliverable form",
};

/**
 * Action menus that are not about an entity, so carry no Copy Link / Copy ID.
 * Only these files may use `ActionMenuContent`.
 */
const NOT_ENTITY_MENUS: Record<string, string> = {
  "features/beats/beat-list.tsx":
    "the Add Beat button picks the new Beat's kind; the Beat rows use EntityMenuContent",
  "features/article-writer/write-toolbar.tsx":
    "copies the writer's conversation or document text",
  "features/article-writer/document-panel.tsx":
    "copies or writes out the writer's document text",
  "features/deliverables-calendar/deliverable-card.tsx":
    "its date area's menu acts on a calendar day, not an entity",
  "features/deliverables-calendar/week-actions-menu.tsx":
    "acts on a calendar week, not an entity",
  "features/video-posting/skills-changelog-helpers.tsx":
    "an image-upload chooser",
};

const APP_ROOT = join(import.meta.dirname, "..", "..");

/** Hand-built menu parts. The root and the Trigger stay raw; everything inside is the primitive's job. */
const RAW =
  /<(?:(?:ContextMenu|DropdownMenu)(?:Content|Item|CheckboxItem|RadioItem|RadioGroup|Sub|SubTrigger|SubContent|Separator|Label|Group|Shortcut)|CopyEntityLinkItems)\b/g;
const ENTITY_MENU = /<EntityMenuContent\b/g;
const ACTION_MENU = /<ActionMenuContent\b/g;
const OPENS_MENU = /<(ContextMenuContent|DropdownMenuContent)\b/g;
/** A label written as a string literal: `label: "…"`. */
const LITERAL_LABEL = /\blabel:\s*"([^"]*)"/g;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")
      ? [path]
      : [];
  });
}

const count = (source: string, pattern: RegExp) =>
  source.match(pattern)?.length ?? 0;

const files = tsxFiles(APP_ROOT)
  .map((path) => relative(APP_ROOT, path).split("\\").join("/"))
  // The shadcn primitives, and the action-menu primitive built on them.
  .filter((path) => !path.startsWith("components/ui/"))
  .filter((path) => !path.startsWith("features/action-menu/"))
  .map((path) => {
    const source = readFileSync(join(APP_ROOT, path), "utf8");
    return {
      path,
      source,
      raw: count(source, RAW),
      entityMenus: count(source, ENTITY_MENU),
      actionMenus: count(source, ACTION_MENU),
      opensRawMenu: count(source, OPENS_MENU) > 0,
    };
  });

const allowed: Record<string, { count: number; reason: string }> = allowlist;

describe("action menus", () => {
  it("finds the app's menus (the scan is not silently empty)", () => {
    expect(
      files.filter((f) => f.raw + f.entityMenus + f.actionMenus > 0).length
    ).toBeGreaterThan(20);
  });

  it("builds no new menu by hand (raw-menus-allowlist.json only shrinks)", () => {
    const over = files
      .filter((f) => !(f.path in PICKERS))
      .filter((f) => f.raw > (allowed[f.path]?.count ?? 0))
      .map((f) => `${f.path}: ${f.raw} raw menu parts`);
    expect(
      over,
      "Render these menus with <EntityMenuContent> / <ActionMenuContent> (features/action-menu) instead of raw ContextMenu*/DropdownMenu* parts"
    ).toEqual([]);
  });

  it("lists no more raw menu parts than a file has", () => {
    const stale = Object.entries(allowed)
      .filter(([path, entry]) => {
        const file = files.find((f) => f.path === path);
        return (file?.raw ?? 0) < entry.count;
      })
      .map(([path]) => path);
    expect(
      stale,
      "These files have fewer raw menu parts than raw-menus-allowlist.json says — lower their count, or drop the entry at 0"
    ).toEqual([]);
  });

  it("uses ActionMenuContent only for menus that are not about an entity", () => {
    const misused = files
      .filter((f) => f.actionMenus > 0 && !(f.path in NOT_ENTITY_MENUS))
      .map((f) => f.path);
    expect(
      misused,
      "Use <EntityMenuContent entity={…}> so the menu can copy its link and ID, or add the file to NOT_ENTITY_MENUS with the reason"
    ).toEqual([]);
  });

  it("gives every hand-built entity menu Copy Link / Copy ID until it migrates", () => {
    const missing = files
      .filter((f) => f.opensRawMenu)
      .filter((f) => !(f.path in PICKERS) && !(f.path in NOT_ENTITY_MENUS))
      .filter((f) => !f.source.includes("<CopyEntityLinkItems"))
      .map((f) => f.path);
    expect(
      missing,
      "Move these menus onto <EntityMenuContent>, which adds Copy Link / Copy ID itself"
    ).toEqual([]);
  });

  it("writes menu labels in Title Case, with no hand-written ellipsis", () => {
    const problems = files
      .filter((f) => f.entityMenus + f.actionMenus > 0)
      .flatMap((f) =>
        [...f.source.matchAll(LITERAL_LABEL)].flatMap(([, label]) =>
          labelProblems(label ?? "").map(
            (problem) => `${f.path}: "${label}" ${problem}`
          )
        )
      );
    expect(problems).toEqual([]);
  });

  it("lists no stale exemptions", () => {
    const menuPaths = files
      .filter((f) => f.raw + f.entityMenus + f.actionMenus > 0)
      .map((f) => f.path);
    const stale = [
      ...Object.keys(PICKERS),
      ...Object.keys(NOT_ENTITY_MENUS),
    ].filter((path) => !menuPaths.includes(path));
    expect(stale, "These files no longer open a menu; drop them").toEqual([]);
  });
});
