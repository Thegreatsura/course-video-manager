import { useRef, useMemo, useState, useEffect } from "react";
import { useEffectReducer, type EffectsMap } from "use-effect-reducer";
import {
  courseEditorReducer,
  createInitialCourseEditorState,
} from "@/features/course-editor/course-editor-reducer";
import { EffectQueue } from "@/features/course-editor/effect-queue";
import { createHttpCourseEditorService } from "@/services/course-editor-service";
import type {
  FrontendId,
  DatabaseId,
  EditorSection,
  EditorLesson,
  EditorVideo,
} from "@/features/course-editor/course-editor-types";
import type { Section } from "@/features/course-view/course-view-types";

// ============================================================================
// Loader → Editor type transformation
// ============================================================================

function transformSections(loaderSections: Section[]): EditorSection[] {
  return loaderSections.map((s, sIndex) => ({
    frontendId: s.id as FrontendId,
    databaseId: s.id as DatabaseId,
    repoVersionId: s.repoVersionId,
    path: s.path,
    description: s.description ?? "",
    order: s.order ?? sIndex + 1,
    lessons: s.lessons.map(
      (l, lIndex): EditorLesson => ({
        frontendId: l.id as FrontendId,
        databaseId: l.id as DatabaseId,
        sectionId: s.id,
        path: l.path,
        title: l.title ?? "",
        fsStatus: l.fsStatus ?? "real",
        description: l.description ?? "",
        icon: l.icon ?? null,
        priority: l.priority ?? 2,
        dependencies: l.dependencies ?? null,
        order: l.order ?? lIndex + 1,
        videos: l.videos.map(
          (v): EditorVideo => ({
            id: v.id,
            path: v.path,
            clipCount: v.clipCount ?? 0,
            totalDuration: v.totalDuration ?? 0,
            firstClipId: v.firstClipId ?? null,
          })
        ),
      })
    ),
  }));
}

// ============================================================================
// Editor → Loader type back-conversion (for existing components)
// ============================================================================

/**
 * Converts reducer-owned EditorSection[] back to the Section[] shape that
 * existing components expect. This is a temporary adapter for incremental
 * migration — components will eventually consume EditorSection directly.
 */
export function editorSectionsToLoaderSections(
  sections: EditorSection[]
): Section[] {
  return sections.map(
    (s) =>
      ({
        id: s.frontendId as string,
        path: s.path,
        description: s.description,
        order: s.order,
        repoVersionId: s.repoVersionId,
        createdAt: new Date(),
        previousVersionSectionId: null,
        lessons: s.lessons.map((l) => ({
          id: (l.databaseId ?? l.frontendId) as string,
          frontendId: l.frontendId as string,
          path: l.path,
          title: l.title,
          fsStatus: l.fsStatus,
          description: l.description,
          icon: l.icon,
          priority: l.priority,
          dependencies: l.dependencies,
          order: l.order,
          sectionId: s.frontendId as string,
          createdAt: new Date(),
          previousVersionLessonId: null,
          videos: l.videos.map((v) => ({
            id: v.id,
            path: v.path,
            clipCount: v.clipCount,
            totalDuration: v.totalDuration,
            firstClipId: v.firstClipId,
            // DB fields that existing components don't use but the type requires
            archived: false,
            createdAt: new Date(),
            lessonId: l.frontendId as string,
            originalFootagePath: v.path,
            updatedAt: new Date(),
          })),
        })),
      }) as unknown as Section
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useCourseEditor(
  loaderSections: Section[],
  opts?: { courseFilePath?: string | null }
) {
  // Stable service ref — created once per hook lifecycle
  const serviceRef = useRef(createHttpCourseEditorService());

  // Dispatch ref — EffectQueue uses this to dispatch reconciliation actions.
  // Updated after each useEffectReducer call to stay current.
  const dispatchRef = useRef<
    ((action: courseEditorReducer.Action) => void) | null
  >(null);

  // Track pending queue size for UI indicator
  const [pendingCount, setPendingCount] = useState(0);
  const setPendingCountRef = useRef(setPendingCount);
  setPendingCountRef.current = setPendingCount;

  // Effect queue ref — created once, uses dispatch wrapper
  const queueRef = useRef(
    new EffectQueue(
      serviceRef.current,
      (action) => {
        dispatchRef.current?.(action);
      },
      (size) => {
        setPendingCountRef.current(size);
      }
    )
  );

  // Transform loader data to editor entity types
  const initialState = useMemo(() => {
    const editorSections = transformSections(loaderSections);
    return createInitialCourseEditorState(editorSections, {
      courseFilePath: opts?.courseFilePath,
    });
  }, [loaderSections, opts?.courseFilePath]);

  // Build effect handlers map — all 17 types forward to the queue.
  // Each handler receives the typed effect and enqueues it for sequential
  // processing with FrontendId → DatabaseId resolution.
  const effectHandlers = useMemo((): EffectsMap<
    courseEditorReducer.State,
    courseEditorReducer.Action,
    courseEditorReducer.Effect
  > => {
    const enqueue = (effect: courseEditorReducer.Effect) => {
      queueRef.current.enqueue(effect);
    };
    return {
      "create-section": (_s, effect) => enqueue(effect),
      "rename-section": (_s, effect) => enqueue(effect),
      "update-section-description": (_s, effect) => enqueue(effect),
      "archive-section": (_s, effect) => enqueue(effect),
      "reorder-sections": (_s, effect) => enqueue(effect),
      "add-ghost-lesson": (_s, effect) => enqueue(effect),
      "create-real-lesson": (_s, effect) => enqueue(effect),
      "update-lesson-name": (_s, effect) => enqueue(effect),
      "update-lesson-title": (_s, effect) => enqueue(effect),
      "update-lesson-description": (_s, effect) => enqueue(effect),
      "update-lesson-icon": (_s, effect) => enqueue(effect),
      "update-lesson-priority": (_s, effect) => enqueue(effect),
      "update-lesson-dependencies": (_s, effect) => enqueue(effect),
      "delete-lesson": (_s, effect) => enqueue(effect),
      "reorder-lessons": (_s, effect) => enqueue(effect),
      "move-lesson-to-section": (_s, effect) => enqueue(effect),
      "convert-to-ghost": (_s, effect) => enqueue(effect),
      "create-on-disk": (_s, effect) => enqueue(effect),
    };
  }, []);

  const [state, dispatch] = useEffectReducer(
    courseEditorReducer,
    initialState,
    effectHandlers
  );

  // Keep dispatch ref current for EffectQueue
  dispatchRef.current = dispatch;

  // Prevent page leave when there are unresolved queue items
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (queueRef.current.hasUnresolvedItems()) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  return { state, dispatch, pendingCount };
}
