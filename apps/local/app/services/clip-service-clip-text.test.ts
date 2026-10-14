import { describe, it, expect } from "vitest";
import { asc, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  setupClipServiceTests,
  clipService,
  testDb,
} from "./clip-service-test-setup";

setupClipServiceTests();

/** A 10 s Clip saying `text`, with one Transcript Word per entry of `words`. */
const seedClip = async (
  text: string,
  words: { start: number; end: number; text: string }[]
) => {
  const video = await clipService.createVideo("edit transcript");
  const [clip] = await testDb
    .insert(schema.clips)
    .values({
      videoId: video.id,
      videoFilename: "/mnt/t/footage.mkv",
      sourceStartTime: 5,
      sourceEndTime: 15,
      order: "a0",
      text,
    })
    .returning();
  if (words.length > 0) {
    await testDb
      .insert(schema.clipTranscriptWords)
      .values(words.map((word) => ({ clipId: clip!.id, ...word })));
  }
  return clip!;
};

const readBack = async (clipId: string) => {
  const clip = await testDb.query.clips.findFirst({
    where: eq(schema.clips.id, clipId),
  });
  const words = await testDb.query.clipTranscriptWords.findMany({
    where: eq(schema.clipTranscriptWords.clipId, clipId),
    orderBy: [asc(schema.clipTranscriptWords.start)],
  });
  return {
    text: clip!.text,
    sourceStartTime: clip!.sourceStartTime,
    sourceEndTime: clip!.sourceEndTime,
    words: words.map(({ start, end, text }) => ({ start, end, text })),
  };
};

describe("Edit Transcript (update-clip-text)", () => {
  it("keeps every word's timing when the word count is unchanged", async () => {
    const clip = await seedClip("I love type script", [
      { start: 1, end: 1.2, text: "I" },
      { start: 1.3, end: 1.6, text: "love" },
      { start: 1.7, end: 2.0, text: "type" },
      { start: 2.0, end: 2.5, text: "script" },
    ]);

    await clipService.updateClipText(clip.id, "I love Type Script!");

    expect(await readBack(clip.id)).toEqual({
      text: "I love Type Script!",
      sourceStartTime: 5,
      sourceEndTime: 15,
      words: [
        { start: 1, end: 1.2, text: "I" },
        { start: 1.3, end: 1.6, text: "love" },
        { start: 1.7, end: 2.0, text: "Type" },
        { start: 2.0, end: 2.5, text: "Script!" },
      ],
    });
  });

  it("shares the old words' span out by letter count when the word count changes", async () => {
    const clip = await seedClip("I love type script", [
      { start: 1, end: 1.2, text: "I" },
      { start: 1.3, end: 1.6, text: "love" },
      { start: 1.7, end: 2.0, text: "type" },
      { start: 2.0, end: 3, text: "script" },
    ]);

    await clipService.updateClipText(clip.id, "I love TypeScript");

    // 1 + 4 + 10 letters over the 2 s span from 1 to 3.
    const { words } = await readBack(clip.id);
    expect(words.map((word) => word.text)).toEqual(["I", "love", "TypeScript"]);
    const bounds = words.flatMap((word) => [word.start, word.end]);
    [1, 1 + 2 / 15, 1 + 2 / 15, 1 + 10 / 15, 1 + 10 / 15, 3].forEach(
      (expected, index) => expect(bounds[index]).toBeCloseTo(expected)
    );
  });

  it("leaves a Clip with no Transcript Words without any", async () => {
    const clip = await seedClip("old text", []);

    await clipService.updateClipText(clip.id, "new text here");

    expect(await readBack(clip.id)).toMatchObject({
      text: "new text here",
      words: [],
    });
  });
});
