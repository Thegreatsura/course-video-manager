import type { UIMessage } from "ai";
import type { Mode } from "./types";

export const partsToText = (parts: UIMessage["parts"]) => {
  return parts
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }

      return "";
    })
    .join("");
};

export const modeToLabel: Record<Mode, string> = {
  article: "Article",
  "article-plan": "Article Plan",
  project: "Project Steps",
  "skill-building": "Skill Building Steps",
  "style-guide-skill-building": "Style Guide Pass - Skill Building",
  "style-guide-project": "Style Guide Pass - Project",
  "seo-description": "SEO Description",
  "youtube-title": "YouTube Title",
  "youtube-thumbnail": "YouTube Thumbnail",
  "youtube-description": "YouTube Description",
  newsletter: "Newsletter",
  "interview-prep": "Interview Me (Pre-Interview)",
  interview: "Interview Me (Live)",
  brainstorming: "Brainstorming",
  "scoping-discussion": "Scoping Discussion",
  "scoping-document": "Scoping Document",
};

export const MODE_STORAGE_KEY = "article-writer-mode";
export const MODEL_STORAGE_KEY = "article-writer-model";
export const COURSE_STRUCTURE_STORAGE_KEY =
  "article-writer-include-course-structure";
export const MEMORY_ENABLED_STORAGE_KEY = "article-writer-memory-enabled";

export const getMessagesStorageKey = (videoId: string, mode: Mode) =>
  `article-writer-messages-${videoId}-${mode}`;

export const loadMessagesFromStorage = (
  videoId: string,
  mode: Mode
): UIMessage[] => {
  if (typeof localStorage === "undefined") return [];
  try {
    const saved = localStorage.getItem(getMessagesStorageKey(videoId, mode));
    if (saved) {
      return JSON.parse(saved) as UIMessage[];
    }
  } catch (e) {
    console.error("Failed to load messages from localStorage:", e);
  }
  return [];
};

export const saveMessagesToStorage = (
  videoId: string,
  mode: Mode,
  messages: UIMessage[]
) => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      getMessagesStorageKey(videoId, mode),
      JSON.stringify(messages)
    );
  } catch (e) {
    console.error("Failed to save messages to localStorage:", e);
  }
};

export const formatConversationAsQA = (messages: UIMessage[]) => {
  const qaMessages: string[] = [];

  for (const message of messages) {
    const text = partsToText(message.parts);
    if (!text) continue;

    if (message.role === "assistant") {
      qaMessages.push(`Q: ${text}`);
    } else if (message.role === "user") {
      qaMessages.push(`A: ${text}`);
    }
  }

  return qaMessages.join("\n\n");
};
