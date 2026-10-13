import { useEffect } from "react";
import { pushDiagramRecordingStatus } from "@/lib/diagram-window";
import type { VideoFormat } from "@/features/videos/video-format";

/**
 * Tells the diagram playground whether a take is recording, whichever
 * Recorder films it (`RecorderCapture.isRecording`): it hides its sidebar and
 * centres the diagram for the Video's `format` as a take starts.
 */
export const useDiagramRecordingStatus = (
  isRecording: boolean,
  format: VideoFormat
) => {
  useEffect(() => {
    pushDiagramRecordingStatus(isRecording, format);
  }, [isRecording, format]);
};
