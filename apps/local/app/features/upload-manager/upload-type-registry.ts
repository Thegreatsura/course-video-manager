import type { uploadReducer } from "./upload-reducer";
import type { PlaceholderFloorBand } from "@/packages/course-json/client";

type StartUploadAction = Extract<
  uploadReducer.Action,
  { type: "START_UPLOAD" }
>;
type UploadSuccessAction = Extract<
  uploadReducer.Action,
  { type: "UPLOAD_SUCCESS" }
>;

export interface UploadTypeConfig<
  TParams = unknown,
  TEntry extends uploadReducer.UploadEntry = uploadReducer.UploadEntry,
> {
  createEntry: (
    base: uploadReducer.BaseUploadEntry,
    action: StartUploadAction
  ) => TEntry;

  resetEntry: (
    base: uploadReducer.BaseUploadEntry,
    prevEntry: TEntry
  ) => TEntry;

  applySuccess: (entry: TEntry, action: UploadSuccessAction) => TEntry;

  /**
   * Starts the job in the browser. `null` for a job that runs in the Sidecar
   * instead (a Video export, a vertical render): the provider enqueues it.
   */
  initiate:
    | ((
        uploadId: string,
        entry: TEntry,
        params: TParams,
        dispatch: (action: uploadReducer.Action) => void,
        abortControllers: Map<string, AbortController>
      ) => void)
    | null;

  supportsDependsOn?: boolean;
}

export function withAbortManagement(
  uploadId: string,
  abortControllers: Map<string, AbortController>,
  start: () => AbortController
): void {
  const existing = abortControllers.get(uploadId);
  if (existing) existing.abort();
  const controller = start();
  abortControllers.set(uploadId, controller);
}

const exportConfig: UploadTypeConfig<
  undefined,
  uploadReducer.ExportUploadEntry
> = {
  createEntry: (base, action) => ({
    ...base,
    uploadType: "export" as const,
    exportStage: "queued" as const,
    isBatchEntry: action.isBatchEntry ?? false,
    videoUploadStage: null,
    uploadedBytes: 0,
    totalBytes: null,
  }),

  resetEntry: (base, prev) => ({
    ...base,
    uploadType: "export" as const,
    exportStage: "queued" as const,
    isBatchEntry: prev.isBatchEntry,
    videoUploadStage: null,
    uploadedBytes: 0,
    // The Video's size on disk survives a retry: it is a fact about the file,
    // not about the attempt.
    totalBytes: prev.totalBytes,
  }),

  applySuccess: (entry) => ({
    ...entry,
    status: "success" as const,
    progress: 100,
    errorMessage: null,
    exportStage: null,
    videoUploadStage: null,
  }),

  // A Video export, alone or in a Batch export, is a background Job: it runs
  // in the Sidecar. Only a Publish's per-Video rows are still entries here,
  // and the Publish drives them.
  initiate: null,

  supportsDependsOn: false,
};

export interface YouTubeParams {
  description: string;
  privacyStatus: "public" | "unlisted";
  thumbnailId: string;
}

const youtubeConfig: UploadTypeConfig<
  YouTubeParams,
  uploadReducer.YouTubeUploadEntry
> = {
  createEntry: (base) => ({
    ...base,
    uploadType: "youtube" as const,
    youtubeVideoId: null,
  }),

  resetEntry: (base, prev) => ({
    ...base,
    uploadType: "youtube" as const,
    youtubeVideoId: prev.youtubeVideoId,
  }),

  applySuccess: (entry, action) => ({
    ...entry,
    status: "success" as const,
    progress: 100,
    errorMessage: null,
    youtubeVideoId: action.youtubeVideoId ?? null,
  }),

  // A YouTube upload is a posting Job: the Sidecar runs it, once
  // (`startUpload` enqueues it), never as a browser entry.
  initiate: null,

  supportsDependsOn: true,
};

export interface YouTubeShortsParams {
  description: string;
}

const youtubeShortsConfig: UploadTypeConfig<
  YouTubeShortsParams,
  uploadReducer.YouTubeShortsUploadEntry
> = {
  createEntry: (base) => ({
    ...base,
    uploadType: "youtube-shorts" as const,
    youtubeVideoId: null,
  }),

  resetEntry: (base, prev) => ({
    ...base,
    uploadType: "youtube-shorts" as const,
    youtubeVideoId: prev.youtubeVideoId,
  }),

  applySuccess: (entry, action) => ({
    ...entry,
    status: "success" as const,
    progress: 100,
    errorMessage: null,
    youtubeVideoId: action.youtubeVideoId ?? null,
  }),

  // A Shorts post is a posting Job: the Sidecar runs it, once
  // (`startYoutubeShortsUpload` enqueues it), never as a browser entry.
  initiate: null,

  supportsDependsOn: true,
};

export interface BufferParams {
  caption: string;
}

const bufferConfig: UploadTypeConfig<
  BufferParams,
  uploadReducer.BufferUploadEntry
> = {
  createEntry: (base) => ({
    ...base,
    uploadType: "buffer" as const,
    bufferStage: "uploading-blob" as const,
  }),

  resetEntry: (base) => ({
    ...base,
    uploadType: "buffer" as const,
    bufferStage: "uploading-blob" as const,
  }),

  applySuccess: (entry) => ({
    ...entry,
    status: "success" as const,
    progress: 100,
    errorMessage: null,
    bufferStage: null,
  }),

  // A Buffer post is a posting Job: the Sidecar runs it, once
  // (`startSocialUpload` enqueues it), never as a browser entry.
  initiate: null,

  supportsDependsOn: true,
};

