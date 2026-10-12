import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import * as schema from "@/db/schema";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import {
  buildWriteLayer,
  makeRun,
  ndjson,
  one,
  seedWrite,
  type RunResult,
  type WriteSeed,
} from "./cli-write-test-harness";

// `cvm clip` on the effective scene: a CVM-recorder Clip reports its Scene
// Override, effective scene and Recording Session, and Clip Zoom is judged on
// the effective scene. An OBS Clip's effective scene is its scene.

let testDb: TestDb;
let run: (argv: ReadonlyArray<string>) => Promise<RunResult>;
let s: WriteSeed;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  run = makeRun(buildWriteLayer(testDb));
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  s = await seedWrite(testDb);
});

type ClipRow = {
  id: string;
  scene: string | null;
  sceneOverride: string | null;
  effectiveScene: string | null;
  recordingSessionId: string | null;
  zoomType: string;
};

const seedClips = async () => {
  const videoId = s.standaloneActiveId;
  const [session] = await testDb
    .insert(schema.recordingSessions)
    .values({
      videoId,
      cameraFilePath: "/rec/camera.mkv",
      screenFilePath: "/rec/screen.mkv",
      micFilePath: "/rec/mic.mkv",
    })
    .returning();
  const [cvmRecorder, obs] = await testDb
    .insert(schema.clips)
    .values([
      {
        videoId,
        videoFilename: "/rec/mic.mkv",
        sourceStartTime: 0,
        sourceEndTime: 5,
        order: "a0",
        text: "",
        scene: "Code",
        sceneOverride: "Camera",
        recordingSessionId: session!.id,
      },
      {
        videoId,
        videoFilename: "/obs/take.mkv",
        sourceStartTime: 0,
        sourceEndTime: 5,
        order: "a1",
        text: "",
        scene: "Code",
      },
    ])
    .returning();
  return { videoId, session: session!, cvmRecorder: cvmRecorder!, obs: obs! };
};

describe("cvm clip on the effective scene", () => {
  it("reports a CVM-recorder Clip's effective scene and Recording Session", async () => {
    const { videoId, session, cvmRecorder, obs } = await seedClips();

    const got = one<ClipRow>(
      (await run(["clip", "get", cvmRecorder.id])).stdout
    );
    expect(got).toMatchObject({
      scene: "Code",
      sceneOverride: "Camera",
      effectiveScene: "Camera",
      recordingSessionId: session.id,
    });

    const listed = ndjson(
      (await run(["clip", "list", "--video", videoId])).stdout
    ) as ClipRow[];
    expect(listed.map((c) => [c.id, c.effectiveScene])).toEqual([
      [cvmRecorder.id, "Camera"],
      [obs.id, "Code"],
    ]);
  });

  it("judges --zoom on the effective scene", async () => {
    const { cvmRecorder, obs } = await seedClips();

    const zoomed = one<ClipRow>(
      (await run(["clip", "update", "--zoom", "subtle", cvmRecorder.id])).stdout
    );
    expect(zoomed.zoomType).toBe("subtle");

    const refused = await run(["clip", "update", "--zoom", "subtle", obs.id]);
    expect(refused.exitCode).toBe(3);
  });
});
