import { lazy, Suspense, useState } from "react";
import { AIResponse } from "components/ui/kibo-ui/ai/response";
import { Button } from "@/components/ui/button";
import type { Options } from "react-markdown";

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

export interface DocumentPanelProps {
  document: string | undefined;
  fullPath: string;
  extraComponents?: Options["components"];
  preprocessMarkdown?: (md: string) => string;
  onDocumentChange?: (content: string) => void;
}

export function DocumentPanel({
  document,
  fullPath,
  extraComponents,
  preprocessMarkdown,
  onDocumentChange,
}: DocumentPanelProps) {
  const [isEditing, setIsEditing] = useState(false);

  if (!document) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <p>No document yet. Send a message to generate one.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-end px-4 py-2 border-b">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsEditing(!isEditing)}
        >
          {isEditing ? "Preview" : "Edit"}
        </Button>
      </div>
      {isEditing ? (
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              Loading editor…
            </div>
          }
        >
          <MonacoEditor
            height="100%"
            defaultLanguage="markdown"
            value={document}
            onChange={(value) => onDocumentChange?.(value ?? "")}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              wordWrap: "on",
              lineNumbers: "off",
              fontSize: 14,
              padding: { top: 16 },
              scrollBeyondLastLine: false,
            }}
          />
        </Suspense>
      ) : (
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
      )}
    </div>
  );
}
