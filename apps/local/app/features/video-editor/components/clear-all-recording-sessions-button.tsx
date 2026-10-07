import { Trash2Icon } from "lucide-react";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";
import { countClipsToClear } from "../video-editor-selectors";

/**
 * One button that does every Recording Session's "Clear all" at once. Sits
 * between the Insertion Point and the session panels, and is hidden when no
 * session has anything to clear.
 */
export const ClearAllRecordingSessionsButton = () => {
  const clipsToClear = useContextSelector(VideoEditorContext, (ctx) =>
    countClipsToClear(ctx.sessionPanels)
  );
  const onPermanentlyRemoveArchived = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onPermanentlyRemoveArchived
  );

  if (clipsToClear === 0) return null;

  return (
    <div className="flex justify-end">
      <button
        onClick={() => onPermanentlyRemoveArchived("all")}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:text-red-400/70 dark:hover:text-red-300 dark:hover:bg-red-950/20 transition-colors"
        title="Clear all on every recording session"
      >
        <Trash2Icon className="size-3.5" />
        Clear all recording sessions ({clipsToClear} to clear)
      </button>
    </div>
  );
};
