import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import {
  clipStateReducer,
  type ClipOnDatabase,
  type DatabaseId,
  type FrontendId,
} from "./clip-state-reducer";
import { ReducerTester } from "@/test-utils/reducer-tester";
import {
  clipTranscribed,
  clipTranscriptionFailed,
  heardTranscriptionEvent,
  transcriptionJobEnded,
  transcriptionJobStarted,
} from "@/test-utils/transcription-job-events";

// The Sidecar runs a Clip transcription as a `transcribe-clips` Job. The edit
// page asks for it (`clips-retranscribing`, `new-database-clips`) and hears
// its Job Events back (`job-event-heard`); the reducer decides what each means.

const createState = (
  overrides: Partial<clipStateReducer.State> = {}
): clipStateReducer.State => ({
  clipIdsWithTranscriptWords: new Set(),
  items: [],
  insertionPoint: { type: "end" },
  insertionOrder: 0,
  error: null,
  sessions: [],
  clipTranscriptionJobs: {},
  jobEventCursor: 0,
  ...overrides,
});

const onDatabase = (
  id: string,
  transcriptionStatus: ClipOnDatabase["transcriptionStatus"] = "done"
): ClipOnDatabase =>
  fromPartial<ClipOnDatabase>({
    type: "on-database",
    frontendId: `f-${id}` as FrontendId,
    databaseId: id as DatabaseId,
    text: "old text",
    transcriptionStatus,
  });

const clipIn = (state: clipStateReducer.State, id: string) =>
  state.items.find(
    (item): item is ClipOnDatabase =>
      item.type === "on-database" && item.databaseId === id
  )!;

const retranscribe = (jobId: string, ...ids: string[]) =>
  ({
    type: "clips-retranscribing",
    clipIds: ids.map((id) => `f-${id}` as FrontendId),
    jobId,
  }) as const;

describe("a re-transcribe", () => {
  it("asks for the Job by the id it was given, and the Clips' results land", () => {
    const tester = new ReducerTester(
      clipStateReducer,
      createState({ items: [onDatabase("a"), onDatabase("b")] })
    )
      .send(retranscribe("job-1", "a", "b"))
      .send(transcriptionJobStarted("job-1", ["a", "b"]))
      .send(clipTranscribed("job-1", "a", "new a"))
      .send(clipTranscriptionFailed("job-1", "b"));

    expect(clipIn(tester.getState(), "a")).toMatchObject({
      text: "new a",
      transcriptionStatus: "done",
    });
    expect(clipIn(tester.getState(), "b")).toMatchObject({
      text: "old text",
      transcriptionStatus: "failed",
    });
    expect(tester.getState().clipTranscriptionJobs).toEqual({});
    expect(tester.getEffects()).toEqual([
      { type: "transcribe-clips", jobId: "job-1", clipIds: ["a", "b"] },
    ]);
  });

  it("a second click before the Job starts asks for nothing more", () => {
    const tester = new ReducerTester(
      clipStateReducer,
      createState({ items: [onDatabase("a"), onDatabase("b")] })
    )
      .send(retranscribe("job-1", "a"))
      .send(retranscribe("job-2", "a"))
      // Only the Clip nobody has asked for yet goes into a new Job.
      .send(retranscribe("job-3", "a", "b"));

    expect(tester.getState().clipTranscriptionJobs).toEqual({
      a: { jobId: "job-1", started: false },
      b: { jobId: "job-3", started: false },
    });
    expect(tester.getEffects()).toEqual([
      { type: "transcribe-clips", jobId: "job-1", clipIds: ["a"] },
      { type: "transcribe-clips", jobId: "job-3", clipIds: ["b"] },
    ]);
  });

  it("a newer Job's Clip ignores what the older one settles, and lands its own", () => {
    const tester = new ReducerTester(
      clipStateReducer,
      createState({ items: [onDatabase("a")] })
    )
      .send(retranscribe("job-1", "a"))
      .send(transcriptionJobStarted("job-1", ["a"]))
      // job-1 looks stuck, so the author asks again.
      .send(retranscribe("job-2", "a"))
      .send(clipTranscribed("job-1", "a", "from job 1"));

    expect(clipIn(tester.getState(), "a")).toMatchObject({
      text: "old text",
      transcriptionStatus: "transcribing",
    });

    tester
      .send(transcriptionJobStarted("job-2", ["a"]))
      .send(clipTranscribed("job-2", "a", "from job 2"));
    expect(clipIn(tester.getState(), "a")).toMatchObject({
      text: "from job 2",
      transcriptionStatus: "done",
    });
  });
});

