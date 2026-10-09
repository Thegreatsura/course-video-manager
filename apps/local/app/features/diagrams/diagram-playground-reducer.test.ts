import { describe, expect, it } from "vitest";
import type { TLStoreSnapshot } from "tldraw";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  createInitialDiagramPlaygroundState,
  diagramPlaygroundReducer,
  isCanvasEditable,
  type StoredHead,
} from "./diagram-playground-reducer";
import type { Snapshot } from "./snapshot-list";

const scene = (name: string) => ({ name }) as unknown as TLStoreSnapshot;

const T0 = "2026-10-09T10:00:00.000Z";
const T1 = "2026-10-09T10:00:05.000Z";
const T2 = "2026-10-09T10:00:10.000Z";

const storedHead = (hash: string | null, updatedAt: string): StoredHead => ({
  hash,
  updatedAt,
});

/** `diagramId`'s head arrived from the server, as last written at T0. */
const loaded = (
  diagramId: string,
  headScene: TLStoreSnapshot | null,
  stored = storedHead(`head-${diagramId}`, T0)
) => ({
  type: "head-loaded" as const,
  diagramId,
  scene: headScene,
  stored,
});

const shown = (
  diagramId: string,
  headScene: TLStoreSnapshot | null,
  opts: { stored?: StoredHead; centreCamera?: boolean } = {}
) => ({
  type: "show-head" as const,
  diagramId,
  scene: headScene,
  stored: opts.stored ?? storedHead(`head-${diagramId}`, T0),
  centreCamera: opts.centreCamera ?? true,
});

const snapshot = (id: string): Snapshot => ({
  id,
  diagramId: "d1",
  scene: scene(id),
  contentHash: `hash-${id}`,
  preserved: true,
  createdAt: "2026-10-07T00:00:00.000Z",
});

/** The Active Diagram page, its editor just mounted on `d1`. */
const openPage = () =>
  new ReducerTester(
    diagramPlaygroundReducer,
    createInitialDiagramPlaygroundState({ windowFocused: true })
  ).send({ type: "editor-mounted", diagramId: "d1", isFocusMode: false });

