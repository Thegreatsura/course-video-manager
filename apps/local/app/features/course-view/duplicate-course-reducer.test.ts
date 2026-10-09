import { describe, expect, it } from "vitest";
import { ReducerTester } from "../../test-utils/reducer-tester";
import {
  createInitialDuplicateCourseState,
  duplicateCourseReducer,
} from "./duplicate-course-reducer";

const press = (name: string) =>
  ({
    type: "duplicate-pressed",
    courseId: "course-1",
    name,
    currentName: "Cohort 002",
  }) as const;

const tester = () =>
  new ReducerTester(
    duplicateCourseReducer,
    createInitialDuplicateCourseState()
  );

describe("duplicateCourseReducer", () => {
  it("asks for the Job with the trimmed name, once, and closes when it is enqueued", () => {
    const t = tester().send(press("  Cohort 003 ")).send(press("Cohort 003"));
    expect(t.getEffects()).toEqual([
      { type: "request-duplicate", courseId: "course-1", name: "Cohort 003" },
    ]);
    t.resetExec();
    t.send({ type: "duplicate-enqueued" });
    expect(t.getEffects()).toEqual([{ type: "close-modal" }]);
    expect(t.getState()).toEqual({ status: "idle" });
  });

  it("refuses an empty or unchanged name without asking", () => {
    const t = tester().send(press("Cohort 002"));
    expect(t.getEffects()).toEqual([]);
    expect(t.getState()).toEqual({
      status: "error",
      message: "New course name must differ from the original",
    });
    expect(tester().send(press("  ")).getState()).toEqual({
      status: "error",
      message: "Course name cannot be empty",
    });
  });

  it("shows the server's refusal, and forgets it when the modal closes", () => {
    const t = tester().send(press("Taken")).send({
      type: "duplicate-refused",
      message: "A course with this name already exists",
    });
    expect(t.getState()).toEqual({
      status: "error",
      message: "A course with this name already exists",
    });
    expect(t.send({ type: "modal-closed" }).getState()).toEqual({
      status: "idle",
    });
  });
});
