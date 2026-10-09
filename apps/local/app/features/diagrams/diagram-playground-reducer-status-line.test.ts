import { describe, expect, it } from "vitest";
import { STATUS_ERROR_MS } from "./diagram-playground-reducer";
import {
  loaded,
  openPage,
  scene,
  storedHead,
  T1,
} from "./diagram-playground-reducer-test-helpers";

describe("the status line", () => {
  const opened = () =>
    openPage()
      .send(loaded("d1", scene("d1")))
      .resetExec();

  it("shows a reported error, and takes it down after its timeout", () => {
    const tester = opened().send({
      type: "error-reported",
      message: "Couldn't delete that component",
    });

    expect(tester.getState().error).toEqual({
      message: "Couldn't delete that component",
      id: 1,
      fromAutosave: false,
    });
    expect(tester.getEffects()).toEqual([
      { type: "time-out-error", id: 1, ms: STATUS_ERROR_MS },
    ]);

    tester.send({ type: "error-timed-out", id: 1 });

    expect(tester.getState().error).toBeNull();
  });

  it("a newer error outlives the older one's timeout", () => {
    const tester = opened()
      .send({ type: "error-reported", message: "first" })
      .send({ type: "error-reported", message: "second" })
      .send({ type: "error-timed-out", id: 1 });

    expect(tester.getState().error?.message).toBe("second");

    tester.send({ type: "error-timed-out", id: 2 });

    expect(tester.getState().error).toBeNull();
  });

  it("the next success clears the error and shows nothing of its own", () => {
    const tester = opened()
      .send({ type: "error-reported", message: "Failed to copy diagram" })
      .send({ type: "operation-succeeded" });

    expect(tester.getState().error).toBeNull();
    // A success on a clean status line leaves it clean.
    tester.send({ type: "operation-succeeded" });
    expect(tester.getState().error).toBeNull();
  });

  it("a background autosave doesn't clear an error the author hasn't seen off", () => {
    const tester = opened()
      .send({
        type: "error-reported",
        message: "Couldn't delete that component",
      })
      .send({ type: "head-save-started", diagramId: "d1" })
      .send({
        type: "head-saved",
        diagramId: "d1",
        stored: storedHead("mine", T1),
      });

    expect(tester.getState().error?.message).toBe(
      "Couldn't delete that component"
    );
  });

  it("failures the page runs itself go to the status line too", () => {
    const tester = opened()
      .send({ type: "create-clicked" })
      .send({ type: "create-failed" });

    expect(tester.getState().error?.message).toBe("Failed to create diagram");

    tester
      .send({ type: "create-clicked" })
      .send({ type: "diagram-created", diagramId: "d2" });

    expect(tester.getState().error).toBeNull();
  });
});
