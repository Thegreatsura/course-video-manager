import {
  VIDEO_RECORDERS,
  type VideoRecorder,
} from "@cvm/core/features/videos/recorder";
import { readStored, writeStored } from "@/hooks/use-local-storage";

const STORAGE_KEY = "video-editor:lastRecorder";

/**
 * The Recorder last chosen in the editor, kept in this browser: a new Video
 * is created with it. Null until a Recorder has been chosen once, so a new
 * Video stays on OBS (null) until then.
 */
export const readLastRecorderChoice = (): VideoRecorder | null => {
  const stored = readStored(STORAGE_KEY);
  return (VIDEO_RECORDERS as readonly string[]).includes(stored ?? "")
    ? (stored as VideoRecorder)
    : null;
};

export const rememberRecorderChoice = (recorder: VideoRecorder): void => {
  writeStored(STORAGE_KEY, recorder);
};
