"use client";

import type {
  SectionWithWordCount,
  IndexedClip,
  Mode,
  Model,
} from "@/features/article-writer/types";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { marked } from "marked";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { toast } from "sonner";
import { VideoContextPanel } from "@/components/video-context-panel";
import { useLint } from "@/hooks/use-lint";
import { useBannedPhrases } from "@/hooks/use-banned-phrases";

import {
  partsToText,
  MODE_STORAGE_KEY,
  MODEL_STORAGE_KEY,
  COURSE_STRUCTURE_STORAGE_KEY,
  MEMORY_ENABLED_STORAGE_KEY,
  loadMessagesFromStorage,
  saveMessagesToStorage,
  formatConversationAsQA,
} from "./write-utils";
import { hasUnresolvedScreenshots } from "./choose-screenshot-mutations";
import { WriteChat } from "./write-chat";
import { WriteModals } from "./write-modals";
import { DocumentPanel } from "./document-panel";
import { useDocumentFlow } from "./use-document-flow";

export interface WritePageProps {
  videoId: string;
  loaderData: {
    lessonId: string | null;
    fullPath: string;
    files: Array<{ path: string; size: number; defaultEnabled: boolean }>;
    isStandalone: boolean;
    transcript: string;
    transcriptWordCount: number;
    clipSections: SectionWithWordCount[];
    indexedClips: IndexedClip[];
    links: Array<{ id: string; url: string; title: string }>;
    courseStructure: {
      repoName: string;
      currentSectionPath: string;
      currentLessonPath: string;
      sections: {
        path: string;
        lessons: { path: string }[];
      }[];
    } | null;
    nextLessonWithoutVideo: {
      lessonId: string;
      lessonPath: string;
      sectionPath: string;
      hasExplainerFolder: boolean;
    } | null;
    repoId: string | null;
    memory: string;
  };
}

