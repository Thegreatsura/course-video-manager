import { DBFunctionsService } from "@/services/db-service.server";
import { runtimeLive } from "@/services/layer.server";
import {
  acquireTextWritingContext,
  createModelMessagesForTextWritingAgent,
} from "@/services/text-writing-agent";
import { createDocumentWritingAgent } from "@/services/document-writing-agent";
import { type UIMessage } from "ai";
import { Console, Effect, Schema } from "effect";
import type { Route } from "./+types/videos.$videoId.document-completions";
import { anthropic } from "@ai-sdk/anthropic";
import { data } from "react-router";

const courseStructureSchema = Schema.Struct({
  repoName: Schema.String,
  currentSectionPath: Schema.String,
  currentLessonPath: Schema.String,
  sections: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      lessons: Schema.Array(
        Schema.Struct({
          path: Schema.String,
          description: Schema.optional(Schema.String),
        })
      ),
    })
  ),
});

const chatSchema = Schema.Struct({
  messages: Schema.Any,
  enabledFiles: Schema.Array(Schema.String),
  model: Schema.String,
  document: Schema.optional(Schema.String),
  includeTranscript: Schema.optionalWith(Schema.Boolean, {
    default: () => true,
  }),
  enabledSections: Schema.optionalWith(Schema.Array(Schema.String), {
    default: () => [],
  }),
  courseStructure: Schema.optional(courseStructureSchema),
  memory: Schema.optional(Schema.String),
});

export const action = async (args: Route.ActionArgs) => {
  const body = await args.request.json();
  const videoId = args.params.videoId;

  return Effect.gen(function* () {
    const parsed = yield* Schema.decodeUnknown(chatSchema)(body);
    const messages: UIMessage[] = parsed.messages;
    const enabledFiles: string[] = [...parsed.enabledFiles];
    const model: string = parsed.model;
    const includeTranscript = parsed.includeTranscript;
    const enabledSections: string[] = [...parsed.enabledSections];

    const videoContext = yield* acquireTextWritingContext({
      videoId,
      enabledFiles,
      includeTranscript,
      enabledSections,
    });

    const db = yield* DBFunctionsService;
    const links = yield* db.getLinks();

    let courseStructureText: string | undefined;
    if (parsed.courseStructure) {
      const cs = parsed.courseStructure;
      const lines: string[] = [`Course: ${cs.repoName}`];
      for (const section of cs.sections) {
        const isCurrent = section.path === cs.currentSectionPath;
        lines.push(
          `  ${section.path}/${isCurrent ? "  <-- current section" : ""}`
        );
        for (const lesson of section.lessons) {
          const isCurrentLesson =
            isCurrent && lesson.path === cs.currentLessonPath;
          const marker = isCurrentLesson ? "  <-- current lesson" : "";
          const desc = lesson.description ? ` - ${lesson.description}` : "";
          lines.push(`    ${lesson.path}/${marker}${desc}`);
        }
      }
      courseStructureText = lines.join("\n");
    }

    const modelMessages = createModelMessagesForTextWritingAgent({
      messages,
      imageFiles: videoContext.imageFiles,
    });

    // Append document content to last user message for prompt caching
    if (parsed.document) {
      const documentText = `\n\n<current-document>\n${parsed.document}\n</current-document>`;
      modelMessages.push({
        role: "user",
        content: documentText,
      });
    }

    const agent = createDocumentWritingAgent({
      model: anthropic(model),
      document: parsed.document,
      transcript: videoContext.transcript,
      code: videoContext.textFiles,
      imageFiles: videoContext.imageFiles,
      sectionNames: videoContext.sectionNames,
      links,
      courseStructure: courseStructureText,
      memory: parsed.memory,
    });

    const result = agent.stream({
      messages: modelMessages,
    });

    return result.toUIMessageStreamResponse();
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
