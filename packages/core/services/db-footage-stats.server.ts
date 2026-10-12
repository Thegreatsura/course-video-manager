import { sql } from "drizzle-orm";
import { Effect } from "effect";
import {
  clips,
  courseVersions,
  lessons,
  sections,
  videos,
} from "../db/schema.js";
import type { Database } from "./drizzle-service.server.js";
import { UnknownDBServiceError } from "./db-service-errors.js";

/**
 * How much **Footage** was filmed recently, in seconds, over three windows of
 * whole calendar days in the author's time zone, each ending now: today
 * (since local midnight), the last 7 days and the last 30 days (both
 * including today). Shown at the foot of the app sidebar.
 */
export interface FootageStats {
  readonly todaySeconds: number;
  readonly last7DaysSeconds: number;
  readonly last30DaysSeconds: number;
  /**
   * Each window's efficiency, by Clip rather than by duration: how many of the
   * Clips filmed in it are still live (`…KeptClips`) out of all of them,
   * archived ones included (`…Clips`). No Clips in a window means no ratio.
   */
  readonly todayClips: number;
  readonly todayKeptClips: number;
  readonly last7DaysClips: number;
  readonly last7DaysKeptClips: number;
  readonly last30DaysClips: number;
  readonly last30DaysKeptClips: number;
}

/**
 * The `scene` every **Effect Clip** is stored with (`WHITE_NOISE_DEFAULTS`,
 * apps/local/app/features/video-editor/clip-state-reducer-effect-clip-helpers.ts).
 * An Effect Clip is an asset put in by hand, not filmed, so it never counts.
 */
const EFFECT_CLIP_SCENE = "white noise";

/**
 * One aggregate over the Clips filmed in the last 30 days: nothing but three
 * sums and six counts leaves the database.
 *
 * - **When** a Clip was filmed is the earlier of its `created_at` and its
 *   `transcribed_at`. Every copy of a Clip (a Submit's new Draft, a
 *   duplicated Course or Video, a Video made from a selection) carries its
 *   original's `created_at` and `transcribed_at`, so it dates the take as the
 *   original does. (Copies made before copies carried `created_at` were
 *   stamped with the time of the copy; their `transcribed_at` still dates
 *   them, unless they were never transcribed.)
 * - **How much**: the live Clips — not archived, not an Effect Clip, on a
 *   standalone Video or a Video of a Draft Version (a Pending or Published
 *   Version holds frozen copies) — each counted for `source_end_time -
 *   source_start_time`. The same stretch of Footage on two live Videos (a
 *   duplicated Course) counts once, dated by its earliest copy.
 * - **Efficiency** (per window): every Clip that is not an Effect Clip, on
 *   ANY Version, archived ones included, each stretch of Footage counted once
 *   and dated by its earliest copy. Every Version, because a take archived in
 *   a Draft that was then Submitted lives on in the Published Version (and,
 *   since copies carry archived Clips, in the new Draft too: the dedupe makes
 *   that one take). A stretch is kept when a copy of it is live where the
 *   duration counts it (a standalone Video or a Draft): a take archived after
 *   a Submit is cut, even though the Published Version still holds it live.
 *
 * Day boundaries are local midnights in `timeZone` (an IANA name), so a day
 * that changes the clocks is still one calendar day.
 *
 * Every page load runs this (the sidebar is on every page), so it reads
 * through `clip_filmed_at_idx`, an index on exactly the `least(...)`
 * expression below: about 6 ms on production-sized data (138k Clips), where
 * a scan of every Clip took 70 ms. The index covers archived Clips too (it
 * has no `WHERE`), so reading them for the efficiency costs no new index. The 30-day bound is written inline, not
 * read from a CTE: behind a CTE the planner guessed a third of the table and
 * went parallel.
 */
