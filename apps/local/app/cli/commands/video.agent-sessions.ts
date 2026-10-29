import { readFileSync } from "node:fs";
import { Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { draftIdArg } from "../entity-id";
import {
  detail,
  emitNdjson,
  emitObject,
  notFound,
  parseError,
} from "../helpers";
import { AgentSessionOperationsService } from "@/services/db-agent-session-operations.server";
import { AgentSessionUploadRefusedError } from "@/services/db-service-errors";
import { findAgentSessionContentProblems } from "@cvm/core/features/agent-sessions/content-rules";
import { readClaudeSession } from "@/services/claude-session-reader";
import { placeAgentSessionEntries } from "@/services/agent-session-placement";
import {
  AGENT_SESSIONS_HELP,
  CLEAR_HELP,
  GET_HELP,
  SET_HELP,
} from "./video.agent-sessions.help";

/**
 * `cvm video agent-sessions set | get | clear` — a Video's Agent Sessions
 * (GLOSSARY.md). The session files are read HERE, on the machine they live
 * on; their entries go to the API, which anchors, checks and stores them.
 */

const readSessionFile = (path: string) =>
  Effect.try({
    try: () => readFileSync(path, "utf8"),
    catch: () => parseError(`could not read --session "${path}"`, "video"),
  });

const sessionOption = Options.text("session").pipe(
  Options.withDescription(
    "A Claude Code session file (its .jsonl transcript). Repeat for each session the Video shows."
  ),
  Options.repeated
);

const setCmd = Command.make(
  "set",
  { id: draftIdArg("video"), sessions: sessionOption },
  ({ id: ref, sessions: paths }) =>
    Effect.gen(function* () {
      const id = yield* ref;
      if (paths.length === 0) {
        return yield* parseError("set needs at least one --session", "video");
      }
      const read = yield* Effect.forEach(paths, (path) =>
        Effect.map(readSessionFile(path), (text) => ({
          path,
          session: readClaudeSession(text),
        }))
      );
      // The API checks the content again; checking here too lists the
      // reader's problems and the content's in one refusal.
      const problems = read.flatMap(({ path, session }) =>
        [
          ...session.problems,
          ...findAgentSessionContentProblems(
            session.entries.map(
              ({ wallClockMs: _wallClockMs, ...entry }, i) => ({
                label: `entry ${i + 1}`,
                entry,
              })
            )
          ),
        ].map((problem) => `${path}: ${problem}`)
      );
      if (problems.length > 0) {
        return yield* new AgentSessionUploadRefusedError({
          reasons: problems,
          message: `Agent Session upload refused, nothing was stored:\n- ${problems.join("\n- ")}`,
        });
      }

      const svc = yield* AgentSessionOperationsService;
      const report = yield* svc
        .setVideoAgentSessions(
          id,
          read.map(({ session }) => ({
            sourceSessionId: session.sourceSessionId,
            entries: session.entries,
          }))
        )
        .pipe(Effect.catchTag("NotFoundError", () => notFound("video", id)));

      yield* emitObject({
        videoId: report.videoId,
        sessions: report.sessions.map((stored, i) => {
          const { path, session } = read[i]!;
          return {
            file: path,
            sourceSessionId: stored.sourceSessionId,
            agentSessionId: stored.agentSessionId,
            reused: stored.reused,
            kept: stored.kept,
            dropped: {
              afterLastScreenClip: stored.droppedAfterLastScreenClip,
              ...session.dropped,
            },
          };
        }),
        clipsWithoutFootageStart: report.clipsWithoutFootageStart,
        agentSessionsDeleted: report.agentSessionsDeleted,
      });
    })
).pipe(Command.withDescription(detail(SET_HELP)));

const getCmd = Command.make("get", { id: draftIdArg("video") }, ({ id: ref }) =>
  Effect.gen(function* () {
    const id = yield* ref;
    const svc = yield* AgentSessionOperationsService;
    const { clips, entries } = yield* svc
      .getVideoAgentSessions(id)
      .pipe(Effect.catchTag("NotFoundError", () => notFound("video", id)));

    const placed = placeAgentSessionEntries(clips, entries);
    const firstSeen = new Map<string, number>();
    for (const { entry, visibleFrom } of placed) {
      if (visibleFrom === null) continue;
      const seen = firstSeen.get(entry.agentSessionId);
      if (seen === undefined || visibleFrom < seen) {
        firstSeen.set(entry.agentSessionId, visibleFrom);
      }
    }
    const last = Number.POSITIVE_INFINITY;
    placed.sort(
      (a, b) =>
        (firstSeen.get(a.entry.agentSessionId) ?? last) -
          (firstSeen.get(b.entry.agentSessionId) ?? last) ||
        a.entry.agentSessionId.localeCompare(b.entry.agentSessionId) ||
        (a.visibleFrom ?? last) - (b.visibleFrom ?? last) ||
        a.entry.sequence - b.entry.sequence
    );

    yield* emitNdjson(
      placed.map(({ entry, visibleFrom }) => ({
        agentSessionId: entry.agentSessionId,
        sourceSessionId: entry.sourceSessionId,
        sequence: entry.sequence,
        clipId: entry.clipId,
        footageTime: entry.footageTime,
        visibleFrom,
        ...entry.content,
      }))
    );
  })
).pipe(Command.withDescription(detail(GET_HELP)));

const clearCmd = Command.make(
  "clear",
  { id: draftIdArg("video") },
  ({ id: ref }) =>
    Effect.gen(function* () {
      const id = yield* ref;
      const svc = yield* AgentSessionOperationsService;
      const cleared = yield* svc
        .clearVideoAgentSessions(id)
        .pipe(Effect.catchTag("NotFoundError", () => notFound("video", id)));
      yield* emitObject(cleared);
    })
).pipe(Command.withDescription(detail(CLEAR_HELP)));

export const agentSessionsCommand = Command.make("agent-sessions").pipe(
  Command.withDescription(detail(AGENT_SESSIONS_HELP)),
  Command.withSubcommands([setCmd, getCmd, clearCmd])
);
