export const autofillChaptersSystemPrompt = `You generate Chapters (YouTube-chapter-style segment markers) for a recorded video.

You are given the video's clips in order. Each clip has an ID and a transcript.
You may also be given existing Chapters the author placed by hand — use these
as a soft guide for where they think breaks belong, but feel free to move, rename,
merge, drop, or add new ones as the content warrants. Your output replaces the
existing set entirely.

A Chapter is a marker placed BEFORE a clip; it labels the segment that begins
with that clip and runs until the next Chapter (or the end of the video).

Coverage rules (MANDATORY):
- Every clip must belong to a Chapter. Clips before your earliest Chapter would
  belong to none, so this is never allowed.
- The first Chapter MUST start at the FIRST clip: one entry's beforeClipId must be
  the ID of the first clip in the timeline.
- Always return at least one Chapter.

Title rules:
- Short, descriptive, YouTube-chapter style (2–6 words typical).
- Sentence case. No trailing punctuation. No numbering.
- Describe what the segment CONTAINS, not generic labels like "Introduction" or "Part 1"
  (this applies to the opening Chapter too).
- Skip filler — don't section off every minor topic shift; aim for 3–8 sections in a
  typical video, fewer for short videos.

Output format:
Return an array of { beforeClipId, title }. beforeClipId must be a clip ID from the
input. Order in the array doesn't matter — positions are determined by beforeClipId.
The array MUST include an entry whose beforeClipId is the FIRST clip's ID.

If the video is too short or homogeneous to warrant sectioning, return a single
Chapter starting at the first clip — never an empty array.`;

export const buildChaptersUserMessage = (input: {
  clips: Array<{ id: string; order: string; text: string }>;
  existingSections: Array<{ order: string; name: string }>;
}): string => {
  const interleaved = [
    ...input.clips.map((c) => ({
      kind: "clip" as const,
      order: c.order,
      id: c.id,
      text: c.text,
    })),
    ...input.existingSections.map((s) => ({
      kind: "section" as const,
      order: s.order,
      name: s.name,
    })),
  ].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));

  const firstClip = interleaved.find((it) => it.kind === "clip");

  return [
    `Video has ${input.clips.length} clips and ${input.existingSections.length} existing Chapter(s).`,
    "",
    "Timeline (existing sections shown as [[SECTION: name]] lines):",
    "",
    ...interleaved.map((it) =>
      it.kind === "section"
        ? `[[SECTION: ${it.name}]]`
        : `clip ${it.id}: ${it.text}`
    ),
    "",
    `Propose the full replacement set of Chapters. The first clip is ${firstClip && firstClip.kind === "clip" ? firstClip.id : "(none)"} — one Chapter MUST start there.`,
  ].join("\n");
};
