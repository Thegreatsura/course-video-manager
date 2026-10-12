import { describe, expect, it } from "vitest";
import { activeSnapshotHash } from "./diagram-playground-reducer";
import {
  loaded,
  openPage,
  scene,
  snapshot,
  storedHead,
  T0,
  T1,
} from "./diagram-playground-reducer-test-helpers";

describe("the timeline's active snapshot", () => {
  it("is the restored snapshot until the canvas is edited, and the saved head once it is preserved", () => {
    const s2 = snapshot("s2");
    const tester = openPage().send(loaded("d1", scene("d1")));
    expect(activeSnapshotHash(tester.getState())).toBe("head-d1");

    tester
      .send({
        type: "restore-requested",
        snapshot: s2,
        timeline: [snapshot("s1"), s2],
        requestId: 1,
      })
      .send({
        type: "restore-succeeded",
        diagramId: "d1",
        snapshot: s2,
        stored: storedHead(s2.contentHash, T0),
      });
    expect(activeSnapshotHash(tester.getState())).toBe("hash-s2");

    // An edit: from its save on, the canvas is no snapshot at all.
    tester.send({ type: "head-save-started", diagramId: "d1" });
    expect(activeSnapshotHash(tester.getState())).toBeNull();
    tester.send({
      type: "head-saved",
      diagramId: "d1",
      stored: storedHead("hash-edited", T1),
    });
    // Unless a snapshot of exactly this content is kept, as Preserve does.
    expect(activeSnapshotHash(tester.getState())).toBe("hash-edited");
  });

  it("is nothing while the head is loading or changed elsewhere", () => {
    const tester = openPage().send({ type: "diagram-opened", diagramId: "d1" });
    expect(activeSnapshotHash(tester.getState())).toBeNull();

    tester
      .send(loaded("d1", scene("d1")))
      .send({ type: "head-save-started", diagramId: "d1" })
      .send({ type: "head-save-refused", diagramId: "d1" });
    expect(activeSnapshotHash(tester.getState())).toBeNull();
  });
});
