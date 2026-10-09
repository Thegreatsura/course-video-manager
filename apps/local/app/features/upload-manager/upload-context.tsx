import {
  createContext,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { uploadReducer, createInitialUploadState } from "./upload-reducer";
import { showErrorToast } from "./upload-toasts";
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
import {
  useJobs,
  type JobSettledReport,
  type SubscribeToJobJoins,
} from "@/features/jobs/use-jobs";
import type { jobsReducer } from "@/features/jobs/jobs-reducer";
import type { SubscribeToJobEvents } from "@/features/jobs/job-event-hub";
import { TRANSCRIBE_CLIPS_JOB_KIND } from "@/features/video-editor/transcribe-clips-response";

export interface UploadContextType {
  uploads: uploadReducer.State["uploads"];
  /** Background Jobs the Sidecar runs (a Video export), as this tab sees them. */
  jobs: jobsReducer.State;
  dismissJob: (jobId: string) => void;
  /** Hear Job Events as they arrive (the recent ones first). */
  subscribeToJobEvents: SubscribeToJobEvents;
  /** Hear this tab's requests the server answered with another, live Job. */
  subscribeToJobJoins: SubscribeToJobJoins;
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
  /**
   * Transcribe a Video's Clips: a `transcribe-clips` Job the Sidecar runs,
   * under the id the editor made. It draws no row; its Job Events come back
   * to the editor (`subscribeToJobEvents`).
   */
  startClipTranscription: (
    jobId: string,
    videoId: string,
    clipIds: readonly string[]
  ) => void;
  dismissUpload: (uploadId: string) => void;
}

export const UploadContext = createContext<UploadContextType>(null!);

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

  // A Publish is a background Job: the Sidecar runs it in the `publish`
  // lane, one at a time, so closing the tab no longer stops it. It runs once
  // and is never re-run on its own: a Publish cut off after Submit leaves a
  // Pending Version for the publish page's Promote / Discard.
  const startPublish = useCallback(
    (
      courseId: string,
      courseName: string,
      name: string,
      description: string,
      includeTodoLessons: boolean,
      placeholders: PlaceholderFloorBand
    ) =>
      startJob({
        kind: "publish",
        title: courseName,
        params: {
          courseId,
          name,
          description,
          includeTodoLessons,
          placeholders,
        },
        subject: { type: "course", id: courseId },
        attemptsSpent: 0,
        dependsOn: null,
      }),
    [startJob]
  );

  // A Course Autofill is a background Job: the Sidecar runs it, so closing
  // the tab no longer stops it. Its rows come from its Job Events.
  const startAutofill = useCallback(
    (
      courseId: string,
      courseName: string,
      versionId: string,
      includeTodoLessons: boolean
    ) =>
      startJob({
        kind: "autofill",
        title: `Autofill ${courseName}`,
        params: { courseId, versionId, includeTodoLessons },
        subject: { type: "course", id: courseId },
        attemptsSpent: 0,
        dependsOn: null,
      }),
    [startJob]
  );

  // A Clip transcription is a Job too. Enqueueing through the jobs reducer
  // asks again, under the same id, when an answer is lost, so a dropped
  // response never fails Clips that were queued after all.
  const startClipTranscription = useCallback(
    (jobId: string, videoId: string, clipIds: readonly string[]) => {
      startJob({
        id: jobId,
        kind: TRANSCRIBE_CLIPS_JOB_KIND,
        title: `Transcribe ${clipIds.length} ${clipIds.length === 1 ? "Clip" : "Clips"}`,
        params: { clipIds: [...clipIds] },
        subject: { type: "video", id: videoId },
        attemptsSpent: 0,
        dependsOn: null,
      });
    },
    [startJob]
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
          // Every kind runs as a Job now, and a Job's success toast is
          // decided by the jobs reducer (`job-succeeded-toast.ts`).
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
        subscribeToJobEvents: jobs.subscribeToJobEvents,
        subscribeToJobJoins: jobs.subscribeToJobJoins,
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
        startClipTranscription,
        dismissUpload,
      }}
    >
      {children}
    </UploadContext.Provider>
  );
}
