import { describe, expect, it } from "vitest";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  appSidebarReducer,
  createInitialAppSidebarState,
} from "./app-sidebar-reducer";

const sidebar = () =>
  new ReducerTester(appSidebarReducer, createInitialAppSidebarState());

describe("appSidebarReducer", () => {
  it("creating a diagram opens it, and a second click while one is in flight creates nothing", () => {
    const tester = sidebar()
      .send({ type: "create-diagram-clicked" })
      .send({ type: "create-diagram-clicked" });

    expect(tester.getState().creatingDiagram).toBe(true);

    tester.send({ type: "diagram-created", diagramId: "d1" });

    expect(tester.getState().creatingDiagram).toBe(false);
    expect(tester.getEffects()).toEqual([
      { type: "create-diagram" },
      { type: "open-diagram", diagramId: "d1" },
    ]);
  });

  it("a failed create shows an error and the next click tries again", () => {
    const tester = sidebar()
      .send({ type: "create-diagram-clicked" })
      .send({ type: "diagram-create-failed" })
      .send({ type: "create-diagram-clicked" });

    expect(tester.getEffects()).toEqual([
      { type: "create-diagram" },
      { type: "show-error", message: "Failed to create diagram" },
      { type: "create-diagram" },
    ]);
  });

  it("opening a dialog replaces the open one, and the replaced one's late close leaves it open", () => {
    const state = sidebar()
      .send({ type: "add-course-clicked" })
      .send({ type: "add-video-clicked" })
      .send({ type: "modal-dismissed", modal: "add-course" })
      .getState();

    expect(state.openModal).toBe("add-video");
  });

  it("clicking Space Desk wakes the display with no dialog, and toasts the outcome", () => {
    const tester = sidebar()
      .send({ type: "spacedesk-clicked" })
      .send({ type: "spacedesk-clicked" });

    expect(tester.getState()).toMatchObject({
      openModal: null,
      wakingSpacedesk: true,
    });

    tester
      .send({ type: "spacedesk-woke" })
      .send({ type: "spacedesk-clicked" })
      .send({ type: "spacedesk-wake-failed", message: "Couldn't reach it" });

    expect(tester.getState().wakingSpacedesk).toBe(false);
    expect(tester.getEffects()).toEqual([
      { type: "wake-spacedesk" },
      { type: "show-message", message: "Spacedesk display is waking up…" },
      { type: "wake-spacedesk" },
      { type: "show-error", message: "Couldn't reach it" },
    ]);
  });

  it("navigating closes the mobile sheet but not a dialog opened from it", () => {
    const tester = sidebar()
      .send({ type: "menu-button-clicked" })
      .send({ type: "add-video-clicked" });

    expect(tester.getState()).toMatchObject({
      sheetOpen: true,
      openModal: "add-video",
    });

    tester
      .send({ type: "modal-dismissed", modal: "add-video" })
      .send({ type: "location-changed" });

    expect(tester.getState()).toMatchObject({
      sheetOpen: false,
      openModal: null,
    });
    expect(tester.getEffects()).toEqual([]);
  });
});
