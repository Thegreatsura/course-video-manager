import { EntityMenuContent } from "@/features/action-menu/action-menu";
import { STANDARD_ACTIONS } from "@/features/action-menu/standard-actions";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import type { Lesson } from "./course-view-types";
import { computeSectionSwap } from "./section-grid-utils";

export function SectionContextMenuItems({
  courseId,
  section,
  lessons,
  allSectionIds,
  isReadOnly,
  dispatch,
  submitEvent,
}: {
  courseId: string;
  section: { id: string; title: string; description?: string | null };
  lessons: Lesson[];
  allSectionIds: string[];
  isReadOnly: boolean;
  dispatch: (action: courseViewReducer.Action) => void;
  submitEvent: (event: CourseEditorEvent) => void;
}) {
  const canEdit = !isReadOnly;
  const swapUp = computeSectionSwap(allSectionIds, section.id, "up");
  const swapDown = computeSectionSwap(allSectionIds, section.id, "down");

  return (
    <EntityMenuContent
      menu="context"
      entity={{ type: "section", id: section.id, courseId }}
      groups={{
        edit: [
          canEdit && {
            ...STANDARD_ACTIONS.rename,
            onSelect: () =>
              dispatch({ type: "set-edit-section-id", sectionId: section.id }),
          },
        ],
        create: [
          canEdit && {
            ...STANDARD_ACTIONS.add,
            label: "Add Lesson",
            opensDialog: true,
            onSelect: () =>
              dispatch({
                type: "set-add-lesson-section-id",
                sectionId: section.id,
              }),
          },
          canEdit && {
            ...STANDARD_ACTIONS.add,
            label: "Add Section Before",
            opensDialog: true,
            onSelect: () =>
              dispatch({
                type: "set-insert-section",
                adjacentSectionId: section.id,
                position: "before",
              }),
          },
          canEdit && {
            ...STANDARD_ACTIONS.add,
            label: "Add Section After",
            opensDialog: true,
            onSelect: () =>
              dispatch({
                type: "set-insert-section",
                adjacentSectionId: section.id,
                position: "after",
              }),
          },
        ],
        move: [
          canEdit && {
            ...STANDARD_ACTIONS.moveUp,
            disabled: !swapUp,
            onSelect: () => {
              if (swapUp)
                submitEvent({ type: "reorder-sections", sectionIds: swapUp });
            },
          },
          canEdit && {
            ...STANDARD_ACTIONS.moveDown,
            disabled: !swapDown,
            onSelect: () => {
              if (swapDown)
                submitEvent({ type: "reorder-sections", sectionIds: swapDown });
            },
          },
        ],
        copy: [
          lessons.length > 0 && {
            ...STANDARD_ACTIONS.copy,
            label: "Copy Transcript",
            opensDialog: true,
            onSelect: () =>
              dispatch({
                type: "open-copy-section-transcript",
                sectionTitle: section.title,
                sectionDescription: section.description ?? undefined,
                lessons,
              }),
          },
        ],
        danger: [
          canEdit && {
            ...STANDARD_ACTIONS.delete,
            // Archives the Section. With Lessons in it, a dialog confirms first.
            opensDialog: lessons.length > 0,
            onSelect: () => {
              if (lessons.length === 0) {
                submitEvent({ type: "archive-section", sectionId: section.id });
              } else {
                dispatch({
                  type: "set-archive-section-id",
                  sectionId: section.id,
                });
              }
            },
          },
        ],
      }}
    />
  );
}
