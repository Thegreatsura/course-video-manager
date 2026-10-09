import {
  createContext,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { uploadReducer, createInitialUploadState } from "./upload-reducer";
import { showSuccessToast, showErrorToast } from "./upload-toasts";
import { uploadTypeRegistry } from "./upload-type-registry";
import { planUploadReactions } from "./upload-transitions";
import type { PlaceholderFloorBand } from "@/packages/course-json/client";
import {
  HISTORY_STORAGE_KEY,
  createHistoryStore,
  parseHistory,
  type HistoryLookup,
  type UploadHistoryStore,
} from "./upload-history";
import { useLocalStorage } from "@/hooks/use-local-storage";
import type { CompletedStage } from "./upload-timing";
import { useJobs, type JobSettledReport } from "@/features/jobs/use-jobs";
import type { jobsReducer } from "@/features/jobs/jobs-reducer";

export interface UploadContextType {
  uploads: uploadReducer.State["uploads"];
  /** Background Jobs the Sidecar runs (a Video export), as this tab sees them. */
  jobs: jobsReducer.State;
  dismissJob: (jobId: string) => void;
  /**
   * The author's Retry on a failed or interrupted post: the only way a post
   * runs again (posts never retry on their own).
   */
  retryJob: (jobId: string) => void;
  /** Hide every succeeded Job: the Global Upload Progress's idle timer. */
  dismissFinishedJobs: () => void;
  /**
   * "Clear finished": dismiss every settled row, Jobs and this tab's own
   * uploads alike. A Job's dismissal is kept on the server.
   */
  clearFinished: () => void;
  /** Inputs to the ETA: see `estimateUploads`. */
  timings: uploadReducer.State["timings"];
  etaHistory: HistoryLookup;
  clock: () => number;
  startUpload: (
    videoId: string,
    title: string,
    description: string,
    privacyStatus: "public" | "unlisted",
    thumbnailId: string,
    dependsOn?: string
  ) => string;
  startSocialUpload: (
    videoId: string,
    title: string,
    caption: string,
    dependsOn?: string
  ) => string;
  startAiHeroUpload: (
    videoId: string,
    title: string,
    body: string,
    description: string,
    slug: string,
    dependsOn?: string
  ) => string;
  startSkillsChangelogUpload: (
    videoId: string,
    title: string,
    slug: string,
    body: string,
    description: string,
    newsletterSubject: string,
    newsletterPreviewText: string,
    newsletterCopy: string,
    dependsOn?: string
  ) => string;
  startYoutubeShortsUpload: (
    videoId: string,
    title: string,
    description: string,
    dependsOn?: string
  ) => string;
  /**
   * Export a Video: a background Job the Sidecar runs, so it carries on when
   * the tab closes. Returns the Job's id, which an upload may wait on.
   */
  startExportUpload: (videoId: string, title: string) => string;
  /**
   * Render a Video as a vertical Short: a background Job the Sidecar runs.
   * Returns the Job's id, which a Shorts post may wait on.
   */
  startRenderVerticalUpload: (videoId: string, title: string) => string;
  /**
   * Export every Video of a Course Version that is not yet exported: a
   * background Job the Sidecar runs, drawn as one row per Video.
   */
  startBatchExportUpload: (
    versionId: string,
    includeTodoLessons: boolean,
    title: string
  ) => void;
  startPublish: (
    courseId: string,
    courseName: string,
    name: string,
    description: string,
    includeTodoLessons: boolean,
    /** The Placeholder Floor the publish page showed, as its band. */
    placeholders: PlaceholderFloorBand
  ) => string;
  startAutofill: (
    courseId: string,
    courseName: string,
    versionId: string,
    includeTodoLessons: boolean
  ) => string;
  dismissUpload: (uploadId: string) => void;
}

export const UploadContext = createContext<UploadContextType>(null!);

let nextUploadId = 0;
const generateUploadId = () => `upload-${++nextUploadId}`;

function initiateFromRegistry(
  uploadType: uploadReducer.UploadType,
  action: Extract<uploadReducer.Action, { type: "START_UPLOAD" }>,
  params: unknown,
  dispatch: (action: uploadReducer.Action) => void,
  abortControllers: Map<string, AbortController>
) {
  const config = uploadTypeRegistry[uploadType];
  if (!config.initiate) return;
  const base: uploadReducer.BaseUploadEntry = {
    uploadId: action.uploadId,
    videoId: action.videoId,
    title: action.title,
    progress: 0,
    status: "uploading",
    errorMessage: null,
    retryCount: 0,
    terminal: false,
    dependsOn: null,
    parentUploadId: null,
  };
  const entry = config.createEntry(base, action);
  config.initiate(action.uploadId, entry, params, dispatch, abortControllers);
}

export function UploadProvider({
  children,
  clock = Date.now,
  history,
}: {
  children: React.ReactNode;
  /** Stamps every action, so the reducer and the ETA never read a clock. */
  clock?: () => number;
  /** Where finished stage durations are kept. Defaults to localStorage. */
  history?: UploadHistoryStore;
}) {
  const [state, dispatchUnstamped] = useReducer(
    uploadReducer,
    undefined,
    createInitialUploadState
  );
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const [storedHistory, setStoredHistory] =
    useLocalStorage(HISTORY_STORAGE_KEY);
  const [historyStore] = useState(
    () =>
      history ??
      createHistoryStore(parseHistory(storedHistory), (data) =>
        setStoredHistory(JSON.stringify(data))
      )
  );
  const dispatch = useCallback(
    (action: uploadReducer.Action) =>
      dispatchUnstamped({ ...action, at: clockRef.current() }),
    []
  );

  // Every stage a job finishes goes into the history, exactly once.
  const persistedStagesRef = useRef(new WeakSet<CompletedStage>());
  useEffect(() => {
    for (const timing of Object.values(state.timings)) {
      for (const stage of timing.completed) {
        if (persistedStagesRef.current.has(stage)) continue;
        persistedStagesRef.current.add(stage);
        historyStore.record(stage.key, {
          durationMs: stage.durationMs,
          units: stage.units,
        });
      }
    }
  }, [state.timings, historyStore]);

  // The background Jobs. One that settles may release uploads waiting on it.
  const onJobSettled = useCallback(
    (report: JobSettledReport) =>
      dispatch(
        report.outcome === "succeeded"
          ? { type: "server-job-succeeded", jobId: report.jobId }
          : {
              type: "server-job-failed",
              jobId: report.jobId,
              title: report.title,
            }
      ),
    [dispatch]
  );
  const jobs = useJobs(onJobSettled);
  const { startJob } = jobs;

  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const previousUploadsRef = useRef<uploadReducer.State["uploads"]>({});

  const paramsMapRef = useRef<
    Map<string, { type: uploadReducer.UploadType; params: unknown }>
  >(new Map());

  // A YouTube upload is a posting Job: the Sidecar runs it once, and only
  // after the Job it waits on (its export) has succeeded.
  const startUpload = useCallback(
    (
      videoId: string,
      title: string,
      description: string,
      privacyStatus: "public" | "unlisted",
      thumbnailId: string,
      dependsOn?: string
    ) =>
      startJob({
        kind: "youtube",
        title,
        params: { videoId, title, description, privacyStatus, thumbnailId },
        subject: { type: "video", id: videoId },
        attemptsSpent: 0,
        dependsOn: dependsOn ?? null,
      }),
    [startJob]
  );

  // A Buffer post is a posting Job: run once, after its render succeeds.
  const startSocialUpload = useCallback(
    (videoId: string, title: string, caption: string, dependsOn?: string) =>
      startJob({
        kind: "buffer",
        title,
        params: { videoId, caption },
        subject: { type: "video", id: videoId },
        attemptsSpent: 0,
        dependsOn: dependsOn ?? null,
      }),
    [startJob]
  );

  // A Shorts post is a posting Job: run once, after its render succeeds.
  const startYoutubeShortsUpload = useCallback(
    (videoId: string, title: string, description: string, dependsOn?: string) =>
      startJob({
        kind: "youtube-shorts",
        title,
        params: { videoId, title, description },
        subject: { type: "video", id: videoId },
        attemptsSpent: 0,
        dependsOn: dependsOn ?? null,
      }),
    [startJob]
  );

  // AI Hero and Skills Changelog posts are posting Jobs: run once, after
  // their export succeeds.
  const startAiHeroUpload = useCallback(
    (
      videoId: string,
      title: string,
      body: string,
      description: string,
      slug: string,
      dependsOn?: string
    ) =>
      startJob({
        kind: "ai-hero",
        title,
        params: { videoId, title, body, description, slug },
        subject: { type: "video", id: videoId },
        attemptsSpent: 0,
        dependsOn: dependsOn ?? null,
      }),
    [startJob]
  );

  const startSkillsChangelogUpload = useCallback(
    (
      videoId: string,
      title: string,
      slug: string,
      body: string,
      description: string,
      newsletterSubject: string,
      newsletterPreviewText: string,
      newsletterCopy: string,
      dependsOn?: string
    ) =>
      startJob({
        kind: "skills-changelog",
        title,
        params: {
          videoId,
          title,
          slug,
          body,
          description,
          newsletterSubject,
          newsletterPreviewText,
          newsletterCopy,
        },
        subject: { type: "video", id: videoId },
        attemptsSpent: 0,
        dependsOn: dependsOn ?? null,
      }),
    [startJob]
  );

  const startExportUpload = useCallback(
    (videoId: string, title: string) =>
      startJob({
        kind: "export",
        title,
        params: { videoId },
        subject: { type: "video", id: videoId },
        attemptsSpent: 0,
        dependsOn: null,
      }),
    [startJob]
  );

  const startRenderVerticalUpload = useCallback(
    (videoId: string, title: string) =>
      startJob({
        kind: "render-vertical",
        title,
        params: { videoId },
        subject: { type: "video", id: videoId },
        attemptsSpent: 0,
        dependsOn: null,
      }),
    [startJob]
  );

  const startBatchExportUpload = useCallback(
    (versionId: string, includeTodoLessons: boolean, title: string) => {
      startJob({
        kind: "batch-export",
        title,
        params: { versionId, includeTodoLessons },
        subject: { type: "course-version", id: versionId },
        attemptsSpent: 0,
        dependsOn: null,
      });
    },
    [startJob]
  );

  const startPublish = useCallback(
    (
      courseId: string,
      courseName: string,
      name: string,
      description: string,
      includeTodoLessons: boolean,
      placeholders: PlaceholderFloorBand
    ) => {
      const uploadId = generateUploadId();

      const params = {
        courseId,
        name,
        description,
        includeTodoLessons,
        placeholders,
      };
      paramsMapRef.current.set(uploadId, { type: "publish", params });

      const action = {
        type: "START_UPLOAD" as const,
        uploadId,
        videoId: "",
        title: courseName,
        uploadType: "publish" as const,
        courseId,
      };
      dispatch(action);

      initiateFromRegistry(
        "publish",
        action,
        params,
        dispatch,
        abortControllersRef.current
      );

      return uploadId;
    },
    []
  );

  const startAutofill = useCallback(
    (
      courseId: string,
      courseName: string,
      versionId: string,
      includeTodoLessons: boolean
    ) => {
      const uploadId = generateUploadId();

      const params = { courseId, versionId, includeTodoLessons };
      paramsMapRef.current.set(uploadId, { type: "autofill", params });

      const action = {
        type: "START_UPLOAD" as const,
        uploadId,
        videoId: "",
        title: `Autofill ${courseName}`,
        uploadType: "autofill" as const,
        courseId,
      };
      dispatch(action);

      initiateFromRegistry(
        "autofill",
        action,
        params,
        dispatch,
        abortControllersRef.current
      );

      return uploadId;
    },
    []
  );

  const clearFinishedJobs = jobs.clearFinishedJobs;
  const clearFinished = useCallback(() => {
    clearFinishedJobs();
    dispatch({ type: "press-clear-finished" });
  }, [clearFinishedJobs, dispatch]);

  const dismissUpload = useCallback((uploadId: string) => {
    const abortController = abortControllersRef.current.get(uploadId);
    if (abortController) {
      abortController.abort();
      abortControllersRef.current.delete(uploadId);
    }
    paramsMapRef.current.delete(uploadId);
    dispatch({ type: "DISMISS", uploadId });
  }, []);

  // Single effect: watch for status transitions to fire toasts and handle auto-retry
  useEffect(() => {
    const current = state.uploads;
    const reactions = planUploadReactions(
      previousUploadsRef.current,
      current,
      paramsMapRef.current
    );

    for (const reaction of reactions) {
      switch (reaction.type) {
        case "success-toast":
          showSuccessToast(reaction.upload);
          break;
        case "error-toast":
          showErrorToast(reaction.upload);
          break;
        case "initiate": {
          const initiate =
            uploadTypeRegistry[reaction.upload.uploadType].initiate;
          // A kind that runs as a Job has no browser driver to re-run.
          if (!initiate) break;
          if (reaction.retry) {
            dispatch({ type: "RETRY", uploadId: reaction.uploadId });
          }
          initiate(
            reaction.uploadId,
            reaction.upload,
            reaction.params,
            dispatch,
            abortControllersRef.current
          );
          break;
        }
      }
    }

    previousUploadsRef.current = current;
  }, [state.uploads]);

  // Clean up abort controllers on unmount
  useEffect(() => {
    return () => {
      for (const controller of abortControllersRef.current.values()) {
        controller.abort();
      }
    };
  }, []);

  return (
    <UploadContext.Provider
      value={{
        uploads: state.uploads,
        jobs: jobs.state,
        dismissJob: jobs.dismissJob,
        retryJob: jobs.retryJob,
        dismissFinishedJobs: jobs.dismissFinishedJobs,
        clearFinished,
        timings: state.timings,
        etaHistory: historyStore.lookup,
        clock,
        startUpload,
        startSocialUpload,
        startYoutubeShortsUpload,
        startAiHeroUpload,
        startSkillsChangelogUpload,
        startExportUpload,
        startRenderVerticalUpload,
        startBatchExportUpload,
        startPublish,
        startAutofill,
        dismissUpload,
      }}
    >
      {children}
    </UploadContext.Provider>
  );
}
