import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  runObservedExportLoop,
  type PublishDetailEvent,
} from "@/services/course-publish-export-events";

const video = (id: string) => ({
  id,
  title: `01-intro/01.01-welcome/${id}`,
});

/** Run the loop over `unexportedVideos`, recording every emitted event and the
 *  order in which the exports were actually begun. */
const runLoop = async (
  unexportedVideos: Array<{ id: string; title: string }>
) => {
  const events: PublishDetailEvent[] = [];
  const startedVideoIds: string[] = [];

  const result = await Effect.runPromise(
    runObservedExportLoop({
      unexportedVideos,
      exportVideo: (videoId) =>
        Effect.sync(() => {
          startedVideoIds.push(videoId);
        }),
      onDetailEvent: (e) => events.push(e),
      afterAFailure: "keep-going",
    })
  );

  return { events, startedVideoIds, result };
};

describe("runObservedExportLoop", () => {
  // Whoever builds the queue decides which Videos run first, so the loop has
  // to honour the order it is handed even once the concurrency cap forces the
  // tail to wait for a free slot.
  describe("queue order", () => {
    // More Videos than MAX_CONCURRENT_EXPORTS, so the last few only start as
    // earlier ones finish.
    const queue = Array.from({ length: 8 }, (_, i) => video(`video-${i}`));
    const queueIds = queue.map((v) => v.id);

    it("begins the exports in the order it was given", async () => {
      const { startedVideoIds } = await runLoop(queue);

      expect(startedVideoIds).toEqual(queueIds);
    });

    it("announces the videos in that same order", async () => {
      const { events } = await runLoop(queue);

      const videosEvent = events.find((e) => e.event === "videos");
      expect(videosEvent?.data).toEqual({ videos: queue });
    });
  });

  it("emits complete per video and reports no failures", async () => {
    const { events, result } = await runLoop([video("only")]);

    expect(events.filter((e) => e.event === "complete")).toEqual([
      { event: "complete", data: { videoId: "only" } },
    ]);
    expect(result.failedVideoIds).toEqual([]);
  });

  it("collects the ids of videos whose export keeps failing", async () => {
    const events: PublishDetailEvent[] = [];
    const result = await Effect.runPromise(
      runObservedExportLoop({
        unexportedVideos: [video("good"), video("bad")],
        exportVideo: (videoId) =>
          videoId === "bad"
            ? Effect.fail({ message: "ffmpeg exploded" })
            : Effect.succeed(undefined),
        onDetailEvent: (e) => events.push(e),
        afterAFailure: "keep-going",
      })
    );

    expect(result.failedVideoIds).toEqual(["bad"]);
    expect(events).toContainEqual({
      event: "error",
      data: { videoId: "bad", message: "ffmpeg exploded" },
    });
  });

  // A Publish ships every Video or none: once one has finally failed, the
  // encodes still running are work for a Bundle that can never be committed.
  it('"stop" interrupts the other exports on the first failure, without a retry', async () => {
    const interrupted: string[] = [];
    const started: string[] = [];
    const result = await Effect.runPromise(
      runObservedExportLoop({
        // Eight Videos: six start, the last two are still queued.
        unexportedVideos: [
          video("bad"),
          ...Array.from({ length: 7 }, (_, i) => video(`slow-${i}`)),
        ],
        exportVideo: (videoId) =>
          Effect.sync(() => started.push(videoId)).pipe(
            Effect.andThen(
              videoId === "bad"
                ? Effect.fail({ message: "ffmpeg exploded" })
                : // An encode that would otherwise run for ever.
                  Effect.never.pipe(
                    Effect.onInterrupt(() =>
                      Effect.sync(() => interrupted.push(videoId))
                    )
                  )
            )
          ),
        afterAFailure: "stop",
      }).pipe(Effect.timeout("5 seconds"))
    );

    expect(result.failures).toEqual([
      { videoId: "bad", message: "ffmpeg exploded" },
    ]);
    // Not retried: the first failure already dooms a Publish.
    expect(started.filter((id) => id === "bad")).toHaveLength(1);
    expect(interrupted.sort()).toEqual(
      ["slow-0", "slow-1", "slow-2", "slow-3", "slow-4"].sort()
    );
    // The queued ones never began.
    expect(started).not.toContain("slow-6");
  });
});