export const getFootageStats = Effect.fn("getFootageStats")(function* (
  db: Database,
  input: { readonly now: Date; readonly timeZone: string }
) {
  const now = sql`${input.now.toISOString()}::timestamptz`;
  const tz = input.timeZone;
  const localMidnight = sql`date_trunc('day', ${now} AT TIME ZONE ${tz})`;
  const filmedAt = sql`least(${clips.createdAt}, ${clips.transcribedAt})`;
  /** On a standalone Video or a Draft's: where a live Clip is current work. */
  const current = sql`(${videos.lessonId} IS NULL OR ${courseVersions.commitState} = 'draft')`;
  const result = yield* Effect.tryPromise({
    try: () =>
      db.execute<{
        today: number | string | null;
        last_7_days: number | string | null;
        last_30_days: number | string | null;
        today_clips: number | string | null;
        today_kept_clips: number | string | null;
        last_7_days_clips: number | string | null;
        last_7_days_kept_clips: number | string | null;
        last_30_days_clips: number | string | null;
        last_30_days_kept_clips: number | string | null;
      }>(sql`
        WITH segments AS (
          SELECT min(${filmedAt}) FILTER (WHERE ${clips.archived} = false AND ${current}) AS filmed_at,
                 min(${filmedAt}) AS any_filmed_at,
                 bool_or(${clips.archived} = false AND ${current}) AS kept,
                 greatest(${clips.sourceEndTime} - ${clips.sourceStartTime}, 0) AS seconds
          FROM ${clips}
          JOIN ${videos} ON ${videos.id} = ${clips.videoId}
          LEFT JOIN ${lessons} ON ${lessons.id} = ${videos.lessonId}
          LEFT JOIN ${sections} ON ${sections.id} = ${lessons.sectionId}
          LEFT JOIN ${courseVersions} ON ${courseVersions.id} = ${sections.repoVersionId}
          WHERE ${filmedAt} >= (${localMidnight} - interval '29 days') AT TIME ZONE ${tz}
            AND ${clips.scene} IS DISTINCT FROM ${EFFECT_CLIP_SCENE}
          GROUP BY ${clips.videoFilename}, ${clips.sourceStartTime}, ${clips.sourceEndTime}
        )
        SELECT
          sum(seconds) FILTER (
            WHERE filmed_at >= ${localMidnight} AT TIME ZONE ${tz}
          ) AS today,
          sum(seconds) FILTER (
            WHERE filmed_at >= (${localMidnight} - interval '6 days') AT TIME ZONE ${tz}
          ) AS last_7_days,
          sum(seconds) FILTER (WHERE filmed_at IS NOT NULL) AS last_30_days,
          count(*) FILTER (
            WHERE any_filmed_at >= ${localMidnight} AT TIME ZONE ${tz}
          ) AS today_clips,
          count(*) FILTER (
            WHERE kept AND any_filmed_at >= ${localMidnight} AT TIME ZONE ${tz}
          ) AS today_kept_clips,
          count(*) FILTER (
            WHERE any_filmed_at >= (${localMidnight} - interval '6 days') AT TIME ZONE ${tz}
          ) AS last_7_days_clips,
          count(*) FILTER (
            WHERE kept AND any_filmed_at >= (${localMidnight} - interval '6 days') AT TIME ZONE ${tz}
          ) AS last_7_days_kept_clips,
          count(*) AS last_30_days_clips,
          count(*) FILTER (WHERE kept) AS last_30_days_kept_clips
        FROM segments
      `),
    catch: (cause) => new UnknownDBServiceError({ cause }),
  });

  const row = result.rows[0];
  return {
    todaySeconds: Number(row?.today ?? 0),
    last7DaysSeconds: Number(row?.last_7_days ?? 0),
    last30DaysSeconds: Number(row?.last_30_days ?? 0),
    todayClips: Number(row?.today_clips ?? 0),
    todayKeptClips: Number(row?.today_kept_clips ?? 0),
    last7DaysClips: Number(row?.last_7_days_clips ?? 0),
    last7DaysKeptClips: Number(row?.last_7_days_kept_clips ?? 0),
    last30DaysClips: Number(row?.last_30_days_clips ?? 0),
    last30DaysKeptClips: Number(row?.last_30_days_kept_clips ?? 0),
  } satisfies FootageStats;
});
