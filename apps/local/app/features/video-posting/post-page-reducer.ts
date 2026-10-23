import type { EffectReducer } from "use-effect-reducer";
import type { CourseStructure } from "@/components/video-context-panel";
import type { YouTubeUploadEntry } from "@/features/upload-manager/upload-entry";
import { findYouTubeMetadataProblem } from "@/lib/youtube-metadata";
import {
  findConvertibleAiHeroUrls,
  hasAiHeroUrls,
  replaceUrls,
} from "./convert-short-links";
import {
  createInitialGeneratedFieldState,
  generatedFieldReducer,
} from "./generated-field-reducer";
import type { CreatedShortLink, GenerateTextRequest } from "./posting-requests";

/**
 * The post page: a Video's YouTube title and description (generated, copied
 * from the Pitch, or typed), its visibility and Thumbnail, the press that
 * checks for an Exported Video and starts the YouTube upload Job, and turning
 * aihero.dev links into short links. The title and description are stored
 * per Video by the page, so events carry them as they were when the user
 * acted. See docs/FRONTEND_STATE.md.
 */
export namespace postPageReducer {
  export type Field = "title" | "description";
  export type PrivacyStatus = "public" | "unlisted";

  /** Everything the upload Job needs, fixed when Post was pressed. */
  export type Upload = {
    videoId: string;
    title: string;
    description: string;
    privacyStatus: PrivacyStatus;
    thumbnailId: string;
  };

  export interface State {
    fields: generatedFieldReducer.State<Field>;
    privacyStatus: PrivacyStatus;
    selectedThumbnailId: string | null;
    /** Post was pressed; the page is asking whether the Exported Video exists. */
    checkingExport: Upload | null;
    /** The description the short links are being made for. */
    convertingShortLinks: { description: string } | null;
    /** The YouTube id this Video was last uploaded as, kept in this browser. */
    storedYoutubeVideoId: string;
  }

  export type Action =
    | generatedFieldReducer.Action<Field, GenerateTextRequest>
    | {
        type: "copy-from-pitch-clicked";
        pitchTitle: string;
        currentTitle: string;
      }
    | { type: "video-opened"; videoId: string }
    | { type: "stored-youtube-video-id-read"; youtubeVideoId: string | null }
    /** This Video's YouTube upload Job succeeded, as the jobs list reports. */
    | {
        type: "youtube-upload-succeeded";
        videoId: string;
        youtubeVideoId: string;
      }
    | { type: "privacy-status-selected"; privacyStatus: PrivacyStatus }
    | { type: "thumbnail-selected"; thumbnailId: string | null }
    | { type: "thumbnail-delete-clicked"; thumbnailId: string }
    | {
        type: "post-clicked";
        videoId: string;
        title: string;
        description: string;
      }
    | { type: "export-checked"; exists: boolean }
    | { type: "export-check-failed" }
    | {
        type: "convert-short-links-clicked";
        title: string;
        description: string;
      }
    | { type: "short-links-created"; links: CreatedShortLink[] }
    | { type: "short-links-failed"; message: string }
    | { type: "disconnect-clicked" };

  export type Effect =
    | generatedFieldReducer.Effect<Field, GenerateTextRequest>
    | { type: "read-stored-youtube-video-id"; videoId: string }
    | {
        type: "store-youtube-video-id";
        videoId: string;
        youtubeVideoId: string;
      }
    | { type: "delete-thumbnail"; thumbnailId: string }
    | { type: "check-export"; videoId: string }
    /** `exportFirst`: queue an export Job and start the upload behind it. */
    | (Upload & { type: "start-youtube-upload"; exportFirst: boolean })
    | { type: "create-short-links"; urls: string[]; linkDescription: string }
    | { type: "show-toast"; title: string; description: string }
    | { type: "show-error"; title: string; description?: string }
    | { type: "disconnect-youtube" };
}

export const createInitialPostPageState = (
  selectedThumbnailId: string | null
): postPageReducer.State => ({
  fields: createInitialGeneratedFieldState(),
  privacyStatus: "unlisted",
  selectedThumbnailId,
  checkingExport: null,
  convertingShortLinks: null,
  storedYoutubeVideoId: "",
});

