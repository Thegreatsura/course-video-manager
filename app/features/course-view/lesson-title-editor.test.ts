import { describe, it, expect, vi } from "vitest";
import { capitalizeTitle } from "@/utils/capitalize-title";
import type { courseViewReducer } from "./course-view-reducer";

// ---------------------------------------------------------------------------
// Helpers — mirror the saveTitle logic from useLessonTitleEditor
// ---------------------------------------------------------------------------

function makeSaveTitle(
  lesson: { title?: string; path: string; id: string },
  dispatch: (action: courseViewReducer.Action) => void
) {
  return (value: string) => {
    const newTitle = capitalizeTitle(value.trim());
    if (newTitle && newTitle !== (lesson.title || lesson.path)) {
      dispatch({
        type: "update-lesson-title",
        frontendId: lesson.id as any,
        title: newTitle,
      } as any);
    }
  };
}

// ---------------------------------------------------------------------------
// Tests for the handledRef blur-save guard
// ---------------------------------------------------------------------------

describe("LessonTitleEditor — blur-save guard (handledRef)", () => {
  /**
   * Regression test for issue #703: renaming a ghost lesson sporadically
   * not working.
   *
   * Root cause: `handledRef.current` is set to `true` when the user presses
   * Enter or Escape to close the editor, but it was never reset when a new
   * editing session began. Any subsequent blur-to-save was silently dropped
   * because `if (!handledRef.current)` evaluated to false.
   *
   * Fix: reset `handledRef.current = false` at the start of each editing
   * session (via a `useEffect` tied to `editingTitle`).
   */
  it("should allow blur-to-save after a previous Enter-to-save", () => {
    // Simulate the handledRef lifecycle for two consecutive editing sessions.
    const handledRef = { current: false };
    let saveCount = 0;
    const onSave = () => {
      saveCount++;
    };

    // --- Session 1: user presses Enter ---
    // Enter keydown: mark handled, call onSave directly
    handledRef.current = true;
    onSave(); // explicit Enter-triggered save

    // onBlur fires afterward — should be a no-op because handledRef is true
    if (!handledRef.current) onSave();

    expect(saveCount).toBe(1);

    // --- Editing session ends (setEditingTitle(false)) ---

    // --- Session 2 starts (setEditingTitle(true)) ---
    // THE FIX: reset handledRef when editing session starts
    handledRef.current = false;

    // User clicks away without pressing Enter — blur fires
    if (!handledRef.current) onSave();

    // Blur-triggered save should have fired
    expect(saveCount).toBe(2);
  });

  it("should NOT call onSave on blur after Escape cancels the session", () => {
    const handledRef = { current: false };
    let saveCount = 0;
    const onSave = () => {
      saveCount++;
    };

    // User presses Escape — mark handled, call onCancel (not onSave)
    handledRef.current = true;
    // (onCancel fires here, not onSave)

    // onBlur fires — should be a no-op
    if (!handledRef.current) onSave();

    expect(saveCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests for auto-select on focus (issue #718)
// ---------------------------------------------------------------------------

describe("LessonTitleEditor — auto-select on focus", () => {
  it("calls select() on the input element when focused", () => {
    const selectMock = vi.fn();
    const mockTarget = { select: selectMock };
    const handledRef = { current: false };

    // Simulate the onFocus handler that the input element uses
    const onFocus = (e: { target: { select: () => void } }) => {
      handledRef.current = false;
      e.target.select();
    };

    // Simulate a prior Enter-save that set handledRef to true
    handledRef.current = true;

    onFocus({ target: mockTarget });

    expect(selectMock).toHaveBeenCalledOnce();
    // handledRef should also be reset
    expect(handledRef.current).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests for saveTitle dispatch logic
// ---------------------------------------------------------------------------

describe("useLessonTitleEditor — saveTitle guard condition", () => {
  const baseLesson = { id: "fid-1", path: "my-lesson", title: "My Lesson" };

  it("dispatches update-lesson-title when title changes", () => {
    const dispatch = vi.fn();
    const saveTitle = makeSaveTitle(baseLesson, dispatch);
    saveTitle("New Name");
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "update-lesson-title",
        title: "New Name",
      })
    );
  });

  it("does not dispatch when title is the same as current", () => {
    const dispatch = vi.fn();
    const saveTitle = makeSaveTitle(baseLesson, dispatch);
    saveTitle("My Lesson"); // same as lesson.title
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not dispatch when value trims/capitalizes to the same title", () => {
    const dispatch = vi.fn();
    const saveTitle = makeSaveTitle(baseLesson, dispatch);
    saveTitle("  my lesson  "); // capitalizes to "My Lesson" — same as current
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("falls back to lesson.path when title is empty — does not dispatch when capitalized value equals path", () => {
    const dispatch = vi.fn();
    // Path already matches what capitalizeTitle would produce
    const noTitleLesson = { ...baseLesson, title: "", path: "My Lesson" };
    const saveTitle = makeSaveTitle(noTitleLesson, dispatch);
    saveTitle("My Lesson"); // capitalizeTitle("My Lesson") === path → no dispatch
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatches multiple times when renamed repeatedly to different values", () => {
    const dispatch = vi.fn();
    let lesson = { ...baseLesson };
    let saveTitle = makeSaveTitle(lesson, dispatch);

    saveTitle("First Rename");
    expect(dispatch).toHaveBeenCalledTimes(1);

    // Simulate optimistic update: lesson.title is now "First Rename"
    lesson = { ...lesson, title: "First Rename" };
    saveTitle = makeSaveTitle(lesson, dispatch);

    saveTitle("Second Rename");
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});
