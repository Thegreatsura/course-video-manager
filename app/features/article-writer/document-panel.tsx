import { AIResponse } from "components/ui/kibo-ui/ai/response";
import type { Options } from "react-markdown";

export interface DocumentPanelProps {
  document: string | undefined;
  fullPath: string;
  extraComponents?: Options["components"];
  preprocessMarkdown?: (md: string) => string;
}

export function DocumentPanel({
  document,
  fullPath,
  extraComponents,
  preprocessMarkdown,
}: DocumentPanelProps) {
  if (!document) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <p>No document yet. Send a message to generate one.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar scrollbar-track-transparent scrollbar-thumb-gray-700 hover:scrollbar-thumb-gray-600 p-6">
      <div className="max-w-[75ch] mx-auto">
        <AIResponse
          imageBasePath={fullPath}
          extraComponents={extraComponents}
          preprocessMarkdown={preprocessMarkdown}
        >
          {document}
        </AIResponse>
      </div>
    </div>
  );
}
