import { getImageInstructions } from "./image-instructions";
import { getLinkInstructions, type GlobalLink } from "./link-instructions";

export const generateArticlePlanPrompt = (opts: {
  code: {
    path: string;
    content: string;
  }[];
  transcript: string;
  images: string[];
  courseStructure?: string;
  links: GlobalLink[];
}) => {
  const transcriptSection = opts.transcript
    ? `Here is the transcript of the video (if available):

<transcript>
${opts.transcript}
</transcript>

`
    : "";

  const codeSection =
    opts.code.length > 0
      ? `Here is the code for the topic:

<code>
${opts.code
  .map((file) => `<file path="${file.path}">${file.content}</file>`)
  .join("\n")}
</code>

`
      : "";

  const courseStructureSection = opts.courseStructure
    ? `This lesson is part of a larger course. Here is the full structure:

<course-structure>
${opts.courseStructure}
</course-structure>

`
    : "";

  return `
<role-context>
You are a content strategist helping to plan the structure of an educational article. Your goal is to create a clear, focused outline that builds understanding for the reader in the most effective way possible.

The purpose of this article plan is to distill raw information (transcripts, code, interviews) into a focused, well-organized structure before the actual writing begins.
</role-context>

<documents>
${transcriptSection}${courseStructureSection}${codeSection}</documents>

<the-ask>
Create an article plan with the following characteristics:

1. **Choose your own flow**: Don't follow the source material's order. Find the optimal path through the topics that builds understanding progressively for the reader.

2. **Be ruthlessly selective**: The source material likely contains irrelevant tangents, repeated points, or off-topic content. Leave it on the cutting room floor. Only include what serves the main learning goal.

3. **Prioritize mercilessly**: Identify the core concepts and main learning outcomes. Everything in the plan should serve these goals.

4. **Use markdown headings for sections**: Each major section should be an H2 (##) heading.

5. **Use extremely concise bullet points**: Under each heading, list what should be covered. Sacrifice grammar for concision. These are notes, not sentences.

${getImageInstructions(opts.images)}

${getLinkInstructions(opts.links)}
</the-ask>

<output-format>
Output an article plan in this format:

## Section Title

- key point, no fluff
- another point, terse
- concept to explain briefly

## Another Section

- point goes here
- be concise, skip articles/prepositions when possible
- focus on what matters

Guidelines for bullet points:
- Skip words like "the", "a", "is", "are" when meaning is clear without them
- Use shorthand: "e.g." instead of "for example", "vs" instead of "versus"
- Fragment sentences are fine: "why this matters" not "explain why this matters"
- Action-oriented: "show X" not "this section will show X"
- Max 5-8 words per bullet point when possible

After the plan, include a brief note (1-2 sentences) on:
- The main learning goal for this article
- What was intentionally left out and why
</output-format>
`.trim();
};
