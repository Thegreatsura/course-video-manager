import { describe, expect, it } from "vitest";
import { LAYOUT_VERSION } from "@/packages/scene-layout";
import {
  clipComposite,
  clipFfmpegInput,
  clipFrame,
  clipPlaybackUrl,
  clipSource,
  clipSourceColumns,
  clipSourceHashFields,
} from "../index";

const OBS_FILE = "/mnt/d/obs-recordings/2026-10-01 09-14-02.mkv";

const obsClip = {
  id: "clip-1",
  videoFilename: OBS_FILE,
  sourceStartTime: 12.5,
  sourceEndTime: 19.75,
  text: "Hello there",
  recordingSessionId: null,
  sceneOverride: null,
  recordingSession: null,
};

describe("an OBS Clip's source", () => {
  const source = clipSource(obsClip);

  it("plays its own range of its Footage file", () => {
    expect(clipPlaybackUrl(source, { from: 12.4, to: 19.69 })).toBe(
      `/view-video?videoPath=${encodeURIComponent(OBS_FILE)}#t=12.4,19.69`
    );
  });

  it("takes its stills from its Footage file", () => {
    expect(clipFrame(source, "first")).toEqual({
      inputVideo: OBS_FILE,
      time: 12.5,
    });
    // A tenth of a second short of the end: the very last frame of a cut is
    // often the next take's first.
    expect(clipFrame(source, "last")).toEqual({
      inputVideo: OBS_FILE,
      time: 19.65,
    });
    expect(clipFrame(source, 15)).toEqual({ inputVideo: OBS_FILE, time: 15 });
  });

  it("hands ffmpeg its Footage file, start and duration", () => {
    expect(clipFfmpegInput(source)).toEqual({
      inputVideo: OBS_FILE,
      startTime: 12.5,
      duration: 7.25,
    });
  });

  it("contributes its file and range to the Export Hash, in that order", () => {
    expect(JSON.stringify(clipSourceHashFields(source))).toBe(
      JSON.stringify({ f: OBS_FILE, s: 12.5, e: 19.75 })
    );
  });

  it("is read from exactly the columns that define it", () => {
    expect(clipSourceColumns(obsClip)).toEqual({
      videoFilename: OBS_FILE,
      sourceStartTime: 12.5,
      sourceEndTime: 19.75,
      recordingSessionId: null,
      sceneOverride: null,
      recordingSession: null,
    });
  });

  it("has no composite", () => {
    expect(clipComposite(source)).toBeNull();
  });
});

const session = {
  id: "session-1",
  cameraFilePath: "/rec/s1/camera.mkv",
  screenFilePath: "/rec/s1/screen.mkv",
  micFilePath: "/rec/s1/mic.mkv",
  micOffsetMs: 150,
  // Code from 0, Camera from 14, back to Code from 30.
  sceneEvents: [
    { fileTime: 30, scene: "Code" },
    { fileTime: 0, scene: "Code" },
    { fileTime: 14, scene: "Camera" },
  ],
};

const newRecorderClip = {
  videoFilename: session.micFilePath,
  sourceStartTime: 12,
  sourceEndTime: 20,
  recordingSessionId: session.id,
  sceneOverride: null,
  recordingSession: session,
};

describe("a new-recorder Clip's source", () => {
  it("composites its Session's files in the scenes of its range", () => {
    expect(clipComposite(clipSource(newRecorderClip))).toEqual({
      screen: "/rec/s1/screen.mkv",
      camera: "/rec/s1/camera.mkv",
      mic: "/rec/s1/mic.mkv",
      micOffsetSeconds: 0.15,
      eq: { lowDb: 0, midDb: 0, highDb: -6.1 },
      segments: [
        { scene: "Code", startSeconds: 12, endSeconds: 14 },
        { scene: "Camera", startSeconds: 14, endSeconds: 20 },
      ],
    });
  });

  it("composites a longer range when asked (a long pause)", () => {
    const composite = clipComposite(clipSource(newRecorderClip), {
      from: 12,
      to: 31,
    });
    expect(composite?.segments.map((s) => s.scene)).toEqual([
      "Code",
      "Camera",
      "Code",
    ]);
  });

  it("draws its whole range in its Scene Override", () => {
    const source = clipSource({ ...newRecorderClip, sceneOverride: "No Face" });
    expect(clipComposite(source)?.segments).toEqual([
      { scene: "No Face", startSeconds: 12, endSeconds: 20 },
    ]);
  });

  it("is exported with the mic EQ setting it is given", () => {
    const micEq = { lowDb: 1, midDb: 0, highDb: 0 };
    expect(clipComposite(clipSource(newRecorderClip, { micEq }))?.eq).toBe(
      micEq
    );
  });

  it("adds its composite's inputs to the Export Hash after the OBS keys", () => {
    expect(clipSourceHashFields(clipSource(newRecorderClip))).toEqual({
      f: "/rec/s1/mic.mkv",
      s: 12,
      e: 20,
      rs: "session-1",
      sg: [
        ["Code", 12, 14],
        ["Camera", 14, 20],
      ],
      mo: 150,
      eq: [0, 0, -6.1],
      lv: LAYOUT_VERSION,
    });
  });
});
