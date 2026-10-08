import { AlertTriangleIcon, RefreshCwIcon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FAILURE_TITLES, type WriterFailure } from "./writer-errors";

/**
 * A failed turn, shown inline after the conversation's last message — where
 * the reply would have been. Retry drops whatever partial reply the turn left
 * and re-runs the last user message.
 */
export function TurnFailure({
  failure,
  onRetry,
}: {
  failure: WriterFailure;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-md border border-red-500/40 bg-red-500/5 p-3 text-sm"
    >
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-red-500" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-red-600 dark:text-red-400">
          {FAILURE_TITLES[failure.kind]}
        </div>
        <div className="mt-1 break-words text-muted-foreground">
          {failure.message}
        </div>
      </div>
      <Button size="sm" variant="outline" className="h-7" onClick={onRetry}>
        <RefreshCwIcon className="mr-1 size-3.5" />
        Retry
      </Button>
    </div>
  );
}

/** Below the last reply when nothing went wrong: run the last message again. */
export function RegenerateReply({
  onRegenerate,
}: {
  onRegenerate: () => void;
}) {
  return (
    <div className="flex justify-start">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-xs text-muted-foreground"
        onClick={onRegenerate}
      >
        <RefreshCwIcon className="mr-1 size-3" />
        Regenerate reply
      </Button>
    </div>
  );
}

/**
 * A tool call the server rejected because its input failed validation. The
 * error went back to the model, which usually corrects itself in the next
 * step of the same reply.
 */
export function RejectedToolCall({
  toolName,
  errorText,
}: {
  toolName: string;
  errorText: string | undefined;
}) {
  return (
    <details className="rounded-md px-2 py-1.5 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 text-red-500">
        <XCircleIcon className="size-3.5 shrink-0" />
        <span className="font-medium">
          Malformed {toolName} call — sent back to the model
        </span>
      </summary>
      {errorText && (
        <div className="mt-1 ml-5 break-words rounded-md border border-red-500/20 bg-red-500/5 p-2 text-xs text-red-400">
          {errorText}
        </div>
      )}
    </details>
  );
}
