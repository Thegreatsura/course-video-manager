import { describe, it, expect } from "vitest";
import { Schema } from "effect";
import { CourseJsonDocumentSchema, type BuildCourseJsonInput } from "../index";
import {
  makeInput,
  makeLesson,
  makeSection,
  makeVideo,
  OBS_CLIP,
  run,
} from "./course-json-fixtures";

// ===========================================================================
// A video entry's `sessionExtract`: the Agent Session Entries stored on its
// Clips, timed in the current cut. How visibleFrom follows trims, reorders
// and inserts is pinned at `cvm video agent-sessions get`, which reads the
// same placement; here, what course.json carries, and that it never fails.
// ===========================================================================

type Clip =
  BuildCourseJsonInput["sections"][0]["lessons"][0]["videos"][0]["clips"][0];
type Entry = NonNullable<Clip["agentSessionEntries"]>[number];

const entry = (
  agentSessionId: string,
  footageTime: number,
  sequence: number,
  content: Partial<Entry> & Pick<Entry, "kind">
): Entry => ({
  agentSessionId,
  footageTime,
  sequence,
  text: null,
  skill: null,
  via: null,
  args: null,
  tool: null,
  summary: null,
  resultIsError: null,
  ...content,
});

const clip = (
  id: string,
  order: string,
  scene: string,
  [sourceStartTime, sourceEndTime]: [number, number],
  agentSessionEntries: Entry[] = []
): Clip => ({
  ...OBS_CLIP,
  id,
  order,
  scene,
  videoFilename: "rec.mkv",
  sourceStartTime,
  sourceEndTime,
  pauseType: "none",
  zoomType: "none",
  overlays: [],
  agentSessionEntries,
});

/** A Problem with no session on screen, and a Solution showing two. */
const lessonWith = (solutionClips: Clip[]) =>
  makeInput([
    makeSection({
      path: "01-intro",
      lessons: [
        makeLesson({
          path: "01.01-exercise",
          videos: [
            makeVideo({ title: "Problem" }),
            makeVideo({ title: "Solution", clips: solutionClips }),
          ],
        }),
      ],
    }),
  ]);

const solutionOf = (doc: Awaited<ReturnType<typeof run>>) => {
  const lesson = doc.sections[0]!.lessons[0]!;
  if (lesson.type !== "problem") throw new Error("expected a problem lesson");
  return { problem: lesson.problem, solution: lesson.solution! };
};

describe("course.json sessionExtract", () => {
  it("carries each session's visible entries, by first appearance, named by the Agent Session id", async () => {
    // The cut: c1 Code at 0–10 s, c2 Camera at 10–20 s, c3 Code at 20–30 s.
    const doc = await run(
      lessonWith([
        clip(
          "c1",
          "a0",
          "Code",
          [10, 20],
          [
            entry("agent-session-a", 12, 0, {
              kind: "userPrompt",
              text: "Add a test",
            }),
            entry("agent-session-b", 11, 0, {
              kind: "assistantText",
              text: "Earlier session",
            }),
            // Past c1's out-point: shown from the next screen Clip, c3.
            entry("agent-session-a", 25, 1, {
              kind: "toolCall",
              tool: "Read",
              summary: "src/a.ts",
            }),
          ]
        ),
        clip("c2", "a1", "Camera", [0, 10]),
        clip(
          "c3",
          "a2",
          "Code",
          [30, 40],
          [
            entry("agent-session-a", 35, 2, {
              kind: "skillCall",
              skill: "tdd",
              via: "slashCommand",
            }),
            // Past c3's out-point with no screen Clip after it: left out.
            entry("agent-session-a", 41, 3, {
              kind: "assistantText",
              text: "Never shown",
            }),
          ]
        ),
      ])
    );

    const { problem, solution } = solutionOf(doc);
    expect("sessionExtract" in problem).toBe(false);
    expect(solution.sessionExtract).toEqual({
      sessions: [
        {
          sessionId: "agent-session-b",
          entries: [
            { kind: "assistantText", visibleFrom: 1, text: "Earlier session" },
          ],
        },
        {
          sessionId: "agent-session-a",
          entries: [
            { kind: "userPrompt", visibleFrom: 2, text: "Add a test" },
            {
              kind: "toolCall",
              visibleFrom: 20,
              tool: "Read",
              summary: "src/a.ts",
            },
            {
              kind: "skillCall",
              visibleFrom: 25,
              skill: "tdd",
              via: "slashCommand",
            },
          ],
        },
      ],
    });
    // The manifest, as written to Dropbox, decodes against its own schema.
    expect(() =>
      Schema.decodeUnknownSync(CourseJsonDocumentSchema)(
        JSON.parse(JSON.stringify(doc))
      )
    ).not.toThrow();
  });

  it("never fails the export: an extract that cannot be built is left out", async () => {
    const doc = await run(
      lessonWith([
        clip(
          "c1",
          "a0",
          "Code",
          [10, 20],
          [
            entry("agent-session-a", Number.NaN, 0, {
              kind: "userPrompt",
              text: "Broken",
            }),
          ]
        ),
      ])
    );

    expect("sessionExtract" in solutionOf(doc).solution).toBe(false);
  });
});
