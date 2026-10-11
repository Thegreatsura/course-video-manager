import { describe, expect, it } from "vitest";
import {
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
    });
  });
});
