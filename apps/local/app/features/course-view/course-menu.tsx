import {
  EntityMenuContent,
  type MenuDoor,
} from "@/features/action-menu/action-menu";
import type { ActionMenuGroups } from "@/features/action-menu/action-menu-model";
import { STANDARD_ACTIONS } from "@/features/action-menu/standard-actions";
import { Archive, FileText, FileX, Upload } from "lucide-react";

/** Every action the Course menu offers. The door that renders the menu decides how each one runs. */
export type CourseMenuAction =
  | "preview-changelog"
  | "view-archived-lessons"
  | "rename"
  | "unarchive"
  | "duplicate"
  | "export"
  | "publish"
  | "copy-transcript"
  | "archive"
  | "purge-exports";

/**
 * What the menu needs to know about the Course to decide what to hide and
 * what to disable. A door that cannot know a fact (the sidebar has only the
 * Course's id) leaves it out, and the action shows enabled; the course page,
 * which runs it, knows.
 */
export interface CourseMenuFacts {
  id: string;
  archived: boolean;
  /** False while an older, read-only Version is selected. */
  isLatestVersion: boolean;
  hasVersion?: boolean;
  hasPreviousVersion?: boolean;
  hasLessons?: boolean;
}

/** The Course's actions, one list for every door (CODING_STANDARDS.md, "Action menus"). */
export function courseMenuGroups(
  course: CourseMenuFacts,
  run: (action: CourseMenuAction) => void
): ActionMenuGroups {
  return {
    open: [
      {
        label: "Preview Changelog",
        icon: FileText,
        disabled: course.hasPreviousVersion === false,
        onSelect: () => run("preview-changelog"),
      },
      // Archived Lessons can only come back into the Draft.
      course.isLatestVersion && {
        label: "View Archived Lessons",
        icon: Archive,
        onSelect: () => run("view-archived-lessons"),
      },
    ],
    edit: [
      {
        ...STANDARD_ACTIONS.rename,
        opensDialog: true,
        onSelect: () => run("rename"),
      },
      course.archived && {
        ...STANDARD_ACTIONS.unarchive,
        onSelect: () => run("unarchive"),
      },
    ],
    create: [
      !course.archived && {
        ...STANDARD_ACTIONS.duplicate,
        opensDialog: true,
        onSelect: () => run("duplicate"),
      },
    ],
    run: [
      course.isLatestVersion && {
        ...STANDARD_ACTIONS.export,
        onSelect: () => run("export"),
      },
      course.isLatestVersion && {
        label: "Publish",
        icon: Upload,
        // Opens the publish page, which reviews the changes before anything ships.
        opensDialog: true,
        onSelect: () => run("publish"),
      },
    ],
    copy: [
      {
        ...STANDARD_ACTIONS.copy,
        label: "Copy Transcript",
        opensDialog: true,
        disabled: course.hasLessons === false,
        onSelect: () => run("copy-transcript"),
      },
    ],
    danger: [
      !course.archived && {
        ...STANDARD_ACTIONS.archive,
        onSelect: () => run("archive"),
      },
      course.hasVersion !== false && {
        label: "Purge Exports",
        icon: FileX,
        // A dialog confirms first: purged files are gone from disk.
        opensDialog: true,
        onSelect: () => run("purge-exports"),
      },
    ],
  };
}

/** The Course menu, from either door: the sidebar's right-click or the course page's Actions button. */
export function CourseMenuContent({
  menu,
  course,
  run,
  align,
}: {
  menu: MenuDoor;
  course: CourseMenuFacts;
  run: (action: CourseMenuAction) => void;
  align?: "start" | "center" | "end";
}) {
  return (
    <EntityMenuContent
      menu={menu}
      align={align}
      entity={{ type: "course", id: course.id }}
      groups={courseMenuGroups(course, run)}
    />
  );
}

/**
 * Actions that need the course page (its dialogs, its selected Version). The
 * sidebar sends them there as a `CourseMenuIntent`; the page runs them on arrival.
 */
const PAGE_ACTIONS: ReadonlySet<CourseMenuAction> = new Set([
  "rename",
  "duplicate",
  "export",
  "copy-transcript",
  "purge-exports",
]);

/** Navigation state the sidebar hands the course page. */
export interface CourseMenuIntent {
  courseMenuAction: CourseMenuAction;
}

export function readCourseMenuIntent(state: unknown): CourseMenuAction | null {
  if (typeof state !== "object" || state === null) return null;
  if (!("courseMenuAction" in state)) return null;
  const action = state.courseMenuAction;
  return [...PAGE_ACTIONS].find((known) => known === action) ?? null;
}
