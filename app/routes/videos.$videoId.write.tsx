"use client";

import { DBFunctionsService } from "@/services/db-service.server";
import { sortByOrder } from "@/lib/sort-by-order";
import { runtimeLive } from "@/services/layer.server";
import type {
  SectionWithWordCount,
  Mode,
  Model,
} from "@/features/article-writer/types";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
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

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AIMessage, AIMessageContent } from "components/ui/kibo-ui/ai/message";
import { AIResponse } from "components/ui/kibo-ui/ai/response";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Array as EffectArray, Console, Effect } from "effect";
import {
  ChevronDown,
  CopyIcon,
  SaveIcon,
  CheckIcon,
  PlusIcon,
  FileTextIcon,
  ListChecksIcon,
  VideoIcon,
  AlertTriangleIcon,
  MicIcon,
  RadioIcon,
  FileTypeIcon,
  SettingsIcon,
  Trash2Icon,
  CrosshairIcon,
  VideoOffIcon,
} from "lucide-react";
import { marked } from "marked";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { data, useFetcher, useRevalidator } from "react-router";
import { toast } from "sonner";
import type { Route } from "./+types/videos.$videoId.write";
import path from "path";
import { FileSystem } from "@effect/platform";
import { VideoContextPanel } from "@/components/video-context-panel";
import { StandaloneFileManagementModal } from "@/components/standalone-file-management-modal";
import { StandaloneFilePasteModal } from "@/components/standalone-file-paste-modal";
import { DeleteStandaloneFileModal } from "@/components/delete-standalone-file-modal";
import { LessonFilePasteModal } from "@/components/lesson-file-paste-modal";
import { FilePreviewModal } from "@/components/file-preview-modal";
import { AddLinkModal } from "@/components/add-link-modal";
import { AddVideoToNextLessonModal } from "@/components/add-video-to-next-lesson-modal";
import { useLint } from "@/hooks/use-lint";
import { useBannedPhrases } from "@/hooks/use-banned-phrases";
import { BannedPhrasesModal } from "@/components/banned-phrases-modal";
import {
  ALWAYS_EXCLUDED_DIRECTORIES,
  DEFAULT_CHECKED_EXTENSIONS,
  DEFAULT_UNCHECKED_PATHS,
} from "@/services/text-writing-agent";
import { getStandaloneVideoFilePath } from "@/services/standalone-video-files";
import { getVideoPath } from "@/lib/get-video";

const partsToText = (parts: UIMessage["parts"]) => {
  return parts
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }

      return "";
    })
    .join("");
};

