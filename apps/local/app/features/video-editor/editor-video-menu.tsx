import type { ActionMenuGroups } from "@/features/action-menu/action-menu-model";
import { UploadContext } from "@/features/upload-manager/upload-context";
import type { VideoMenuActions } from "@/features/video-menu/video-menu";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFetcher } from "react-router";
import { toast } from "@/components/ui/toast";
import { useContextSelector } from "use-context-selector";
import { useRetranscribeAllClips } from "./components/transcript-word-actions";
import { VideoEditorContext } from "./video-editor-context";

type GroupsRef = { current: ActionMenuGroups | null };

const EditorVideoMenuContext = createContext<GroupsRef | null>(null);

/**
 * Carries the editor's Video menu from the player panel, which builds it (its
 * handlers close over the panel's own modals and fetchers), to the compact
 * header's breadcrumb, which is the menu's second door (CODING_STANDARDS.md,
 * "Action menus", rule 1). A ref, not state: the groups are rebuilt on every
 * render, and the breadcrumb only needs the latest as its menu opens.
 */
export function EditorVideoMenuProvider({ children }: { children: ReactNode }) {
  const ref = useRef<ActionMenuGroups | null>(null);
  return (
    <EditorVideoMenuContext.Provider value={ref}>
      {children}
    </EditorVideoMenuContext.Provider>
  );
}

/** Called by the panel that owns the Actions dropdown, with the groups it renders. */
export function usePublishEditorVideoMenu(groups: ActionMenuGroups) {
  const ref = useContext(EditorVideoMenuContext);
  useLayoutEffect(() => {
    if (ref) ref.current = groups;
  });
}

/** The groups the Actions dropdown last rendered. Read it as the menu opens. */
export function useEditorVideoMenuRef(): GroupsRef | null {
  return useContext(EditorVideoMenuContext);
}

/**
 * The Video actions both editors offer — the landscape editor and the
 * portrait Studio — wired to the editor's context. `common` goes in the
 * Actions menu. `rare` is what the landscape editor moves out of it, to its
 * More tab, to keep the menu near a dozen items (CODING_STANDARDS.md, "Action
 * menus", rule 9); the Studio's shorter menu keeps both.
 */
export function useEditorVideoActions(): {
  common: VideoMenuActions;
  rare: VideoMenuActions;
} {
  const videoId = useContextSelector(VideoEditorContext, (ctx) => ctx.videoId);
  const videoTitle = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.videoTitle
  );
  const allClipsHaveText = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.allClipsHaveText
  );
  const copyTranscriptToClipboard = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.copyTranscriptToClipboard
  );
  const youtubeChapters = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.youtubeChapters
  );
  const copyYoutubeChaptersToClipboard = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.copyYoutubeChaptersToClipboard
  );
  const modalDispatch = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.modalDispatch
  );
  const { startExportUpload, startRenderVerticalUpload } =
    useContext(UploadContext);
  const retranscribeAllClips = useRetranscribeAllClips();
  const revealVideoFetcher = useFetcher();

  // Reveal in File System only applies once there is an exported file.
  const [exportFileExists, setExportFileExists] = useState(false);
  useEffect(() => {
    fetch(`/api/videos/${videoId}/export-file-exists`)
      .then((res) => res.json())
      .then((data: { exists: boolean }) => setExportFileExists(data.exists))
      .catch(() => setExportFileExists(false));
  }, [videoId]);

  const common: VideoMenuActions = {
    rename: () => modalDispatch({ type: "rename-video-clicked" }),
    duplicate: () => modalDispatch({ type: "copy-video-clicked" }),
    export: () => startExportUpload(videoId, videoTitle),
    copyTranscript: {
      onSelect: () =>
        void copyTranscriptToClipboard().then(() =>
          toast("Transcript copied to clipboard")
        ),
      disabled: !allClipsHaveText,
      description: allClipsHaveText
        ? undefined
        : "Waiting for transcription to complete",
    },
  };
  const rare: VideoMenuActions = {
    revealInFileSystem: exportFileExists
      ? () =>
          revealVideoFetcher.submit(
            {},
            { method: "post", action: `/api/videos/${videoId}/reveal` }
          )
      : undefined,
    renderVerticalShort: () => startRenderVerticalUpload(videoId, videoTitle),
    retranscribeAllClips,
    copyYouTubeChapters:
      youtubeChapters.length > 0
        ? () =>
            void copyYoutubeChaptersToClipboard().then(() =>
              toast("YouTube chapters copied to clipboard")
            )
        : undefined,
    copyLogPath: () => void copyLogPath(videoId),
  };
  return { common, rare };
}

async function copyLogPath(videoId: string) {
  try {
    const res = await fetch(`/api/videos/${videoId}/log-path`);
    await navigator.clipboard.writeText(await res.text());
    toast("Log path copied to clipboard");
  } catch {
    toast.error("Failed to copy log path to clipboard");
  }
}
