import { isTodoLesson } from "@cvm/core/lib/authoring-status";
import { EntityMenuContent } from "@/features/action-menu/action-menu";
import { STANDARD_ACTIONS } from "@/features/action-menu/standard-actions";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import type { Lesson, Section } from "./course-view-types";
import type { useNavigate } from "react-router";
import {
  CheckCircle2,
  FileText,
  FileVideo,
  FolderInput,
  ListTodo,
} from "lucide-react";

export function LessonContextMenuContent({
  courseId,
  lesson,
  section,
  isReadOnly,
  compact,
  navigate,
  allSections,
  dispatch,
  submitEvent,
  startEditingTitle,
  startEditingDescription,
}: {
  courseId: string;
  lesson: Lesson;
  section: Section;
  isReadOnly: boolean;
  compact?: boolean;
  navigate: ReturnType<typeof useNavigate>;
  allSections: { id: string; path: string }[];
  dispatch: (action: courseViewReducer.Action) => void;
  submitEvent: (event: CourseEditorEvent) => void;
  startEditingTitle: () => void;
  startEditingDescription: () => void;
}) {
  const otherSections = allSections.filter((s) => s.id !== section.id);
  const canEdit = !isReadOnly;

  return (
    <EntityMenuContent
      menu="context"
      entity={{
        type: "lesson",
        id: lesson.id,
        courseId,
        sectionId: section.id,
      }}
      groups={{
        open: compact
          ? lesson.videos.map((video) => ({
              label: video.title,
              icon: FileVideo,
              onSelect: () => void navigate(`/videos/${video.id}/edit`),
            }))
          : [],
        edit: [
          canEdit && {
            ...STANDARD_ACTIONS.rename,
            onSelect: startEditingTitle,
          },
          canEdit &&
            compact && {
              label: "Edit Description",
              icon: FileText,
              onSelect: startEditingDescription,
            },
          canEdit &&
            (isTodoLesson(lesson)
              ? {
                  label: "Mark as Done",
                  icon: CheckCircle2,
                  onSelect: () =>
                    submitEvent({
                      type: "set-lesson-authoring-status",
                      lessonId: lesson.id,
                      status: "done",
                    }),
                }
              : {
                  label: "Mark as TODO",
                  icon: ListTodo,
                  onSelect: () =>
                    submitEvent({
                      type: "set-lesson-authoring-status",
                      lessonId: lesson.id,
                      status: "todo",
                    }),
                }),
        ],
        create: [
          canEdit && {
            ...STANDARD_ACTIONS.add,
            label: "Add Video",
            opensDialog: true,
            onSelect: () =>
              dispatch({
                type: "set-add-video-to-lesson-id",
                lessonId: lesson.id,
              }),
          },
          canEdit && {
            ...STANDARD_ACTIONS.add,
            label: "Add Lesson Before",
            opensDialog: true,
            onSelect: () =>
              dispatch({
                type: "set-insert-lesson",
                sectionId: section.id,
                adjacentLessonId: lesson.id,
                position: "before",
              }),
          },
          canEdit && {
            ...STANDARD_ACTIONS.add,
            label: "Add Lesson After",
            opensDialog: true,
            onSelect: () =>
              dispatch({
                type: "set-insert-lesson",
                sectionId: section.id,
                adjacentLessonId: lesson.id,
                position: "after",
              }),
          },
        ],
        move: [
          canEdit &&
            otherSections.length > 0 && {
              ...STANDARD_ACTIONS.moveTo,
              label: "Move to Section",
              items: otherSections.map((targetSection) => ({
                label: targetSection.path,
                icon: FolderInput,
                onSelect: () =>
                  submitEvent({
                    type: "move-lesson-to-section",
                    lessonId: lesson.id,
                    targetSectionId: targetSection.id,
                  }),
              })),
            },
        ],
        danger: [
          // Undoable from the course's Archived Lessons page, so it acts at once.
          canEdit && {
            ...STANDARD_ACTIONS.archive,
            onSelect: () =>
              submitEvent({ type: "delete-lesson", lessonId: lesson.id }),
          },
        ],
      }}
    />
  );
}