/** What the page knows about the writing context when Generate is pressed. */
export interface PostGenerationContext {
  videoId: string;
  enabledFiles: Set<string>;
  enabledSections: Set<string>;
  includeTranscript: boolean;
  hasChapters: boolean;
  courseStructure: CourseStructure | null;
  includeCourseStructure: boolean;
}

/**
 * The generation request for one field. With chapters, the transcript goes
 * with the request when any chapter is ticked; without, when the whole
 * transcript is.
 */
export const selectGenerateRequest = (
  field: postPageReducer.Field,
  context: PostGenerationContext
): GenerateTextRequest => ({
  videoId: context.videoId,
  mode: field === "title" ? "youtube-title-single" : "youtube-description",
  enabledFiles: Array.from(context.enabledFiles),
  includeTranscript: context.hasChapters
    ? context.enabledSections.size > 0
    : context.includeTranscript,
  enabledSections: Array.from(context.enabledSections),
  courseStructure:
    context.includeCourseStructure && context.courseStructure
      ? context.courseStructure
      : undefined,
});

/**
 * What YouTube would refuse, named, so the upload is never queued with it.
 * A blank title is not reported: the button is already off for it.
 */
export const selectMetadataProblem = (title: string, description: string) =>
  title.trim() ? findYouTubeMetadataProblem({ title, description }) : null;

/** Post can be pressed: both fields filled, a Thumbnail picked, nothing YouTube would refuse. */
export const selectCanPost = (
  state: postPageReducer.State,
  title: string,
  description: string
) =>
  !!title.trim() &&
  !!description.trim() &&
  !!state.selectedThumbnailId &&
  !selectMetadataProblem(title, description);

/**
 * How the upload reads on the page: from this Video's upload Job while there
 * is one, else from the YouTube id this browser remembers.
 */
export const selectUploadDisplay = (
  state: postPageReducer.State,
  upload:
    | Pick<
        YouTubeUploadEntry,
        "status" | "progress" | "errorMessage" | "youtubeVideoId"
      >
    | undefined
): {
  status: "idle" | "uploading" | "success" | "error";
  progress: number;
  error: string;
  youtubeVideoId: string;
} => ({
  status: upload
    ? upload.status === "retrying" || upload.status === "waiting"
      ? "uploading"
      : upload.status
    : state.storedYoutubeVideoId
      ? "success"
      : "idle",
  progress: upload?.progress ?? 0,
  error: upload?.errorMessage ?? "",
  youtubeVideoId: upload?.youtubeVideoId ?? state.storedYoutubeVideoId,
});

type Exec = (effect: postPageReducer.Effect) => void;

const postClicked = (
  state: postPageReducer.State,
  action: Extract<postPageReducer.Action, { type: "post-clicked" }>,
  exec: Exec
): postPageReducer.State => {
  const thumbnailId = state.selectedThumbnailId;
  if (state.checkingExport || !thumbnailId) return state;
  if (!selectCanPost(state, action.title, action.description)) return state;
  const upload: postPageReducer.Upload = {
    videoId: action.videoId,
    title: action.title,
    description: action.description,
    privacyStatus: state.privacyStatus,
    thumbnailId,
  };
  exec({ type: "check-export", videoId: action.videoId });
  return { ...state, checkingExport: upload };
};

const convertShortLinksClicked = (
  state: postPageReducer.State,
  action: Extract<
    postPageReducer.Action,
    { type: "convert-short-links-clicked" }
  >,
  exec: Exec
): postPageReducer.State => {
  if (state.convertingShortLinks) return state;
  if (!hasAiHeroUrls(action.description)) {
    exec({
      type: "show-toast",
      title: "No aihero.dev links found",
      description: "The description doesn't contain any aihero.dev URLs.",
    });
    return state;
  }
  const urls = findConvertibleAiHeroUrls(action.description);
  if (urls.length === 0) {
    exec({
      type: "show-toast",
      title: "All links already converted",
      description: "All aihero.dev links are already short links.",
    });
    return state;
  }
  exec({
    type: "create-short-links",
    urls,
    linkDescription: `YouTube (${action.title || "Untitled"})`,
  });
  return {
    ...state,
    convertingShortLinks: { description: action.description },
  };
};

