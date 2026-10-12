/**
 * A Video filmed with the New recorder goes through the same Publish as an OBS
 * one: the export step reads each Clip's Recording Session through the Clip
 * Source and hands the renderer its composite; addressing, upload and the
 * bundle are unchanged.
 */

import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { CoursePublishService } from "@/services/course-publish-service";
import { ANNOUNCE_NOTHING } from "@/packages/course-json";
import {
  remoteBundleVideoPaths,
  setupPublishServiceTests,
  setupPublishableCourse as setup,
  type FakeRenderRun,
} from "./course-publish-service-test-setup";

setupPublishServiceTests();

describe("CoursePublishService — a Video of new-recorder Clips", () => {
  it("renders every Clip as its composite and publishes it", async () => {
    const runs: FakeRenderRun[] = [];
    const { course, video, run } = await setup({
      newRecorder: true,
      renderBytes: (r) => {
        runs.push(r);
        return "composite";
      },
    });

    await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc.publish({
          courseId: course.id,
          versionName: "v1.0",
          versionDescription: "First release",
          includeTodoLessons: true,
          placeholderFloor: ANNOUNCE_NOTHING,
        });
      })
    );

    expect(runs).toHaveLength(1);
    // Clip 1 is 0–10 s (Camera from 5 s); clip 2 is 15–25 s plus the final
    // padding, all Camera.
    expect(
      runs[0]!.composites.map((c) => c?.segments.map((s) => s.scene))
    ).toEqual([["Code", "Camera"], ["Camera"]]);
    expect(runs[0]!.composites[0]).toMatchObject({
      screen: "/rec/s1/screen.mkv",
      camera: "/rec/s1/camera.mkv",
      micOffsetSeconds: 0.15,
    });
    expect(remoteBundleVideoPaths()).toEqual([
      expect.stringContaining(video.title),
    ]);
  });
});
