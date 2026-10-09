import { DrizzleService, type Database } from "./drizzle-service.server.js";
import { clipMockups, jobs, videos } from "../db/schema.js";
import { CLIP_MOCKUP_VOICE_JOB_KIND } from "../features/clip-mockups/voice-status.js";
import { UnknownDBServiceError } from "./db-service-errors.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { ClipMockupSpeech } from "./db-clip-mockup-operations.server.js";

/**
 * Where a Clip Mockup's VOICE is recorded — the half of a Clip Mockup the
 * `clip-mockup-voice` Job writes, once the row already exists
 * (`features/clip-mockups/voice-status.ts`).
 *
 * Only the Sidecar uses this, against its own database connection; it is not
 * part of the RPC surface. Every write is GUARDED BY THE LINE the Job voiced:
 * a Clip Mockup whose words were changed while its old line was being voiced
 * is left `pending` for the Job its new words queued, never marked `ready`
 * with speech for words it no longer says.
 */

/** A Clip Mockup as the voice Job reads it: its line, and where its WAV goes. */
export interface ClipMockupToVoice {
  readonly id: string;
  readonly line: string;
  readonly voiceStatus: "pending" | "ready" | "failed";
  readonly archived: boolean;
  /** Its Video's `lineageId`: the directory its WAV is written in. */
  readonly lineageId: string;
}

const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });

const createClipMockupVoiceOperations = (db: Database) => {
  /** The Clip Mockups named, with their Video's `lineageId`; unknown ids are left out. */
  const listClipMockupsToVoice = (ids: readonly string[]) =>
    ids.length === 0
      ? Effect.succeed([] as ClipMockupToVoice[])
      : makeDbCall(() =>
          db
            .select({
              id: clipMockups.id,
              line: clipMockups.line,
              voiceStatus: clipMockups.voiceStatus,
              archived: clipMockups.archived,
              lineageId: videos.lineageId,
            })
            .from(clipMockups)
            .innerJoin(videos, eq(videos.id, clipMockups.videoId))
            .where(inArray(clipMockups.id, [...ids]))
        );

  /**
   * The line's voice is on disk: record where, and how long it runs. Only if
   * the row still says `line`; answers whether it did.
   */
  const markVoiceReady = (input: {
    readonly id: string;
    readonly line: string;
    readonly speech: ClipMockupSpeech;
  }) =>
    makeDbCall(() =>
      db
        .update(clipMockups)
        .set({
          audioPath: input.speech.audioPath,
          durationSeconds: input.speech.durationSeconds,
          voiceStatus: "ready",
          voiceError: null,
        })
        .where(
          and(eq(clipMockups.id, input.id), eq(clipMockups.line, input.line))
        )
        .returning({ id: clipMockups.id })
    ).pipe(Effect.map((rows) => rows.length > 0));

  /**
   * The `clip-mockup-voice` Job `jobId` has ended for good, by whatever
   * route — its last attempt failed, or its last run was lost: every Clip
   * Mockup it named that is still `pending` is marked `failed`, with why.
   * Except one another live (`queued` or `running`) voice Job also names:
   * that Job will still voice it. The check and the write are one statement.
   * Answers the ids it marked.
   */
  const markVoiceFailed = (input: {
    readonly ids: readonly string[];
    readonly jobId: string;
    readonly error: string;
  }) =>
    input.ids.length === 0
      ? Effect.succeed([] as string[])
      : makeDbCall(() =>
          db
            .update(clipMockups)
            .set({
              audioPath: null,
              durationSeconds: null,
              voiceStatus: "failed",
              voiceError: input.error,
            })
            .where(
              and(
                inArray(clipMockups.id, [...input.ids]),
                eq(clipMockups.voiceStatus, "pending"),
                sql`not exists (select 1 from ${jobs} where ${jobs.kind} = ${CLIP_MOCKUP_VOICE_JOB_KIND} and ${jobs.id} <> ${input.jobId} and ${jobs.status} in ('queued', 'running') and ${jobs.params} -> 'clipMockupIds' @> jsonb_build_array(${clipMockups.id}))`
              )
            )
            .returning({ id: clipMockups.id })
        ).pipe(Effect.map((rows) => rows.map((r) => r.id)));

  return { listClipMockupsToVoice, markVoiceReady, markVoiceFailed };
};

export class ClipMockupVoiceOperationsService extends Effect.Service<ClipMockupVoiceOperationsService>()(
  "ClipMockupVoiceOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      return createClipMockupVoiceOperations(db);
    }),
  }
) {}
