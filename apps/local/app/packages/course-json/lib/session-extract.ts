import { Effect, Schema } from "effect";
import {
  fromEntryColumns,
  type AgentSessionEntryColumns,
  type AgentSessionEntryContent,
} from "@cvm/core/features/agent-sessions/agent-session-entry";
import {
  visibleAgentSessions,
  type PlacementClip,
} from "@/services/agent-session-placement";
import { CourseJsonSessionExtract } from "./course-json-schema";

/**
 * A video entry's `sessionExtract`: the Agent Sessions on screen in the
 * Video, every entry timed in the CURRENT cut (`visibleAgentSessions`, the
 * one place that turns a stored entry into video time). Sessions in the
 * order they first appear, each named by its Agent Session id — never by
 * Claude Code's own id.
 */

/** An Agent Session Entry as the publish read loads it, on its Clip. */
export type InputAgentSessionEntry = AgentSessionEntryColumns & {
  readonly agentSessionId: string;
  readonly footageTime: number;
  readonly sequence: number;
};

export type SessionExtractClip = PlacementClip & {
  readonly agentSessionEntries?: ReadonlyArray<InputAgentSessionEntry>;
};

type SessionExtract = typeof CourseJsonSessionExtract.Type;

/** An entry's fields as course.json carries them: an absent value is left out. */
const toFields = (content: AgentSessionEntryContent) => {
  switch (content.kind) {
    case "userPrompt":
    case "assistantText":
    case "interrupt":
      return { kind: content.kind, text: content.text };
    case "skillCall":
      return {
        kind: content.kind,
        skill: content.skill,
        via: content.via,
        ...(content.args === null ? {} : { args: content.args }),
      };
    case "toolCall":
      return {
        kind: content.kind,
        tool: content.tool,
        ...(content.summary === null ? {} : { summary: content.summary }),
        ...(content.resultIsError === null
          ? {}
          : { resultIsError: content.resultIsError }),
      };
  }
};

const buildSessionExtract = (
  clipsInVideoOrder: ReadonlyArray<SessionExtractClip>
): unknown => {
  const entries = clipsInVideoOrder.flatMap((clip) =>
    (clip.agentSessionEntries ?? []).map((entry) => ({
      ...entry,
      clipId: clip.id,
    }))
  );
  const sessions = visibleAgentSessions(clipsInVideoOrder, entries);
  if (sessions.length === 0) return undefined;
  return {
    sessions: sessions.map((session) => ({
      sessionId: session.agentSessionId,
      entries: session.entries.map(({ entry, visibleFrom }) => {
        const { kind, ...fields } = toFields(fromEntryColumns(entry));
        return { kind, visibleFrom, ...fields };
      }),
    })),
  };
};

/**
 * The Video's `sessionExtract`, or undefined when nothing shows. It NEVER
 * fails the export: an extract that cannot be built, or that does not match
 * the published schema, is logged and left out, and the Video ships without
 * one.
 */
export const sessionExtractOf = (
  videoId: string,
  clipsInVideoOrder: ReadonlyArray<SessionExtractClip>
): Effect.Effect<SessionExtract | undefined> =>
  Effect.try(() => buildSessionExtract(clipsInVideoOrder)).pipe(
    Effect.flatMap((extract) =>
      extract === undefined
        ? Effect.succeed(undefined)
        : Schema.decodeUnknown(CourseJsonSessionExtract)(extract)
    ),
    Effect.catchAll((error) =>
      Effect.logWarning("course.json: sessionExtract left out", {
        videoId,
        error: String(error),
      }).pipe(Effect.as(undefined))
    )
  );
