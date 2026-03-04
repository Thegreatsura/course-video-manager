import { describe, expect, it } from "vitest";
import type {
  Clip,
  ClipOnDatabase,
  ClipOptimisticallyAdded,
  ClipSection,
  FrontendId,
  FrontendInsertionPoint,
  SessionId,
  TimelineItem,
} from "./clip-state-reducer";
import type { OBSConnectionOuterState } from "./obs-connector";
import type { RecordingSession } from "./clip-state-reducer";
import {
  DANGEROUS_TEXT_SIMILARITY_THRESHOLD,
  getClips,
  getCurrentClipIndex,
  getNextClip,
  getSelectedClipId,
  getClipsToAggressivelyPreload,
  getTotalDuration,
  getShowVideoPlayer,
  getShowLiveStream,
  getShowLastFrame,
  getDatabaseClipBeforeInsertionPoint,
  getCurrentClip,
  getAllClipsHaveSilenceDetected,
  getAllClipsHaveText,
  getClipComputedProps,
  getAreAnyClipsDangerous,
  getClipDuration,
  getClipPercentComplete,
  getIsClipPortrait,
  getIsClipDangerous,
  getLastTranscribedClipId,
  getClipSections,
  getHasSections,
  getIsOBSActive,
  getIsLiveStreamPortrait,
  getShouldShowLastFrameOverlay,
  getBackButtonUrl,
  getShowCenterLine,
  getTimelineItems,
  getSessionPanels,
} from "./video-editor-selectors";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const makeClipOnDatabase = (
  overrides: Partial<ClipOnDatabase> & { frontendId: FrontendId }
): ClipOnDatabase => ({
  type: "on-database",
  databaseId: `db-${overrides.frontendId}` as any,
  videoFilename: "video.mp4",
  sourceStartTime: 0,
  sourceEndTime: 5,
  text: "hello world",
  transcribedAt: new Date(),
  scene: null,
  profile: null,
  insertionOrder: null,
  beatType: "none",
  ...overrides,
});

const makeOptimisticClip = (
  overrides: Partial<ClipOptimisticallyAdded> & { frontendId: FrontendId }
): ClipOptimisticallyAdded => ({
  type: "optimistically-added",
  scene: "Camera",
  profile: "Default",
  insertionOrder: 0,
  beatType: "none",
  soundDetectionId: "sd-1",
  sessionId: "test-session" as SessionId,
  ...overrides,
});

const makeClipSection = (
  frontendId: FrontendId,
  name: string
): ClipSection => ({
  type: "clip-section-on-database",
  frontendId,
  databaseId: `db-${frontendId}` as any,
  name,
  insertionOrder: null,
});

const id = (s: string) => s as FrontendId;
const sid = (s: string) => s as SessionId;