describe("diagramPlaygroundReducer", () => {
  it("opening a diagram shows its head without ever saving it", () => {
    const tester = openPage().send(loaded("d1", scene("d1")));

    expect(isCanvasEditable(tester.getState())).toBe(true);
    expect(tester.getEffects()).toEqual([
      { type: "load-head", diagramId: "d1", saveOpenHeadFirst: false },
      shown("d1", scene("d1")),
    ]);
  });

  it("a diagram whose head failed to load can't be edited until a retry loads it", () => {
    const tester = openPage().send({
      type: "head-load-failed",
      diagramId: "d1",
    });

    expect(isCanvasEditable(tester.getState())).toBe(false);
    expect(tester.getState().head).toMatchObject({
      diagramId: "d1",
      status: "failed",
    });

    tester.send({ type: "retry-load-clicked" }).send(loaded("d1", scene("d1")));

    expect(isCanvasEditable(tester.getState())).toBe(true);
    expect(tester.getEffects()).toEqual([
      { type: "load-head", diagramId: "d1", saveOpenHeadFirst: false },
      { type: "clear-canvas" },
      { type: "load-head", diagramId: "d1", saveOpenHeadFirst: false },
      shown("d1", scene("d1")),
    ]);
  });

  it("switching diagrams saves the one being left, but reloading the same one after a search restore does not", () => {
    const tester = openPage()
      .send(loaded("d1", scene("d1")))
      .resetExec()
      .send({ type: "diagram-opened", diagramId: "d2" })
      .send(loaded("d2", null))
      .send({ type: "head-moved-elsewhere", diagramId: "d2" });

    expect(isCanvasEditable(tester.getState())).toBe(false);
    expect(tester.getEffects()).toEqual([
      { type: "load-head", diagramId: "d2", saveOpenHeadFirst: true },
      shown("d2", null),
      { type: "load-head", diagramId: "d2", saveOpenHeadFirst: false },
    ]);
  });

  it("a head that arrives after the page has moved to another diagram is ignored", () => {
    const tester = openPage()
      .send({ type: "diagram-opened", diagramId: "d2" })
      .resetExec()
      .send(loaded("d1", scene("d1")))
      .send({ type: "head-load-failed", diagramId: "d1" });

    expect(tester.getState().head).toMatchObject({
      diagramId: "d2",
      status: "loading",
    });
    expect(tester.getEffects()).toEqual([]);
  });

  it("restoring over a canvas the timeline hasn't captured asks first, then shows the restored head", () => {
    const tester = openPage()
      .send(loaded("d1", scene("d1")))
      .resetExec()
      .send({
        type: "restore-requested",
        snapshot: snapshot("s1"),
        headIsCaptured: false,
        canvasIsEmpty: false,
        requestId: 7,
      });

    expect(tester.getState().pendingRestore).toEqual(snapshot("s1"));

    tester
      .send({ type: "restore-dismissed" })
      .send({ type: "restore-confirmed", snapshot: snapshot("s1") })
      .send({
        type: "restore-succeeded",
        diagramId: "d1",
        snapshot: snapshot("s1"),
        stored: storedHead("hash-s1", T1),
      });

    expect(tester.getState().pendingRestore).toBeNull();
    expect(tester.getEffects()).toEqual([
      { type: "release-restore-request", requestId: 7 },
      {
        type: "restore-snapshot",
        diagramId: "d1",
        snapshot: snapshot("s1"),
        requestId: null,
      },
      shown("d1", scene("s1"), { stored: storedHead("hash-s1", T1) }),
    ]);
  });

  it("restores straight away when the head is already on the timeline or the canvas is empty", () => {
    const tester = openPage()
      .send(loaded("d1", scene("d1")))
      .resetExec()
      .send({
        type: "restore-requested",
        snapshot: snapshot("s1"),
        headIsCaptured: true,
        canvasIsEmpty: false,
        requestId: 1,
      })
      .send({
        type: "restore-requested",
        snapshot: snapshot("s2"),
        headIsCaptured: false,
        canvasIsEmpty: true,
        requestId: 2,
      });

    expect(tester.getState().pendingRestore).toBeNull();
    expect(tester.getEffects()).toEqual([
      {
        type: "restore-snapshot",
        diagramId: "d1",
        snapshot: snapshot("s1"),
        requestId: 1,
      },
      {
        type: "restore-snapshot",
        diagramId: "d1",
        snapshot: snapshot("s2"),
        requestId: 2,
      },
    ]);
  });

  it("preserving ignores repeat clicks until it finishes, and a failure can be retried", () => {
    const tester = openPage()
      .send(loaded("d1", scene("d1")))
      .resetExec()
      .send({ type: "preserve-clicked" })
      .send({ type: "preserve-clicked" })
      .send({ type: "preserve-failed", reason: "empty-diagram" })
      .send({ type: "preserve-clicked" })
      .send({ type: "snapshot-preserved", created: true });

    expect(tester.getState().preserving).toBe(false);
    expect(tester.getEffects()).toEqual([
      { type: "preserve-snapshot", diagramId: "d1" },
      { type: "show-error", message: "Cannot preserve an empty diagram" },
      { type: "preserve-snapshot", diagramId: "d1" },
    ]);
  });

  it("creating a diagram ignores repeat clicks, then opens the new diagram", () => {
    const tester = openPage()
      .resetExec()
      .send({ type: "create-clicked" })
      .send({ type: "create-clicked" })
      .send({ type: "diagram-created", diagramId: "d9" });

    expect(tester.getState().creating).toBe(false);
    expect(tester.getEffects()).toEqual([
      { type: "create-diagram" },
      { type: "go-to-diagram", diagramId: "d9" },
    ]);
  });

  it("snapshots the open diagram for a clip, and refuses a clip aimed at another diagram", () => {
    const tester = openPage()
      .send(loaded("d1", scene("d1")))
      .resetExec()
      .send({
        type: "clip-snapshot-requested",
        clipId: "c1",
        diagramId: "d2",
        diagramName: "Other",
      })
      .send({
        type: "clip-snapshot-requested",
        clipId: "c2",
        diagramId: "d1",
        diagramName: "Open",
      })
      .send({
        type: "clip-snapshot-taken",
        clipId: "c2",
        diagramName: "Open",
        snapshotId: "s5",
      });

    expect(tester.getEffects()).toEqual([
      {
        type: "report-clip-snapshot",
        clipId: "c1",
        ok: false,
        snapshotId: null,
        diagramName: "Other",
      },
      {
        type: "take-clip-snapshot",
        clipId: "c2",
        diagramId: "d1",
        diagramName: "Open",
      },
      {
        type: "report-clip-snapshot",
        clipId: "c2",
        ok: true,
        snapshotId: "s5",
        diagramName: "Open",
      },
    ]);
  });

  it("hides the sidebar when a recording starts and shows it when it stops", () => {
    const tester = openPage()
      .resetExec()
      .send({ type: "recording-status-reported", recording: true });

    expect(tester.getEffects()).toEqual([
      { type: "set-focus-mode", isFocusMode: true },
    ]);

    tester
      .send({ type: "focus-mode-changed", isFocusMode: true })
      // The editor repeats its status on every heartbeat.
      .send({ type: "recording-status-reported", recording: true })
      .send({ type: "recording-status-reported", recording: false })
      .send({ type: "recording-status-reported", recording: false });

    expect(tester.getEffects()).toEqual([
      { type: "set-focus-mode", isFocusMode: true },
      { type: "set-focus-mode", isFocusMode: false },
    ]);
  });

  it("a sidebar toggled by hand during a recording stays as it was put", () => {
    const tester = openPage()
      .resetExec()
      .send({ type: "recording-status-reported", recording: true })
      .send({ type: "focus-mode-changed", isFocusMode: true })
      .send({ type: "focus-mode-changed", isFocusMode: false })
      .send({ type: "recording-status-reported", recording: true });

    expect(tester.getState().isFocusMode).toBe(false);
    expect(tester.getEffects()).toEqual([
      { type: "set-focus-mode", isFocusMode: true },
    ]);
  });
});

