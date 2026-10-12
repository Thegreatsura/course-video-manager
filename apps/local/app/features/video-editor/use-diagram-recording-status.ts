import { useEffect } from "react";
import { pushDiagramRecordingStatus } from "@/lib/diagram-window";

/**
 * Tells the diagram playground whether a take is recording, whichever
 * Recorder films it (`RecorderCapture.isRecording`): it hides its sidebar and
 * centres the diagram as a take starts.
 */
export const useDiagramRecordingStatus = (isRecording: boolean) => {
  useEffect(() => {
    pushDiagramRecordingStatus(isRecording);
  }, [isRecording]);
};
