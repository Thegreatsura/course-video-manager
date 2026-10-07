import { Data } from "effect";
import { VERSION_NOT_DRAFT_MESSAGE } from "./version-not-draft-message.js";

export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  type: string;
  params: object;
  message?: string;
}> {}

export class UnknownDBServiceError extends Data.TaggedError(
  "UnknownDBServiceError"
)<{
  cause: unknown;
}> {}

export class NotLatestVersionError extends Data.TaggedError(
  "NotLatestVersionError"
)<{
  sourceVersionId: string;
  latestVersionId: string;
}> {}

/**
 * Write-closure: only a Draft Version accepts section/lesson/video/clip
 * writes. A Pending or Published Version is immutable, and every DB-mutation
 * entry point rejects writes into one with this error (see issue #1348).
 */
export class VersionNotDraftError extends Data.TaggedError(
  "VersionNotDraftError"
)<{
  versionId: string;
  commitState: string;
}> {
  // Serialized as the 409 body; browsers match on it to treat the failure as
  // terminal (surface + force reload into the new Draft — issue #1403).
  override get message() {
    return VERSION_NOT_DRAFT_MESSAGE;
  }
}

/**
 * Promote and Discard act only on a Pending Version — Promote marks it
 * Published once the Dropbox `course.json` rename (the commit receipt) lands,
 * and Discard deletes it. Neither may ever touch a Draft or Published row.
 */
export class VersionNotPendingError extends Data.TaggedError(
  "VersionNotPendingError"
)<{
  versionId: string;
  commitState: string;
}> {}

/**
 * At most one Pending Version may exist per course. Submit refuses to stack a
 * second Pending on top of one left behind by a crash in the receipt→Promote
 * gap; reconcile-on-load (issue #1404) heals the stale one first.
 */
export class PendingVersionExistsError extends Data.TaggedError(
  "PendingVersionExistsError"
)<{
  repoId: string;
  pendingVersionId: string;
}> {}

/**
 * Submit's copy left a table short: the new Draft has fewer (or more) live rows
 * of `table` than the Version it was cloned from. Raised inside the Submit
 * transaction, so nothing is written — the Draft stays a Draft and no new
 * Version exists. A copy-path bug, never a user error.
 */
export class VersionCopyIncompleteError extends Data.TaggedError(
  "VersionCopyIncompleteError"
)<{
  table: string;
  sourceCount: number;
  copyCount: number;
  sourceVersionId: string;
}> {
  override get message() {
    return `Submit refused: copying Version ${this.sourceVersionId} would carry ${this.copyCount} of its ${this.sourceCount} live "${this.table}" row(s) into the new Draft. Nothing was changed. This is a bug in the version copy (packages/core/services/db-version-copy.server.ts).`;
  }
}

export class CourseNameTakenError extends Data.TaggedError(
  "CourseNameTakenError"
)<{
  name: string;
  slug: string;
  message: string;
}> {}

export class SectionPathTakenError extends Data.TaggedError(
  "SectionPathTakenError"
)<{
  path: string;
  message: string;
}> {}

export class LessonPathTakenError extends Data.TaggedError(
  "LessonPathTakenError"
)<{
  path: string;
  message: string;
}> {}

export class VideoTitleTakenError extends Data.TaggedError(
  "VideoTitleTakenError"
)<{
  title: string;
  message: string;
}> {}

/**
 * A Clip Zoom was asked for on a Clip that cannot carry one — its recorded
 * scene is not a camera scene, or it has no recorded scene at all (clips
 * filmed before CVM captured scenes). Carries the human-facing reason built
 * by clipZoomIneligibilityMessage so every caller reports the same wall.
 */
export class ClipNotZoomableError extends Data.TaggedError(
  "ClipNotZoomableError"
)<{
  clipId: string;
  scene: string | null;
  message: string;
}> {}
