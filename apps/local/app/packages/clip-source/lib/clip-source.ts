import { DEFAULT_MIC_EQ, type MicEq } from "@cvm/core/features/videos/recorder";
import {
  LAYOUT_VERSION,
  SCENES,
  sceneSegments,
  type Scene,
  type SceneSegment,
} from "@/packages/scene-layout";

/**
 * A new-recorder Clip's Recording Session, as read with the Clip: its three
 * Footage files, its mic offset and its scene events (`fileTime` is picture
 * file time, seconds).
 */
export type RecordingSessionColumns = {
  readonly id: string;
  readonly cameraFilePath: string;
  readonly screenFilePath: string;
  readonly micFilePath: string;
  readonly micOffsetMs: number;
  readonly sceneEvents: ReadonlyArray<{
    readonly fileTime: number;
    readonly scene: string;
  }>;
};

/**
 * The persisted columns a Clip's picture and sound are read from. Every Clip
 * row carries them; nothing outside this package should read them for picture
 * or sound — it asks a {@link ClipSource} instead.
 *
 * `recordingSession` is the joined Recording Session row (with its scene
 * events) — null for an OBS Clip. A query that feeds the Export Hash must
 * load it, or a new-recorder Clip would be addressed as a single file.
 */
export type ClipSourceColumns = {
  readonly videoFilename: string;
  readonly sourceStartTime: number;
  readonly sourceEndTime: number;
  readonly recordingSessionId: string | null;
  readonly sceneOverride: Scene | null;
  readonly recordingSession: RecordingSessionColumns | null;
};

/**
 * A row `clipSource` can read. The new-recorder columns are optional so a
 * reader holding only the OBS columns (an editor Clip, a test row) still gets
 * an answer: without a loaded Recording Session it is read as one file.
 */
export type ClipSourceRow = Pick<
  ClipSourceColumns,
  "videoFilename" | "sourceStartTime" | "sourceEndTime"
> &
  Partial<
    Pick<
      ClipSourceColumns,
      "recordingSessionId" | "sceneOverride" | "recordingSession"
    >
  >;

/**
 * Where a Clip's picture and sound come from:
 *
 * - `footage` — a single Footage file (an OBS recording) cut between a start
 *   and an end time.
 * - `recording-session` — a new-recorder Clip: the composite of its Recording
 *   Session's screen and camera, drawn in its scenes, with the mic shifted by
 *   the Session's mic offset. `start`/`end` are picture file time;
 *   `footagePath` is the mic file (the `videoFilename` column).
 *
 * The variants are this package's business; readers hand a ClipSource back to
 * the functions below and never look inside it.
 */
export type ClipSource =
  | {
      readonly kind: "footage";
      readonly footagePath: string;
      readonly start: number;
      readonly end: number;
    }
  | {
      readonly kind: "recording-session";
      readonly footagePath: string;
      readonly start: number;
      readonly end: number;
      readonly recordingSessionId: string;
      readonly files: {
        readonly screen: string;
        readonly camera: string;
        readonly mic: string;
      };
      readonly micOffsetMs: number;
      readonly micEq: MicEq;
      readonly sceneEvents: ReadonlyArray<{
        readonly scene: Scene;
        readonly atSeconds: number;
      }>;
      readonly sceneOverride: Scene | null;
    };

/**
 * What the export draws for a new-recorder Clip over a stretch of picture
 * time: the files, the scene segments, and the mic's offset and EQ.
 */
export type ClipComposite = {
  readonly screen: string;
  readonly camera: string;
  readonly mic: string;
  /** The mic is read from `start - micOffsetSeconds`. */
  readonly micOffsetSeconds: number;
  readonly eq: MicEq;
  readonly segments: readonly SceneSegment[];
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
  recordingSessionId: row.recordingSessionId,
  sceneOverride: row.sceneOverride,
  recordingSession: row.recordingSession && {
    id: row.recordingSession.id,
    cameraFilePath: row.recordingSession.cameraFilePath,
    screenFilePath: row.recordingSession.screenFilePath,
    micFilePath: row.recordingSession.micFilePath,
    micOffsetMs: row.recordingSession.micOffsetMs,
    sceneEvents: row.recordingSession.sceneEvents.map((e) => ({
      fileTime: e.fileTime,
      scene: e.scene,
    })),
  },
});

