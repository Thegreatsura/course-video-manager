import type { courseEditorReducer } from "./course-editor-reducer";
import type { EditorVideo } from "./course-editor-types";

export function handleVideoCase(
  state: courseEditorReducer.State,
  action: courseEditorReducer.Action
): courseEditorReducer.State | null {
  switch (action.type) {
    case "video-moved": {
      if (action.fromLessonId === action.toLessonId) return state;
      let movedVideo: EditorVideo | undefined;
      for (const section of state.sections) {
        for (const lesson of section.lessons) {
          if (
            lesson.databaseId === action.fromLessonId ||
            lesson.frontendId === action.fromLessonId
          ) {
            movedVideo = lesson.videos.find((v) => v.id === action.videoId);
            break;
          }
        }
        if (movedVideo) break;
      }
      if (!movedVideo) return state;
      return {
        ...state,
        sections: state.sections.map((section) => ({
          ...section,
          lessons: section.lessons.map((lesson) => {
            if (
              lesson.databaseId === action.fromLessonId ||
              lesson.frontendId === action.fromLessonId
            ) {
              return {
                ...lesson,
                videos: lesson.videos.filter((v) => v.id !== action.videoId),
              };
            }
            if (
              lesson.databaseId === action.toLessonId ||
              lesson.frontendId === action.toLessonId
            ) {
              return {
                ...lesson,
                videos: [...lesson.videos, movedVideo],
              };
            }
            return lesson;
          }),
        })),
      };
    }

    default:
      return null;
  }
}
