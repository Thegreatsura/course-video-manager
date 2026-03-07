import { describe, it, expect } from "vitest";
import { ReducerTester } from "../../test-utils/reducer-tester";
import {
  courseViewReducer,
  createInitialCourseViewState,
} from "./course-view-reducer";

const createTester = () =>
  new ReducerTester(courseViewReducer, createInitialCourseViewState());

describe("courseViewReducer", () => {
  describe("Initial state", () => {
    it("1. all modals are closed initially", () => {
      const state = createTester().getState();
      expect(state.isAddRepoModalOpen).toBe(false);
      expect(state.isCreateSectionModalOpen).toBe(false);
      expect(state.isCreateVersionModalOpen).toBe(false);
      expect(state.isVersionSelectorModalOpen).toBe(false);
      expect(state.isEditVersionModalOpen).toBe(false);
      expect(state.isRenameRepoModalOpen).toBe(false);
      expect(state.isDeleteVersionModalOpen).toBe(false);
      expect(state.isClearVideoFilesModalOpen).toBe(false);
      expect(state.isRewriteRepoPathModalOpen).toBe(false);
      expect(state.isAddStandaloneVideoModalOpen).toBe(false);
    });

    it("2. all ID-based selections are null initially", () => {
      const state = createTester().getState();
      expect(state.addGhostLessonSectionId).toBeNull();
      expect(state.addVideoToLessonId).toBeNull();
      expect(state.editLessonId).toBeNull();
      expect(state.convertToGhostLessonId).toBeNull();
    });

    it("3. video player is closed initially", () => {
      const state = createTester().getState();
      expect(state.videoPlayerState).toEqual({
        isOpen: false,
        videoId: "",
        videoPath: "",
      });
    });

    it("4. complex states are null initially", () => {
      const state = createTester().getState();
      expect(state.moveVideoState).toBeNull();
      expect(state.moveLessonState).toBeNull();
      expect(state.renameVideoState).toBeNull();
    });

    it("5. filters are empty initially", () => {
      const state = createTester().getState();
      expect(state.priorityFilter).toEqual([]);
      expect(state.iconFilter).toEqual([]);
      expect(state.fsStatusFilter).toEqual([]);
    });
  });

  describe("Boolean modal toggles", () => {
    it("6. set-add-repo-modal-open: opens the modal", () => {
      const state = createTester()
        .send({ type: "set-add-repo-modal-open", open: true })
        .getState();
      expect(state.isAddRepoModalOpen).toBe(true);
    });

    it("7. set-add-repo-modal-open: closes the modal", () => {
      const state = createTester()
        .send({ type: "set-add-repo-modal-open", open: true })
        .send({ type: "set-add-repo-modal-open", open: false })
        .getState();
      expect(state.isAddRepoModalOpen).toBe(false);
    });

    it("8. set-create-section-modal-open: toggles", () => {
      const state = createTester()
        .send({ type: "set-create-section-modal-open", open: true })
        .getState();
      expect(state.isCreateSectionModalOpen).toBe(true);
    });

    it("9. set-create-version-modal-open: toggles", () => {
      const state = createTester()
        .send({ type: "set-create-version-modal-open", open: true })
        .getState();
      expect(state.isCreateVersionModalOpen).toBe(true);
    });

    it("10. set-version-selector-modal-open: toggles", () => {
      const state = createTester()
        .send({ type: "set-version-selector-modal-open", open: true })
        .getState();
      expect(state.isVersionSelectorModalOpen).toBe(true);
    });

    it("11. set-edit-version-modal-open: toggles", () => {
      const state = createTester()
        .send({ type: "set-edit-version-modal-open", open: true })
        .getState();
      expect(state.isEditVersionModalOpen).toBe(true);
    });

    it("12. set-rename-repo-modal-open: toggles", () => {
      const state = createTester()
        .send({ type: "set-rename-repo-modal-open", open: true })
        .getState();
      expect(state.isRenameRepoModalOpen).toBe(true);
    });

    it("13. set-delete-version-modal-open: toggles", () => {
      const state = createTester()
        .send({ type: "set-delete-version-modal-open", open: true })
        .getState();
      expect(state.isDeleteVersionModalOpen).toBe(true);
    });

    it("14. set-clear-video-files-modal-open: toggles", () => {
      const state = createTester()
        .send({ type: "set-clear-video-files-modal-open", open: true })
        .getState();
      expect(state.isClearVideoFilesModalOpen).toBe(true);
    });

    it("15. set-rewrite-repo-path-modal-open: toggles", () => {
      const state = createTester()
        .send({ type: "set-rewrite-repo-path-modal-open", open: true })
        .getState();
      expect(state.isRewriteRepoPathModalOpen).toBe(true);
    });

    it("16. set-add-standalone-video-modal-open: toggles", () => {
      const state = createTester()
        .send({ type: "set-add-standalone-video-modal-open", open: true })
        .getState();
      expect(state.isAddStandaloneVideoModalOpen).toBe(true);
    });

    it("17. opening one modal does not affect others", () => {
      const state = createTester()
        .send({ type: "set-add-repo-modal-open", open: true })
        .getState();
      expect(state.isAddRepoModalOpen).toBe(true);
      expect(state.isCreateSectionModalOpen).toBe(false);
      expect(state.isCreateVersionModalOpen).toBe(false);
    });
  });

  describe("ID-based selections", () => {
    it("18. set-add-ghost-lesson-section-id: sets the section ID", () => {
      const state = createTester()
        .send({
          type: "set-add-ghost-lesson-section-id",
          sectionId: "section-1",
        })
        .getState();
      expect(state.addGhostLessonSectionId).toBe("section-1");
    });

    it("19. set-add-ghost-lesson-section-id: clears with null", () => {
      const state = createTester()
        .send({
          type: "set-add-ghost-lesson-section-id",
          sectionId: "section-1",
        })
        .send({ type: "set-add-ghost-lesson-section-id", sectionId: null })
        .getState();
      expect(state.addGhostLessonSectionId).toBeNull();
    });

    it("20. set-add-video-to-lesson-id: sets the lesson ID", () => {
      const state = createTester()
        .send({ type: "set-add-video-to-lesson-id", lessonId: "lesson-1" })
        .getState();
      expect(state.addVideoToLessonId).toBe("lesson-1");
    });

    it("21. set-edit-lesson-id: sets and clears", () => {
      const tester = createTester();
      const state1 = tester
        .send({ type: "set-edit-lesson-id", lessonId: "lesson-2" })
        .getState();
      expect(state1.editLessonId).toBe("lesson-2");

      const state2 = tester
        .send({ type: "set-edit-lesson-id", lessonId: null })
        .getState();
      expect(state2.editLessonId).toBeNull();
    });

    it("22. set-convert-to-ghost-lesson-id: sets and clears", () => {
      const tester = createTester();
      const state1 = tester
        .send({
          type: "set-convert-to-ghost-lesson-id",
          lessonId: "lesson-3",
        })
        .getState();
      expect(state1.convertToGhostLessonId).toBe("lesson-3");

      const state2 = tester
        .send({ type: "set-convert-to-ghost-lesson-id", lessonId: null })
        .getState();
      expect(state2.convertToGhostLessonId).toBeNull();
    });
  });

  describe("Video player", () => {
    it("23. open-video-player: opens with video info", () => {
      const state = createTester()
        .send({
          type: "open-video-player",
          videoId: "vid-1",
          videoPath: "section/lesson/video.mp4",
        })
        .getState();
      expect(state.videoPlayerState).toEqual({
        isOpen: true,
        videoId: "vid-1",
        videoPath: "section/lesson/video.mp4",
      });
    });

    it("24. close-video-player: resets to initial state", () => {
      const state = createTester()
        .send({
          type: "open-video-player",
          videoId: "vid-1",
          videoPath: "section/lesson/video.mp4",
        })
        .send({ type: "close-video-player" })
        .getState();
      expect(state.videoPlayerState).toEqual({
        isOpen: false,
        videoId: "",
        videoPath: "",
      });
    });
  });

  describe("Move video", () => {
    it("25. open-move-video: sets move video state", () => {
      const state = createTester()
        .send({
          type: "open-move-video",
          videoId: "vid-1",
          videoPath: "video.mp4",
          currentLessonId: "lesson-1",
        })
        .getState();
      expect(state.moveVideoState).toEqual({
        videoId: "vid-1",
        videoPath: "video.mp4",
        currentLessonId: "lesson-1",
      });
    });

    it("26. close-move-video: clears move video state", () => {
      const state = createTester()
        .send({
          type: "open-move-video",
          videoId: "vid-1",
          videoPath: "video.mp4",
          currentLessonId: "lesson-1",
        })
        .send({ type: "close-move-video" })
        .getState();
      expect(state.moveVideoState).toBeNull();
    });
  });

  describe("Move lesson", () => {
    it("27. open-move-lesson: sets move lesson state", () => {
      const state = createTester()
        .send({
          type: "open-move-lesson",
          lessonId: "lesson-1",
          lessonTitle: "Intro",
          currentSectionId: "section-1",
        })
        .getState();
      expect(state.moveLessonState).toEqual({
        lessonId: "lesson-1",
        lessonTitle: "Intro",
        currentSectionId: "section-1",
      });
    });

    it("28. close-move-lesson: clears move lesson state", () => {
      const state = createTester()
        .send({
          type: "open-move-lesson",
          lessonId: "lesson-1",
          lessonTitle: "Intro",
          currentSectionId: "section-1",
        })
        .send({ type: "close-move-lesson" })
        .getState();
      expect(state.moveLessonState).toBeNull();
    });
  });

  describe("Rename video", () => {
    it("31. open-rename-video: sets rename video state", () => {
      const state = createTester()
        .send({
          type: "open-rename-video",
          videoId: "vid-1",
          videoPath: "video.mp4",
        })
        .getState();
      expect(state.renameVideoState).toEqual({
        videoId: "vid-1",
        videoPath: "video.mp4",
      });
    });

    it("32. close-rename-video: clears rename video state", () => {
      const state = createTester()
        .send({
          type: "open-rename-video",
          videoId: "vid-1",
          videoPath: "video.mp4",
        })
        .send({ type: "close-rename-video" })
        .getState();
      expect(state.renameVideoState).toBeNull();
    });
  });

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

    it("35. toggle-priority-filter: supports multiple priorities", () => {
      const state = createTester()
        .send({ type: "toggle-priority-filter", priority: 1 })
        .send({ type: "toggle-priority-filter", priority: 3 })
        .getState();
      expect(state.priorityFilter).toEqual([1, 3]);
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

    it("37. toggle-icon-filter: adds icon when not present", () => {
      const state = createTester()
        .send({ type: "toggle-icon-filter", icon: "code" })
        .getState();
      expect(state.iconFilter).toEqual(["code"]);
    });

    it("38. toggle-icon-filter: removes icon when already present", () => {
      const state = createTester()
        .send({ type: "toggle-icon-filter", icon: "code" })
        .send({ type: "toggle-icon-filter", icon: "code" })
        .getState();
      expect(state.iconFilter).toEqual([]);
    });

    it("39. toggle-icon-filter: supports multiple icons", () => {
      const state = createTester()
        .send({ type: "toggle-icon-filter", icon: "code" })
        .send({ type: "toggle-icon-filter", icon: "discussion" })
        .getState();
      expect(state.iconFilter).toEqual(["code", "discussion"]);
    });

    it("40. toggle-fs-status-filter: adds status when not present", () => {
      const state = createTester()
        .send({ type: "toggle-fs-status-filter", status: "ghost" })
        .getState();
      expect(state.fsStatusFilter).toEqual(["ghost"]);
    });

    it("41. toggle-fs-status-filter: removes status when already present", () => {
      const state = createTester()
        .send({ type: "toggle-fs-status-filter", status: "ghost" })
        .send({ type: "toggle-fs-status-filter", status: "ghost" })
        .getState();
      expect(state.fsStatusFilter).toEqual([]);
    });

    it("42. toggle-fs-status-filter: supports multiple statuses", () => {
      const state = createTester()
        .send({ type: "toggle-fs-status-filter", status: "ghost" })
        .send({ type: "toggle-fs-status-filter", status: "real" })
        .getState();
      expect(state.fsStatusFilter).toEqual(["ghost", "real"]);
    });

    it("43. filters are independent of each other", () => {
      const state = createTester()
        .send({ type: "toggle-priority-filter", priority: 1 })
        .send({ type: "toggle-icon-filter", icon: "code" })
        .send({ type: "toggle-fs-status-filter", status: "ghost" })
        .getState();
      expect(state.priorityFilter).toEqual([1]);
      expect(state.iconFilter).toEqual(["code"]);
      expect(state.fsStatusFilter).toEqual(["ghost"]);
    });
  });

  describe("State independence", () => {
    it("44. modal toggle does not affect filters", () => {
      const state = createTester()
        .send({ type: "toggle-priority-filter", priority: 1 })
        .send({ type: "set-add-repo-modal-open", open: true })
        .getState();
      expect(state.priorityFilter).toEqual([1]);
      expect(state.isAddRepoModalOpen).toBe(true);
    });

    it("45. opening video player does not affect modals", () => {
      const state = createTester()
        .send({ type: "set-add-repo-modal-open", open: true })
        .send({
          type: "open-video-player",
          videoId: "vid-1",
          videoPath: "path",
        })
        .getState();
      expect(state.isAddRepoModalOpen).toBe(true);
      expect(state.videoPlayerState.isOpen).toBe(true);
    });
  });
});
