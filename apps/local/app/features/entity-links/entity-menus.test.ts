import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The guard behind "Every entity menu can copy its link and ID"
 * (CODING_STANDARDS.md). Every file under `app/` that opens a context menu or
 * a dropdown must render `CopyEntityLinkItems` — or be listed here, with the
 * reason its menus are not about an entity. A new menu fails this test until
 * it makes that choice.
 */
const NOT_ENTITY_MENUS: Record<string, string> = {
  "components/effort-selector.tsx": "picks a value for a Pitch field",
  "components/priority-selector.tsx": "picks a value for a Pitch field",
  "features/article-writer/write-mode-dropdown.tsx": "picks the writer's mode",
  "features/article-writer/write-toolbar.tsx":
    "copies the writer's conversation or document text",
  "features/article-writer/document-panel.tsx":
    "copies or writes out the writer's document text",
  "features/deliverables-calendar/deliverable-form.tsx":
    "a picker inside the Deliverable form",
  "features/deliverables-calendar/week-actions-menu.tsx":
    "acts on a calendar week, not an entity",
  "features/video-posting/ai-hero-page.tsx": "an image-upload picker",
  "features/video-posting/skills-changelog-helpers.tsx":
    "an image-upload picker",
};

const APP_ROOT = join(import.meta.dirname, "..", "..");
const MENU = /<(ContextMenuContent|DropdownMenuContent)\b/;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")
      ? [path]
      : [];
  });
}

const menuFiles = tsxFiles(APP_ROOT)
  .map((path) => relative(APP_ROOT, path).split("\\").join("/"))
  // The shadcn primitives themselves.
  .filter((path) => !path.startsWith("components/ui/"))
  .filter((path) => MENU.test(readFileSync(join(APP_ROOT, path), "utf8")));

describe("entity menus", () => {
  it("finds the app's menus (the scan is not silently empty)", () => {
    expect(menuFiles.length).toBeGreaterThan(20);
  });

  it("every menu offers Copy Link / Copy ID, or says why it is not an entity menu", () => {
    const missing = menuFiles.filter(
      (path) =>
        !(path in NOT_ENTITY_MENUS) &&
        !readFileSync(join(APP_ROOT, path), "utf8").includes(
          "<CopyEntityLinkItems"
        )
    );
    expect(
      missing,
      "Render <CopyEntityLinkItems entity={…} menu=… /> in these menus, or add the file to NOT_ENTITY_MENUS with the reason it is not about an entity"
    ).toEqual([]);
  });

  it("lists no stale exemptions", () => {
    const stale = Object.keys(NOT_ENTITY_MENUS).filter(
      (path) => !menuFiles.includes(path)
    );
    expect(stale, "These files no longer open a menu; drop them").toEqual([]);
  });
});