const shortLinksCreated = (
  state: postPageReducer.State,
  action: Extract<postPageReducer.Action, { type: "short-links-created" }>,
  exec: Exec
): postPageReducer.State => {
  const converting = state.convertingShortLinks;
  if (!converting) return state;
  const count = action.links.length;
  exec({
    type: "apply-field-text",
    field: "description",
    text: replaceUrls(
      converting.description,
      new Map(action.links.map((link) => [link.url, link.shortLinkUrl]))
    ),
  });
  exec({
    type: "show-toast",
    title: "Links converted",
    description: `Converted ${count} aihero.dev URL${count > 1 ? "s" : ""} to short links.`,
  });
  return { ...state, convertingShortLinks: null };
};

export const postPageReducer: EffectReducer<
  postPageReducer.State,
  postPageReducer.Action,
  postPageReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "generate-clicked":
    case "text-generated":
    case "text-generation-failed":
    case "text-offered":
    case "overwrite-confirmed":
    case "overwrite-cancelled": {
      const fields = generatedFieldReducer(state.fields, action, exec);
      return fields === state.fields ? state : { ...state, fields };
    }
    case "copy-from-pitch-clicked":
      return postPageReducer(
        state,
        {
          type: "text-offered",
          field: "title",
          currentText: action.currentTitle,
          text: action.pitchTitle,
        },
        exec
      );
    case "video-opened":
      exec({ type: "read-stored-youtube-video-id", videoId: action.videoId });
      return state;
    case "stored-youtube-video-id-read":
      // Nothing stored keeps what the page already shows.
      if (!action.youtubeVideoId) return state;
      return { ...state, storedYoutubeVideoId: action.youtubeVideoId };
    case "youtube-upload-succeeded":
      exec({
        type: "store-youtube-video-id",
        videoId: action.videoId,
        youtubeVideoId: action.youtubeVideoId,
      });
      return { ...state, storedYoutubeVideoId: action.youtubeVideoId };
    case "privacy-status-selected":
      return { ...state, privacyStatus: action.privacyStatus };
    case "thumbnail-selected":
      return { ...state, selectedThumbnailId: action.thumbnailId };
    case "thumbnail-delete-clicked":
      // The Thumbnail menu has already asked (useThumbnailMenu).
      exec({ type: "delete-thumbnail", thumbnailId: action.thumbnailId });
      if (action.thumbnailId !== state.selectedThumbnailId) return state;
      return { ...state, selectedThumbnailId: null };
    case "post-clicked":
      return postClicked(state, action, exec);
    case "export-checked": {
      const upload = state.checkingExport;
      if (!upload) return state;
      exec({
        type: "start-youtube-upload",
        ...upload,
        exportFirst: !action.exists,
      });
      exec(
        action.exists
          ? {
              type: "show-toast",
              title: "Upload started",
              description: `"${upload.title}" is uploading to YouTube`,
            }
          : {
              type: "show-toast",
              title: "Export + upload started",
              description: `"${upload.title}" will export first, then upload to YouTube`,
            }
      );
      return { ...state, checkingExport: null };
    }
    case "export-check-failed":
      if (!state.checkingExport) return state;
      exec({ type: "show-error", title: "Failed to check export status" });
      return { ...state, checkingExport: null };
    case "convert-short-links-clicked":
      return convertShortLinksClicked(state, action, exec);
    case "short-links-created":
      return shortLinksCreated(state, action, exec);
    case "short-links-failed":
      if (!state.convertingShortLinks) return state;
      exec({
        type: "show-error",
        title: "Failed to convert links",
        description: action.message,
      });
      return { ...state, convertingShortLinks: null };
    case "disconnect-clicked":
      exec({ type: "disconnect-youtube" });
      return state;
  }
};
