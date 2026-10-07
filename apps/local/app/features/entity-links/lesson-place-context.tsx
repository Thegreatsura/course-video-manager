import { createContext, useContext } from "react";
import type { FindLessonPlace } from "./entity-deep-link";

const LessonPlaceContext = createContext<FindLessonPlace>(() => undefined);

/**
 * Tells every entity menu below it where a Video sits in its Course, so the
 * links they copy name the Course, Section and Lesson as well as the Video.
 * The Video's pages provide it for their one Video; the course view, for
 * every Video it lists.
 */
export const LessonPlaceProvider = LessonPlaceContext.Provider;

export function useFindLessonPlace(): FindLessonPlace {
  return useContext(LessonPlaceContext);
}
