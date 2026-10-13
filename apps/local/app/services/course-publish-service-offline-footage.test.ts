import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { CoursePublishService } from "@/services/course-publish-service";
import { clips as clipsTable } from "@/db/schema";
import {
  setupPublishServiceTests,
  setupPublishableCourse as setup,
  testDb,
} from "./course-publish-service-test-setup";

setupPublishServiceTests();

/**
 * A Video whose Footage is on a Storage Root that is not plugged in (E:
 * offline) but whose export is already on disk still exports: the sound
 * export is reused before any Footage is looked for (#2104).
 */
describe("CoursePublishService — an export whose Footage is offline", () => {
  const offlineFootage = async (videoId: string) =>
    testDb
      .update(clipsTable)
      .set({ videoFilename: "raw-footage/on-an-unplugged-drive.mkv" })
      .where(eq(clipsTable.videoId, videoId));

  it("reuses a sound export without looking for its Footage", async () => {
    const { video, run } = await setup();
    await offlineFootage(video.id);
    const exportPath = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return (yield* svc.resolveExportPath(video.id))!;
      })
    );
    fs.writeFileSync(exportPath, "already-exported");

    const stages: string[] = [];
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc.exportVideo(video.id, (stage) => {
          stages.push(stage);
        });
      })
    );

    expect(result).toBe(exportPath);
    expect(stages).toEqual([]);
    expect(fs.readFileSync(exportPath, "utf-8")).toBe("already-exported");
  });

  it("fails naming the missing Footage when there is no export to reuse", async () => {
    const { video, run } = await setup();
    await offlineFootage(video.id);

    const failure = await run(
      Effect.gen(function* () {
        const svc = yield* CoursePublishService;
        return yield* svc.exportVideo(video.id).pipe(Effect.flip);
      })
    );

    expect(failure.message).toMatch(
      /^Footage not found .*raw-footage\/on-an-unplugged-drive\.mkv$/
    );
  });
});
