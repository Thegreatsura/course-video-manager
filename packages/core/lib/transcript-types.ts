/**
 * The shapes the Transcript builder hands back.
 *
 * They live here rather than with the article writer's UI types because
 * `transcript-builder.ts` is read by the domain operations, and the domain
 * cannot reach into the writer — the writer's types module pulls in the AI SDK
 * and the writing agents. The writer re-exports these so its own callers see
 * one vocabulary.
 */

/** Chapters with calculated word counts, for UI display. */
export type SectionWithWordCount = {
  id: string;
  name: string;
  order: string;
  wordCount: number;
};

import type { RecordingSessionScene } from "../features/videos/recorder.js";
import type { VideoFormat } from "../features/videos/video-format.js";

/**
 * A CVM-recorder Clip's Recording Session as loaded with it — the shape the
 * Clip Source module (`ClipRecordingSession`) composites the picture from.
 */
export type IndexedClipRecordingSession = {
  id: string;
  cameraFilePath: string;
  screenFilePath: string;
  micFilePath: string;
  micOffsetMs: number;
  /** The Video Format it was filmed in: its picture is drawn in that layout. */
  format: VideoFormat;
  /** False on a camera-only Short session: there is no screen file. */
  screenCaptured: boolean;
  sceneEvents: { fileTime: number; scene: RecordingSessionScene }[];
};

/** A Clip paired with the `[N]` marker index it carries in the Transcript. */
export type IndexedClip = {
  index: number;
  sourceStartTime: number;
  sourceEndTime: number;
  videoFilename: string;
  text: string | null;
  /** Present on a CVM-recorder Clip, so its screenshot is the composite. */
  recordingSession?: IndexedClipRecordingSession | null;
  sceneOverride?: RecordingSessionScene | null;
};
