import { Schema } from "effect";
import {
  ANNOUNCE_NOTHING_BAND,
  PLACEHOLDER_FLOOR_BANDS,
} from "@/packages/course-json/client";

/**
 * Every Job kind's params, apart from its handler (`kinds/<kind>.ts`): what
 * a caller may enqueue. The app server checks a request against these
 * (`job-specs.ts`) without importing a single handler — a handler reaches
 * ffmpeg, Remotion and the posting services, which only the Sidecar may run
 * (the spawn guard in `.dependency-cruiser.cjs`).
 */
export const JOB_PARAMS = {
  noop: Schema.Struct({
    /** How long to take, in steps of up to 100 ms, reporting each. */
    durationMs: Schema.optionalWith(
      Schema.Number.pipe(Schema.int(), Schema.between(0, 600_000)),
      { default: () => 0 }
    ),
    /** Fail every attempt up to and including this one. */
    failAttempts: Schema.optionalWith(
      Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
      { default: () => 0 }
    ),
  }),
  export: Schema.Struct({ videoId: Schema.String }),
  "render-vertical": Schema.Struct({ videoId: Schema.String }),
  "batch-export": Schema.Struct({
    versionId: Schema.String,
    // Export All ships everything unless to-do Lessons are being withheld.
    includeTodoLessons: Schema.optionalWith(Schema.Boolean, {
      default: () => true,
    }),
  }),
  /** The Clips one transcribe request named; at least one. */
  "transcribe-clips": Schema.Struct({
    clipIds: Schema.NonEmptyArray(Schema.String),
  }),
  /** A body whose local images go to Cloudinary; the body itself is never written back. */
  "upload-images": Schema.Struct({
    videoId: Schema.String,
    body: Schema.String,
  }),
  /** Local image files the tab swapped Cloudinary URLs in for; at least one. */
  "remove-local-images": Schema.Struct({
    videoId: Schema.String,
    filePaths: Schema.NonEmptyArray(Schema.String),
  }),
  /** One Footage file, by its absolute path (Footage has no row). */
  "transcribe-footage": Schema.Struct({
    path: Schema.String.pipe(
      Schema.filter((p) => p.startsWith("/"), {
        message: () => "a footage path must be absolute",
      })
    ),
  }),
  /** A Course copied under a new name; the route chose the new Course's id. */
  "duplicate-course": Schema.Struct({
    sourceCourseId: Schema.String,
    name: Schema.Trim.pipe(Schema.nonEmptyString()),
    newCourseId: Schema.UUID,
  }),
  /**
   * The Clip Mockups one `cvm clip-mockup add` or `update` left with a
   * voice to make; at least one.
   */
  "clip-mockup-voice": Schema.Struct({
    clipMockupIds: Schema.NonEmptyArray(Schema.String),
  }),
  autofill: Schema.Struct({
    /** For the success toast's "Back to Publish"; the run reads only the Version. */
    courseId: Schema.String,
    versionId: Schema.String,
    // Required, as the route had it: it decides which Videos the run acts on.
    includeTodoLessons: Schema.Boolean,
  }),
  publish: Schema.Struct({
    courseId: Schema.String,
    name: Schema.String,
    // Required, like name: a Published Version always carries a description.
    description: Schema.String,
    includeTodoLessons: Schema.optionalWith(Schema.Boolean, {
      default: () => true,
    }),
    // The Placeholder Floor as a band, as the CLI spells it. Absent means
    // announce nothing.
    placeholders: Schema.optionalWith(
      Schema.Literal(...PLACEHOLDER_FLOOR_BANDS),
      { default: () => ANNOUNCE_NOTHING_BAND }
    ),
  }),
  youtube: Schema.Struct({
    videoId: Schema.String,
    title: Schema.Trim.pipe(Schema.nonEmptyString()),
    description: Schema.Trim.pipe(Schema.nonEmptyString()),
    privacyStatus: Schema.Literal("public", "unlisted"),
    thumbnailId: Schema.String,
  }),
  "youtube-shorts": Schema.Struct({
    videoId: Schema.String,
    title: Schema.Trim.pipe(Schema.nonEmptyString()),
    description: Schema.Trim.pipe(Schema.nonEmptyString()),
  }),
  buffer: Schema.Struct({
    videoId: Schema.String,
    caption: Schema.Trim.pipe(Schema.nonEmptyString()),
  }),
  "ai-hero": Schema.Struct({
    videoId: Schema.String,
    title: Schema.Trim.pipe(Schema.nonEmptyString()),
    body: Schema.String,
    description: Schema.String,
    slug: Schema.String,
  }),
  "skills-changelog": Schema.Struct({
    videoId: Schema.String,
    title: Schema.Trim.pipe(Schema.nonEmptyString()),
    slug: Schema.String,
    body: Schema.String,
    description: Schema.String,
    newsletterSubject: Schema.Trim.pipe(Schema.nonEmptyString()),
    newsletterPreviewText: Schema.String,
    newsletterCopy: Schema.String.pipe(
      Schema.filter((copy) => copy.trim().length > 0, {
        message: () => "Newsletter copy is required",
      })
    ),
  }),
} as const;
