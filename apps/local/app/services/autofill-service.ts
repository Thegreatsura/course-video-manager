import { chapters as chaptersTable, videos } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { Data, Effect, Schedule } from "effect";
import {
  selectAutofillCandidates,
  type AutofillCandidate,
  type AutofillField,
  type AutofillSelection,
  type AutofillSkip,
} from "./autofill-candidates";
import { replaceVideoChapters } from "./autofill-chapters-write.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { requireDraftVersionForVideo } from "@/services/draft-guard.server";
import {
  DrizzleService,
  type Database,
} from "@/services/drizzle-service.server";
import {
  TextGenerationService,
  type AutofillChapterProposal,
} from "./text-generation-service";
import { withDbTransaction } from "@/services/with-db-transaction.server";
import { UnknownDBServiceError } from "@/services/db-service-errors";
import { SidecarContext } from "@/services/sidecar-context";

/**
 * THE AUTOFILL — a review-free generation pass that writes every shipping
 * **Video**'s missing `description` and missing **Chapters** in one go.
 *
 * It is deliberately a JOB OF ITS OWN, not a stage of a **Publish** (ADR
 * 0024). **Missing Chapters** is a blocking lint, so the Publish button is
 * disabled in exactly the situation the Autofill exists to fix — a stage
 * inside a Publish would be unreachable. And a Publish is long, holds a global
 * mutation semaphore and has a **Pending Version** to unwind; a rate limit
 * from Anthropic must not be able to touch any of that.
 *
 * Its rules, all of which the tests are about:
 *
 *   Candidates    are chosen by selectAutofillCandidates — the same rule the
 *                 publish page counts its button with.
 *   Execution     six Videos at a time, with a Video's two fields written
 *                 concurrently inside that.
 *   Commit        a Video's two fields land in ONE transaction or neither
 *                 does, so there is never a Video with new chapters and a
 *                 half-written description.
 *   Isolation     one Video's failure never stops the rest; failures are
 *                 collected the way the publish export loop collects its own.
 *   Retry         a refusal that says "later" — a rate limit, a server error —
 *                 backs off and tries again, and does NOT consume the Video's
 *                 one attempt. Everything else does.
 *   Author wins   a field is written only if it is still exactly as it was
 *                 when the run read it. One the author changed meanwhile is
 *                 kept, and the Autofill's text is offered beside it (`kept`)
 *                 instead of written over it.
 */

/** Six Videos at a time: enough that thirty finish in minutes. */
export const AUTOFILL_CONCURRENCY = 6;

/** How many times a retryable refusal is waited out before it counts. */
export const AUTOFILL_RETRY_LIMIT = 3;

const retrySchedule = Schedule.exponential("500 millis").pipe(
  Schedule.jittered,
  Schedule.intersect(Schedule.recurs(AUTOFILL_RETRY_LIMIT))
);

export class AutofillVersionNotDraftError extends Data.TaggedError(
  "AutofillVersionNotDraftError"
)<{ readonly versionId: string; readonly commitState: string }> {}

/**
 * The model's Chapter set named no Clip of the Video it was proposed for, so
 * there is nothing safe to write.
 */
export class AutofillNoValidChaptersError extends Data.TaggedError(
  "AutofillNoValidChaptersError"
)<{ readonly message: string }> {}

export type AutofillVideoResult = {
  readonly videoId: string;
  readonly title: string;
  readonly status: "filled" | "failed";
  /** The fields actually written. Empty on a failure — nothing landed. */
  readonly fields: readonly AutofillField[];
  /**
   * The fields the author changed while the Autofill ran: their text stayed,
   * and this is what the Autofill would have written, offered instead.
   */
  readonly kept: readonly AutofillKept[];
  readonly message?: string;
};

export type AutofillKept = {
  readonly field: AutofillField;
  /** The description, or the Chapter titles in order joined by " · ". */
  readonly proposal: string;
};

export type AutofillRunResult = {
  readonly versionId: string;
  readonly candidates: readonly AutofillCandidate[];
  readonly skipped: readonly AutofillSkip[];
  readonly results: readonly AutofillVideoResult[];
};

export interface AutofillRunOptions {
  readonly versionId: string;
  readonly includeTodoLessons: boolean;
  /** The roster, announced once selection is done and before any work starts. */
  readonly onCandidates?: (selection: AutofillSelection) => void;
  readonly onVideoStarted?: (candidate: AutofillCandidate) => void;
  readonly onVideoSettled?: (result: AutofillVideoResult) => void;
}

