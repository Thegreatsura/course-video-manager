import { generateArticlePrompt } from "@/prompts/generate-article";
import type { GlobalLink } from "@/prompts/link-instructions";
import {
  ToolLoopAgent as Agent,
  tool,
  type LanguageModel,
  stepCountIs,
} from "ai";
import { z } from "zod";
import type {
  TextWritingAgentCodeFile,
  TextWritingAgentImageFile,
} from "./text-writing-agent";

export const createDocumentWritingAgent = (props: {
  model: LanguageModel;
  document: string | undefined;
  transcript: string;
  code: TextWritingAgentCodeFile[];
  imageFiles: TextWritingAgentImageFile[];
  sectionNames?: string[];
  links?: GlobalLink[];
  courseStructure?: string;
  memory?: string;
}) => {
  const links = props.links ?? [];

  const basePrompt = generateArticlePrompt({
    code: props.code,
    transcript: props.transcript,
    images: props.imageFiles.map((file) => file.path),
    sectionNames: props.sectionNames,
    courseStructure: props.courseStructure,
    links,
  });

  const documentInstructions = props.document
    ? `

## Document Editing Instructions

A document already exists. The user will provide it in a <current-document> tag. You MUST use the \`editDocument\` tool to make changes. Do not output the full article as plain text.

Use minimal, surgical edits:
- \`replace\`: Find a unique passage of old_text and replace it with new_text. Include enough surrounding context in old_text to ensure a unique match.
- \`insert_after\`: Find a unique anchor string and insert new_text immediately after it.
- \`rewrite\`: Replace the entire document (use only for major restructuring when asked).

You can include multiple edits in a single editDocument call. Edits are applied sequentially — each edit sees the document as modified by prior edits.

If an edit fails (e.g. text not found), you will receive an error message. Read it carefully and retry with corrected text.

After calling editDocument, you may add a brief conversational message explaining what you changed.`
    : `

## Document Writing Instructions

There is no document yet. You MUST use the \`writeDocument\` tool to create the article. Do not output the article as plain text — always use the tool.

After calling writeDocument, you may add a brief conversational message explaining what you wrote.`;

  const systemPrompt = basePrompt + documentInstructions;

  const memorySection = props.memory
    ? `\n\n## Course Memory\n\nThe following is course-level context provided by the author. Use it to inform your response:\n\n<memory>\n${props.memory}\n</memory>`
    : "";

  const writeDocumentTool = tool({
    description:
      "Write the full article document. Use this to create the initial article.",
    inputSchema: z.object({
      content: z.string().describe("The full markdown content of the article"),
    }),
  });

  const editDocumentTool = tool({
    description:
      "Edit the existing document with surgical changes. Use replace for targeted text changes, insert_after to add content after an anchor, or rewrite to replace the entire document.",
    inputSchema: z.object({
      edits: z.array(
        z.object({
          type: z
            .enum(["replace", "insert_after", "rewrite"])
            .describe("The type of edit to apply"),
          old_text: z
            .string()
            .optional()
            .describe(
              "For replace: the exact text to find and replace. Include enough context for a unique match."
            ),
          anchor: z
            .string()
            .optional()
            .describe(
              "For insert_after: the exact text after which to insert new content."
            ),
          new_text: z
            .string()
            .describe("The new text to insert or replace with"),
        })
      ),
    }),
  });

  if (props.document) {
    return new Agent({
      model: props.model,
      instructions: systemPrompt + memorySection,
      tools: { editDocument: editDocumentTool },
      stopWhen: stepCountIs(5),
    });
  }

  return new Agent({
    model: props.model,
    instructions: systemPrompt + memorySection,
    tools: { writeDocument: writeDocumentTool },
    stopWhen: stepCountIs(5),
  });
};
