import { Loader2Icon, SparklesIcon } from "lucide-react";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";

/**
 * Inline suggestion display that appears at the bottom of the clip timeline.
 * Shows the AI-generated suggestion for what to say next, styled as plain text
 * for teleprompter-like reading.
 */
export const InlineSuggestion = () => {
  const suggestionState = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.suggestionState
  );
  const { suggestionText, isStreaming, enabled } = suggestionState;

  // Only show when enabled and there's something to display
  if (!enabled) return null;
  if (!suggestionText && !isStreaming) return null;

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          {isStreaming ? (
            <Loader2Icon className="h-4 w-4 text-gray-400 animate-spin" />
          ) : (
            <SparklesIcon className="h-4 w-4 text-gray-400" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-400 mb-1">Say next:</p>
          {suggestionText ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-gray-200">
              {suggestionText}
            </p>
          ) : (
            <p className="text-sm text-gray-500">Generating suggestion...</p>
          )}
        </div>
      </div>
    </div>
  );
};