describe("a request the server joins to a live Job", () => {
  it("follows that Job: its result lands, and its end fails what it never settled", () => {
    const tester = new ReducerTester(
      clipStateReducer,
      createState({ items: [onDatabase("a"), onDatabase("b")] })
    )
      .send(retranscribe("job-live", "a", "b"))
      .send(transcriptionJobStarted("job-live", ["a", "b"]))
      // The sidecar dies; the author asks again, and the server answers with
      // the live Job, which still holds both Clips.
      .send(retranscribe("job-mine", "a", "b"))
      .send({
        type: "transcription-job-joined",
        requestedJobId: "job-mine",
        jobId: "job-live",
      })
      .send(clipTranscribed("job-live", "a", "landed"))
      .send(transcriptionJobEnded("job-live", "interrupted"));

    expect(clipIn(tester.getState(), "a")).toMatchObject({
      text: "landed",
      transcriptionStatus: "done",
    });
    expect(clipIn(tester.getState(), "b").transcriptionStatus).toBe("failed");
    expect(tester.getState().clipTranscriptionJobs).toEqual({});
  });

  it("join race: the live Job's clip-settled heard before the join answer still lands", () => {
    const tester = new ReducerTester(
      clipStateReducer,
      createState({ items: [onDatabase("a", "transcribing")] })
    )
      .send(transcriptionJobStarted("job-live", ["a"]))
      .send(retranscribe("job-mine", "a"))
      // server joins job-mine to job-live (nothing settled yet); job-live then
      // settles `a` and its event reaches the tab before the POST answer.
      .send(clipTranscribed("job-live", "a", "landed"))
      .send({
        type: "transcription-job-joined",
        requestedJobId: "job-mine",
        jobId: "job-live",
      });
    expect(clipIn(tester.getState(), "a")).toMatchObject({
      text: "landed",
      transcriptionStatus: "done",
    });
  });

  it("a live Job that ends before the join answer fails the Clips that follow it", () => {
    const tester = new ReducerTester(
      clipStateReducer,
      createState({ items: [onDatabase("a"), onDatabase("b")] })
    )
      .send(transcriptionJobStarted("job-live", ["a"]))
      .send(retranscribe("job-mine", "a"))
      .send(transcriptionJobEnded("job-live", "interrupted"));
    // Until the answer comes, the Clip is this tab's request's.
    expect(clipIn(tester.getState(), "a").transcriptionStatus).toBe(
      "transcribing"
    );

    tester.send({
      type: "transcription-job-joined",
      requestedJobId: "job-mine",
      jobId: "job-live",
    });
    expect(clipIn(tester.getState(), "a").transcriptionStatus).toBe("failed");
    expect(clipIn(tester.getState(), "b").transcriptionStatus).toBe("done");
    expect(tester.getState().clipTranscriptionJobs).toEqual({});
  });

  it("a request that runs itself drops what another Job said meanwhile", () => {
    const tester = new ReducerTester(
      clipStateReducer,
      createState({ items: [onDatabase("a")] })
    )
      .send(transcriptionJobStarted("job-other", ["a"]))
      .send(retranscribe("job-mine", "a"))
      .send(clipTranscribed("job-other", "a", "theirs"))
      .send(transcriptionJobStarted("job-mine", ["a"]))
      .send(clipTranscribed("job-mine", "a", "mine"));
    expect(clipIn(tester.getState(), "a")).toMatchObject({
      text: "mine",
      transcriptionStatus: "done",
    });
    expect(tester.getState().clipTranscriptionJobs).toEqual({});
  });

  it("a join for a request this tab does not hold changes nothing", () => {
    const state = createState({ items: [onDatabase("a")] });
    const tester = new ReducerTester(clipStateReducer, state).send({
      type: "transcription-job-joined",
      requestedJobId: "job-other-tab",
      jobId: "job-live",
    });

    expect(tester.getState()).toBe(state);
  });
});

