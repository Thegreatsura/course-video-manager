"use client";

import type {
  SectionWithWordCount,
  IndexedClip,
  Mode,
  Model,
} from "@/features/article-writer/types";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
} from "react";
import { useFetcher, useRevalidator } from "react-router";
import { toast } from "sonner";
import type { Options } from "react-markdown";
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
} from "./write-utils";
import {
  replaceChooseScreenshotWithImage,
  updateChooseScreenshotClipIndex,
} from "./choose-screenshot-mutations";
import { preprocessChooseScreenshotMarkdown } from "./choose-screenshot-markdown";
import { ChooseScreenshot } from "./choose-screenshot";
import { WriteChat } from "./write-chat";
import { WriteModals } from "./write-modals";
import { DocumentPanel } from "./document-panel";
import { useDocumentFlow } from "./use-document-flow";
import { useVideoContextHandlers } from "./use-video-context-handlers";
import { useToolbarProps } from "./use-toolbar-props";

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

  const { document, documentRef, clearDocument, saveDocument, updateDocument } =
    useDocumentFlow({
      videoId,
      isDocumentMode,
      messages,
      status,
      addToolOutput,
    });

  // ChooseScreenshot support for document panel
  const [docCapturingKey, setDocCapturingKey] = useState<string | null>(null);

  const handleDocCapture = useCallback(
    async (
      clipIndex: number,
      alt: string,
      timestamp: number,
      videoFilename: string
    ) => {
      const key = `doc-${clipIndex}-${alt}`;
      setDocCapturingKey(key);
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
        const currentDoc = documentRef.current;
        if (currentDoc) {
          updateDocument(
            replaceChooseScreenshotWithImage(
              currentDoc,
              clipIndex,
              alt,
              imagePath
            )
          );
        }
      } catch (err) {
        console.error("Screenshot capture failed:", err);
      } finally {
        setDocCapturingKey(null);
      }
    },
    [videoId, documentRef, updateDocument]
  );

  const handleDocClipIndexChange = useCallback(
    (currentIndex: number, newIndex: number, alt: string) => {
      const currentDoc = documentRef.current;
      if (currentDoc) {
        updateDocument(
          updateChooseScreenshotClipIndex(
            currentDoc,
            currentIndex,
            newIndex,
            alt
          )
        );
      }
    },
    [documentRef, updateDocument]
  );

  const docExtraComponents = useMemo((): Options["components"] | undefined => {
    if (indexedClips.length === 0 || !isDocumentMode) return undefined;
    return {
      choosescreenshot: ((
        compProps: HTMLAttributes<HTMLElement> & Record<string, unknown>
      ) => {
        const clipIdx = parseInt(compProps.clipindex as string, 10);
        const altText = (compProps.alt as string) ?? "";
        const key = `doc-${clipIdx}-${altText}`;
        return (
          <ChooseScreenshot
            clipIndex={clipIdx}
            alt={altText}
            clips={indexedClips}
            onClipIndexChange={(current, next) =>
              handleDocClipIndexChange(current, next, altText)
            }
            onCapture={handleDocCapture}
            isCapturing={docCapturingKey === key}
            isStreaming={status === "streaming" || status === "submitted"}
          />
        );
      }) as unknown,
    } as Options["components"];
  }, [
    indexedClips,
    isDocumentMode,
    handleDocClipIndexChange,
    handleDocCapture,
    docCapturingKey,
    status,
  ]);

  const docPreprocessMarkdown = useMemo(() => {
    if (!docExtraComponents) return undefined;
    return (md: string) => preprocessChooseScreenshotMarkdown(md);
  }, [docExtraComponents]);

  const prevStatusRef = useRef(status);
  useEffect(() => {
    const transitionedToReady =
      prevStatusRef.current === "streaming" && status === "ready";
    prevStatusRef.current = status;

    if (transitionedToReady) {
      saveMessagesToStorage(videoId, mode, messages);
      if (isDocumentMode) saveDocument();
      return;
    }

    // In document mode, tool outputs are added client-side via addToolOutput()
    // after streaming completes. Save messages when they change while already
    // ready so tool results persist across page refreshes.
    if (isDocumentMode && status === "ready" && messages.length > 0) {
      saveMessagesToStorage(videoId, mode, messages);
    }
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

  const getBodyPayload = useCallback(() => {
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
  }, [
    clipSections.length,
    enabledSections,
    includeTranscript,
    enabledFiles,
    model,
    includeCourseStructure,
    courseStructure,
    memoryEnabled,
    memory,
    isDocumentMode,
    document,
    mode,
  ]);

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

  const {
    handleCopyTranscript,
    handleIncludeCourseStructureChange,
    handleFileClick,
    handleOpenFolderClick,
    handleAddFromClipboardClick,
    handleDeleteFile,
    handleDeleteLink,
    handleAddLinkClick,
    handleMemoryEnabledChange,
  } = useVideoContextHandlers({
    videoId,
    transcript,
    isStandalone,
    openFolderFetcher,
    deleteLinkFetcher,
    setIncludeCourseStructure,
    setPreviewFilePath,
    setIsPreviewModalOpen,
    setIsPasteModalOpen,
    setIsLessonPasteModalOpen,
    setFileToDelete,
    setIsDeleteModalOpen,
    setIsAddLinkModalOpen,
    setMemoryEnabled,
  });

  const { violations, composeFixMessage } = useLint(
    partsToText(
      messages
        .slice()
        .reverse()
        .find((m) => m.role === "assistant")?.parts ?? []
    ),
    mode,
    bannedPhrases
  );

  const handleSubmit = useCallback(
    (text: string) => {
      sendMessage({ text }, { body: getBodyPayload() });
    },
    [sendMessage, getBodyPayload]
  );

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

  const toolbarProps = useToolbarProps({
    messages,
    mode,
    model,
    status,
    isCopied,
    setIsCopied,
    violations,
    hasExplainerOrProblem,
    isStandalone,
    isDocumentMode,
    document,
    writeToReadmeFetcher,
    lessonId,
    composeFixMessage,
    sendMessage,
    getBodyPayload,
    regenerate,
    onModeChange: handleModeChange,
    onModelChange: handleModelChange,
    onGoLive: handleGoLive,
    onClearChat: handleClearChat,
    onOpenBannedPhrases: () => setIsBannedPhrasesModalOpen(true),
  });

  const chatProps = useMemo(
    () => ({
      messages,
      setMessages,
      error,
      fullPath,
      onSubmit: handleSubmit,
      status,
      indexedClips,
      mode,
      videoId,
      toolbarProps,
    }),
    [
      messages,
      setMessages,
      error,
      fullPath,
      handleSubmit,
      status,
      indexedClips,
      mode,
      videoId,
      toolbarProps,
    ]
  );

  return (
    <>
      <div className="flex-1 flex overflow-hidden h-full">
        <VideoContextPanel
          videoSrc={`/api/videos/${videoId}/stream`}
          transcriptWordCount={transcriptWordCount}
          onCopyTranscript={handleCopyTranscript}
          clipSections={clipSections}
          enabledSections={enabledSections}
          onEnabledSectionsChange={setEnabledSections}
          includeTranscript={includeTranscript}
          onIncludeTranscriptChange={setIncludeTranscript}
          courseStructure={courseStructure}
          includeCourseStructure={includeCourseStructure}
          onIncludeCourseStructureChange={handleIncludeCourseStructureChange}
          files={files}
          isStandalone={isStandalone}
          enabledFiles={enabledFiles}
          onEnabledFilesChange={setEnabledFiles}
          onFileClick={handleFileClick}
          onOpenFolderClick={handleOpenFolderClick}
          onAddFromClipboardClick={handleAddFromClipboardClick}
          onEditFile={handleEditFile}
          onDeleteFile={handleDeleteFile}
          links={links}
          onAddLinkClick={handleAddLinkClick}
          onDeleteLink={handleDeleteLink}
          memory={repoId ? memory : undefined}
          onMemoryChange={repoId ? setMemory : undefined}
          memoryEnabled={memoryEnabled}
          onMemoryEnabledChange={handleMemoryEnabledChange}
        />
        {isDocumentMode ? (
          <>
            <WriteChat {...chatProps} className="w-2/5" />
            <div className="w-3/5 flex flex-col border-l">
              <DocumentPanel
                document={document}
                fullPath={fullPath}
                extraComponents={docExtraComponents}
                preprocessMarkdown={docPreprocessMarkdown}
                onDocumentChange={updateDocument}
              />
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
