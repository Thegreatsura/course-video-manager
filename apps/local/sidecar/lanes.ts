/**
 * The sidecar's lanes, and how many Jobs each runs at once.
 *
 * COPIED, NOT CHOSEN. Matt's decision (docs/plans/background-jobs-sidecar.md,
 * section 6) is that the sidecar reproduces today's limits rather than invent
 * new ones. Today there are exactly two at the level of a whole job:
 *
 * - The Upload Manager has NO queue limit. Every job it is handed starts the
 *   moment it is dispatched (`upload-context.tsx`, each `start*` callback calls
 *   `initiateFromRegistry` at once unless the job has a `dependsOn`), so ten
 *   exports run as ten concurrent SSE requests. → `default`: unbounded.
 * - A Publish ran one at a time: the service held a one-permit semaphore for
 *   its whole run, so a second Publish waited for the first. The lane now
 *   does that job and the semaphore is gone (`CoursePublishService.publish`).
 *   → `publish`: 1.
 *
 * Every OTHER limit is on a resource inside a job, and stays where it is, in
 * the service, because the sidecar builds each service layer once per process
 * just as the app server does: ffmpeg's 2 encode slots / 12 CPU permits
 * (`FfmpegPermitsService`, `ffmpeg-permits.ts`), `MAX_CONCURRENT_EXPORTS` 6
 * (`course-publish-export-events.ts:79`), Autofill's 6 Videos
 * (`autofill-service.ts:54`), Dropbox's upload pool (`dropbox-upload-config.ts:17`,
 * default 4), AI Hero's 4 parts (`ai-hero-upload-service.ts:13`) and
 * Whisper's 20 (`whisper-transcription-service.ts`, `TRANSCRIPTION_PERMITS`).
 */
export const LANES = {
  default: { concurrency: "unbounded" },
  publish: { concurrency: 1 },
} as const satisfies Record<string, { concurrency: number | "unbounded" }>;

export type LaneName = keyof typeof LANES;

export const LANE_NAMES = Object.keys(LANES) as LaneName[];

/** Whether a lane already running `running` Jobs may claim another. */
export const laneHasRoom = (lane: LaneName, running: number): boolean => {
  const { concurrency } = LANES[lane];
  return concurrency === "unbounded" || running < concurrency;
};
