import { useEffect } from "react";
import { useEffectReducer } from "use-effect-reducer";
import { toast } from "@/components/ui/toast";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useUploadActions } from "@/features/upload-manager/upload-context";
import type { PostedPlatforms } from "@/lib/short-status";
import { createShortLinks, generateText } from "./posting-requests";
import {
  createInitialShortsPostingState,
  shortsPostingReducer,
  type ShortsPostingMode,
} from "./shorts-posting-reducer";

const SHORTS_DESC_KEY = (videoId: string) =>
  `shorts-post-description-${videoId}`;

/**
 * The Shorts posting modal's effect runner for `shortsPostingReducer`, with
 * the description it keeps per Short in this browser.
 */
export function useShortsPostingReducer({
  open,
  onOpenChange,
  videoId,
  videoTitle,
  mode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoId: string;
  videoTitle: string;
  mode: ShortsPostingMode;
}) {
  const [description, setDescription] = useLocalStorage(
    SHORTS_DESC_KEY(videoId),
    ""
  );

  const {
    startYoutubeShortsUpload,
    startSocialUpload,
    startRenderVerticalUpload,
  } = useUploadActions();

  const [state, dispatch] = useEffectReducer<
    shortsPostingReducer.State,
    shortsPostingReducer.Action,
    shortsPostingReducer.Effect
  >(shortsPostingReducer, () => createInitialShortsPostingState(videoTitle), {
    "generate-text": (_state, effect, dispatch) => {
      generateText(effect.request)
        .then((text) =>
          dispatch({ type: "text-generated", field: effect.field, text })
        )
        .catch(() =>
          dispatch({ type: "text-generation-failed", field: effect.field })
        );
    },
    "apply-field-text": (_state, effect) => {
      setDescription(effect.text);
    },
    "load-posted-status": (_state, effect, dispatch) => {
      let cancelled = false;
      fetch(`/api/videos/${effect.videoId}/posted-status`)
        .then((res) => (res.ok ? res.json() : null))
        .then((postedStatus: PostedPlatforms | null) => {
          if (!cancelled && postedStatus) {
            dispatch({
              type: "posted-status-loaded",
              videoId: effect.videoId,
              postedStatus,
            });
          }
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    },
    "rename-short": (_state, effect, dispatch) => {
      const formData = new FormData();
      formData.set("name", effect.name);
      fetch(`/api/videos/${effect.videoId}/rename`, {
        method: "POST",
        body: formData,
      })
        .then((res) => {
          if (res.ok) return;
          dispatch({
            type: "rename-refused",
            reason: res.status === 409 ? "name-taken" : "failed",
          });
        })
        .catch(() => dispatch({ type: "rename-refused", reason: "failed" }));
    },
    "check-vertical-export": (_state, effect, dispatch) => {
      fetch(`/api/videos/${effect.videoId}/vertical-export-exists`)
        .then(async (res) => {
          if (!res.ok) throw new Error("Failed to check export status");
          const { exists } = (await res.json()) as { exists: boolean };
          dispatch({ type: "vertical-export-checked", exists });
        })
        .catch(() => dispatch({ type: "vertical-export-check-failed" }));
    },
    "start-short-posting": (_state, effect) => {
      const exportId = effect.exportFirst
        ? startRenderVerticalUpload(effect.videoId, effect.title)
        : undefined;
      if (effect.toYoutube) {
        startYoutubeShortsUpload(
          effect.videoId,
          effect.title,
          effect.description,
          exportId
        );
      }
      if (effect.toBuffer) {
        startSocialUpload(effect.videoId, effect.title, effect.title, exportId);
      }
    },
    "close-modal": () => {
      onOpenChange(false);
    },
    "create-short-links": (_state, effect, dispatch) => {
      createShortLinks(effect.urls, effect.linkDescription)
        .then((links) => dispatch({ type: "short-links-created", links }))
        .catch(() => dispatch({ type: "short-links-failed" }));
    },
    "show-toast": (_state, effect) => {
      toast(effect.title, { description: effect.description });
    },
    "show-error": (_state, effect) => {
      toast.error(effect.title);
    },
  });

  // Bridges: the modal opening, and the Short's title as the page has it.
  useEffect(() => {
    if (open) dispatch({ type: "modal-opened", videoId, mode, description });
    else dispatch({ type: "modal-closed" });
    // Only opening the modal counts; typing in the description must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, open, videoId]);

  useEffect(() => {
    dispatch({ type: "video-title-loaded", videoTitle });
  }, [dispatch, videoTitle]);

  return { state, dispatch, description, editDescription: setDescription };
}