describe("a Job that ends without settling its Clips", () => {
  it.each(["failed", "interrupted"] as const)(
    "fails the Clips it never settled, and only those, when it %s",
    (how) => {
      const tester = new ReducerTester(
        clipStateReducer,
        createState({ items: [onDatabase("a"), onDatabase("b")] })
      )
        .send(retranscribe("job-1", "a", "b"))
        .send(transcriptionJobStarted("job-1", ["a", "b"]))
        .send(clipTranscribed("job-1", "a", "landed"))
        .send(transcriptionJobEnded("job-1", how));

      expect(clipIn(tester.getState(), "a").transcriptionStatus).toBe("done");
      expect(clipIn(tester.getState(), "b").transcriptionStatus).toBe("failed");
      expect(tester.getState().clipTranscriptionJobs).toEqual({});
    }
  );

  it("fails the Clips of a Job that never got to start", () => {
    const tester = new ReducerTester(
      clipStateReducer,
      createState({ items: [onDatabase("a")] })
    )
      .send(retranscribe("job-1", "a"))
      .send(transcriptionJobEnded("job-1"));

    expect(clipIn(tester.getState(), "a").transcriptionStatus).toBe("failed");
  });

  // A tab reloaded mid-Job loads the Clip `transcribing`; the Job's
  // `clips-started` is at or below the loader's cursor.
  it("reopened tab: a Job interrupted after the tab loaded fails the Clip it was transcribing", () => {
    // The tab never heard the Job start (its replay fell out of the history),
    // so it holds no Job for the Clip.
    const tester = new ReducerTester(
      clipStateReducer,
      createState({
        items: [onDatabase("a", "transcribing")],
        jobEventCursor: 0,
      })
    ).send(transcriptionJobEnded("job-live", "interrupted"));
    expect(clipIn(tester.getState(), "a").transcriptionStatus).toBe("failed");
  });

  it("reopened tab: a replayed start says which Job holds the Clip, so another Job's end leaves it be", () => {
    const state = createState({
      items: [onDatabase("a", "transcribing"), onDatabase("b", "transcribing")],
      jobEventCursor: 10,
    });
    const tester = new ReducerTester(clipStateReducer, state)
      .send(
        heardTranscriptionEvent(
          "job-a",
          "clips-started",
          { clipIds: ["a"] },
          { id: 4 }
        )
      )
      .send(
        heardTranscriptionEvent(
          "job-b",
          "clips-started",
          { clipIds: ["b"] },
          { id: 5 }
        )
      );
    // The replay changes no Clip: the loader read them after it.
    expect(tester.getState().items).toBe(state.items);

    tester.send(transcriptionJobEnded("job-b", "interrupted"));
    expect(clipIn(tester.getState(), "a").transcriptionStatus).toBe(
      "transcribing"
    );
    expect(clipIn(tester.getState(), "b").transcriptionStatus).toBe("failed");

    tester.send(clipTranscribed("job-a", "a", "landed"));
    expect(clipIn(tester.getState(), "a")).toMatchObject({
      text: "landed",
      transcriptionStatus: "done",
    });
  });
});