describe("keeping the Active Diagram in step with its stored head", () => {
  const reported = (
    stored: StoredHead,
    canvasHasUnsavedEdits: boolean,
    diagramId = "d1"
  ) => ({
    type: "stored-head-reported" as const,
    diagramId,
    stored,
    canvasHasUnsavedEdits,
  });

  /** `d1` open on a clean canvas, its head last written at T0. */
  const openD1 = () =>
    openPage()
      .send(loaded("d1", scene("d1")))
      .resetExec();

  it("a head saved elsewhere loads in place, camera kept, when the canvas has nothing unsaved", () => {
    const theirs = storedHead("theirs", T1);
    const tester = openD1().send(reported(theirs, false));

    expect(isCanvasEditable(tester.getState())).toBe(false);

    tester.send(loaded("d1", scene("theirs"), theirs));

    expect(isCanvasEditable(tester.getState())).toBe(true);
    expect(tester.getState().head?.seen).toEqual(theirs);
    expect(tester.getEffects()).toEqual([
      { type: "load-head", diagramId: "d1", saveOpenHeadFirst: false },
      shown("d1", scene("theirs"), { stored: theirs, centreCamera: false }),
    ]);
  });

  it("with unsaved edits, a head changed elsewhere asks first and overwrites neither side", () => {
    const tester = openD1()
      .send(reported(storedHead("theirs", T1), true))
      // The refetch keeps coming while the prompt is up.
      .send(reported(storedHead("theirs", T1), true));

    expect(tester.getState().head?.changedElsewhere).toBe(true);
    // The author can keep drawing; the server refuses to save over theirs.
    expect(isCanvasEditable(tester.getState())).toBe(true);
    expect(tester.getEffects()).toEqual([]);

    tester
      .send({ type: "head-save-started", diagramId: "d1" })
      .send({ type: "head-save-refused", diagramId: "d1" });

    expect(tester.getState().head?.changedElsewhere).toBe(true);
    expect(tester.getEffects()).toEqual([]);
  });

  it("reloading from the prompt drops the unsaved edits for the changed head", () => {
    const theirs = storedHead("theirs", T1);
    const tester = openD1()
      .send(reported(theirs, true))
      .send({ type: "load-changed-head-clicked" })
      .send(loaded("d1", scene("theirs"), theirs));

    expect(tester.getState().head?.changedElsewhere).toBe(false);
    expect(tester.getEffects()).toEqual([
      { type: "load-head", diagramId: "d1", saveOpenHeadFirst: false },
      shown("d1", scene("theirs"), { stored: theirs, centreCamera: false }),
    ]);
  });

  it("keeping my edits from the prompt saves them over the changed head", () => {
    const mine = storedHead("mine", T2);
    const tester = openD1()
      .send({ type: "head-save-started", diagramId: "d1" })
      .send({ type: "head-save-refused", diagramId: "d1" })
      .send({ type: "keep-my-edits-clicked" })
      .send({ type: "keep-my-edits-clicked" })
      .send({ type: "head-save-started", diagramId: "d1" })
      .send({ type: "head-saved", diagramId: "d1", stored: mine });

    expect(tester.getState().head).toMatchObject({
      changedElsewhere: false,
      saving: false,
      seen: mine,
    });
    expect(tester.getEffects()).toEqual([
      { type: "overwrite-stored-head", diagramId: "d1" },
    ]);
  });

  it("the tab's own autosaves never read as a change elsewhere", () => {
    const mine = storedHead("mine", T1);
    const tester = openD1()
      .send({ type: "head-save-started", diagramId: "d1" })
      // The refetch sees our write land before the save's reply does.
      .send(reported(mine, true))
      .send({ type: "head-saved", diagramId: "d1", stored: mine })
      // A refetch that left before the save landed, arriving after it.
      .send(reported(storedHead("head-d1", T0), false))
      .send(reported(mine, false));

    expect(tester.getState().head).toMatchObject({
      status: "ready",
      changedElsewhere: false,
      seen: mine,
    });
    expect(tester.getEffects()).toEqual([]);
  });

  it("a report for a diagram the page has left, or one still loading, is ignored", () => {
    const tester = openPage()
      .resetExec()
      .send(reported(storedHead("theirs", T1), false))
      .send(loaded("d1", scene("d1")))
      .resetExec()
      .send(reported(storedHead("theirs", T1), false, "d2"));

    expect(tester.getState().head?.status).toBe("ready");
    expect(tester.getEffects()).toEqual([]);
  });
});