export function WritePage({ videoId, loaderData }: WritePageProps) {
  const {
    lessonId,
    fullPath,
    files,
    isStandalone,
    transcript,
    transcriptWordCount,
    clipSections,
    indexedClips,
    links,
    courseStructure,
    nextLessonWithoutVideo,
    repoId,
    memory: initialMemory,
  } = loaderData;
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

  const [memory, setMemory] = useState(initialMemory);
  const [memoryEnabled, setMemoryEnabled] = useState(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(MEMORY_ENABLED_STORAGE_KEY) === "true";
    }
    return false;
  });
  const memorySaveTimeoutRef = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  const isMemoryInitialMount = useRef(true);
  const updateMemoryFetcher = useFetcher();

  useEffect(() => {
    if (isMemoryInitialMount.current) {
      isMemoryInitialMount.current = false;
      return;
    }
    if (!repoId) return;
    if (memorySaveTimeoutRef.current) {
      clearTimeout(memorySaveTimeoutRef.current);
    }
    memorySaveTimeoutRef.current = setTimeout(() => {
      updateMemoryFetcher.submit(
        { memory },
        { method: "post", action: `/api/repos/${repoId}/update-memory` }
      );
    }, 750);
    return () => {
      if (memorySaveTimeoutRef.current) {
        clearTimeout(memorySaveTimeoutRef.current);
      }
    };
  }, [memory, repoId]);

  const isDocumentMode = mode === "article";

  const hasExplainerOrProblem = files.some(
    (f) => f.path.startsWith("explainer/") || f.path.startsWith("problem/")
  );

  const [initialMessages] = useState(() =>
    loadMessagesFromStorage(videoId, mode)
  );

  const chatApi = isDocumentMode
    ? `/videos/${videoId}/document-completions`
    : `/videos/${videoId}/completions`;

  const {
    messages,
    setMessages,
    sendMessage,
    regenerate,
    addToolOutput,
    status,
    error,
  } = useChat({
    transport: new DefaultChatTransport({ api: chatApi }),
    messages: initialMessages,
  });

  const { document, clearDocument, saveDocument } = useDocumentFlow({
    videoId,
    isDocumentMode,
    messages,
    status,
    addToolOutput,
  });

  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current === "streaming" && status === "ready") {
      saveMessagesToStorage(videoId, mode, messages);
      if (isDocumentMode) saveDocument();
    }
    prevStatusRef.current = status;
  }, [status, videoId, mode, messages, isDocumentMode, saveDocument]);

  const handleModeChange = (newMode: Mode) => {
    if (messages.length > 0) {
      saveMessagesToStorage(videoId, mode, messages);
    }
    setMode(newMode);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(MODE_STORAGE_KEY, newMode);
    }
    setMessages(loadMessagesFromStorage(videoId, newMode));
    if (newMode === "style-guide-skill-building") {
      setEnabledFiles(
        new Set(
          files
            .filter((f) => f.path.toLowerCase().endsWith("readme.md"))
            .map((f) => f.path)
        )
      );
    }
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
    if (isDocumentMode) clearDocument();
  };

  const getBodyPayload = () => {
    const transcriptEnabled =
      clipSections.length > 0 ? enabledSections.size > 0 : includeTranscript;
    const base = {
      enabledFiles: Array.from(enabledFiles),
      model,
      includeTranscript: transcriptEnabled,
      enabledSections: Array.from(enabledSections),
      courseStructure:
        includeCourseStructure && courseStructure ? courseStructure : undefined,
      memory: memoryEnabled && memory ? memory : undefined,
    };
    return isDocumentMode ? { ...base, document } : { ...base, mode };
  };

  const writeToReadmeFetcher = useFetcher();
  const deleteLinkFetcher = useFetcher();
  const openFolderFetcher = useFetcher();

  useEffect(() => {
    const result = openFolderFetcher.data as { error?: string } | undefined;
    if (openFolderFetcher.state === "idle" && result?.error) {
      toast.error(result.error);
    }
  }, [openFolderFetcher.state, openFolderFetcher.data]);

  const [isCopied, setIsCopied] = useState(false);
  const revalidator = useRevalidator();

  const [isFileModalOpen, setIsFileModalOpen] = useState(false);
  const [selectedFilename, setSelectedFilename] = useState<string>("");
  const [selectedFileContent, setSelectedFileContent] = useState<string>("");
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<string>("");
  const [isLessonPasteModalOpen, setIsLessonPasteModalOpen] = useState(false);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [previewFilePath, setPreviewFilePath] = useState<string>("");
  const [isBannedPhrasesModalOpen, setIsBannedPhrasesModalOpen] =
    useState(false);
  const {
    phrases: bannedPhrases,
    addPhrase: addBannedPhrase,
    removePhrase: removeBannedPhrase,
    updatePhrase: updateBannedPhrase,
    resetToDefaults: resetBannedPhrases,
  } = useBannedPhrases();
  const [isAddLinkModalOpen, setIsAddLinkModalOpen] = useState(false);

  const lastAssistantMessage = messages
    .slice()
    .reverse()
    .find((m) => m.role === "assistant");
  const lastAssistantMessageText = lastAssistantMessage
    ? partsToText(lastAssistantMessage.parts)
    : "";

  const setCopied = () => {
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(lastAssistantMessageText);
      setCopied();
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
        new ClipboardItem({ "text/html": blob, "text/plain": textBlob }),
      ]);
      setCopied();
    } catch (error) {
      console.error("Failed to copy as rich text:", error);
    }
  };

  const copyConversationHistory = async () => {
    try {
      await navigator.clipboard.writeText(formatConversationAsQA(messages));
      setCopied();
    } catch (error) {
      console.error("Failed to copy conversation history:", error);
    }
  };

  const { violations, composeFixMessage } = useLint(
    lastAssistantMessageText,
    mode,
    bannedPhrases
  );

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    sendMessage({ text: text.trim() || "Go" }, { body: getBodyPayload() });
    setText("");
  };

  const handleGoLive = () => {
    setMode("interview");
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(MODE_STORAGE_KEY, "interview");
    }
    const transcriptEnabled =
      clipSections.length > 0 ? enabledSections.size > 0 : includeTranscript;
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
  };

  const handleEditFile = async (filename: string) => {
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

  const handleModalClose = (setter: (open: boolean) => void, open: boolean) => {
    setter(open);
    if (!open) revalidator.revalidate();
  };

  const toolbarProps = {
    mode,
    model,
    status,
    isCopied,
    messagesLength: messages.length,
    violations,
    hasExplainerOrProblem,
    isStandalone,
    lastAssistantMessageText,
    writeToReadmeFetcherState: writeToReadmeFetcher.state,
    hasUnresolvedScreenshots: hasUnresolvedScreenshots(
      lastAssistantMessageText
    ),
    onModeChange: handleModeChange,
    onModelChange: handleModelChange,
    onCopyToClipboard: copyToClipboard,
    onCopyAsRichText: copyAsRichText,
    onCopyConversationHistory: copyConversationHistory,
    onGoLive: handleGoLive,
    onFixLintViolations: () => {
      const fixMessage = composeFixMessage();
      if (fixMessage)
        sendMessage({ text: fixMessage }, { body: getBodyPayload() });
    },
    onOpenBannedPhrases: () => setIsBannedPhrasesModalOpen(true),
    onRegenerate: () => regenerate({ body: getBodyPayload() }),
    onClearChat: handleClearChat,
    onWriteToReadme: (writeMode: "write" | "append") => {
      writeToReadmeFetcher.submit(
        { lessonId, content: lastAssistantMessageText, mode: writeMode },
        {
          method: "POST",
          action: "/api/write-readme",
          encType: "application/json",
        }
      );
    },
  };

  const chatProps = {
    messages,
    setMessages,
    error,
    fullPath,
    text,
    onTextChange: setText,
    onSubmit: handleSubmit,
    status,
    indexedClips,
    mode,
    videoId,
    toolbarProps,
  };

  return (
    <>
      <div className="flex-1 flex overflow-hidden h-full">
        <VideoContextPanel
          videoSrc={`/api/videos/${videoId}/stream`}
          transcriptWordCount={transcriptWordCount}
          onCopyTranscript={() => navigator.clipboard.writeText(transcript)}
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
          onFileClick={(filePath) => {
            setPreviewFilePath(filePath);
            setIsPreviewModalOpen(true);
          }}
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
          onDeleteFile={(filename) => {
            setFileToDelete(filename);
            setIsDeleteModalOpen(true);
          }}
          links={links}
          onAddLinkClick={() => setIsAddLinkModalOpen(true)}
          onDeleteLink={(linkId) => {
            deleteLinkFetcher.submit(null, {
              method: "post",
              action: `/api/links/${linkId}/delete`,
            });
          }}
          memory={repoId ? memory : undefined}
          onMemoryChange={repoId ? setMemory : undefined}
          memoryEnabled={memoryEnabled}
          onMemoryEnabledChange={(enabled) => {
            setMemoryEnabled(enabled);
            if (typeof localStorage !== "undefined") {
              localStorage.setItem(MEMORY_ENABLED_STORAGE_KEY, String(enabled));
            }
          }}
        />
        {isDocumentMode ? (
          <>
            <WriteChat {...chatProps} className="w-1/2" />
            <div className="w-1/2 flex flex-col border-l">
              <DocumentPanel document={document} fullPath={fullPath} />
            </div>
          </>
        ) : (
          <WriteChat {...chatProps} />
        )}
      </div>
      <WriteModals
        videoId={videoId}
        isStandalone={isStandalone}
        defaultTextFilename={`${mode}.md`}
        files={files}
        selectedFilename={selectedFilename}
        selectedFileContent={selectedFileContent}
        isFileModalOpen={isFileModalOpen}
        onFileModalClose={(open) => handleModalClose(setIsFileModalOpen, open)}
        isPasteModalOpen={isPasteModalOpen}
        onPasteModalClose={(open) =>
          handleModalClose(setIsPasteModalOpen, open)
        }
        onStandaloneFileCreated={(filename) =>
          setEnabledFiles((prev) => new Set([...prev, filename]))
        }
        isDeleteModalOpen={isDeleteModalOpen}
        fileToDelete={fileToDelete}
        onDeleteModalClose={(open) =>
          handleModalClose(setIsDeleteModalOpen, open)
        }
        isLessonPasteModalOpen={isLessonPasteModalOpen}
        onLessonPasteModalClose={(open) =>
          handleModalClose(setIsLessonPasteModalOpen, open)
        }
        onLessonFileCreated={(filename) =>
          setEnabledFiles((prev) => new Set([...prev, filename]))
        }
        isPreviewModalOpen={isPreviewModalOpen}
        previewFilePath={previewFilePath}
        onPreviewModalClose={() => {
          setIsPreviewModalOpen(false);
          setPreviewFilePath("");
        }}
        isBannedPhrasesModalOpen={isBannedPhrasesModalOpen}
        onBannedPhrasesModalOpenChange={setIsBannedPhrasesModalOpen}
        bannedPhrases={bannedPhrases}
        onAddBannedPhrase={addBannedPhrase}
        onRemoveBannedPhrase={removeBannedPhrase}
        onUpdateBannedPhrase={updateBannedPhrase}
        onResetBannedPhrases={resetBannedPhrases}
        isAddLinkModalOpen={isAddLinkModalOpen}
        onAddLinkModalOpenChange={setIsAddLinkModalOpen}
        nextLessonWithoutVideo={nextLessonWithoutVideo}
        isAddVideoToNextLessonModalOpen={isAddVideoToNextLessonModalOpen}
        onAddVideoToNextLessonModalOpenChange={
          setIsAddVideoToNextLessonModalOpen
        }
      />
    </>
  );
}
