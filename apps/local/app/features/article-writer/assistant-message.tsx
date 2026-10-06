import type { ReactNode } from "react";
import { AIMessage } from "components/ui/kibo-ui/ai/message";

/**
 * An assistant turn in the writer chat. AIMessage is a flex *row* (built for
 * an avatar beside a single bubble), so its parts — tool calls, text,
 * screenshots, the cache badge — must not be its direct children or they sit
 * side by side. They stack top-to-bottom at full width inside one column.
 */
export function AssistantMessage({ children }: { children: ReactNode }) {
  return (
    <AIMessage from="assistant" className="[&>div]:max-w-full">
      <div
        data-testid="assistant-message-parts"
        className="flex w-full min-w-0 flex-col gap-2"
      >
        {children}
      </div>
    </AIMessage>
  );
}
