import { describe, expect, it } from "vitest";
import { computeExportHash, toExportClips } from "@/services/export-hash";

/**
 * The Export Hash reads a Clip's picture and sound through the Clip Source
 * package. Routing it there must not move a single existing address, or every
 * Video in the library would suddenly need a new export.
 *
 * The literals were computed from these rows on `main` BEFORE the hash went
 * through the Clip Source, so they pin the OBS Clip's contribution byte for
 * byte. They live apart from `export-hash.test.ts`, which is at the repo's
 * per-file size limit.
 */
const obsRows = [
  {
    videoFilename: "/mnt/d/obs-recordings/2026-10-01 09-14-02.mkv",
    sourceStartTime: 12.345,
    sourceEndTime: 19.876,
    pauseType: "none",
    zoomType: "none",
    overlays: [],
  },
  {
    videoFilename: "/mnt/d/obs-recordings/2026-10-01 09-14-02.mkv",
    sourceStartTime: 21.5,
    sourceEndTime: 30.25,
    pauseType: "long",
    zoomType: "none",
    overlays: [],
  },
  {
    videoFilename: "/mnt/d/obs-recordings/2026-10-01 10-02-41.mkv",
    sourceStartTime: 0.75,
    sourceEndTime: 4.125,
    pauseType: "none",
    zoomType: "none",
    overlays: [],
  },
];

describe("an OBS Clip's Export Hash through the Clip Source", () => {
  it("keeps every existing address exactly where it was", () => {
    const clips = toExportClips(obsRows);
    expect(computeExportHash(clips, "landscape")).toBe(
      "9a58c78eb23dbfc7020e1c84ae3cc711"
    );
    expect(computeExportHash(clips, "short")).toBe(
      "4950ba6b38ec40b7cff9bc03a37d84d1"
    );
  });
});
