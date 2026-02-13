import { getLinkInstructions, type GlobalLink } from "./link-instructions";

export const generateYoutubeDescriptionPrompt = (opts: {
  code: {
    path: string;
    content: string;
  }[];
  transcript: string;
  images: string[];
  courseStructure?: string;
  youtubeChapters: { timestamp: string; name: string }[];
  links: GlobalLink[];
}) => {
  const transcriptSection = opts.transcript
    ? `Here is the transcript of the video:

<transcript>
${opts.transcript}
</transcript>

`
    : "";

  const codeSection =
    opts.code.length > 0
      ? `Here is the code for the video:

<code>
${opts.code
  .map((file) => `<file path="${file.path}">${file.content}</file>`)
  .join("\n")}
</code>

`
      : "";

  const chaptersSection =
    opts.youtubeChapters.length > 0
      ? `Here are the YouTube chapter timestamps for this video:

<chapters>
${opts.youtubeChapters.map((chapter) => `${chapter.timestamp} ${chapter.name}`).join("\n")}
</chapters>

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
You are a helpful assistant being asked to generate a YouTube video description for a coding lesson video.

YouTube descriptions appear below the video and should provide context, include timestamps, and encourage engagement.
</role-context>

<documents>
${transcriptSection}${courseStructureSection}${codeSection}${chaptersSection}</documents>

<the-ask>
Generate a YouTube video description for this coding lesson.

The description should have the following structure:

1. **Opening Summary** (First section)
   - A short, engaging description about what the video covers
   - Maximum 300 characters
   - Do NOT use emojis
   - Stick closely to the content from the transcript
   - This is what viewers see before clicking "Show more"

2. **Timestamps** (Second section, if chapters exist)
   - Include all the YouTube chapter timestamps provided above
   - Copy them exactly as provided
   - Add a blank line before this section

3. **Relevant Links** (Third section)
   - Extract any calls-to-action or relevant links mentioned in the transcript or code
   - This might include course links, documentation, tools, or resources mentioned in the video
   - Add a blank line before this section
   - If no specific links are mentioned, skip this section

4. **Standard Promotional Footer** (Fourth section, if relevant)
   - If this is an AI-related video about working with AI SDKs, LLMs, or AI development, include this promotional section:

   Become an AI Hero with my AI SDK v5 Crash Course:

   https://www.aihero.dev/workshops/ai-sdk-v5-crash-course

   Follow Matt on Twitter

   https://twitter.com/mattpocockuk

   Join the Discord:

   https://aihero.dev/discord

   - Add a blank line before this section
   - Only include this if the video is clearly about AI development, AI SDKs, or working with LLMs
   - If the video is about general TypeScript, React, or other non-AI topics, skip this section

${getLinkInstructions(opts.links)}
</the-ask>

<output-format>
Do not enter into conversation with the user. Always assume that their messages to you are instructions for editing the description.

Respond with the complete YouTube description text, formatted with proper line breaks between sections.

Do not add any commentary, explanations, or meta-text. Just output the description itself.
</output-format>
`.trim();
};