const asScene = (scene: string | null | undefined): Scene | null =>
  (SCENES as readonly string[]).includes(scene ?? "") ? (scene as Scene) : null;

/**
 * The Clip's source. `micEq` is the saved mic EQ setting a new-recorder Clip
 * is exported with (default: Matt's OBS EQ, {@link DEFAULT_MIC_EQ}).
 */
export const clipSource = (
  row: ClipSourceRow,
  settings: { readonly micEq?: MicEq } = {}
): ClipSource => {
  const session = row.recordingSession;
  if (!row.recordingSessionId || !session) {
    return {
      kind: "footage",
      footagePath: row.videoFilename,
      start: row.sourceStartTime,
      end: row.sourceEndTime,
    };
  }
  return {
    kind: "recording-session",
    footagePath: row.videoFilename,
    start: row.sourceStartTime,
    end: row.sourceEndTime,
    recordingSessionId: session.id,
    files: {
      screen: session.screenFilePath,
      camera: session.cameraFilePath,
      mic: session.micFilePath,
    },
    micOffsetMs: session.micOffsetMs,
    micEq: settings.micEq ?? DEFAULT_MIC_EQ,
    sceneEvents: session.sceneEvents.flatMap((e) => {
      const scene = asScene(e.scene);
      return scene ? [{ scene, atSeconds: e.fileTime }] : [];
    }),
    sceneOverride: asScene(row.sceneOverride),
  };
};

/**
 * What the export composites for a new-recorder Clip from `from` to `to`
 * (picture file time; default the Clip's own range), or null for an OBS
 * Clip, whose single Footage file is cut as it always was.
 */
export const clipComposite = (
  source: ClipSource,
  range?: { readonly from: number; readonly to: number }
): ClipComposite | null => {
  if (source.kind === "footage") return null;
  const from = range?.from ?? source.start;
  const to = range?.to ?? source.end;
  return {
    screen: source.files.screen,
    camera: source.files.camera,
    mic: source.files.mic,
    micOffsetSeconds: source.micOffsetMs / 1000,
    eq: source.micEq,
    segments: sceneSegments({
      events: source.sceneEvents,
      clip: { startSeconds: from, endSeconds: to },
      override: source.sceneOverride,
    }),
  };
};

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
 *
 * A new-recorder Clip adds, after those: its Recording Session (`rs`), the
 * scene segments in its range (`sg`), its Scene Override (`so`, only when
 * set), the mic offset (`mo`), the mic EQ (`eq`) and the layout version
 * (`lv`) — everything else its composite is drawn from.
 */
export const clipSourceHashFields = (
  source: ClipSource
):
  | { f: string; s: number; e: number }
  | {
      f: string;
      s: number;
      e: number;
      rs: string;
      sg: [Scene, number, number][];
      so?: Scene;
      mo: number;
      eq: [number, number, number];
      lv: number;
    } => {
  const fields = { f: source.footagePath, s: source.start, e: source.end };
  const composite = clipComposite(source);
  if (source.kind === "footage" || !composite) return fields;
  return {
    ...fields,
    rs: source.recordingSessionId,
    sg: composite.segments.map((g) => [g.scene, g.startSeconds, g.endSeconds]),
    ...(source.sceneOverride ? { so: source.sceneOverride } : {}),
    mo: source.micOffsetMs,
    eq: [composite.eq.lowDb, composite.eq.midDb, composite.eq.highDb],
    lv: LAYOUT_VERSION,
  };
};
