import { useContext, useEffect } from "react";
import { useFetcher } from "react-router";
import { useEffectReducer } from "use-effect-reducer";
import { toast } from "@/components/ui/toast";
import {
  readStored,
  useLocalStorage,
  writeStored,
} from "@/hooks/use-local-storage";
import { UploadContext } from "@/features/upload-manager/upload-context";
import { findVideoJobRow } from "@/features/jobs/jobs-selectors";
import { getAutoSelectThumbnailId } from "./auto-select-thumbnail";
import { createShortLinks, generateText } from "./posting-requests";
import {
  createInitialPostPageState,
  postPageReducer,
} from "./post-page-reducer";

const POST_TITLE_STORAGE_KEY = (videoId: string) => `post-title-${videoId}`;
const POST_DESCRIPTION_STORAGE_KEY = (videoId: string) =>
  `post-description-${videoId}`;
const YOUTUBE_VIDEO_ID_STORAGE_KEY = (videoId: string) =>
  `youtube-video-id-${videoId}`;

/**
 * The post page's effect runner for `postPageReducer`, with the title and
 * description it keeps per Video in this browser and this Video's YouTube
 * upload Job.
 */
export function usePostPageReducer({
  videoId,
  thumbnails,
  pitchYoutubeTitle,
}: {
  videoId: string;
  thumbnails: Array<{ id: string }>;
  pitchYoutubeTitle: string | null;
}) {
  const [title, setTitle] = useLocalStorage(
    POST_TITLE_STORAGE_KEY(videoId),
    pitchYoutubeTitle ?? ""
  );
  const [description, setDescription] = useLocalStorage(
    POST_DESCRIPTION_STORAGE_KEY(videoId)
  );

  const { jobs, startUpload, startExportUpload } = useContext(UploadContext);
  // This Video's YouTube upload: a posting Job the Sidecar runs.
  const activeUpload = findVideoJobRow(jobs, videoId, "youtube");

  const deleteThumbnailFetcher = useFetcher();

  const [state, dispatch] = useEffectReducer<
    postPageReducer.State,
    postPageReducer.Action,
    postPageReducer.Effect
  >(
    postPageReducer,
    () => createInitialPostPageState(getAutoSelectThumbnailId(thumbnails)),
    {
      "generate-text": (_state, effect, dispatch) => {
        generateText(effect.request)
          .then((text) =>
            dispatch({ type: "text-generated", field: effect.field, text })
          )
          .catch((error) => {
            console.error(`Failed to generate ${effect.field}:`, error);
            dispatch({ type: "text-generation-failed", field: effect.field });
          });
      },
      "apply-field-text": (_state, effect) => {
        const setField = effect.field === "title" ? setTitle : setDescription;
        setField(effect.text);
      },
      "read-stored-youtube-video-id": (_state, effect, dispatch) => {
        dispatch({
          type: "stored-youtube-video-id-read",
          youtubeVideoId: readStored(
            YOUTUBE_VIDEO_ID_STORAGE_KEY(effect.videoId)
          ),
        });
      },
      "store-youtube-video-id": (_state, effect) => {
        writeStored(
          YOUTUBE_VIDEO_ID_STORAGE_KEY(effect.videoId),
          effect.youtubeVideoId
        );
      },
      "delete-thumbnail": (_state, effect) => {
        deleteThumbnailFetcher.submit(null, {
          method: "post",
          action: `/api/thumbnails/${effect.thumbnailId}/delete`,
        });
      },
      "check-export": (_state, effect, dispatch) => {
        fetch(`/api/videos/${effect.videoId}/export-file-exists`)
          .then((res) => res.json())
          .then(({ exists }: { exists: boolean }) =>
            dispatch({ type: "export-checked", exists })
          )
          .catch(() => dispatch({ type: "export-check-failed" }));
      },
      "start-youtube-upload": (_state, effect) => {
        const exportId = effect.exportFirst
          ? startExportUpload(effect.videoId, effect.title)
          : undefined;
        startUpload(
          effect.videoId,
          effect.title,
          effect.description,
          effect.privacyStatus,
          effect.thumbnailId,
          exportId
        );
      },
      "create-short-links": (_state, effect, dispatch) => {
        createShortLinks(effect.urls, effect.linkDescription)
          .then((links) => dispatch({ type: "short-links-created", links }))
          .catch((error) => {
            console.error("Failed to convert short links:", error);
            dispatch({
              type: "short-links-failed",
              message:
                error instanceof Error ? error.message : "An error occurred",
            });
          });
      },
      "show-toast": (_state, effect) => {
        toast(effect.title, { description: effect.description });
      },
      "show-error": (_state, effect) => {
        toast.error(effect.title, { description: effect.description });
      },
      "disconnect-youtube": () => {
        void fetch("/api/auth/google/disconnect", { method: "POST" }).then(
          (response) => {
            if (response.ok) window.location.reload();
          }
        );
      },
    }
  );

  // Bridges: the Video the page shows, and its upload Job settling.
  useEffect(() => {
    dispatch({ type: "video-opened", videoId });
  }, [dispatch, videoId]);

  const succeededAs =
    activeUpload?.status === "success" ? activeUpload.youtubeVideoId : null;
  useEffect(() => {
    if (succeededAs) {
      dispatch({
        type: "youtube-upload-succeeded",
        videoId,
        youtubeVideoId: succeededAs,
      });
    }
  }, [dispatch, videoId, succeededAs]);

  return {
    state,
    dispatch,
    title,
    description,
    editTitle: setTitle,
    editDescription: setDescription,
    activeUpload,
  };
}
