import { Effect, Option } from "effect";
import { ClipMockupOperationsService } from "@/services/db-clip-mockup-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { notFound, parseError, rejectBothFlags } from "@/cli/helpers";

/**
 * How the `cvm clip-mockup` write verbs find the rows they are aimed at:
 * the Video, and the Clip Mockup by bare id or by `--video <id> --at <n>`.
 */

/**
 * Frames hang off a Video's `lineageId`, not its id — resolve one to the
 * other, refusing archived videos the way every other noun refuses archived
 * rows. The bare Video row: `lineageId`, `format` and `archived` are all any
 * verb here reads, so its Lesson, Section and repo are not fetched.
 */
export const requireActiveVideo = (id: string) =>
  Effect.gen(function* () {
    const svc = yield* VideoOperationsService;
    const row = yield* svc
      .getVideoRowById(id)
      .pipe(Effect.catchTag("NotFoundError", () => notFound("video", id)));
    if (row.archived) {
      return yield* notFound("video", id);
    }
    return row;
  });

/** The row must exist and be active. */
export const requireActiveClipMockup = (id: string) =>
  Effect.gen(function* () {
    const svc = yield* ClipMockupOperationsService;
    const row = yield* svc
      .getClipMockupById(id)
      .pipe(Effect.catchTag("NotFoundError", () => notFound("clipMockup", id)));
    if (row.archived) {
      return yield* notFound("clipMockup", id);
    }
    return row;
  });

/**
 * Find the ONE Clip Mockup a write verb is aimed at, from either form of
 * address: the bare `<id>` an agent reads out of `list`, or `--video <id> --at
 * <position>`, the number a human reads off the screen while watching the
 * Animatic ("number 14 is too dense"). Positions count from 1 and are exactly
 * the order `list` and the player show, because both read this same sorted
 * list.
 *
 * Every write verb goes through here so the two forms can never drift apart,
 * and so "both at once" and "off the end of the list" are one message each.
 * An out-of-range position is INVALID INPUT, not a not-found: the position is
 * only meaningful against a list whose length the caller can be told.
 */
export const resolveTargetClipMockup = (params: {
  readonly id: Option.Option<string>;
  readonly video: Option.Option<string>;
  readonly at: Option.Option<number>;
}) =>
  Effect.gen(function* () {
    const id = Option.getOrUndefined(params.id);
    const video = Option.getOrUndefined(params.video);
    const at = Option.getOrUndefined(params.at);

    yield* rejectBothFlags({
      a: id,
      b: at,
      flags: ["<id>", "--at"],
      entity: "clipMockup",
    });

    if (id !== undefined) {
      if (video !== undefined) {
        return yield* parseError(
          "--video only names the list --at counts in, so it cannot be combined with a bare <id>",
          "clipMockup"
        );
      }
      return yield* requireActiveClipMockup(id);
    }

    if (at === undefined) {
      return yield* parseError(
        "address the Clip Mockup with a bare <id> or with --video <id> --at <position>",
        "clipMockup"
      );
    }
    if (video === undefined) {
      return yield* parseError(
        "--at <position> needs --video <id> to count the position in",
        "clipMockup"
      );
    }

    const videoRow = yield* requireActiveVideo(video);
    const svc = yield* ClipMockupOperationsService;
    const rows = yield* svc.listClipMockupsByVideoId(videoRow.id);
    const row = at >= 1 ? rows[at - 1] : undefined;

    if (row === undefined) {
      return yield* parseError(
        rows.length === 0
          ? `--at ${at} is out of range: video ${video} has 0 Clip Mockups`
          : `--at ${at} is out of range: video ${video} has ${rows.length} Clip Mockups, so positions run 1-${rows.length}`,
        "clipMockup"
      );
    }
    return row;
  });

/**
 * What `delete` archives: the bare ids, read in ONE call, or the one Clip
 * Mockup at `--video <id> --at <n>`. Every id must be active — a missing or
 * already-deleted one is a not-found naming it, and nothing is archived. A
 * repeated id counts once.
 */
export const resolveDeleteTargets = (params: {
  readonly ids: ReadonlyArray<string>;
  readonly video: Option.Option<string>;
  readonly at: Option.Option<number>;
}) =>
  Effect.gen(function* () {
    if (params.ids.length === 0) {
      return [yield* resolveTargetClipMockup({ ...params, id: Option.none() })];
    }
    yield* rejectBothFlags({
      a: params.ids[0],
      b: Option.getOrUndefined(params.at),
      flags: ["<id>", "--at"],
      entity: "clipMockup",
    });
    if (Option.isSome(params.video)) {
      return yield* parseError(
        "--video only names the list --at counts in, so it cannot be combined with a bare <id>",
        "clipMockup"
      );
    }
    const unique = [...new Set(params.ids)];
    const svc = yield* ClipMockupOperationsService;
    const found = new Map(
      (yield* svc.getClipMockupsByIds(unique)).map((r) => [r.id, r])
    );
    return yield* Effect.forEach(unique, (id) => {
      const row = found.get(id);
      return row === undefined || row.archived
        ? notFound("clipMockup", id)
        : Effect.succeed(row);
    });
  });
