import { Card } from "@/components/ui/card";
import type { UIMessage } from "ai";
import {
  AIConversation,
  AIConversationContent,
  AIConversationScrollButton,
} from "components/ui/kibo-ui/ai/conversation";
import {
  AIInput,
  AIInputSubmit,
  AIInputTextarea,
  AIInputToolbar,
} from "components/ui/kibo-ui/ai/input";
import { AIMessage, AIMessageContent } from "components/ui/kibo-ui/ai/message";
import { AIResponse } from "components/ui/kibo-ui/ai/response";
import type { Options } from "react-markdown";
import type { FormEvent, HTMLAttributes } from "react";
import { useCallback, useMemo, useState } from "react";
import { partsToText, saveMessagesToStorage } from "./write-utils";
import type { WriteToolbarProps } from "./write-toolbar";
import { WriteToolbar } from "./write-toolbar";
import type { IndexedClip, Mode } from "./types";
import { ChooseScreenshot } from "./choose-screenshot";
import { preprocessChooseScreenshotMarkdown } from "./choose-screenshot-markdown";
import {
  replaceChooseScreenshotWithImage,
  updateChooseScreenshotClipIndex,
} from "./choose-screenshot-mutations";

export interface WriteChatProps {
  messages: UIMessage[];
  setMessages: (messages: UIMessage[]) => void;
  error: Error | undefined;
  fullPath: string;
  text: string;
  onTextChange: (text: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  status: "streaming" | "submitted" | "ready" | "error";
  indexedClips: IndexedClip[];
  mode: Mode;
  videoId: string;
  className?: string;
  toolbarProps: WriteToolbarProps;
}

export function WriteChat(props: WriteChatProps) {
  const {
    messages,
    setMessages,
    error,
    fullPath,
    text,
    onTextChange,
    onSubmit,
    status,
    indexedClips,
    mode,
    videoId,
    className,
    toolbarProps,
  } = props;

  const mutateMessageText = useCallback(
    (messageId: string, mutator: (text: string) => string) => {
      const updated = messages.map((msg) => {
        if (msg.id !== messageId) return msg;
        return {
          ...msg,
          parts: msg.parts.map((part) => {
            if (part.type !== "text") return part;
            return { ...part, text: mutator(part.text) };
          }),
        };
      });
      setMessages(updated);
      saveMessagesToStorage(videoId, mode, updated);
    },
    [messages, setMessages, videoId, mode]
  );

  const handleClipIndexChange = useCallback(
    (
      messageId: string,
      currentIndex: number,
      newIndex: number,
      alt: string
    ) => {
      mutateMessageText(messageId, (text) =>
        updateChooseScreenshotClipIndex(text, currentIndex, newIndex, alt)
      );
    },
    [mutateMessageText]
  );

  const [capturingKey, setCapturingKey] = useState<string | null>(null);

  const handleCapture = useCallback(
    async (
      messageId: string,
      clipIndex: number,
      alt: string,
      timestamp: number,
      videoFilename: string
    ) => {
      const key = `${messageId}-${clipIndex}-${alt}`;
      setCapturingKey(key);
      try {
        const res = await fetch(`/api/videos/${videoId}/capture-screenshot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timestamp, videoFilename }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Failed to capture screenshot");
        }
        const { imagePath } = await res.json();
        mutateMessageText(messageId, (text) =>
          replaceChooseScreenshotWithImage(text, clipIndex, alt, imagePath)
        );
      } catch (err) {
        console.error("Screenshot capture failed:", err);
      } finally {
        setCapturingKey(null);
      }
    },
    [videoId, mutateMessageText]
  );

  const extraComponents = useMemo((): Options["components"] | undefined => {
    if (indexedClips.length === 0 || mode !== "article") return undefined;
    return {
      choosescreenshot: ((
        compProps: HTMLAttributes<HTMLElement> & Record<string, unknown>
      ) => {
        const clipIdx = parseInt(compProps.clipindex as string, 10);
        const altText = (compProps.alt as string) ?? "";
        const msgId = (compProps["data-message-id"] as string) ?? "";
        const key = `${msgId}-${clipIdx}-${altText}`;
        return (
          <ChooseScreenshot
            clipIndex={clipIdx}
            alt={altText}
            clips={indexedClips}
            onClipIndexChange={(current, next) =>
              handleClipIndexChange(msgId, current, next, altText)
            }
            onCapture={(ci, a, timestamp, videoFilename) =>
              handleCapture(msgId, ci, a, timestamp, videoFilename)
            }
            isCapturing={capturingKey === key}
            isStreaming={status === "streaming" || status === "submitted"}
          />
        );
      }) as unknown,
    } as Options["components"];
  }, [
    indexedClips,
    mode,
    handleClipIndexChange,
    handleCapture,
    capturingKey,
    status,
  ]);

  const preprocessMarkdown = useMemo(() => {
    if (!extraComponents) return undefined;
    return (md: string, messageId?: string) => {
      let processed = preprocessChooseScreenshotMarkdown(md);
      // Inject message ID as data attribute so the component can identify which message to mutate
      if (messageId) {
        processed = processed.replace(
          /<choosescreenshot /g,
          `<choosescreenshot data-message-id="${messageId}" `
        );
      }
      return processed;
    };
  }, [extraComponents]);

  return (
    <div
      className={
        className ? `${className} flex flex-col` : "w-3/4 flex flex-col"
      }
    >
      <AIConversation className="flex-1 overflow-y-auto scrollbar scrollbar-track-transparent scrollbar-thumb-gray-700 hover:scrollbar-thumb-gray-600">
        <AIConversationContent className="max-w-[75ch] mx-auto">
          {error && (
            <Card className="p-4 mb-4 border-red-500 bg-red-50 dark:bg-red-950">
              <div className="flex items-start gap-2">
                <div className="text-red-500 font-semibold">Error:</div>
                <div className="text-red-700 dark:text-red-300 flex-1">
                  {error.message}
                </div>
              </div>
            </Card>
          )}
          {messages.map((message) => {
            if (message.role === "system") {
              return null;
            }

            if (message.role === "user") {
              return (
                <AIMessage from={message.role} key={message.id}>
                  <AIMessageContent>
                    {partsToText(message.parts)}
                  </AIMessageContent>
                </AIMessage>
              );
            }

            const textContent = partsToText(message.parts);

            return (
              <AIMessage from={message.role} key={message.id}>
                {message.parts.map((part, partIndex) => {
                  if (part.type === "tool-writeDocument") {
                    return (
                      <div
                        key={partIndex}
                        className="text-sm text-muted-foreground italic py-1"
                      >
                        Wrote document
                      </div>
                    );
                  }
                  if (part.type === "tool-editDocument") {
                    const input = "input" in part ? part.input : undefined;
                    const editCount =
                      input &&
                      typeof input === "object" &&
                      "edits" in input &&
                      Array.isArray(input.edits)
                        ? input.edits.length
                        : 0;
                    const result = "result" in part ? part.result : undefined;
                    const failed =
                      typeof result === "string" &&
                      !result.includes("successfully");
                    return (
                      <div
                        key={partIndex}
                        className={`text-sm italic py-1 ${failed ? "text-red-500" : "text-muted-foreground"}`}
                      >
                        {failed
                          ? "Edit failed — retrying..."
                          : `Edited document (${editCount} ${editCount === 1 ? "edit" : "edits"})`}
                      </div>
                    );
                  }
                  return null;
                })}
                {textContent && (
                  <AIResponse
                    imageBasePath={fullPath ?? ""}
                    extraComponents={extraComponents}
                    preprocessMarkdown={
                      preprocessMarkdown
                        ? (md: string) => preprocessMarkdown(md, message.id)
                        : undefined
                    }
                  >
                    {textContent}
                  </AIResponse>
                )}
              </AIMessage>
            );
          })}
        </AIConversationContent>
        <AIConversationScrollButton />
      </AIConversation>
      <div className="border-t p-4 bg-background">
        <div className="max-w-[75ch] mx-auto">
          <WriteToolbar {...toolbarProps} />
          <AIInput onSubmit={onSubmit}>
            <AIInputTextarea
              value={text}
              onChange={(e) => onTextChange(e.target.value)}
              placeholder="What would you like to create?"
            />
            <AIInputToolbar>
              <AIInputSubmit status={status} />
            </AIInputToolbar>
          </AIInput>
        </div>
      </div>
    </div>
  );
}
