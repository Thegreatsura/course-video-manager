import type { VideoAction } from "@/features/video-menu/video-menu";
import { NEW_SHORT_ACTION, newShortFormData } from "@/lib/new-short";
import { useFetcher } from "react-router";
import { useContextSelector } from "use-context-selector";
import { isCvmRecorderRecording } from "./cvm-recorder-reducer";
import { VideoEditorContext } from "./video-editor-context";

/**
 * The editor's New Short: creates a Short and opens it, its back button
 * returning to this Video (`returnTo`). A take never outlives the editor
 * unsaved: a CVM recorder take is stopped first, as the Stop button stops it
 * (Footage closed, take kept). OBS has no stop in the editor, so while OBS
 * records, New Short waits for the author to stop it there.
 */
export function useNewShortAction(): VideoAction {
  const videoId = useContextSelector(VideoEditorContext, (ctx) => ctx.videoId);
  const isObsRecording = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.obsConnectorState.type === "obs-recording"
  );
  const cvmRecorder = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.cvmRecorder
  );
  const fetcher = useFetcher();
  const isCreating = fetcher.state !== "idle";

  return {
    onSelect: () => {
      if (isCvmRecorderRecording(cvmRecorder.state) && cvmRecorder.canStop)
        cvmRecorder.onStop();
      void fetcher.submit(newShortFormData({ returnToVideoId: videoId }), {
        method: "post",
        action: NEW_SHORT_ACTION,
      });
    },
    disabled: isObsRecording || isCreating,
    description: isObsRecording
      ? "Stop recording in OBS first"
      : isCreating
        ? "Creating…"
        : undefined,
  };
}
