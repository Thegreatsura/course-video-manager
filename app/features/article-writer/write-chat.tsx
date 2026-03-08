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
import type { FormEvent } from "react";
import { partsToText } from "./write-utils";
import type { WriteToolbarProps } from "./write-toolbar";
import { WriteToolbar } from "./write-toolbar";

export interface WriteChatProps {
  messages: UIMessage[];
  error: Error | undefined;
  fullPath: string;
  text: string;
  onTextChange: (text: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  status: "streaming" | "submitted" | "ready" | "error";
  toolbarProps: WriteToolbarProps;
}

export function WriteChat(props: WriteChatProps) {
  const {
    messages,
    error,
    fullPath,
    text,
    onTextChange,
    onSubmit,
    status,
    toolbarProps,
  } = props;

  return (
    <div className="w-3/4 flex flex-col">
      <AIConversation className="flex-1 overflow-y-auto scrollbar scrollbar-track-transparent scrollbar-thumb-gray-700 hover:scrollbar-thumb-gray-600">
        <AIConversationContent className="max-w-2xl mx-auto">
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

            return (
              <AIMessage from={message.role} key={message.id}>
                <AIResponse imageBasePath={fullPath ?? ""}>
                  {partsToText(message.parts)}
                </AIResponse>
              </AIMessage>
            );
          })}
        </AIConversationContent>
        <AIConversationScrollButton />
      </AIConversation>
      <div className="border-t p-4 bg-background">
        <div className="max-w-2xl mx-auto">
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
