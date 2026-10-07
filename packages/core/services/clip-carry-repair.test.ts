import { describe, expect, it } from "vitest";
import {
  planClipCarryRepair,
  type ClipCarryRow,
} from "./clip-carry-repair.server.js";

const row = (overrides: Partial<ClipCarryRow>): ClipCarryRow => ({
  clipId: "clip",
  courseId: "course",
  versionId: "v",
  commitState: "published",
  versionCreatedAt: new Date("2026-01-01"),
  videoLineageId: "video-lineage",
  videoFilename: "take.mp4",
  sourceStartTime: 0,
  sourceEndTime: 5,
  zoomType: "none",
  diagramSnapshotId: null,
  ...overrides,
});

const v1 = { versionId: "v1", versionCreatedAt: new Date("2026-01-01") };
const v2 = { versionId: "v2", versionCreatedAt: new Date("2026-02-01") };
const draft = {
  versionId: "draft",
  commitState: "draft",
  versionCreatedAt: new Date("2026-03-01"),
};

describe("planClipCarryRepair", () => {
  it("restores a zoom and pin dropped by an earlier Submit, even across hops", () => {
    const fixes = planClipCarryRepair([
      row({ ...v1, clipId: "a", zoomType: "subtle", diagramSnapshotId: "s1" }),
      // v2 was itself a clone, so it already lost both.
      row({ ...v2, clipId: "b" }),
      row({ ...draft, clipId: "c" }),
    ]);
    expect(fixes).toEqual([
      {
        clipId: "c",
        courseId: "course",
        versionId: "draft",
        zoomType: "subtle",
        diagramSnapshotId: "s1",
      },
    ]);
  });

  it("takes the most recent earlier value", () => {
    const fixes = planClipCarryRepair([
      row({ ...v1, diagramSnapshotId: "old" }),
      row({ ...v2, diagramSnapshotId: "new" }),
      row({ ...draft, clipId: "c" }),
    ]);
    expect(fixes[0]!.diagramSnapshotId).toBe("new");
  });

  it("never overwrites a Draft Clip that already has a value", () => {
    const fixes = planClipCarryRepair([
      row({ ...v1, zoomType: "subtle", diagramSnapshotId: "s1" }),
      row({
        ...draft,
        clipId: "c",
        zoomType: "subtle",
        diagramSnapshotId: "s2",
      }),
    ]);
    expect(fixes).toEqual([]);
  });

  it("only matches the same cut of the same Video lineage in the same Course", () => {
    const fixes = planClipCarryRepair([
      row({ ...v1, zoomType: "subtle", sourceStartTime: 1 }),
      row({ ...v1, zoomType: "subtle", videoLineageId: "other" }),
      row({ ...v1, zoomType: "subtle", courseId: "other-course" }),
      row({ ...draft, clipId: "c" }),
    ]);
    expect(fixes).toEqual([]);
  });
});
