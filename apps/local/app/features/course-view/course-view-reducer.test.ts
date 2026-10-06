import { describe, it, expect } from "vitest";
import { ReducerTester } from "../../test-utils/reducer-tester";
import {
  courseViewReducer,
  createInitialCourseViewState,
} from "./course-view-reducer";

const createTester = () =>
  new ReducerTester(courseViewReducer, createInitialCourseViewState());

describe("courseViewReducer", () => {
  describe("Filters", () => {
    it("33. toggle-priority-filter: adds priority when not present", () => {
      const state = createTester()
        .send({ type: "toggle-priority-filter", priority: 1 })
        .getState();
      expect(state.priorityFilter).toEqual([1]);
    });

    it("34. toggle-priority-filter: removes priority when already present", () => {
      const state = createTester()
        .send({ type: "toggle-priority-filter", priority: 1 })
        .send({ type: "toggle-priority-filter", priority: 1 })
        .getState();
      expect(state.priorityFilter).toEqual([]);
    });

    it("36. toggle-priority-filter: removes one while keeping others", () => {
      const state = createTester()
        .send({ type: "toggle-priority-filter", priority: 1 })
        .send({ type: "toggle-priority-filter", priority: 2 })
        .send({ type: "toggle-priority-filter", priority: 3 })
        .send({ type: "toggle-priority-filter", priority: 2 })
        .getState();
      expect(state.priorityFilter).toEqual([1, 3]);
    });

    it("38. toggle-icon-filter: removes icon when already present", () => {
      const state = createTester()
        .send({ type: "toggle-icon-filter", icon: "code" })
        .send({ type: "toggle-icon-filter", icon: "code" })
        .getState();
      expect(state.iconFilter).toEqual([]);
    });

    it("41. toggle-todo-filter: toggles back to false", () => {
      const state = createTester()
        .send({ type: "toggle-todo-filter" })
        .send({ type: "toggle-todo-filter" })
        .getState();
      expect(state.todoFilter).toBe(false);
    });
  });

  describe("Insert section", () => {
    it("46. set-insert-section: opens modal and sets adjacent section state", () => {
      const state = createTester()
        .send({
          type: "set-insert-section",
          adjacentSectionId: "section-1",
          position: "before",
        })
        .getState();
      expect(state.isCreateSectionModalOpen).toBe(true);
      expect(state.insertAdjacentSectionId).toBe("section-1");
      expect(state.insertSectionPosition).toBe("before");
    });

    it("47. set-insert-section: after position", () => {
      const state = createTester()
        .send({
          type: "set-insert-section",
          adjacentSectionId: "section-2",
          position: "after",
        })
        .getState();
      expect(state.isCreateSectionModalOpen).toBe(true);
      expect(state.insertAdjacentSectionId).toBe("section-2");
      expect(state.insertSectionPosition).toBe("after");
    });

    it("48. set-create-section-modal-open clears insert section state", () => {
      const state = createTester()
        .send({
          type: "set-insert-section",
          adjacentSectionId: "section-1",
          position: "before",
        })
        .send({ type: "set-create-section-modal-open", open: true })
        .getState();
      expect(state.isCreateSectionModalOpen).toBe(true);
      expect(state.insertAdjacentSectionId).toBeNull();
      expect(state.insertSectionPosition).toBeNull();
    });

    it("49. closing create section modal clears insert section state", () => {
      const state = createTester()
        .send({
          type: "set-insert-section",
          adjacentSectionId: "section-1",
          position: "before",
        })
        .send({ type: "set-create-section-modal-open", open: false })
        .getState();
      expect(state.isCreateSectionModalOpen).toBe(false);
      expect(state.insertAdjacentSectionId).toBeNull();
      expect(state.insertSectionPosition).toBeNull();
    });
  });

  describe("Filters cleared by hidden fields", () => {
    it("60. clearing one filter leaves the others untouched", () => {
      const state = createTester()
        .send({ type: "toggle-priority-filter", priority: 1 })
        .send({ type: "toggle-icon-filter", icon: "code" })
        .send({ type: "toggle-todo-filter" })
        .send({ type: "clear-priority-filter" })
        .getState();
      expect(state.priorityFilter).toEqual([]);
      expect(state.iconFilter).toEqual(["code"]);
      expect(state.todoFilter).toBe(true);
    });
  });
});
