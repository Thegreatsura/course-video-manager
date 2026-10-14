import { CopyVideoModal } from "@/components/copy-video-modal";
import { RenameVideoModal } from "@/components/rename-video-modal";
import { Suspense, type ReactNode } from "react";
import { useContextSelector } from "use-context-selector";
import type { ChapterNamingModal } from "../types";
import { VideoEditorContext } from "../video-editor-context";
import { ChapterNamingModal as ChapterNamingModalComponent } from "./chapter-naming-modal";
import { CreateVideoFromSelectionModal } from "./create-video-from-selection-modal";
import { DeferredVideoFilePasteModal } from "./deferred-fs-panels";
import { MicSettingsModal } from "./mic-settings-modal";
import { EditClipTranscriptModal } from "./edit-clip-transcript-modal";

/**
 * Every dialog the editor keeps mounted alongside its panels. They live in one
 * place — and out of {@link VideoEditor} — because the surfaces that *open*
 * them (the action menus, the timeline, the Stream Deck) are scattered, so
 * which one is open is editor-level state either way (`editorModalsReducer`).
 *
 * The video, its file data, and the open dialog are read from
 * {@link VideoEditorContext} rather than drilled through props — the same way
 * the panels alongside these dialogs read them.
 */
export const EditorModals = (props: {
  chapterNamingModal: ChapterNamingModal;
  onCloseChapterNamingModal: () => void;
  /** Clips a copy of this video would duplicate. */
  clipCount: number;
  beatCount: number;
  hasScript: boolean;
  onCreateVideoFromSelection: (title: string, mode: "copy" | "move") => void;
  /** The **Autofill chapters** modal, owned by useAutofillChaptersModal. */
  autofillChaptersModal: ReactNode;
}) => {
  const videoId = useContextSelector(VideoEditorContext, (ctx) => ctx.videoId);
  const videoTitle = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.videoTitle
  );
  const fsData = useContextSelector(VideoEditorContext, (ctx) => ctx.fsData);
  const onAddChapter = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onAddChapter
  );
  const onUpdateChapter = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onUpdateChapter
  );
  const onAddChapterAt = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onAddChapterAt
  );
  const openModal = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.openModal
  );
  const onModalOpenChange = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onModalOpenChange
  );
  const micOffsetRefusal = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.cvmRecorder.micOffsetRefusal
  );
  const onDismissMicOffsetRefusal = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.cvmRecorder.onDismissMicOffsetRefusal
  );
  // A refused offset reopens the dialog on its Clip to say why.
  const micSettingsClip = useContextSelector(VideoEditorContext, (ctx) =>
    ctx.clips.find(
      (c) =>
        c.frontendId ===
        (ctx.cvmRecorder.micOffsetRefusal?.clipId ?? ctx.micSettingsClipId)
    )
  );
  const editTranscriptClip = useContextSelector(VideoEditorContext, (ctx) =>
    ctx.clips.find((c) => c.frontendId === ctx.editTranscriptClipId)
  );
  const onEditClipText = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onEditClipText
  );
  const onSubmitMicSettings = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.cvmRecorder.onSubmitMicSettings
  );

  return (
    <>
      <ChapterNamingModalComponent
        modalState={props.chapterNamingModal}
        onClose={props.onCloseChapterNamingModal}
        onAddChapter={onAddChapter}
        onUpdateChapter={onUpdateChapter}
        onAddChapterAt={onAddChapterAt}
      />
      <Suspense>
        <DeferredVideoFilePasteModal
          fsData={fsData}
          videoId={videoId}
          open={openModal === "paste-file"}
          onOpenChange={onModalOpenChange["paste-file"]}
        />
      </Suspense>
      <RenameVideoModal
        videoId={videoId}
        currentName={videoTitle}
        open={openModal === "rename-video"}
        onOpenChange={onModalOpenChange["rename-video"]}
      />
      <CopyVideoModal
        videoId={videoId}
        videoTitle={videoTitle}
        clipCount={props.clipCount}
        beatCount={props.beatCount}
        hasScript={props.hasScript}
        open={openModal === "copy-video"}
        onOpenChange={onModalOpenChange["copy-video"]}
        // Open the copy — the editor is a single-video surface, and with
        // "Rename old video" ticked the video still on screen is now the
        // "(old)" one. Mirrors "Create Video from Selection".
        redirectTo="/videos/{id}/edit"
      />
      <CreateVideoFromSelectionModal
        open={openModal === "create-video-from-selection"}
        onOpenChange={onModalOpenChange["create-video-from-selection"]}
        onSubmit={props.onCreateVideoFromSelection}
      />
      <MicSettingsModal
        open={openModal === "mic-settings" || micOffsetRefusal !== null}
        onOpenChange={(open) => {
          onModalOpenChange["mic-settings"](open);
          if (!open && micOffsetRefusal) onDismissMicOffsetRefusal();
        }}
        refusal={micOffsetRefusal?.message ?? null}
        recordingSession={
          (micSettingsClip?.type === "on-database" &&
            micSettingsClip.recordingSession) ||
          null
        }
        onSubmit={(settings) =>
          micSettingsClip &&
          onSubmitMicSettings(micSettingsClip.frontendId, settings)
        }
      />
      <EditClipTranscriptModal
        open={openModal === "edit-transcript"}
        onOpenChange={onModalOpenChange["edit-transcript"]}
        clip={
          editTranscriptClip?.type === "on-database" ? editTranscriptClip : null
        }
        onSubmit={(text) =>
          editTranscriptClip &&
          onEditClipText(editTranscriptClip.frontendId, text)
        }
      />
      {props.autofillChaptersModal}
    </>
  );
};