describe("a Job another tab asked for", () => {
  it("shows its Clips transcribing once it starts, not the old text as done", () => {
    const tester = new ReducerTester(
      clipStateReducer,
      createState({ items: [onDatabase("a")] })
    ).send(transcriptionJobStarted("job-other", ["a"]));

    expect(clipIn(tester.getState(), "a").transcriptionStatus).toBe(
      "transcribing"
    );

    tester.send(clipTranscribed("job-other", "a", "theirs"));
    expect(clipIn(tester.getState(), "a")).toMatchObject({
      text: "theirs",
      transcriptionStatus: "done",
    });
  });

  it("does not take a Clip from this tab's own Job that has yet to start", () => {
    const tester = new ReducerTester(
      clipStateReducer,
      createState({ items: [onDatabase("a")] })
    )
      .send(retranscribe("job-mine", "a"))
      .send(transcriptionJobStarted("job-other", ["a"]))
      .send(transcriptionJobEnded("job-other", "failed"));

    expect(clipIn(tester.getState(), "a").transcriptionStatus).toBe(
      "transcribing"
    );
    expect(tester.getState().clipTranscriptionJobs).toMatchObject({
      a: { jobId: "job-mine", started: false },
    });
  });
});

describe("which Job Events count", () => {
  // An older Job's result, replayed in a snapshot, must not overwrite what
  // the loader read (a newer Job's result, or that newer Job running).
  it("ignores an event at or below the loader's cursor", () => {
    const state = createState({
      items: [onDatabase("a", "transcribing")],
      jobEventCursor: 10,
    });
    const tester = new ReducerTester(clipStateReducer, state)
      .send(
        heardTranscriptionEvent(
          "job-old",
          "clip-settled",
          { id: "a", transcriptionStatus: "failed" },
          { id: 10 }
        )
      )
      .send(heardTranscriptionEvent("job-old", "failed", {}, { id: 3 }));

    expect(tester.getState()).toBe(state);
  });

  it("applies an event once, even when it is heard again", () => {
    const started = heardTranscriptionEvent(
      "job-1",
      "clips-started",
      { clipIds: ["a"] },
      { id: 20 }
    );
    const tester = new ReducerTester(
      clipStateReducer,
      createState({ items: [onDatabase("a")] })
    )
      .send(started)
      .send(
        heardTranscriptionEvent(
          "job-1",
          "clip-settled",
          {
            id: "a",
            transcriptionStatus: "done",
            text: "new",
            hasTranscriptWords: true,
          },
          { id: 21 }
        )
      )
      .send(started);

    expect(tester.getState().jobEventCursor).toBe(21);
    expect(clipIn(tester.getState(), "a")).toMatchObject({
      text: "new",
      transcriptionStatus: "done",
    });
  });

  it("ignores an event it cannot read", () => {
    const state = createState({ items: [onDatabase("a", "transcribing")] });
    const tester = new ReducerTester(clipStateReducer, state)
      .send(heardTranscriptionEvent("job-1", "clip-settled", { id: 4 }))
      .send(heardTranscriptionEvent("job-1", "clips-started", { clipIds: 4 }))
      .send(heardTranscriptionEvent("job-1", "started"));

    expect(tester.getState().items).toBe(state.items);
    expect(tester.getState().clipTranscriptionJobs).toEqual({});
  });
});

describe("a freshly recorded Clip", () => {
  it("goes into the Job the recording names, and that Job's failure fails it", () => {
    const tester = new ReducerTester(clipStateReducer, createState())
      .send({
        type: "new-database-clips",
        clips: [fromPartial({ id: "a", text: "" })],
        transcriptionJobId: "job-rec",
      })
      .send(transcriptionJobEnded("job-rec", "interrupted"));

    expect(clipIn(tester.getState(), "a").transcriptionStatus).toBe("failed");
    expect(
      tester.getEffects().filter((effect) => effect.type === "transcribe-clips")
    ).toEqual([{ type: "transcribe-clips", jobId: "job-rec", clipIds: ["a"] }]);
  });
});
