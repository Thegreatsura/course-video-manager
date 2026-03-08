import { StandaloneFileManagementModal } from "@/components/standalone-file-management-modal";
import { StandaloneFilePasteModal } from "@/components/standalone-file-paste-modal";
import { DeleteStandaloneFileModal } from "@/components/delete-standalone-file-modal";
import { LessonFilePasteModal } from "@/components/lesson-file-paste-modal";
import { FilePreviewModal } from "@/components/file-preview-modal";
import { BannedPhrasesModal } from "@/components/banned-phrases-modal";
import { AddLinkModal } from "@/components/add-link-modal";
import { AddVideoToNextLessonModal } from "@/components/add-video-to-next-lesson-modal";
import type { BannedPhrase } from "./lint-rules";

export interface WriteModalsProps {
  videoId: string;
  isStandalone: boolean;
  files: Array<{ path: string; size: number; defaultEnabled: boolean }>;

  // Standalone file modals
  selectedFilename: string;
  selectedFileContent: string;
  isFileModalOpen: boolean;
  onFileModalClose: (open: boolean) => void;
  isPasteModalOpen: boolean;
  onPasteModalClose: (open: boolean) => void;
  onStandaloneFileCreated: (filename: string) => void;
  isDeleteModalOpen: boolean;
  fileToDelete: string;
  onDeleteModalClose: (open: boolean) => void;

  // Lesson file paste modal
  isLessonPasteModalOpen: boolean;
  onLessonPasteModalClose: (open: boolean) => void;
  onLessonFileCreated: (filename: string) => void;

  // File preview modal
  isPreviewModalOpen: boolean;
  previewFilePath: string;
  onPreviewModalClose: () => void;

  // Banned phrases modal
  isBannedPhrasesModalOpen: boolean;
  onBannedPhrasesModalOpenChange: (open: boolean) => void;
  bannedPhrases: BannedPhrase[];
  onAddBannedPhrase: (
    pattern: string,
    readable: string,
    caseSensitive: boolean
  ) => void;
  onRemoveBannedPhrase: (index: number) => void;
  onUpdateBannedPhrase: (index: number, updated: Partial<BannedPhrase>) => void;
  onResetBannedPhrases: () => void;

  // Add link modal
  isAddLinkModalOpen: boolean;
  onAddLinkModalOpenChange: (open: boolean) => void;

  // Add video to next lesson modal
  nextLessonWithoutVideo: {
    lessonId: string;
    lessonPath: string;
    sectionPath: string;
    hasExplainerFolder: boolean;
  } | null;
  isAddVideoToNextLessonModalOpen: boolean;
  onAddVideoToNextLessonModalOpenChange: (open: boolean) => void;
}

export function WriteModals(props: WriteModalsProps) {
  const {
    videoId,
    isStandalone,
    files,
    selectedFilename,
    selectedFileContent,
    isFileModalOpen,
    onFileModalClose,
    isPasteModalOpen,
    onPasteModalClose,
    onStandaloneFileCreated,
    isDeleteModalOpen,
    fileToDelete,
    onDeleteModalClose,
    isLessonPasteModalOpen,
    onLessonPasteModalClose,
    onLessonFileCreated,
    isPreviewModalOpen,
    previewFilePath,
    onPreviewModalClose,
    isBannedPhrasesModalOpen,
    onBannedPhrasesModalOpenChange,
    bannedPhrases,
    onAddBannedPhrase,
    onRemoveBannedPhrase,
    onUpdateBannedPhrase,
    onResetBannedPhrases,
    isAddLinkModalOpen,
    onAddLinkModalOpenChange,
    nextLessonWithoutVideo,
    isAddVideoToNextLessonModalOpen,
    onAddVideoToNextLessonModalOpenChange,
  } = props;

  return (
    <>
      {/* Standalone file modals */}
      {isStandalone && (
        <>
          <StandaloneFileManagementModal
            videoId={videoId}
            filename={selectedFilename}
            content={selectedFileContent}
            open={isFileModalOpen}
            onOpenChange={onFileModalClose}
          />
          <StandaloneFilePasteModal
            videoId={videoId}
            open={isPasteModalOpen}
            onOpenChange={onPasteModalClose}
            existingFiles={files}
            onFileCreated={onStandaloneFileCreated}
          />
          <DeleteStandaloneFileModal
            videoId={videoId}
            filename={fileToDelete}
            open={isDeleteModalOpen}
            onOpenChange={onDeleteModalClose}
          />
        </>
      )}
      {/* Lesson file modals */}
      {!isStandalone && (
        <LessonFilePasteModal
          videoId={videoId}
          open={isLessonPasteModalOpen}
          onOpenChange={onLessonPasteModalClose}
          existingFiles={files}
          onFileCreated={onLessonFileCreated}
        />
      )}
      {/* File preview modal */}
      <FilePreviewModal
        isOpen={isPreviewModalOpen}
        onClose={onPreviewModalClose}
        videoId={videoId}
        filePath={previewFilePath}
        isStandalone={isStandalone}
      />
      {/* Banned phrases management modal */}
      <BannedPhrasesModal
        open={isBannedPhrasesModalOpen}
        onOpenChange={onBannedPhrasesModalOpenChange}
        phrases={bannedPhrases}
        onAddPhrase={onAddBannedPhrase}
        onRemovePhrase={onRemoveBannedPhrase}
        onUpdatePhrase={onUpdateBannedPhrase}
        onResetToDefaults={onResetBannedPhrases}
      />
      {/* Add link modal */}
      <AddLinkModal
        open={isAddLinkModalOpen}
        onOpenChange={onAddLinkModalOpenChange}
      />
      {/* Add video to next lesson modal */}
      {nextLessonWithoutVideo && (
        <AddVideoToNextLessonModal
          lessonId={nextLessonWithoutVideo.lessonId}
          lessonPath={nextLessonWithoutVideo.lessonPath}
          sectionPath={nextLessonWithoutVideo.sectionPath}
          hasExplainerFolder={nextLessonWithoutVideo.hasExplainerFolder}
          open={isAddVideoToNextLessonModalOpen}
          onOpenChange={onAddVideoToNextLessonModalOpenChange}
        />
      )}
    </>
  );
}