export interface AiHeroParams {
  body: string;
  description: string;
  slug: string;
}

const aiHeroConfig: UploadTypeConfig<
  AiHeroParams,
  uploadReducer.AiHeroUploadEntry
> = {
  createEntry: (base) => ({
    ...base,
    uploadType: "ai-hero" as const,
    aiHeroSlug: null,
  }),

  resetEntry: (base) => ({
    ...base,
    uploadType: "ai-hero" as const,
    aiHeroSlug: null,
  }),

  applySuccess: (entry, action) => ({
    ...entry,
    status: "success" as const,
    progress: 100,
    errorMessage: null,
    aiHeroSlug: action.aiHeroSlug ?? null,
  }),

  // An AI Hero post is a posting Job: the Sidecar runs it, once
  // (`startAiHeroUpload` enqueues it), never as a browser entry.
  initiate: null,

  supportsDependsOn: true,
};

export interface SkillsChangelogParams {
  slug: string;
  body: string;
  description: string;
  newsletterSubject: string;
  newsletterPreviewText: string;
  newsletterCopy: string;
}

const skillsChangelogConfig: UploadTypeConfig<
  SkillsChangelogParams,
  uploadReducer.SkillsChangelogUploadEntry
> = {
  createEntry: (base) => ({
    ...base,
    uploadType: "skills-changelog" as const,
    skillsChangelogSlug: null,
  }),

  resetEntry: (base) => ({
    ...base,
    uploadType: "skills-changelog" as const,
    skillsChangelogSlug: null,
  }),

  applySuccess: (entry, action) => ({
    ...entry,
    status: "success" as const,
    progress: 100,
    errorMessage: null,
    skillsChangelogSlug: action.skillsChangelogSlug ?? null,
  }),

  // A Skills Changelog post is a posting Job: the Sidecar runs it,
  // once (`startSkillsChangelogUpload` enqueues it), never as a browser entry.
  initiate: null,

  supportsDependsOn: true,
};

export interface PublishParams {
  courseId: string;
  name: string;
  description: string;
  includeTodoLessons: boolean;
  /** The Placeholder Floor the publish page showed, as its band. */
  placeholders: PlaceholderFloorBand;
}

const publishConfig: UploadTypeConfig<
  PublishParams,
  uploadReducer.PublishUploadEntry
> = {
  createEntry: (base, action) => ({
    ...base,
    uploadType: "publish" as const,
    publishStage: "validating" as const,
    newDraftVersionId: null,
    courseId: action.courseId ?? "",
  }),

  resetEntry: (base, prev) => ({
    ...base,
    uploadType: "publish" as const,
    publishStage: "validating" as const,
    newDraftVersionId: null,
    courseId: prev.courseId,
  }),

  applySuccess: (entry) => ({
    ...entry,
    status: "success" as const,
    progress: 100,
    errorMessage: null,
    publishStage: null,
    newDraftVersionId: entry.newDraftVersionId,
    courseId: entry.courseId,
  }),

  // A Publish is a Job: the Sidecar runs it (`startPublish` enqueues it),
  // in the `publish` lane, once. Its rows come from its Job Events
  // (`jobs-selectors.ts`); the type is how they draw.
  initiate: null,

  supportsDependsOn: false,
};

const renderVerticalConfig: UploadTypeConfig<
  undefined,
  uploadReducer.RenderVerticalUploadEntry
> = {
  createEntry: (base) => ({
    ...base,
    uploadType: "render-vertical" as const,
    renderVerticalStage: "concatenating-clips" as const,
  }),

  resetEntry: (base) => ({
    ...base,
    uploadType: "render-vertical" as const,
    renderVerticalStage: "concatenating-clips" as const,
  }),

  applySuccess: (entry) => ({
    ...entry,
    status: "success" as const,
    progress: 100,
    errorMessage: null,
    renderVerticalStage: null,
  }),

  // A vertical render is a background Job: it runs in the Sidecar
  // (`startRenderVerticalUpload` enqueues it), never as a browser entry.
  initiate: null,

  supportsDependsOn: false,
};

const autofillConfig: UploadTypeConfig<
  undefined,
  uploadReducer.AutofillUploadEntry
> = {
  createEntry: (base, action) => ({
    ...base,
    uploadType: "autofill" as const,
    // A child is born already writing; the parent still has to work out which
    // Videos it has work for.
    autofillStage: action.parentUploadId ? "writing" : "selecting",
    courseId: action.courseId ?? "",
  }),

  resetEntry: (base, prev) => ({
    ...base,
    uploadType: "autofill" as const,
    autofillStage: "selecting" as const,
    courseId: prev.courseId,
  }),

  applySuccess: (entry) => ({
    ...entry,
    status: "success" as const,
    progress: 100,
    errorMessage: null,
    autofillStage: null,
  }),

  // A Course Autofill is a background Job: it runs in the Sidecar
  // (`startAutofill` enqueues it), never as a browser entry.
  initiate: null,

  supportsDependsOn: false,
};

export const uploadTypeRegistry: Record<
  uploadReducer.UploadType,
  UploadTypeConfig<any, any>
> = {
  export: exportConfig,
  youtube: youtubeConfig,
  "youtube-shorts": youtubeShortsConfig,
  buffer: bufferConfig,
  "ai-hero": aiHeroConfig,
  "skills-changelog": skillsChangelogConfig,
  publish: publishConfig,
  autofill: autofillConfig,
  "render-vertical": renderVerticalConfig,
};
