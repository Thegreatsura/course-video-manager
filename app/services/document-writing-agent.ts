import { generateArticlePrompt } from "@/prompts/generate-article";
import type { GlobalLink } from "@/prompts/link-instructions";
import {
  Experimental_Agent as Agent,
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
    ? ""
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

  if (props.document) {
    // No tools when document already exists (edit flow is a future slice)
    return new Agent({
      model: props.model,
      system: systemPrompt + memorySection,
      stopWhen: stepCountIs(5),
    });
  }

  return new Agent({
    model: props.model,
    system: systemPrompt + memorySection,
    tools: { writeDocument: writeDocumentTool },
    stopWhen: stepCountIs(5),
  });
};
