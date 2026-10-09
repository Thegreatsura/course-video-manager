import type {
  ExportStage as ExportServiceStage,
  PublishStage as PublishServiceStage,
} from "@/services/course-publish-export-events";
import type { RenderVerticalStage as RenderVerticalServiceStage } from "@/services/render-vertical-video-service";
import type { DuplicateCourseStage as DuplicateCourseJobStage } from "@/features/jobs/duplicate-course-job";

/**
 * One row of the Upload Manager: how a Job draws (`jobUploadEntries` in
 * `features/jobs/jobs-selectors.ts`). An Autofill and a Publish draw a parent
 * row and a child row per Video; every other kind draws one row per Job, or
 * one per Video for a Batch export. The browser no longer runs any of these:
 * every row comes from a Job's events.
 */

export type UploadStatus =
  "waiting" | "uploading" | "retrying" | "success" | "error";
export type UploadType =
  | "youtube"
  | "youtube-shorts"
  | "buffer"
  | "ai-hero"
  | "skills-changelog"
  | "export"
  | "publish"
  | "autofill"
  | "render-vertical"
  | "duplicate-course";
export type BufferStage =
  "uploading-blob" | "creating-post" | "polling" | "cleaning-up";
// Every stage union below is the SERVICE's own union, never a restatement of
// it. The bands and the labels are total `Record`s over these types, so a
// stage the server emits and the client has no band for is a compile error
// here rather than an undefined lookup at run time. `PublishStage` was
// restated, drifted, and lost `complete` — which the Publish emits after the
// Promote, so every successful Publish ended in "Cannot read properties of
// undefined (reading 'start')".
export type ExportStage = ExportServiceStage;
export type RenderVerticalStage = RenderVerticalServiceStage;
export type PublishStage = PublishServiceStage;
export type DuplicateCourseStage = DuplicateCourseJobStage;
// An Autofill only ever does two things: work out which Videos it has work
// for, then write their text. The parent passes through both; a per-Video
// child is born already writing.
export type AutofillStage = "selecting" | "writing";
// The upload half of a per-Video task under a Publish. It follows the
// export stages above: encode, then wait for a slot in the upload pool,
// then move bytes.
export type VideoUploadStage = "queued-for-upload" | "uploading";

export interface BaseUploadEntry {
  uploadId: string;
  videoId: string;
  title: string;
  progress: number;
  status: UploadStatus;
  errorMessage: string | null;
  retryCount: number;
  // When set, this entry has failed terminally and must never be
  // auto-retried, independent of how many attempts `retryCount` has counted.
  terminal: boolean;
  dependsOn: string | null;
  // The job this entry is a child task of — a Publish, for the per-Video
  // tasks it fans out into. Held in state rather than in a closure so
  // children render nested under their parent, are dismissed with it, and
  // can be aggregated into its progress.
  parentUploadId: string | null;
}

export interface YouTubeUploadEntry extends BaseUploadEntry {
  uploadType: "youtube";
  youtubeVideoId: string | null;
}

export interface YouTubeShortsUploadEntry extends BaseUploadEntry {
  uploadType: "youtube-shorts";
  youtubeVideoId: string | null;
}

export interface BufferUploadEntry extends BaseUploadEntry {
  uploadType: "buffer";
  bufferStage: BufferStage | null;
}

export interface AiHeroUploadEntry extends BaseUploadEntry {
  uploadType: "ai-hero";
  aiHeroSlug: string | null;
}

export interface SkillsChangelogUploadEntry extends BaseUploadEntry {
  uploadType: "skills-changelog";
  skillsChangelogSlug: string | null;
}

export interface ExportUploadEntry extends BaseUploadEntry {
  uploadType: "export";
  exportStage: ExportStage | null;
  isBatchEntry: boolean;
  // Set only for a per-Video task under a Publish, which carries on into
  // Dropbox once its encode is done. A standalone export has nowhere to
  // upload to and leaves these at their defaults.
  videoUploadStage: VideoUploadStage | null;
  uploadedBytes: number;
  // This Video's size on disk, known once the upload pool picks it up. It is
  // what weights the Video inside its parent's progress, so a 1.7 GB Video
  // does not count the same as a 200 MB one.
  totalBytes: number | null;
}

export interface PublishUploadEntry extends BaseUploadEntry {
  uploadType: "publish";
  publishStage: PublishStage | null;
  newDraftVersionId: string | null;
  courseId: string;
}

/**
 * One row of an **Autofill** run: the parent job, or one of its per-Video
 * children. The same type serves both — a child carries the Video it is
 * writing and a `parentUploadId`; the parent carries neither and derives its
 * bar from the children.
 */
export interface AutofillUploadEntry extends BaseUploadEntry {
  uploadType: "autofill";
  autofillStage: AutofillStage | null;
  courseId: string;
}

export interface RenderVerticalUploadEntry extends BaseUploadEntry {
  uploadType: "render-vertical";
  renderVerticalStage: RenderVerticalStage | null;
}

/** A Course duplicate: its rows, then every Video's files. */
export interface DuplicateCourseUploadEntry extends BaseUploadEntry {
  uploadType: "duplicate-course";
  duplicateCourseStage: DuplicateCourseStage | null;
  /** The new Course, which the row links to once it is done. */
  courseId: string;
}

export type UploadEntry =
  | YouTubeUploadEntry
  | YouTubeShortsUploadEntry
  | BufferUploadEntry
  | AiHeroUploadEntry
  | SkillsChangelogUploadEntry
  | ExportUploadEntry
  | PublishUploadEntry
  | AutofillUploadEntry
  | RenderVerticalUploadEntry
  | DuplicateCourseUploadEntry;
