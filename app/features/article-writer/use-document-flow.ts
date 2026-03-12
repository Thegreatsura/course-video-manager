import { useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { loadDocumentFromStorage, saveDocumentToStorage } from "./write-utils";

/**
 * Manages document state for the article mode document flow.
 * Handles writeDocument tool call interception, live streaming,
 * and localStorage persistence.
 */
export function useDocumentFlow(opts: {
  videoId: string;
  isDocumentMode: boolean;
  messages: UIMessage[];
  status: "streaming" | "submitted" | "ready" | "error";
  addToolOutput: (args: {
    tool: never;
    toolCallId: string;
    output: never;
  }) => Promise<void>;
}) {
  const { videoId, isDocumentMode, messages, status, addToolOutput } = opts;

  const [document, setDocument] = useState<string | undefined>(() =>
    loadDocumentFromStorage(videoId)
  );

  const processedToolCallsRef = useRef<Set<string>>(new Set());

  // Handle completed writeDocument tool calls
  useEffect(() => {
    if (!isDocumentMode) return;
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts) {
        if (
          "toolCallId" in part &&
          part.type === "tool-writeDocument" &&
          "input" in part &&
          part.input &&
          typeof part.input === "object" &&
          "content" in part.input &&
          typeof part.input.content === "string" &&
          !processedToolCallsRef.current.has(part.toolCallId)
        ) {
          processedToolCallsRef.current.add(part.toolCallId);
          const content = part.input.content;
          setDocument(content);
          saveDocumentToStorage(videoId, content);
          addToolOutput({
            tool: "writeDocument" as never,
            toolCallId: part.toolCallId,
            output: "Document written successfully." as never,
          });
        }
      }
    }
  }, [messages, isDocumentMode, videoId, addToolOutput]);

  // Stream document content live during writeDocument tool call
  useEffect(() => {
    if (!isDocumentMode) return;
    if (status !== "streaming" && status !== "submitted") return;
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts) {
        if (
          "toolCallId" in part &&
          part.type === "tool-writeDocument" &&
          "state" in part &&
          part.state === "input-streaming" &&
          "input" in part &&
          part.input &&
          typeof part.input === "object" &&
          "content" in part.input &&
          typeof part.input.content === "string"
        ) {
          setDocument(part.input.content);
        }
      }
    }
  }, [messages, isDocumentMode, status]);

  const clearDocument = () => {
    setDocument(undefined);
    saveDocumentToStorage(videoId, undefined);
    processedToolCallsRef.current.clear();
  };

  const saveDocument = () => {
    if (document) {
      saveDocumentToStorage(videoId, document);
    }
  };

  return { document, clearDocument, saveDocument };
}
