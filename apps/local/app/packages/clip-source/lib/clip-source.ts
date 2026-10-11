/**
 * The persisted columns a Clip's picture and sound are read from. Every Clip
 * row carries them; nothing outside this package should read them for picture
 * or sound — it asks a {@link ClipSource} instead.
 */
export type ClipSourceColumns = {
  readonly videoFilename: string;
  readonly sourceStartTime: number;
  readonly sourceEndTime: number;
};

/**
 * Where a Clip's picture and sound come from. Today there is one answer: a
 * single Footage file (an OBS recording) cut between a start and an end time.
 * The variants are this package's business; readers hand a ClipSource back to
 * the functions below and never look inside it.
 */
export type ClipSource = {
  readonly kind: "footage";
  readonly footagePath: string;
  readonly start: number;
  readonly end: number;
};

/** One frame of a Clip's picture: the file to seek and the time to seek to. */
export type ClipFrame = { readonly inputVideo: string; readonly time: number };

/** One Clip as an input to the ffmpeg encode/transcribe pipelines. */
export type ClipFfmpegInput = {
  readonly inputVideo: string;
  readonly startTime: number;
  readonly duration: number;
};

/**
 * How far before the end of a Clip its last-frame still is taken: the very
 * last frame of a cut is often already the next take.
 */
const LAST_FRAME_INSET_SECONDS = 0.1;

export const clipSourceColumns = (
  row: ClipSourceColumns
): ClipSourceColumns => ({
  videoFilename: row.videoFilename,
  sourceStartTime: row.sourceStartTime,
  sourceEndTime: row.sourceEndTime,
});

export const clipSource = (row: ClipSourceColumns): ClipSource => ({
  kind: "footage",
  footagePath: row.videoFilename,
  start: row.sourceStartTime,
  end: row.sourceEndTime,
});

/**
 * The URL a `<video>` plays the source from, cued to `from`–`to` (source
 * time, as a media fragment).
 */
export const clipPlaybackUrl = (
  source: ClipSource,
  range: { readonly from: number; readonly to: number }
): string =>
  `/view-video?videoPath=${encodeURIComponent(source.footagePath)}#t=${range.from},${range.to}`;

/** The first frame, the last frame, or the frame at a source time. */
export const clipFrame = (
  source: ClipSource,
  at: "first" | "last" | number
): ClipFrame => ({
  inputVideo: source.footagePath,
  time:
    at === "first"
      ? source.start
      : at === "last"
        ? source.end - LAST_FRAME_INSET_SECONDS
        : at,
});

export const clipFfmpegInput = (source: ClipSource): ClipFfmpegInput => ({
  inputVideo: source.footagePath,
  startTime: source.start,
  duration: source.end - source.start,
});

/**
 * What the source contributes to the Export Hash payload. The keys and their
 * order are load-bearing: every existing export is addressed by them, so an
 * OBS Clip must keep hashing as `{ f, s, e }` for ever.
 */
export const clipSourceHashFields = (
  source: ClipSource
): { f: string; s: number; e: number } => ({
  f: source.footagePath,
  s: source.start,
  e: source.end,
});