/** Everything one candidate Video's generation needs, gathered on one walk. */
type CandidatePayload = {
  readonly body: string;
  readonly clips: ReadonlyArray<{ id: string; order: string; text: string }>;
  readonly chapters: ReadonlyArray<{ order: string; name: string }>;
  /** The two fields as the run first read them: a write lands only on these. */
  readonly startedFrom: FieldsSnapshot;
};

type FieldsSnapshot = {
  readonly description: string | null;
  readonly chapters: string;
};

/** A Video's live Chapters as one comparable value: a rename or a move counts. */
const chaptersFingerprint = (
  chapters: ReadonlyArray<{ id: string; order: string; name: string }>
) =>
  JSON.stringify(
    [...chapters]
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
      .map((chapter) => [chapter.id, chapter.order, chapter.name])
  );

const makeAutofillService = (
  db: Database,
  deps: {
    versionOps: VersionOperationsService;
    linkAuthOps: LinkAuthOperationsService;
    textGeneration: TextGenerationService;
  }
) => {
  const { versionOps, linkAuthOps, textGeneration } = deps;

  /**
   * Write a Video's two fields together. The draft guard runs inside the same
   * transaction as the writes, so the Autofill serialises against **Submit**
   * exactly as every other write does — an immutable version is never touched.
   */
  const commitVideo = (input: {
    videoId: string;
    startedFrom: FieldsSnapshot;
    description: string | null;
    chapters: readonly AutofillChapterProposal[] | null;
  }) =>
    withDbTransaction(db, (tx) =>
      Effect.gen(function* () {
        yield* requireDraftVersionForVideo(tx, input.videoId);
        // Compare-and-set: the Video row is locked, then each field is
        // re-read. One the author changed since the run read it is theirs.
        const now = yield* Effect.tryPromise({
          try: async () => {
            const [row] = await tx
              .select({ description: videos.description })
              .from(videos)
              .where(eq(videos.id, input.videoId))
              .for("update");
            const liveChapters = await tx
              .select({
                id: chaptersTable.id,
                order: chaptersTable.order,
                name: chaptersTable.name,
              })
              .from(chaptersTable)
              .where(
                and(
                  eq(chaptersTable.videoId, input.videoId),
                  eq(chaptersTable.archived, false)
                )
              )
              .orderBy(asc(chaptersTable.order));
            return {
              description: row?.description ?? null,
              chapters: chaptersFingerprint(liveChapters),
            };
          },
          catch: (cause) => new UnknownDBServiceError({ cause }),
        });

        const fields: AutofillField[] = [];
        const kept: AutofillKept[] = [];

        if (input.description !== null) {
          const description = input.description;
          if (now.description !== input.startedFrom.description) {
            kept.push({ field: "description", proposal: description });
          } else {
            yield* Effect.tryPromise({
              try: () =>
                tx
                  .update(videos)
                  .set({ description, updatedAt: new Date() })
                  .where(eq(videos.id, input.videoId)),
              catch: (cause) => new UnknownDBServiceError({ cause }),
            });
            fields.push("description");
          }
        }
        if (input.chapters !== null) {
          const chapters = input.chapters;
          if (now.chapters !== input.startedFrom.chapters) {
            kept.push({
              field: "chapters",
              proposal: chapters.map((chapter) => chapter.title).join(" · "),
            });
          } else {
            yield* Effect.tryPromise({
              try: () =>
                replaceVideoChapters(tx, {
                  videoId: input.videoId,
                  proposals: chapters,
                }),
              catch: (cause) => new UnknownDBServiceError({ cause }),
            });
            fields.push("chapters");
          }
        }
        return { fields, kept };
      })
    );

  const autofillVideo = (
    candidate: AutofillCandidate,
    payload: CandidatePayload,
    links: Effect.Effect.Success<ReturnType<typeof linkAuthOps.getLinks>>
  ) =>
    Effect.gen(function* () {
      const wantsDescription = candidate.fields.includes("description");
      const wantsChapters = candidate.fields.includes("chapters");

      // The two fields of one Video run together; the whole Video is one
      // attempt, so the first refusal that sticks takes both down with it and
      // neither is written.
      const [description, chapters] = yield* Effect.all(
        [
          wantsDescription
            ? textGeneration
                .autofillDescription({ body: payload.body, links })
                .pipe(
                  Effect.retry({
                    schedule: retrySchedule,
                    while: (error) => error.retryable,
                  })
                )
            : Effect.succeed(null),
          wantsChapters
            ? textGeneration
                .autofillChapters({
                  clips: payload.clips,
                  existingChapters: payload.chapters,
                })
                .pipe(
                  Effect.retry({
                    schedule: retrySchedule,
                    while: (error) => error.retryable,
                  })
                )
            : Effect.succeed(null),
        ],
        { concurrency: "unbounded" }
      );

      // TextGeneration is a boundary, so what comes back through it is not
      // trusted: an id the model invented is refused here rather than written.
      // A set that validates to nothing is a failure, not an instruction to
      // archive the Chapters already there.
      let validChapters: AutofillChapterProposal[] | null = null;
      if (chapters !== null) {
        const clipIds = new Set(payload.clips.map((clip) => clip.id));
        validChapters = chapters.filter((chapter) =>
          clipIds.has(chapter.beforeClipId)
        );
        if (validChapters.length === 0) {
          return yield* new AutofillNoValidChaptersError({
            message:
              "the model proposed no Chapter naming a clip of this video",
          });
        }
      }

      const { fields, kept } = yield* commitVideo({
        videoId: candidate.videoId,
        startedFrom: payload.startedFrom,
        description,
        chapters: validChapters,
      });

      return {
        videoId: candidate.videoId,
        title: candidate.title,
        status: "filled",
        fields,
        kept,
      } satisfies AutofillVideoResult;
    });

  const autofillCourseVersion = Effect.fn("autofillCourseVersion")(function* (
    options: AutofillRunOptions
  ) {
    // An Autofill is a Job: only the Sidecar runs it, never a request a
    // browser tab keeps alive (sidecar-context.ts).
    yield* SidecarContext;
    const version = yield* versionOps.getVersionWithSections(options.versionId);
    // Only the Draft Version is ever written to. Refusing up front is cheaper
    // and clearer than letting every per-Video guard refuse in turn.
    if (version.commitState !== "draft") {
      return yield* new AutofillVersionNotDraftError({
        versionId: options.versionId,
        commitState: version.commitState,
      });
    }

    const selection = selectAutofillCandidates(
      version.sections,
      options.includeTodoLessons
    );
    options.onCandidates?.(selection);

    const payloads = new Map<string, CandidatePayload>();
    for (const section of version.sections) {
      for (const lesson of section.lessons) {
        for (const video of lesson.videos) {
          payloads.set(video.id, {
            body: (video.body ?? "").trim(),
            clips: video.clips.map((clip) => ({
              id: clip.id,
              order: clip.order,
              text: clip.text ?? "",
            })),
            chapters: video.chapters.map((chapter) => ({
              order: chapter.order,
              name: chapter.name,
            })),
            startedFrom: {
              description: video.description ?? null,
              chapters: chaptersFingerprint(video.chapters),
            },
          });
        }
      }
    }

    const links = yield* linkAuthOps.getLinks();

    const results = yield* Effect.forEach(
      selection.candidates,
      (candidate) =>
        Effect.gen(function* () {
          options.onVideoStarted?.(candidate);
          const payload = payloads.get(candidate.videoId)!;
          // Nothing here may fail the run: thirty Videos are never held
          // hostage by one.
          const result: AutofillVideoResult = yield* autofillVideo(
            candidate,
            payload,
            links
          ).pipe(
            Effect.catchAll((error) =>
              Effect.succeed({
                videoId: candidate.videoId,
                title: candidate.title,
                status: "failed",
                fields: [],
                kept: [],
                message:
                  error instanceof Error
                    ? error.message
                    : String((error as { message?: string }).message ?? error),
              } satisfies AutofillVideoResult)
            ),
            Effect.catchAllDefect((defect) =>
              Effect.succeed({
                videoId: candidate.videoId,
                title: candidate.title,
                status: "failed",
                fields: [],
                kept: [],
                message:
                  defect instanceof Error ? defect.message : String(defect),
              } satisfies AutofillVideoResult)
            )
          );
          options.onVideoSettled?.(result);
          return result;
        }),
      { concurrency: AUTOFILL_CONCURRENCY }
    );

    const runResult: AutofillRunResult = {
      versionId: options.versionId,
      candidates: selection.candidates,
      skipped: selection.skipped,
      results,
    };
    return runResult;
  });

  return { autofillCourseVersion };
};

export class AutofillService extends Effect.Service<AutofillService>()(
  "AutofillService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      const versionOps = yield* VersionOperationsService;
      const linkAuthOps = yield* LinkAuthOperationsService;
      const textGeneration = yield* TextGenerationService;
      return makeAutofillService(db, {
        versionOps,
        linkAuthOps,
        textGeneration,
      });
    }),
    dependencies: [
      VersionOperationsService.Default,
      LinkAuthOperationsService.Default,
      TextGenerationService.Default,
    ],
  }
) {}
