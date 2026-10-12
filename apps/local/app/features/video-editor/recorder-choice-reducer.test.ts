import { describe, expect, it } from "vitest";
import {
  createInitialRecorderChoiceState,
  isRecorderLocked,
  recorderChoiceReducer,
  showsCvmRecorderControls,
  showsOBSChecks,
} from "./recorder-choice-reducer";
import type { TimelineItem } from "./clip-state-reducer";
import type { OBSConnectionOuterState } from "./obs-connector";

type Effect = { type: string; [key: string]: unknown };

const run = (
  state: recorderChoiceReducer.State,
  ...actions: recorderChoiceReducer.Action[]
) => {
  const effects: Effect[] = [];
  const next = actions.reduce(
    (s, action) =>
      recorderChoiceReducer(s, action, ((e: Effect) => {
        effects.push(e);
      }) as never),
    state
  );
  return { state: next, effects };
};

const landscape = (recorder: string | null = null) =>
  createInitialRecorderChoiceState({ format: "landscape", recorder });

const notRunning: OBSConnectionOuterState = { type: "obs-not-running" };
const recording: OBSConnectionOuterState = {
  type: "obs-recording",
  profile: "Landscape",
  scene: "Camera",
  latestOutputPath: "/out.mkv",
};
const chapter = {
  type: "chapter-on-database",
  frontendId: "c1",
  databaseId: "c1",
  name: "Intro",
  insertionOrder: null,
} as unknown as TimelineItem;
const clip = { type: "on-database", frontendId: "k1" } as TimelineItem;

describe("recorder choice", () => {
  it("every existing Video reads as OBS and shows the OBS checks", () => {
    const state = landscape(null);
    expect(state.recorder).toBe("obs");
    expect(showsOBSChecks(state)).toBe(true);
    expect(showsCvmRecorderControls(state)).toBe(false);
  });

  it("picking the CVM recorder saves it, hides the OBS checks, and remembers it as the last choice once saved", () => {
    const picked = run(landscape(), {
      type: "recorder-picked",
      recorder: "cvm",
      locked: false,
    });
    expect(picked.state.recorder).toBe("cvm");
    expect(showsOBSChecks(picked.state)).toBe(false);
    // Record, the scene buttons and the composite preview.
    expect(showsCvmRecorderControls(picked.state)).toBe(true);
    expect(picked.effects).toEqual([
      { type: "save-recorder", recorder: "cvm" },
    ]);
    const saved = run(picked.state, {
      type: "recorder-saved",
      recorder: "cvm",
    });
    expect(saved.effects).toEqual([
      { type: "remember-recorder-choice", recorder: "cvm" },
    ]);
  });

  it("a locked choice does not change", () => {
    const { state, effects } = run(landscape("obs"), {
      type: "recorder-picked",
      recorder: "cvm",
      locked: true,
    });
    expect(state.recorder).toBe("obs");
    expect(effects).toEqual([]);
  });

  it("a Short offers both Recorders and is picked like a Landscape Video", () => {
    const short = createInitialRecorderChoiceState({
      format: "short",
      recorder: null,
    });
    expect(short.options).toEqual(["obs", "cvm"]);
    expect(short.recorder).toBe("obs");
    const { state, effects } = run(short, {
      type: "recorder-picked",
      recorder: "cvm",
      locked: false,
    });
    expect(state.recorder).toBe("cvm");
    expect(effects).toEqual([{ type: "save-recorder", recorder: "cvm" }]);
    expect(
      createInitialRecorderChoiceState({ format: "short", recorder: "cvm" })
        .recorder
    ).toBe("cvm");
  });

  it("a failed save goes back to the saved Recorder, says why and is not remembered", () => {
    const { state, effects } = run(
      landscape("obs"),
      { type: "recorder-picked", recorder: "cvm", locked: false },
      {
        type: "recorder-save-failed",
        recorder: "cvm",
        message: "The Recorder is locked once the Video has Clips",
      }
    );
    expect(state.recorder).toBe("obs");
    expect(state.error).toBe("The Recorder is locked once the Video has Clips");
    expect(effects).not.toContainEqual(
      expect.objectContaining({ type: "remember-recorder-choice" })
    );
  });

  it("a stale failure after a newer pick changes nothing", () => {
    const { state } = run(
      landscape("obs"),
      { type: "recorder-picked", recorder: "cvm", locked: false },
      { type: "recorder-picked", recorder: "obs", locked: false },
      { type: "recorder-save-failed", recorder: "cvm", message: "x" }
    );
    expect(state.recorder).toBe("obs");
    expect(state.error).toBeNull();
  });
});

describe("isRecorderLocked", () => {
  it("is unlocked on a Video with no Clips", () => {
    expect(isRecorderLocked(notRunning, [chapter], [])).toBe(false);
  });

  it("locks once the Video has a Clip", () => {
    expect(isRecorderLocked(notRunning, [chapter, clip], [])).toBe(true);
  });

  it("is unlocked once every Clip is archived", () => {
    const archived = {
      type: "on-database",
      frontendId: "k2",
      shouldArchive: true,
    } as TimelineItem;
    expect(isRecorderLocked(notRunning, [chapter, archived], [])).toBe(false);
  });

  it("locks while OBS is recording, before any Clip lands", () => {
    expect(isRecorderLocked(recording, [], [])).toBe(true);
  });
});