const makeSession = (
  overrides: Partial<RecordingSession> & { id: SessionId }
): RecordingSession => ({
  displayNumber: 1,
  status: "recording",
  outputPath: "/tmp/test.mkv",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Top-level selectors
// ---------------------------------------------------------------------------

describe("getClips", () => {
  it("filters out clip sections", () => {
    const items: TimelineItem[] = [
      makeClipSection(id("s1"), "Intro"),
      makeClipOnDatabase({ frontendId: id("c1") }),
      makeClipSection(id("s2"), "Body"),
      makeClipOnDatabase({ frontendId: id("c2") }),
    ];
    const clips = getClips(items);
    expect(clips).toHaveLength(2);
    expect(clips.map((c) => c.frontendId)).toEqual([id("c1"), id("c2")]);
  });

  it("returns empty array for no clips", () => {
    expect(getClips([])).toEqual([]);
  });
});

describe("getCurrentClipIndex", () => {
  const clips = [
    makeClipOnDatabase({ frontendId: id("a") }),
    makeClipOnDatabase({ frontendId: id("b") }),
  ];

  it("returns index of matching clip", () => {
    expect(getCurrentClipIndex(clips, id("b"))).toBe(1);
  });

  it("returns -1 when not found", () => {
    expect(getCurrentClipIndex(clips, id("z"))).toBe(-1);
  });

  it("returns -1 for undefined", () => {
    expect(getCurrentClipIndex(clips, undefined)).toBe(-1);
  });
});

describe("getNextClip", () => {
  const clips = [
    makeClipOnDatabase({ frontendId: id("a") }),
    makeClipOnDatabase({ frontendId: id("b") }),
    makeClipOnDatabase({ frontendId: id("c") }),
  ];

  it("returns the clip after the current one", () => {
    expect(getNextClip(clips, id("a"))?.frontendId).toBe(id("b"));
  });

  it("returns undefined for the last clip", () => {
    expect(getNextClip(clips, id("c"))).toBeUndefined();
  });

  it("returns first clip when current clip not found (index -1 + 1 = 0)", () => {
    expect(getNextClip(clips, id("z"))?.frontendId).toBe(id("a"));
  });
});

describe("getSelectedClipId", () => {
  it("returns first selected clip", () => {
    const set = new Set([id("a"), id("b")]);
    expect(getSelectedClipId(set)).toBe(id("a"));
  });

  it("returns undefined for empty set", () => {
    expect(getSelectedClipId(new Set())).toBeUndefined();
  });
});

describe("getClipsToAggressivelyPreload", () => {
  const clips = [
    makeClipOnDatabase({ frontendId: id("a") }),
    makeClipOnDatabase({ frontendId: id("b") }),
    makeClipOnDatabase({ frontendId: id("c") }),
  ];

  it("includes current, next, and selected clip ids", () => {
    const result = getClipsToAggressivelyPreload(
      id("a"),
      clips,
      new Set([id("c")])
    );
    expect(result).toEqual([id("a"), id("b"), id("c")]);
  });

  it("deduplicates nothing (duplicates kept as in current behavior)", () => {
    // When selected clip IS the next clip, both appear
    const result = getClipsToAggressivelyPreload(
      id("a"),
      clips,
      new Set([id("b")])
    );
    expect(result).toEqual([id("a"), id("b"), id("b")]);
  });

  it("handles undefined currentClipId", () => {
    const result = getClipsToAggressivelyPreload(undefined, clips, new Set());
    // currentClipId undefined -> filtered out, but getNextClip returns clips[0] (index -1+1=0)
    expect(result).toEqual([id("a")]);
  });
});

describe("getTotalDuration", () => {
  it("sums on-database clip durations", () => {
    const clips = [
      makeClipOnDatabase({
        frontendId: id("a"),
        sourceStartTime: 0,
        sourceEndTime: 10,
      }),
      makeClipOnDatabase({
        frontendId: id("b"),
        sourceStartTime: 5,
        sourceEndTime: 15,
      }),
    ];
    expect(getTotalDuration(clips)).toBe(20);
  });

  it("ignores optimistically-added clips", () => {
    const clips: Clip[] = [
      makeClipOnDatabase({
        frontendId: id("a"),
        sourceStartTime: 0,
        sourceEndTime: 10,
      }),
      makeOptimisticClip({ frontendId: id("b") }),
    ];
    expect(getTotalDuration(clips)).toBe(10);
  });

  it("returns 0 for empty array", () => {
    expect(getTotalDuration([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// viewMode -> boolean selectors
// ---------------------------------------------------------------------------

describe("getShowVideoPlayer", () => {
  it("returns true when playing", () => {
    expect(getShowVideoPlayer("playing")).toBe(true);
  });

  it("returns false when paused", () => {
    expect(getShowVideoPlayer("paused")).toBe(false);
  });
});

describe("getShowLiveStream", () => {
  it("returns true when stream exists and paused", () => {
    expect(getShowLiveStream(true, "paused")).toBe(true);
  });

  it("returns false when playing even with stream", () => {
    expect(getShowLiveStream(true, "playing")).toBe(false);
  });

  it("returns false when no stream", () => {
    expect(getShowLiveStream(false, "paused")).toBe(false);
  });
});

describe("getShowLastFrame", () => {
  it("returns true when flag is set", () => {
    expect(getShowLastFrame(true)).toBe(true);
  });

  it("returns false when flag is not set", () => {
    expect(getShowLastFrame(false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getDatabaseClipBeforeInsertionPoint
// ---------------------------------------------------------------------------

describe("getDatabaseClipBeforeInsertionPoint", () => {
  const items: TimelineItem[] = [
    makeClipOnDatabase({ frontendId: id("a") }),
    makeOptimisticClip({ frontendId: id("b") }),
    makeClipOnDatabase({ frontendId: id("c") }),
  ];

  it("returns undefined for start insertion point", () => {
    expect(
      getDatabaseClipBeforeInsertionPoint(items, { type: "start" })
    ).toBeUndefined();
  });

  it("returns last database clip for end insertion point", () => {
    const result = getDatabaseClipBeforeInsertionPoint(items, { type: "end" });
    expect(result?.frontendId).toBe(id("c"));
  });

  it("returns the clip for after-clip insertion point", () => {
    const insertionPoint: FrontendInsertionPoint = {
      type: "after-clip",
      frontendClipId: id("a"),
    };
    const result = getDatabaseClipBeforeInsertionPoint(items, insertionPoint);
    expect(result?.frontendId).toBe(id("a"));
  });

  it("returns undefined for after-clip pointing at optimistic clip", () => {
    const insertionPoint: FrontendInsertionPoint = {
      type: "after-clip",
      frontendClipId: id("b"),
    };
    expect(
      getDatabaseClipBeforeInsertionPoint(items, insertionPoint)
    ).toBeUndefined();
  });

  it("returns the last database clip before a clip section", () => {
    const itemsWithSection: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("a") }),
      makeClipOnDatabase({ frontendId: id("b") }),
      makeClipSection(id("s1"), "Intro"),
      makeClipOnDatabase({ frontendId: id("c") }),
    ];
    const result = getDatabaseClipBeforeInsertionPoint(itemsWithSection, {
      type: "after-clip-section",
      frontendClipSectionId: id("s1"),
    });
    expect(result?.frontendId).toBe(id("b"));
  });

  it("returns undefined when clip section is at the start", () => {
    const itemsWithSection: TimelineItem[] = [
      makeClipSection(id("s1"), "Intro"),
      makeClipOnDatabase({ frontendId: id("a") }),
    ];
    expect(
      getDatabaseClipBeforeInsertionPoint(itemsWithSection, {
        type: "after-clip-section",
        frontendClipSectionId: id("s1"),
      })
    ).toBeUndefined();
  });

  it("returns the database clip when section follows it directly", () => {
    const itemsWithSection: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("a") }),
      makeClipSection(id("s1"), "Body"),
    ];
    const result = getDatabaseClipBeforeInsertionPoint(itemsWithSection, {
      type: "after-clip-section",
      frontendClipSectionId: id("s1"),
    });
    expect(result?.frontendId).toBe(id("a"));
  });

  it("skips optimistic clips when looking before a section", () => {
    const itemsWithSection: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("a") }),
      makeOptimisticClip({ frontendId: id("b") }),
      makeClipSection(id("s1"), "Body"),
      makeClipOnDatabase({ frontendId: id("c") }),
    ];
    const result = getDatabaseClipBeforeInsertionPoint(itemsWithSection, {
      type: "after-clip-section",
      frontendClipSectionId: id("s1"),
    });
    expect(result?.frontendId).toBe(id("a"));
  });
});

// ---------------------------------------------------------------------------
// getCurrentClip
// ---------------------------------------------------------------------------

describe("getCurrentClip", () => {
  const clips = [
    makeClipOnDatabase({ frontendId: id("a") }),
    makeClipOnDatabase({ frontendId: id("b") }),
  ];

  it("finds the current clip", () => {
    expect(getCurrentClip(clips, id("b"))?.frontendId).toBe(id("b"));
  });

  it("returns undefined when not found", () => {
    expect(getCurrentClip(clips, id("z"))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// allClips checks
// ---------------------------------------------------------------------------

describe("getAllClipsHaveSilenceDetected", () => {
  it("returns true when all clips are on-database", () => {
    const clips = [
      makeClipOnDatabase({ frontendId: id("a") }),
      makeClipOnDatabase({ frontendId: id("b") }),
    ];
    expect(getAllClipsHaveSilenceDetected(clips)).toBe(true);
  });

  it("returns false when any clip is optimistic", () => {
    const clips: Clip[] = [
      makeClipOnDatabase({ frontendId: id("a") }),
      makeOptimisticClip({ frontendId: id("b") }),
    ];
    expect(getAllClipsHaveSilenceDetected(clips)).toBe(false);
  });

  it("returns true for empty array", () => {
    expect(getAllClipsHaveSilenceDetected([])).toBe(true);
  });
});

describe("getAllClipsHaveText", () => {
  it("returns true when all database clips have text", () => {
    const clips = [
      makeClipOnDatabase({ frontendId: id("a"), text: "hello" }),
      makeClipOnDatabase({ frontendId: id("b"), text: "world" }),
    ];
    expect(getAllClipsHaveText(clips)).toBe(true);
  });

  it("returns false when a clip has empty text", () => {
    const clips = [
      makeClipOnDatabase({ frontendId: id("a"), text: "hello" }),
      makeClipOnDatabase({ frontendId: id("b"), text: "" }),
    ];
    expect(getAllClipsHaveText(clips)).toBe(false);
  });

  it("returns false for optimistic clips", () => {
    const clips: Clip[] = [makeOptimisticClip({ frontendId: id("a") })];
    expect(getAllClipsHaveText(clips)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getClipComputedProps
// ---------------------------------------------------------------------------

describe("getClipComputedProps", () => {
  it("computes timecodes cumulatively", () => {
    const clips = [
      makeClipOnDatabase({
        frontendId: id("a"),
        sourceStartTime: 0,
        sourceEndTime: 65,
        text: "first",
      }),
      makeClipOnDatabase({
        frontendId: id("b"),
        sourceStartTime: 0,
        sourceEndTime: 5,
        text: "second",
      }),
    ];
    const props = getClipComputedProps(clips);
    expect(props.get(id("a"))?.timecode).toBe("0:00");
    expect(props.get(id("b"))?.timecode).toBe("1:05");
  });

  it("sets timecode to empty string for optimistic clips", () => {
    const clips: Clip[] = [makeOptimisticClip({ frontendId: id("a") })];
    const props = getClipComputedProps(clips);
    expect(props.get(id("a"))?.timecode).toBe("");
    expect(props.get(id("a"))?.nextLevenshtein).toBe(0);
  });

  it("computes levenshtein similarity between consecutive clips", () => {
    const clips = [
      makeClipOnDatabase({
        frontendId: id("a"),
        text: "hello world",
      }),
      makeClipOnDatabase({
        frontendId: id("b"),
        text: "hello world",
      }),
    ];
    const props = getClipComputedProps(clips);
    // Identical text -> 100% similarity
    expect(props.get(id("a"))?.nextLevenshtein).toBe(100);
    // Last clip has no next -> 0
    expect(props.get(id("b"))?.nextLevenshtein).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getAreAnyClipsDangerous
// ---------------------------------------------------------------------------

describe("getAreAnyClipsDangerous", () => {
  it("returns true when consecutive clips have high similarity", () => {
    const clips = [
      makeClipOnDatabase({ frontendId: id("a"), text: "hello world" }),
      makeClipOnDatabase({ frontendId: id("b"), text: "hello world" }),
    ];
    expect(getAreAnyClipsDangerous(clips)).toBe(true);
  });

  it("returns false when clips are sufficiently different", () => {
    const clips = [
      makeClipOnDatabase({ frontendId: id("a"), text: "the quick brown fox" }),
      makeClipOnDatabase({
        frontendId: id("b"),
        text: "completely different text here",
      }),
    ];
    expect(getAreAnyClipsDangerous(clips)).toBe(false);
  });

  it("returns false for empty clips", () => {
    expect(getAreAnyClipsDangerous([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Per-clip selectors
// ---------------------------------------------------------------------------

describe("getClipDuration", () => {
  it("returns duration for on-database clips", () => {
    const clip = makeClipOnDatabase({
      frontendId: id("a"),
      sourceStartTime: 10,
      sourceEndTime: 25,
    });
    expect(getClipDuration(clip)).toBe(15);
  });

  it("returns null for optimistic clips", () => {
    const clip = makeOptimisticClip({ frontendId: id("a") });
    expect(getClipDuration(clip)).toBeNull();
  });
});

describe("getClipPercentComplete", () => {
  it("returns fraction of duration", () => {
    const clip = makeClipOnDatabase({
      frontendId: id("a"),
      sourceStartTime: 0,
      sourceEndTime: 10,
    });
    expect(getClipPercentComplete(clip, 5)).toBe(0.5);
  });

  it("returns 0 for optimistic clips", () => {
    const clip = makeOptimisticClip({ frontendId: id("a") });
    expect(getClipPercentComplete(clip, 5)).toBe(0);
  });
});

describe("getIsClipPortrait", () => {
  it("returns true for TikTok profile", () => {
    const clip = makeClipOnDatabase({
      frontendId: id("a"),
      profile: "TikTok",
    });
    expect(getIsClipPortrait(clip)).toBe(true);
  });

  it("returns true for Portrait profile", () => {
    const clip = makeClipOnDatabase({
      frontendId: id("a"),
      profile: "Portrait",
    });
    expect(getIsClipPortrait(clip)).toBe(true);
  });

  it("returns false for other profiles", () => {
    const clip = makeClipOnDatabase({
      frontendId: id("a"),
      profile: "Default",
    });
    expect(getIsClipPortrait(clip)).toBe(false);
  });

  it("returns false for optimistic clips", () => {
    const clip = makeOptimisticClip({ frontendId: id("a") });
    expect(getIsClipPortrait(clip)).toBe(false);
  });
});

describe("getIsClipDangerous", () => {
  it("returns true when levenshtein exceeds threshold", () => {
    const clip = makeClipOnDatabase({ frontendId: id("a") });
    const map = new Map([[id("a"), { timecode: "0:00", nextLevenshtein: 80 }]]);
    expect(getIsClipDangerous(clip, map)).toBe(true);
  });

  it("returns false below threshold", () => {
    const clip = makeClipOnDatabase({ frontendId: id("a") });
    const map = new Map([[id("a"), { timecode: "0:00", nextLevenshtein: 20 }]]);
    expect(getIsClipDangerous(clip, map)).toBe(false);
  });

  it("returns false at exact threshold", () => {
    const clip = makeClipOnDatabase({ frontendId: id("a") });
    const map = new Map([
      [
        id("a"),
        {
          timecode: "0:00",
          nextLevenshtein: DANGEROUS_TEXT_SIMILARITY_THRESHOLD,
        },
      ],
    ]);
    expect(getIsClipDangerous(clip, map)).toBe(false);
  });

  it("returns false for optimistic clips", () => {
    const clip = makeOptimisticClip({ frontendId: id("a") });
    const map = new Map([[id("a"), { timecode: "", nextLevenshtein: 80 }]]);
    expect(getIsClipDangerous(clip, map)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Panel selectors
// ---------------------------------------------------------------------------

describe("getLastTranscribedClipId", () => {
  it("returns the last clip with text", () => {
    const clips = [
      makeClipOnDatabase({ frontendId: id("a"), text: "hello" }),
      makeClipOnDatabase({ frontendId: id("b"), text: "world" }),
      makeClipOnDatabase({ frontendId: id("c"), text: "" }),
    ];
    expect(getLastTranscribedClipId(clips)).toBe(id("b"));
  });

  it("returns null when no clips have text", () => {
    const clips = [makeClipOnDatabase({ frontendId: id("a"), text: "" })];
    expect(getLastTranscribedClipId(clips)).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(getLastTranscribedClipId([])).toBeNull();
  });
});

describe("getClipSections", () => {
  it("filters items to clip sections only", () => {
    const items: TimelineItem[] = [
      makeClipSection(id("s1"), "Intro"),
      makeClipOnDatabase({ frontendId: id("c1") }),
      makeClipSection(id("s2"), "Body"),
    ];
    const sections = getClipSections(items);
    expect(sections).toHaveLength(2);
    expect(sections.map((s) => s.name)).toEqual(["Intro", "Body"]);
  });
});

describe("getHasSections", () => {
  it("returns true when sections exist", () => {
    const items: TimelineItem[] = [
      makeClipSection(id("s1"), "Intro"),
      makeClipOnDatabase({ frontendId: id("c1") }),
    ];
    expect(getHasSections(items)).toBe(true);
  });

  it("returns false when no sections", () => {
    const items: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("c1") }),
    ];
    expect(getHasSections(items)).toBe(false);
  });

  it("returns false for empty array", () => {
    expect(getHasSections([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OBS and live stream selectors
// ---------------------------------------------------------------------------

const obsNotRunning: OBSConnectionOuterState = { type: "obs-not-running" };
const obsConnected: OBSConnectionOuterState = {
  type: "obs-connected",
  profile: "Default",
  scene: "Camera",
  latestOutputPath: null,
};
const obsRecording: OBSConnectionOuterState = {
  type: "obs-recording",
  profile: "Default",
  scene: "Camera",
  latestOutputPath: "/output/path",
};

describe("getIsOBSActive", () => {
  it("returns true when OBS is connected", () => {
    expect(getIsOBSActive(obsConnected)).toBe(true);
  });

  it("returns true when OBS is recording", () => {
    expect(getIsOBSActive(obsRecording)).toBe(true);
  });

  it("returns false when OBS is not running", () => {
    expect(getIsOBSActive(obsNotRunning)).toBe(false);
  });
});

describe("getIsLiveStreamPortrait", () => {
  it("returns true when OBS is active with TikTok profile", () => {
    expect(
      getIsLiveStreamPortrait({ ...obsConnected, profile: "TikTok" })
    ).toBe(true);
  });

  it("returns true when OBS is recording with TikTok profile", () => {
    expect(
      getIsLiveStreamPortrait({ ...obsRecording, profile: "TikTok" })
    ).toBe(true);
  });

  it("returns false when OBS is active with non-TikTok profile", () => {
    expect(getIsLiveStreamPortrait(obsConnected)).toBe(false);
  });

  it("returns false when OBS is not running", () => {
    expect(getIsLiveStreamPortrait(obsNotRunning)).toBe(false);
  });
});

describe("getShouldShowLastFrameOverlay", () => {
  const clip = makeClipOnDatabase({
    frontendId: id("a"),
    scene: "Camera",
  });

  it("returns false when no clip provided", () => {
    expect(getShouldShowLastFrameOverlay(undefined, true, obsRecording)).toBe(
      false
    );
  });

  it("returns false when showLastFrame is false", () => {
    expect(getShouldShowLastFrameOverlay(clip, false, obsRecording)).toBe(
      false
    );
  });

  it("returns true when OBS is not running (defaults to showing)", () => {
    expect(getShouldShowLastFrameOverlay(clip, true, obsNotRunning)).toBe(true);
  });

  it("returns true when clip scene matches OBS scene", () => {
    const state: OBSConnectionOuterState = {
      ...obsRecording,
      scene: "Camera",
    };
    expect(getShouldShowLastFrameOverlay(clip, true, state)).toBe(true);
  });

  it("returns false when clip scene does not match OBS scene", () => {
    const state: OBSConnectionOuterState = {
      ...obsRecording,
      scene: "Screen",
    };
    expect(getShouldShowLastFrameOverlay(clip, true, state)).toBe(false);
  });

  it("returns true when clip has no scene (null)", () => {
    const clipNoScene = makeClipOnDatabase({
      frontendId: id("b"),
      scene: null,
    });
    expect(getShouldShowLastFrameOverlay(clipNoScene, true, obsRecording)).toBe(
      true
    );
  });

  it("returns true when OBS is connected (not recording) and scenes match", () => {
    expect(getShouldShowLastFrameOverlay(clip, true, obsConnected)).toBe(true);
  });
});

describe("getBackButtonUrl", () => {
  it("returns lesson-specific URL when repoId and lessonId exist", () => {
    expect(getBackButtonUrl("repo-1", "lesson-1")).toBe(
      "/?repoId=repo-1#lesson-1"
    );
  });

  it("returns /videos when repoId is missing", () => {
    expect(getBackButtonUrl(undefined, "lesson-1")).toBe("/videos");
  });

  it("returns /videos when lessonId is missing", () => {
    expect(getBackButtonUrl("repo-1", undefined)).toBe("/videos");
  });

  it("returns /videos when both are missing", () => {
    expect(getBackButtonUrl(undefined, undefined)).toBe("/videos");
  });
});

describe("getShowCenterLine", () => {
  it("returns true when OBS is active and scene is Camera", () => {
    expect(getShowCenterLine({ ...obsConnected, scene: "Camera" })).toBe(true);
  });

  it("returns false when OBS is active but scene is not Camera", () => {
    expect(getShowCenterLine({ ...obsConnected, scene: "Screen" })).toBe(false);
  });

  it("returns false when OBS is not running", () => {
    expect(getShowCenterLine(obsNotRunning)).toBe(false);
  });

  it("returns true when OBS is recording with Camera scene", () => {
    expect(getShowCenterLine({ ...obsRecording, scene: "Camera" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getTimelineItems
// ---------------------------------------------------------------------------

describe("getTimelineItems", () => {
  it("excludes optimistically-added clips", () => {
    const items: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("c1") }),
      makeOptimisticClip({ frontendId: id("c2") }),
      makeClipOnDatabase({ frontendId: id("c3") }),
    ];
    const result = getTimelineItems(items);
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.frontendId)).toEqual([id("c1"), id("c3")]);
  });

  it("includes on-database clips", () => {
    const items: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("c1") }),
      makeClipOnDatabase({ frontendId: id("c2") }),
    ];
    const result = getTimelineItems(items);
    expect(result).toHaveLength(2);
  });

  it("includes clip sections (on-database)", () => {
    const items: TimelineItem[] = [
      makeClipSection(id("s1"), "Intro"),
      makeClipOnDatabase({ frontendId: id("c1") }),
      makeClipSection(id("s2"), "Body"),
    ];
    const result = getTimelineItems(items);
    expect(result).toHaveLength(3);
  });

  it("excludes clip sections with shouldArchive", () => {
    const items: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("c1") }),
      {
        type: "clip-section-optimistically-added",
        frontendId: id("s1"),
        name: "Archived Section",
        insertionOrder: 1,
        shouldArchive: true,
      },
      makeClipSection(id("s2"), "Visible Section"),
    ];
    const result = getTimelineItems(items);
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.frontendId)).toEqual([id("c1"), id("s2")]);
  });

  it("excludes on-database clips with shouldArchive", () => {
    const items: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("c1") }),
      makeClipOnDatabase({ frontendId: id("c2"), shouldArchive: true }),
      makeClipOnDatabase({ frontendId: id("c3") }),
    ];
    const result = getTimelineItems(items);
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.frontendId)).toEqual([id("c1"), id("c3")]);
  });

  it("returns empty array for empty input", () => {
    expect(getTimelineItems([])).toEqual([]);
  });

  it("returns empty array when all items are optimistic clips", () => {
    const items: TimelineItem[] = [
      makeOptimisticClip({ frontendId: id("c1") }),
      makeOptimisticClip({ frontendId: id("c2") }),
    ];
    expect(getTimelineItems(items)).toEqual([]);
  });

  it("preserves order of remaining items", () => {
    const items: TimelineItem[] = [
      makeClipSection(id("s1"), "Intro"),
      makeOptimisticClip({ frontendId: id("c1") }),
      makeClipOnDatabase({ frontendId: id("c2") }),
      makeOptimisticClip({ frontendId: id("c3") }),
      makeClipSection(id("s2"), "Body"),
      makeClipOnDatabase({ frontendId: id("c4") }),
    ];
    const result = getTimelineItems(items);
    expect(result.map((i) => i.frontendId)).toEqual([
      id("s1"),
      id("c2"),
      id("s2"),
      id("c4"),
    ]);
  });
});

// ---------------------------------------------------------------------------
// getSessionPanels
// ---------------------------------------------------------------------------

describe("getSessionPanels", () => {
  it("groups pending optimistic clips by session", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1 }),
      makeSession({ id: sid("s2"), displayNumber: 2 }),
    ];
    const items: TimelineItem[] = [
      makeOptimisticClip({ frontendId: id("c1"), sessionId: sid("s1") }),
      makeOptimisticClip({ frontendId: id("c2"), sessionId: sid("s2") }),
      makeOptimisticClip({ frontendId: id("c3"), sessionId: sid("s1") }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(2);
    expect(panels[0]!.sessionId).toBe(sid("s1"));
    expect(panels[0]!.pendingClips.map((c) => c.frontendId)).toEqual([
      id("c1"),
      id("c3"),
    ]);
    expect(panels[1]!.sessionId).toBe(sid("s2"));
    expect(panels[1]!.pendingClips.map((c) => c.frontendId)).toEqual([
      id("c2"),
    ]);
  });

  it("excludes non-recording sessions with no pending clips", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1, status: "done" }),
      makeSession({ id: sid("s2"), displayNumber: 2, status: "done" }),
    ];
    const items: TimelineItem[] = [
      makeOptimisticClip({ frontendId: id("c1"), sessionId: sid("s1") }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.sessionId).toBe(sid("s1"));
  });

  it("excludes shouldArchive optimistic clips from pending", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1 }),
    ];
    const items: TimelineItem[] = [
      makeOptimisticClip({ frontendId: id("c1"), sessionId: sid("s1") }),
      makeOptimisticClip({
        frontendId: id("c2"),
        sessionId: sid("s1"),
        shouldArchive: true,
      }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.pendingClips).toHaveLength(1);
    expect(panels[0]!.pendingClips[0]!.frontendId).toBe(id("c1"));
  });

  it("ignores non-optimistic items", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1 }),
    ];
    const items: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("c1") }),
      makeClipSection(id("s1"), "Intro"),
      makeOptimisticClip({ frontendId: id("c2"), sessionId: sid("s1") }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.pendingClips).toHaveLength(1);
  });

  it("returns empty array when no sessions exist", () => {
    const items: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("c1") }),
    ];
    expect(getSessionPanels(items, [])).toEqual([]);
  });

  it("includes archived optimistic clips in archivedClips", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1 }),
    ];
    const items: TimelineItem[] = [
      makeOptimisticClip({
        frontendId: id("c1"),
        sessionId: sid("s1"),
        shouldArchive: true,
      }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.pendingClips).toHaveLength(0);
    expect(panels[0]!.archivedClips).toHaveLength(1);
    expect(panels[0]!.archivedClips[0]!.frontendId).toBe(id("c1"));
  });

  it("includes archived ClipOnDatabase clips in archivedClips", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1 }),
    ];
    const items: TimelineItem[] = [
      makeClipOnDatabase({
        frontendId: id("c1"),
        shouldArchive: true,
        sessionId: sid("s1"),
      }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.pendingClips).toHaveLength(0);
    expect(panels[0]!.archivedClips).toHaveLength(1);
    expect(panels[0]!.archivedClips[0]!.frontendId).toBe(id("c1"));
  });

  it("shows session with both pending and archived clips", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1 }),
    ];
    const items: TimelineItem[] = [
      makeOptimisticClip({ frontendId: id("c1"), sessionId: sid("s1") }),
      makeOptimisticClip({
        frontendId: id("c2"),
        sessionId: sid("s1"),
        shouldArchive: true,
      }),
      makeClipOnDatabase({
        frontendId: id("c3"),
        shouldArchive: true,
        sessionId: sid("s1"),
      }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.pendingClips).toHaveLength(1);
    expect(panels[0]!.pendingClips[0]!.frontendId).toBe(id("c1"));
    expect(panels[0]!.archivedClips).toHaveLength(2);
    expect(panels[0]!.archivedClips.map((c) => c.frontendId)).toEqual([
      id("c2"),
      id("c3"),
    ]);
  });

  it("excludes non-recording sessions with no pending or archived clips", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1, status: "done" }),
      makeSession({ id: sid("s2"), displayNumber: 2, status: "done" }),
    ];
    const items: TimelineItem[] = [
      makeOptimisticClip({ frontendId: id("c1"), sessionId: sid("s1") }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.sessionId).toBe(sid("s1"));
  });

  it("ignores ClipOnDatabase without shouldArchive (main timeline clips)", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1 }),
    ];
    const items: TimelineItem[] = [
      makeClipOnDatabase({ frontendId: id("c1") }),
      makeOptimisticClip({ frontendId: id("c2"), sessionId: sid("s1") }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.archivedClips).toHaveLength(0);
    expect(panels[0]!.pendingClips).toHaveLength(1);
  });

  it("sorts panels by display number (oldest first)", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s2"), displayNumber: 2 }),
      makeSession({ id: sid("s1"), displayNumber: 1 }),
      makeSession({ id: sid("s3"), displayNumber: 3 }),
    ];
    const items: TimelineItem[] = [
      makeOptimisticClip({ frontendId: id("c1"), sessionId: sid("s2") }),
      makeOptimisticClip({ frontendId: id("c2"), sessionId: sid("s1") }),
      makeOptimisticClip({ frontendId: id("c3"), sessionId: sid("s3") }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels.map((p) => p.displayNumber)).toEqual([1, 2, 3]);
  });

  it("derives isRecording from session status", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1, status: "recording" }),
      makeSession({ id: sid("s2"), displayNumber: 2, status: "done" }),
    ];
    const items: TimelineItem[] = [
      makeOptimisticClip({ frontendId: id("c1"), sessionId: sid("s1") }),
      makeOptimisticClip({ frontendId: id("c2"), sessionId: sid("s2") }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels[0]!.isRecording).toBe(true);
    expect(panels[1]!.isRecording).toBe(false);
  });

  it("includes done sessions with orphaned optimistic clips in archivedClips", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1, status: "done" }),
    ];
    const items: TimelineItem[] = [
      makeOptimisticClip({
        frontendId: id("c1"),
        sessionId: sid("s1"),
        isOrphaned: true,
      }),
    ];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.sessionId).toBe(sid("s1"));
    expect(panels[0]!.pendingClips).toHaveLength(0);
    expect(panels[0]!.archivedClips).toHaveLength(1);
    expect(
      (panels[0]!.archivedClips[0] as ClipOptimisticallyAdded).isOrphaned
    ).toBe(true);
  });

  it("includes recording sessions even with no clips", () => {
    const sessions: RecordingSession[] = [
      makeSession({ id: sid("s1"), displayNumber: 1, status: "recording" }),
    ];
    const items: TimelineItem[] = [];
    const panels = getSessionPanels(items, sessions);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.sessionId).toBe(sid("s1"));
    expect(panels[0]!.isRecording).toBe(true);
    expect(panels[0]!.pendingClips).toHaveLength(0);
    expect(panels[0]!.archivedClips).toHaveLength(0);
  });
});