export const loader = async (args: Route.LoaderArgs) => {
  const { videoId } = args.params;
  return Effect.gen(function* () {
    const db = yield* DBFunctionsService;
    const fs = yield* FileSystem.FileSystem;
    const video = yield* db.getVideoWithClipsById(videoId);
    const globalLinks = yield* db.getLinks();
    const videoExists = yield* fs.exists(getVideoPath(videoId));

    const lesson = video.lesson;

    // Build transcript from clips and clip sections
    // Combine and sort clips and clip sections by order (ASCII ordering to match PostgreSQL COLLATE "C")
    type ClipItem = { type: "clip"; order: string; text: string | null };
    type ClipSectionItem = {
      type: "clip-section";
      order: string;
      name: string;
    };

    const clipItems: ClipItem[] = video.clips.map((clip) => ({
      type: "clip" as const,
      order: clip.order,
      text: clip.text,
    }));

    const clipSectionItems: ClipSectionItem[] = video.clipSections.map(
      (section) => ({
        type: "clip-section" as const,
        order: section.order,
        name: section.name,
      })
    );

    const sortedItems = sortByOrder([...clipItems, ...clipSectionItems]);

    // Build formatted transcript with sections as H2 headers
    const transcriptParts: string[] = [];
    let currentParagraph: string[] = [];

    for (const item of sortedItems) {
      if (item.type === "clip-section") {
        // Flush current paragraph before starting a new section
        if (currentParagraph.length > 0) {
          transcriptParts.push(currentParagraph.join(" "));
          currentParagraph = [];
        }
        // Add section as H2 header
        transcriptParts.push(`## ${item.name}`);
      } else if (item.text) {
        currentParagraph.push(item.text);
      }
    }

    // Flush remaining paragraph
    if (currentParagraph.length > 0) {
      transcriptParts.push(currentParagraph.join(" "));
    }

    const transcript = transcriptParts.join("\n\n").trim();
    const transcriptWordCount = transcript ? transcript.split(/\s+/).length : 0;

    // Calculate word count per section
    const sectionsWithWordCount: SectionWithWordCount[] = [];
    let currentSectionIndex = -1;

    for (const item of sortedItems) {
      if (item.type === "clip-section") {
        // Start tracking a new section
        const section = video.clipSections.find((s) => s.order === item.order);
        if (section) {
          currentSectionIndex = sectionsWithWordCount.length;
          sectionsWithWordCount.push({
            id: section.id,
            name: item.name,
            order: item.order,
            wordCount: 0,
          });
        }
      } else if (item.text && currentSectionIndex >= 0) {
        // Add this clip's word count to the current section
        const wordCount = item.text.split(/\s+/).length;
        sectionsWithWordCount[currentSectionIndex]!.wordCount += wordCount;
      }
    }

    // For standalone videos (no lesson), fetch standalone video files
    if (!lesson) {
      const nextVideoId = yield* db.getNextVideoId(videoId);
      const previousVideoId = yield* db.getPreviousVideoId(videoId);

      // Get the standalone video files directory
      const standaloneVideoDir = getStandaloneVideoFilePath(videoId);

      // Check if directory exists
      const dirExists = yield* fs.exists(standaloneVideoDir);

      let standaloneFiles: Array<{
        path: string;
        size: number;
        defaultEnabled: boolean;
      }> = [];

      if (dirExists) {
        // Read all files from the standalone video directory
        const filesInDirectory = yield* fs.readDirectory(standaloneVideoDir);

        standaloneFiles = yield* Effect.forEach(
          filesInDirectory,
          (filename) => {
            return Effect.gen(function* () {
              const filePath = getStandaloneVideoFilePath(videoId, filename);
              const stat = yield* fs.stat(filePath);

              if (stat.type !== "File") {
                return null;
              }

              const extension = path.extname(filename).slice(1);
              const defaultEnabled =
                DEFAULT_CHECKED_EXTENSIONS.includes(extension);

              return {
                path: filename,
                size: Number(stat.size),
                defaultEnabled,
              };
            });
          }
        ).pipe(Effect.map(EffectArray.filter((f) => f !== null)));
      }

      return {
        videoPath: video.path,
        videoExists,
        lessonPath: null,
        sectionPath: null,
        repoId: null,
        lessonId: null,
        fullPath: path.resolve(getStandaloneVideoFilePath(videoId)),
        files: standaloneFiles,
        nextVideoId,
        previousVideoId,
        isStandalone: true,
        transcriptWordCount,
        clipSections: sectionsWithWordCount,
        links: globalLinks,
        courseStructure: null as null | {
          repoName: string;
          currentSectionPath: string;
          currentLessonPath: string;
          sections: {
            path: string;
            lessons: { path: string }[];
          }[];
        },
        nextLessonWithoutVideo: null as null | {
          lessonId: string;
          lessonPath: string;
          sectionPath: string;
          hasExplainerFolder: boolean;
        },
      };
    }

    const repo = lesson.section.repoVersion.repo;
    const section = lesson.section;

    const lessonPath = path.join(repo.filePath, section.path, lesson.path);

    const allFilesInDirectory = yield* fs
      .readDirectory(lessonPath, {
        recursive: true,
      })
      .pipe(
        Effect.map((files) => files.map((file) => path.join(lessonPath, file)))
      );

    const filteredFiles = allFilesInDirectory.filter((filePath) => {
      return !ALWAYS_EXCLUDED_DIRECTORIES.some((excludedDir) =>
        filePath.includes(excludedDir)
      );
    });

    const filesWithMetadata = yield* Effect.forEach(
      filteredFiles,
      (filePath) => {
        return Effect.gen(function* () {
          const stat = yield* fs.stat(filePath);

          if (stat.type !== "File") {
            return null;
          }

          const relativePath = path.relative(lessonPath, filePath);
          const extension = path.extname(filePath).slice(1);

          const defaultEnabled =
            DEFAULT_CHECKED_EXTENSIONS.includes(extension) &&
            !DEFAULT_UNCHECKED_PATHS.some((uncheckedPath) =>
              relativePath.toLowerCase().includes(uncheckedPath.toLowerCase())
            );

          return {
            path: relativePath,
            size: Number(stat.size),
            defaultEnabled,
          };
        });
      }
    ).pipe(Effect.map(EffectArray.filter((f) => f !== null)));

    const nextVideoId = yield* db.getNextVideoId(videoId);
    const previousVideoId = yield* db.getPreviousVideoId(videoId);

    // Get next lesson without video (for "add video to next lesson" modal)
    const nextLessonWithoutVideo = yield* db.getNextLessonWithoutVideo(videoId);

    // Check if next lesson has explainer folder
    let nextLessonHasExplainerFolder = false;
    if (nextLessonWithoutVideo) {
      const explainerPath = `${nextLessonWithoutVideo.repoFilePath}/${nextLessonWithoutVideo.sectionPath}/${nextLessonWithoutVideo.lessonPath}/explainer`;
      nextLessonHasExplainerFolder = yield* fs.exists(explainerPath);
    }

    // Fetch course structure for non-standalone videos
    const repoWithSections = yield* db.getRepoWithSectionsById(
      section.repoVersion.repoId
    );
    const matchingVersion = repoWithSections?.versions.find(
      (v) => v.id === section.repoVersion.id
    );
    const courseStructure = matchingVersion
      ? {
          repoName: repoWithSections!.name,
          currentSectionPath: section.path,
          currentLessonPath: lesson.path,
          sections: matchingVersion.sections.map((s) => ({
            path: s.path,
            lessons: s.lessons.map((l) => ({ path: l.path })),
          })),
        }
      : null;

    return {
      videoPath: video.path,
      videoExists,
      lessonPath: lesson.path,
      sectionPath: section.path,
      repoId: section.repoVersion.repoId,
      lessonId: lesson.id,
      fullPath: lessonPath,
      files: filesWithMetadata,
      nextVideoId,
      previousVideoId,
      isStandalone: false,
      transcriptWordCount,
      clipSections: sectionsWithWordCount,
      links: globalLinks,
      courseStructure,
      nextLessonWithoutVideo: nextLessonWithoutVideo
        ? {
            lessonId: nextLessonWithoutVideo.lessonId,
            lessonPath: nextLessonWithoutVideo.lessonPath,
            sectionPath: nextLessonWithoutVideo.sectionPath,
            hasExplainerFolder: nextLessonHasExplainerFolder,
          }
        : null,
    };
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("NotFoundError", () => {
      return Effect.die(data("Video not found", { status: 404 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};

const Video = (props: { src: string }) => {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.playbackRate = 2;
    }
  }, [props.src, ref.current]);

  return <video src={props.src} className="w-full" controls ref={ref} />;
};

const modeToLabel: Record<Mode, string> = {
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

const MODE_STORAGE_KEY = "article-writer-mode";
const MODEL_STORAGE_KEY = "article-writer-model";
const COURSE_STRUCTURE_STORAGE_KEY = "article-writer-include-course-structure";

const getMessagesStorageKey = (videoId: string, mode: Mode) =>
  `article-writer-messages-${videoId}-${mode}`;

const loadMessagesFromStorage = (videoId: string, mode: Mode): UIMessage[] => {
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

const saveMessagesToStorage = (
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

export function InnerComponent(props: Route.ComponentProps) {
  const { videoId } = props.params;
  const {
    lessonId,
    fullPath,
    files,
    isStandalone,
    transcriptWordCount,
    clipSections,
    links,
    courseStructure,
    nextLessonWithoutVideo,
    videoExists,
  } = props.loaderData;
  const [text, setText] = useState<string>("");
  const [mode, setMode] = useState<Mode>(() => {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(MODE_STORAGE_KEY);
      return (saved as Mode) || "article";
    }
    return "article";
  });
  const [model, setModel] = useState<Model>(() => {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(MODEL_STORAGE_KEY);
      return (saved as Model) || "claude-haiku-4-5";
    }
    return "claude-haiku-4-5";
  });
  const [enabledFiles, setEnabledFiles] = useState<Set<string>>(() => {
    // If mode is style-guide-skill-building, only enable README.md files
    if (mode === "style-guide-skill-building") {
      return new Set(
        files
          .filter((f) => f.path.toLowerCase().endsWith("readme.md"))
          .map((f) => f.path)
      );
    }
    return new Set(files.filter((f) => f.defaultEnabled).map((f) => f.path));
  });
  const [includeTranscript, setIncludeTranscript] = useState(true);
  const [enabledSections, setEnabledSections] = useState<Set<string>>(() => {
    // By default, all sections are enabled
    return new Set(clipSections.map((s) => s.id));
  });

  const [isAddVideoToNextLessonModalOpen, setIsAddVideoToNextLessonModalOpen] =
    useState(false);
  const [includeCourseStructure, setIncludeCourseStructure] = useState(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(COURSE_STRUCTURE_STORAGE_KEY) === "true";
    }
    return false;
  });

  // Check if explainer or problem folder exists
  const hasExplainerOrProblem = files.some(
    (f) => f.path.startsWith("explainer/") || f.path.startsWith("problem/")
  );

  // Load initial messages from localStorage based on current mode
  const [initialMessages] = useState(() =>
    loadMessagesFromStorage(videoId, mode)
  );

  const { messages, setMessages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: `/videos/${videoId}/completions`,
    }),
    messages: initialMessages,
  });

  // Track previous status to detect when streaming finishes
  const prevStatusRef = useRef(status);
  useEffect(() => {
    // Save messages when streaming finishes (status changes from "streaming" to "ready")
    if (prevStatusRef.current === "streaming" && status === "ready") {
      saveMessagesToStorage(videoId, mode, messages);
    }
    prevStatusRef.current = status;
  }, [status, videoId, mode, messages]);

  const handleModeChange = (newMode: Mode) => {
    // Save current messages before switching modes
    if (messages.length > 0) {
      saveMessagesToStorage(videoId, mode, messages);
    }

    setMode(newMode);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(MODE_STORAGE_KEY, newMode);
    }

    // Load messages for the new mode
    const savedMessages = loadMessagesFromStorage(videoId, newMode);
    setMessages(savedMessages);

    // If switching to style-guide mode, only enable README.md files
    if (newMode === "style-guide-skill-building") {
      setEnabledFiles(
        new Set(
          files
            .filter((f) => f.path.toLowerCase().endsWith("readme.md"))
            .map((f) => f.path)
        )
      );
    }

    // Auto-enable course structure for scoping modes
    if (
      (newMode === "scoping-discussion" || newMode === "scoping-document") &&
      courseStructure
    ) {
      setIncludeCourseStructure(true);
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(COURSE_STRUCTURE_STORAGE_KEY, "true");
      }
    }
  };

  const handleModelChange = (newModel: Model) => {
    setModel(newModel);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(MODEL_STORAGE_KEY, newModel);
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    saveMessagesToStorage(videoId, mode, []);
  };

  const writeToReadmeFetcher = useFetcher();
  const deleteLinkFetcher = useFetcher();
  const openFolderFetcher = useFetcher();
  const revealVideoFetcher = useFetcher();

  useEffect(() => {
    const result = openFolderFetcher.data as { error?: string } | undefined;
    if (openFolderFetcher.state === "idle" && result?.error) {
      toast.error(result.error);
    }
  }, [openFolderFetcher.state, openFolderFetcher.data]);

  const [isCopied, setIsCopied] = useState(false);
  const revalidator = useRevalidator();

  // Standalone file management state
  const [isFileModalOpen, setIsFileModalOpen] = useState(false);
  const [selectedFilename, setSelectedFilename] = useState<string>("");
  const [selectedFileContent, setSelectedFileContent] = useState<string>("");
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<string>("");

  // Lesson file paste modal state
  const [isLessonPasteModalOpen, setIsLessonPasteModalOpen] = useState(false);

  // File preview modal state
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [previewFilePath, setPreviewFilePath] = useState<string>("");

  // Banned phrases management
  const [isBannedPhrasesModalOpen, setIsBannedPhrasesModalOpen] =
    useState(false);
  const {
    phrases: bannedPhrases,
    addPhrase: addBannedPhrase,
    removePhrase: removeBannedPhrase,
    updatePhrase: updateBannedPhrase,
    resetToDefaults: resetBannedPhrases,
  } = useBannedPhrases();

  // Add link modal state
  const [isAddLinkModalOpen, setIsAddLinkModalOpen] = useState(false);

  // Get last assistant message
  const lastAssistantMessage = messages
    .slice()
    .reverse()
    .find((m) => m.role === "assistant");
  const lastAssistantMessageText = lastAssistantMessage
    ? partsToText(lastAssistantMessage.parts)
    : "";

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(lastAssistantMessageText);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };

  const copyAsRichText = async () => {
    try {
      const html = await marked.parse(lastAssistantMessageText);
      const blob = new Blob([html], { type: "text/html" });
      const textBlob = new Blob([lastAssistantMessageText], {
        type: "text/plain",
      });
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": blob,
          "text/plain": textBlob,
        }),
      ]);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy as rich text:", error);
    }
  };

  // Format conversation history as Q&A for interview mode
  const formatConversationAsQA = () => {
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

  const copyConversationHistory = async () => {
    try {
      const qaText = formatConversationAsQA();
      await navigator.clipboard.writeText(qaText);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy conversation history:", error);
    }
  };

  // Lint hook for checking violations in real-time
  const { violations, composeFixMessage } = useLint(
    lastAssistantMessageText,
    mode,
    bannedPhrases
  );

  const handleFixLintViolations = () => {
    const fixMessage = composeFixMessage();
    if (fixMessage) {
      const transcriptEnabled =
        clipSections.length > 0 ? enabledSections.size > 0 : includeTranscript;

      sendMessage(
        { text: fixMessage },
        {
          body: {
            enabledFiles: Array.from(enabledFiles),
            mode,
            model,
            includeTranscript: transcriptEnabled,
            enabledSections: Array.from(enabledSections),
            courseStructure:
              includeCourseStructure && courseStructure
                ? courseStructure
                : undefined,
          },
        }
      );
    }
  };

  const writeToReadme = (mode: "write" | "append") => {
    writeToReadmeFetcher.submit(
      { lessonId, content: lastAssistantMessageText, mode },
      {
        method: "POST",
        action: "/api/write-readme",
        encType: "application/json",
      }
    );
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // When sections exist, derive includeTranscript from enabledSections
    const transcriptEnabled =
      clipSections.length > 0 ? enabledSections.size > 0 : includeTranscript;

    sendMessage(
      { text: text.trim() || "Go" },
      {
        body: {
          enabledFiles: Array.from(enabledFiles),
          mode,
          model,
          includeTranscript: transcriptEnabled,
          enabledSections: Array.from(enabledSections),
          courseStructure:
            includeCourseStructure && courseStructure
              ? courseStructure
              : undefined,
        },
      }
    );

    setText("");
  };

  const handleEditFile = async (filename: string) => {
    // Fetch file content
    try {
      const response = await fetch(
        `/api/standalone-files/read?videoId=${videoId}&filename=${encodeURIComponent(filename)}`
      );
      if (response.ok) {
        const content = await response.text();
        setSelectedFilename(filename);
        setSelectedFileContent(content);
        setIsFileModalOpen(true);
      }
    } catch (error) {
      console.error("Failed to read file:", error);
    }
  };

  const handleDeleteFile = (filename: string) => {
    setFileToDelete(filename);
    setIsDeleteModalOpen(true);
  };

  const handleFileModalClose = (open: boolean) => {
    setIsFileModalOpen(open);
    if (!open) {
      // Revalidate to refresh the file list
      revalidator.revalidate();
    }
  };

  const handlePasteModalClose = (open: boolean) => {
    setIsPasteModalOpen(open);
    if (!open) {
      // Revalidate to refresh the file list
      revalidator.revalidate();
    }
  };

  const handleStandaloneFileCreated = (filename: string) => {
    // Automatically add newly created file to context
    setEnabledFiles((prev) => new Set([...prev, filename]));
  };

  const handleDeleteModalClose = (open: boolean) => {
    setIsDeleteModalOpen(open);
    if (!open) {
      // Revalidate to refresh the file list
      revalidator.revalidate();
    }
  };

  const handleLessonPasteModalClose = (open: boolean) => {
    setIsLessonPasteModalOpen(open);
    if (!open) {
      // Revalidate to refresh the file list
      revalidator.revalidate();
    }
  };

  const handleLessonFileCreated = (filename: string) => {
    // Automatically add newly created file to context
    setEnabledFiles((prev) => new Set([...prev, filename]));
  };

  const handleFileClick = (filePath: string) => {
    setPreviewFilePath(filePath);
    setIsPreviewModalOpen(true);
  };

  const handlePreviewModalClose = (open: boolean) => {
    setIsPreviewModalOpen(open);
    if (!open) {
      setPreviewFilePath("");
    }
  };

  return (
    <>
      <div className="flex-1 flex overflow-hidden h-full">
        <VideoContextPanel
          videoSrc={`/api/videos/${videoId}/stream`}
          transcriptWordCount={transcriptWordCount}
          clipSections={clipSections}
          enabledSections={enabledSections}
          onEnabledSectionsChange={setEnabledSections}
          includeTranscript={includeTranscript}
          onIncludeTranscriptChange={setIncludeTranscript}
          courseStructure={courseStructure}
          includeCourseStructure={includeCourseStructure}
          onIncludeCourseStructureChange={(checked) => {
            setIncludeCourseStructure(checked);
            if (typeof localStorage !== "undefined") {
              localStorage.setItem(
                COURSE_STRUCTURE_STORAGE_KEY,
                String(checked)
              );
            }
          }}
          files={files}
          isStandalone={isStandalone}
          enabledFiles={enabledFiles}
          onEnabledFilesChange={setEnabledFiles}
          onFileClick={handleFileClick}
          onOpenFolderClick={() => {
            openFolderFetcher.submit(null, {
              method: "post",
              action: `/api/videos/${videoId}/open-folder`,
            });
          }}
          onAddFromClipboardClick={
            isStandalone
              ? () => setIsPasteModalOpen(true)
              : () => setIsLessonPasteModalOpen(true)
          }
          onEditFile={handleEditFile}
          onDeleteFile={handleDeleteFile}
          links={links}
          onAddLinkClick={() => setIsAddLinkModalOpen(true)}
          onDeleteLink={(linkId) => {
            deleteLinkFetcher.submit(null, {
              method: "post",
              action: `/api/links/${linkId}/delete`,
            });
          }}
          videoSlot={
            videoExists ? (
              <Video src={`/api/videos/${videoId}/stream`} />
            ) : (
              <div className="w-full aspect-[16/9] bg-gray-800 rounded-lg flex flex-col items-center justify-center gap-3">
                <VideoOffIcon className="size-10 text-gray-500" />
                <p className="text-gray-400 text-sm text-center px-4">
                  Video file not found on disk.
                </p>
              </div>
            )
          }
          onRevealInFileSystem={() => {
            revealVideoFetcher.submit(
              {},
              {
                method: "post",
                action: `/api/videos/${videoId}/reveal`,
              }
            );
          }}
        />

        {/* Right column: Chat */}
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
              <div className="mb-4 flex gap-2 items-center">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="justify-between min-w-[180px]"
                    >
                      {modeToLabel[mode]}
                      <ChevronDown className="h-4 w-4 ml-2 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    {/* Writing */}
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <FileTextIcon className="h-4 w-4 mr-2" />
                        Writing
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-64">
                        <DropdownMenuRadioGroup
                          value={mode}
                          onValueChange={(value) =>
                            handleModeChange(value as Mode)
                          }
                        >
                          <DropdownMenuRadioItem value="article">
                            <div>
                              <div>Article</div>
                              <div className="text-xs text-muted-foreground">
                                Educational content and explanations
                              </div>
                            </div>
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="article-plan">
                            <div>
                              <div>Article Plan</div>
                              <div className="text-xs text-muted-foreground">
                                Plan structure with concise bullet points
                              </div>
                            </div>
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="newsletter">
                            <div>
                              <div>Newsletter</div>
                              <div className="text-xs text-muted-foreground">
                                Friendly preview for AI Hero audience
                              </div>
                            </div>
                          </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>

                    {/* Exercise Steps */}
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <ListChecksIcon className="h-4 w-4 mr-2" />
                        Exercise Steps
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-64">
                        <DropdownMenuRadioGroup
                          value={mode}
                          onValueChange={(value) =>
                            handleModeChange(value as Mode)
                          }
                        >
                          <DropdownMenuRadioItem value="project">
                            <div>
                              <div>Project Steps</div>
                              <div className="text-xs text-muted-foreground">
                                Write steps for project
                              </div>
                            </div>
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="skill-building">
                            <div>
                              <div>Skill Building Steps</div>
                              <div className="text-xs text-muted-foreground">
                                Write steps for skill building problem
                              </div>
                            </div>
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="style-guide-skill-building">
                            <div>
                              <div>Style Guide - Skill Building</div>
                              <div className="text-xs text-muted-foreground">
                                Refine existing skill-building steps
                              </div>
                            </div>
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="style-guide-project">
                            <div>
                              <div>Style Guide - Project</div>
                              <div className="text-xs text-muted-foreground">
                                Refine existing project steps
                              </div>
                            </div>
                          </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>

                    {/* YouTube & SEO */}
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <VideoIcon className="h-4 w-4 mr-2" />
                        YouTube & SEO
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-64">
                        <DropdownMenuRadioGroup
                          value={mode}
                          onValueChange={(value) =>
                            handleModeChange(value as Mode)
                          }
                        >
                          <DropdownMenuRadioItem value="youtube-title">
                            <div>
                              <div>YouTube Title</div>
                              <div className="text-xs text-muted-foreground">
                                Generate engaging video title
                              </div>
                            </div>
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="youtube-thumbnail">
                            <div>
                              <div>YouTube Thumbnail</div>
                              <div className="text-xs text-muted-foreground">
                                Generate thumbnail description
                              </div>
                            </div>
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="youtube-description">
                            <div>
                              <div>YouTube Description</div>
                              <div className="text-xs text-muted-foreground">
                                Generate description with timestamps
                              </div>
                            </div>
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="seo-description">
                            <div>
                              <div>SEO Description</div>
                              <div className="text-xs text-muted-foreground">
                                Generate SEO description (max 160 chars)
                              </div>
                            </div>
                          </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>

                    {/* Planning */}
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <CrosshairIcon className="h-4 w-4 mr-2" />
                        Planning
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-64">
                        <DropdownMenuRadioGroup
                          value={mode}
                          onValueChange={(value) =>
                            handleModeChange(value as Mode)
                          }
                        >
                          <DropdownMenuRadioItem value="brainstorming">
                            <div>
                              <div>Brainstorming</div>
                              <div className="text-xs text-muted-foreground">
                                Explore ideas with an AI facilitator
                              </div>
                            </div>
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="scoping-discussion">
                            <div>
                              <div>Scoping Discussion</div>
                              <div className="text-xs text-muted-foreground">
                                Open-ended discussion to scope a lesson
                              </div>
                            </div>
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="scoping-document">
                            <div>
                              <div>Scoping Document</div>
                              <div className="text-xs text-muted-foreground">
                                Generate concise scoping document
                              </div>
                            </div>
                          </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>

                    {/* Interview */}
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <MicIcon className="h-4 w-4 mr-2" />
                        Interview
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-64">
                        <DropdownMenuRadioGroup
                          value={mode}
                          onValueChange={(value) =>
                            handleModeChange(value as Mode)
                          }
                        >
                          <DropdownMenuRadioItem value="interview-prep">
                            <div>
                              <div>Interview Me</div>
                              <div className="text-xs text-muted-foreground">
                                Pre-interview chat, then go live
                              </div>
                            </div>
                          </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Select
                  value={model}
                  onValueChange={(value) => handleModelChange(value as Model)}
                >
                  <SelectTrigger>
                    {model === "claude-sonnet-4-5" ? "Sonnet 4.5" : "Haiku 4.5"}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude-haiku-4-5">
                      <div>
                        <div>Haiku 4.5</div>
                        <div className="text-xs text-muted-foreground">
                          Fast and cost-effective
                        </div>
                      </div>
                    </SelectItem>
                    <SelectItem value="claude-sonnet-4-5">
                      <div>
                        <div>Sonnet 4.5</div>
                        <div className="text-xs text-muted-foreground">
                          More capable and thorough
                        </div>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                {mode === "interview-prep" ||
                mode === "interview" ||
                mode === "brainstorming" ||
                mode === "scoping-discussion" ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          status === "streaming" || messages.length === 0
                        }
                      >
                        {isCopied ? (
                          <>
                            <CheckIcon className="h-4 w-4 mr-1" />
                            Copied
                          </>
                        ) : (
                          <>
                            <CopyIcon className="h-4 w-4 mr-1" />
                            Copy
                            <ChevronDown className="h-3 w-3 ml-1" />
                          </>
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={copyConversationHistory}>
                        Copy Conversation History
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={copyToClipboard}
                        disabled={!lastAssistantMessageText}
                      >
                        Copy Last Message
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          status === "streaming" || !lastAssistantMessageText
                        }
                      >
                        {isCopied ? (
                          <>
                            <CheckIcon className="h-4 w-4 mr-1" />
                            Copied
                          </>
                        ) : (
                          <>
                            <CopyIcon className="h-4 w-4 mr-1" />
                            Copy
                            <ChevronDown className="h-3 w-3 ml-1" />
                          </>
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={copyToClipboard}>
                        <FileTextIcon className="h-4 w-4 mr-2" />
                        Copy as Markdown
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={copyAsRichText}>
                        <FileTypeIcon className="h-4 w-4 mr-2" />
                        Copy as Rich Text
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {/* Go Live button - shows when in interview-prep mode */}
                {mode === "interview-prep" && messages.length > 0 && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => {
                      // Switch to live interview mode
                      setMode("interview");
                      if (typeof localStorage !== "undefined") {
                        localStorage.setItem(MODE_STORAGE_KEY, "interview");
                      }
                      // Send a transition message to start the interview
                      const transcriptEnabled =
                        clipSections.length > 0
                          ? enabledSections.size > 0
                          : includeTranscript;
                      sendMessage(
                        {
                          text: "Let's go live! Start the interview based on what we discussed.",
                        },
                        {
                          body: {
                            enabledFiles: Array.from(enabledFiles),
                            mode: "interview",
                            model,
                            includeTranscript: transcriptEnabled,
                            enabledSections: Array.from(enabledSections),
                            courseStructure:
                              includeCourseStructure && courseStructure
                                ? courseStructure
                                : undefined,
                          },
                        }
                      );
                    }}
                    disabled={status === "streaming"}
                  >
                    <RadioIcon className="h-4 w-4 mr-1" />
                    Go Live
                  </Button>
                )}
                {/* Lint Fix button - shows when violations detected */}
                {violations.length > 0 && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleFixLintViolations}
                          disabled={status === "streaming"}
                        >
                          <AlertTriangleIcon className="h-4 w-4 mr-1 text-orange-500" />
                          Fix ({violations.reduce((sum, v) => sum + v.count, 0)}
                          )
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="space-y-1">
                          <p className="font-semibold">Lint Violations:</p>
                          {violations.map((v) => (
                            <p key={v.rule.id} className="text-sm">
                              • {v.rule.name}: {v.count} issue
                              {v.count > 1 ? "s" : ""}
                            </p>
                          ))}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {/* Banned phrases settings button */}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setIsBannedPhrasesModalOpen(true)}
                      >
                        <SettingsIcon className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Manage banned phrases</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {/* Clear chat button - shows when there are messages */}
                {messages.length > 0 && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={handleClearChat}
                          disabled={status === "streaming"}
                        >
                          <Trash2Icon className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Clear chat</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {/* README dropdown - hidden for standalone videos */}
                {!isStandalone && (
                  <DropdownMenu>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={
                                  !hasExplainerOrProblem ||
                                  status === "streaming" ||
                                  writeToReadmeFetcher.state === "submitting" ||
                                  writeToReadmeFetcher.state === "loading" ||
                                  !lastAssistantMessageText
                                }
                              >
                                {writeToReadmeFetcher.state === "submitting" ||
                                writeToReadmeFetcher.state === "loading" ? (
                                  <>
                                    <SaveIcon className="h-4 w-4 mr-1" />
                                    Writing...
                                  </>
                                ) : (
                                  <>
                                    <SaveIcon className="h-4 w-4 mr-1" />
                                    Readme
                                    <ChevronDown className="h-4 w-4 ml-1" />
                                  </>
                                )}
                              </Button>
                            </DropdownMenuTrigger>
                          </span>
                        </TooltipTrigger>
                        {!hasExplainerOrProblem && (
                          <TooltipContent>
                            <p>No explainer or problem folder</p>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => writeToReadme("write")}>
                        <SaveIcon className="h-4 w-4 mr-2" />
                        <div className="flex flex-col">
                          <span className="font-medium">Write to README</span>
                          <span className="text-xs text-muted-foreground">
                            Replace existing content
                          </span>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => writeToReadme("append")}
                      >
                        <PlusIcon className="h-4 w-4 mr-2" />
                        <div className="flex flex-col">
                          <span className="font-medium">Append to README</span>
                          <span className="text-xs text-muted-foreground">
                            Add to end of existing content
                          </span>
                        </div>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              <AIInput onSubmit={handleSubmit}>
                <AIInputTextarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="What would you like to create?"
                />
                <AIInputToolbar>
                  <AIInputSubmit status={status} />
                </AIInputToolbar>
              </AIInput>
            </div>
          </div>
        </div>
      </div>
      {/* Standalone file modals */}
      {isStandalone && (
        <>
          <StandaloneFileManagementModal
            videoId={videoId}
            filename={selectedFilename}
            content={selectedFileContent}
            open={isFileModalOpen}
            onOpenChange={handleFileModalClose}
          />
          <StandaloneFilePasteModal
            videoId={videoId}
            open={isPasteModalOpen}
            onOpenChange={handlePasteModalClose}
            existingFiles={files}
            onFileCreated={handleStandaloneFileCreated}
          />
          <DeleteStandaloneFileModal
            videoId={videoId}
            filename={fileToDelete}
            open={isDeleteModalOpen}
            onOpenChange={handleDeleteModalClose}
          />
        </>
      )}
      {/* Lesson file modals */}
      {!isStandalone && (
        <LessonFilePasteModal
          videoId={videoId}
          open={isLessonPasteModalOpen}
          onOpenChange={handleLessonPasteModalClose}
          existingFiles={files}
          onFileCreated={handleLessonFileCreated}
        />
      )}
      {/* File preview modal */}
      <FilePreviewModal
        isOpen={isPreviewModalOpen}
        onClose={() => handlePreviewModalClose(false)}
        videoId={videoId}
        filePath={previewFilePath}
        isStandalone={isStandalone}
      />
      {/* Banned phrases management modal */}
      <BannedPhrasesModal
        open={isBannedPhrasesModalOpen}
        onOpenChange={setIsBannedPhrasesModalOpen}
        phrases={bannedPhrases}
        onAddPhrase={addBannedPhrase}
        onRemovePhrase={removeBannedPhrase}
        onUpdatePhrase={updateBannedPhrase}
        onResetToDefaults={resetBannedPhrases}
      />
      {/* Add link modal */}
      <AddLinkModal
        open={isAddLinkModalOpen}
        onOpenChange={setIsAddLinkModalOpen}
      />
      {/* Add video to next lesson modal */}
      {nextLessonWithoutVideo && (
        <AddVideoToNextLessonModal
          lessonId={nextLessonWithoutVideo.lessonId}
          lessonPath={nextLessonWithoutVideo.lessonPath}
          sectionPath={nextLessonWithoutVideo.sectionPath}
          hasExplainerFolder={nextLessonWithoutVideo.hasExplainerFolder}
          open={isAddVideoToNextLessonModalOpen}
          onOpenChange={setIsAddVideoToNextLessonModalOpen}
        />
      )}
    </>
  );
}

export default function Component(props: Route.ComponentProps) {
  return <InnerComponent {...props} key={props.params.videoId} />;
}
