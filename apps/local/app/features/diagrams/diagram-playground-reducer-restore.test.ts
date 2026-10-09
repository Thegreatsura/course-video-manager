import { describe, expect, it } from "vitest";
import { isCanvasEditable } from "./diagram-playground-reducer";
import {
  loaded,
  openPage,
  scene,
  shown,
  snapshot,
  storedHead,
  T1,
  T2,
} from "./diagram-playground-reducer-test-helpers";

describe("restoring a snapshot over the head", () => {
  it("restoring keeps a head the timeline hasn't got as a snapshot first, an edit still in the autosave debounce included", () => {
    // The timeline holds s1 and the head as loaded.
    const timeline = [snapshot("s1"), { contentHash: "head-d1" }];
    const tester = openPage()
      .send(loaded("d1", scene("d1")))
      // (a) An autosave lands a head the timeline has never seen.
      .send({
        type: "head-saved",
        diagramId: "d1",
        stored: storedHead("hash-drawn", T1),
      })
      .resetExec()
      .send({
        type: "restore-requested",
        snapshot: snapshot("s1"),
        timeline,
        requestId: 7,
      });

    // (b) The edit still in the debounce is saved before anything is decided,
    // and nothing more can be drawn until the restore lands.
    expect(tester.getEffects()).toEqual([
      { type: "save-before-leaving", diagramId: "d1" },
    ]);
    expect(isCanvasEditable(tester.getState())).toBe(false);

    tester
      .send({ type: "head-save-started", diagramId: "d1" })
      .send({
        type: "head-saved",
        diagramId: "d1",
        stored: storedHead("hash-drawn-more", T2),
      })
      .send({ type: "saved-before-leaving", diagramId: "d1", outcome: "saved" })
      .send({ type: "canvas-kept", diagramId: "d1" })
      .send({
        type: "restore-succeeded",
        diagramId: "d1",
        snapshot: snapshot("s1"),
        stored: storedHead("hash-s1", T2),
      });

    expect(tester.getEffects()).toEqual([
      { type: "save-before-leaving", diagramId: "d1" },
      { type: "keep-canvas-as-snapshot", diagramId: "d1" },
      {
        type: "restore-snapshot",
        diagramId: "d1",
        snapshot: snapshot("s1"),
        expectedHeadHash: "hash-drawn-more",
        requestId: 7,
      },
      shown("d1", scene("s1"), { stored: storedHead("hash-s1", T2) }),
    ]);
    expect(isCanvasEditable(tester.getState())).toBe(true);
  });

  it("restores without a new snapshot when the head is already on the timeline or the canvas is empty", () => {
    const timeline = [snapshot("s1"), { contentHash: "head-d1" }];
    const tester = openPage()
      .send(loaded("d1", scene("d1")))
      .resetExec()
      .send({
        type: "restore-requested",
        snapshot: snapshot("s1"),
        timeline,
        requestId: 1,
      })
      .send({ type: "saved-before-leaving", diagramId: "d1", outcome: "saved" })
      .send({
        type: "restore-succeeded",
        diagramId: "d1",
        snapshot: snapshot("s1"),
        stored: storedHead("hash-s1", T1),
      })
      .resetExec()
      .send({
        type: "restore-requested",
        snapshot: snapshot("s2"),
        timeline: [],
        requestId: 2,
      })
      .send({ type: "saved-before-leaving", diagramId: "d1", outcome: "saved" })
      .send({
        type: "keep-canvas-failed",
        diagramId: "d1",
        reason: "empty-canvas",
      });

    expect(tester.getEffects()).toEqual([
      { type: "save-before-leaving", diagramId: "d1" },
      { type: "keep-canvas-as-snapshot", diagramId: "d1" },
      {
        type: "restore-snapshot",
        diagramId: "d1",
        snapshot: snapshot("s2"),
        expectedHeadHash: "hash-s1",
        requestId: 2,
      },
    ]);
  });
});
