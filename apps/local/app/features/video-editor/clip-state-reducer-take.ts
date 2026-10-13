import type { DB } from "@/db/schema";
import type { PauseType } from "@/services/video-processing-service";
import { isCapturableUrl, type CapturedWebLink } from "@/lib/clip-web-link";
import { resolveClipZoomType } from "@/features/videos/clip-zoom";
import type { ClipRecordingSession } from "@/packages/clip-source";
import { holdForRequestedJob } from "./clip-state-reducer-transcription-jobs";
import type {
  ClipOnDatabase,
  ClipOptimisticallyAdded,
  ClipReducerAction,
  ClipReducerExec,
  ClipReducerState,
  DatabaseId,
  FrontendInsertionPoint,
  RecordingSession,
  SessionId,
  TimelineItem,
} from "./clip-state-reducer.types";
import { createFrontendId, createSessionId } from "./clip-state-reducer.types";
import { DEFAULT_SILENCE_LENGTH } from "@/silence-detection-constants";
import { insertAtPoint } from "./insert-at-point";

/**
 * The Take: one stretch of speech, from the moment it is long enough to be a
 * Clip until that Clip is saved. Both Recorders map their own facts onto it
 * (OBS: `take-started` from the browser detector, `new-database-clips` from
 * polling; the CVM recorder: `take-started` timed off `speech-started`, then
 * `clips-saved` from the app server), so delete, restore and the insertion
 * point behave the same whichever Recorder films.
 *
 * - **Take started**: an Optimistic Clip appears at the insertion point, and
 *   the insertion point moves after it, so a Stream Deck delete archives
 *   that Clip, not the one before it.
 * - **Take saved**: the saved Clip fills in its Optimistic Clip, where it
 *   stands. One deleted meanwhile arrives already archived: its Footage is
 *   kept, and it can be restored.
 * - **Take ended unsaved**: nothing was saved (too short, or the recording
 *   stopped first). The Optimistic Clip is marked orphaned.
 */

/**
 * The single web page currently visible on screen, folded from the live browser
 * focus + URL state. Null when Chrome does not hold OS focus or the URL is not a
 * capturable web page (http/https).
 */
export const effectiveWebLink = (
  focused: boolean,
  url: string | null | undefined,
  title: string | null | undefined
): { url: string; title: string | null } | null => {
  if (!focused || url == null || !isCapturableUrl(url)) return null;
  return { url, title: title ?? null };
};

export type TakeStart = {
  sessionId: SessionId;
  soundDetectionId: string;
  /** The scene the Clip is stamped with when saved; null: the saved Clip's own. */
  scene: string | null;
  profile: string | null;
  /** When the take started, for the web page already on screen. */
  at: number;
};

export const startTake = (
  state: ClipReducerState,
  take: TakeStart,
  exec: ClipReducerExec
): ClipReducerState => {
  if (
    state.items.some(
      (c) =>
        c.type === "optimistically-added" &&
        c.soundDetectionId === take.soundDetectionId
    )
  ) {
    return state;
  }

  // Seed the clip with the page already on screen when narration begins (e.g.
  // one shown during silent setup). Further pages switched to while the clip
  // records are appended by `browser-event`.
  const seed = effectiveWebLink(
    state.browserFocus ?? false,
    state.browserUrl,
    state.browserTitle
  );
  const frontendId = createFrontendId();
  const clip: ClipOptimisticallyAdded = {
    type: "optimistically-added",
    frontendId,
    scene: take.scene,
    profile: take.profile,
    insertionOrder: state.insertionOrder + 1,
    pauseType: "none",
    soundDetectionId: take.soundDetectionId,
    sessionId: take.sessionId,
    pendingWebLinks: seed
      ? [{ url: seed.url, title: seed.title, capturedAt: take.at }]
      : undefined,
  };

  const { items, insertionPoint } = insertAtPoint(
    state.items,
    clip,
    state.insertionPoint
  );

  exec({ type: "scroll-to-insertion-point" });

  return {
    ...state,
    items,
    insertionOrder: state.insertionOrder + 1,
    insertionPoint,
    recordingClipFrontendId: frontendId,
  };
};

export type SavedTakeClip = DB.Clip & {
  recordingSession?: ClipRecordingSession | null;
};

export type TakeSave = {
  /** The takes these Clips fill in; undefined: any session's. */
  sessionId: SessionId | undefined;
  clips: readonly SavedTakeClip[];
  transcriptionJobId: string;
  /** The editor asks for the transcription; otherwise the server already did. */
  requestTranscription: boolean;
  /**
   * Where a Clip with no take to fill in goes (the editor missed its
   * `take-started`), and whether the insertion point follows it there.
   */
  unpaired: { at: FrontendInsertionPoint; insertionPointFollows: boolean };
};

const isInProgress = (
  item: TimelineItem,
  sessionId: SessionId | undefined
): item is ClipOptimisticallyAdded =>
  item.type === "optimistically-added" &&
  !item.isOrphaned &&
  (sessionId === undefined || item.sessionId === sessionId);

/** Takes not yet saved, oldest first: the order their Clips are saved in. */
const takesInProgress = (
  items: readonly TimelineItem[],
  sessionId: SessionId | undefined
) =>
  items
    .filter((i) => isInProgress(i, sessionId))
    .sort((a, b) => a.insertionOrder - b.insertionOrder);

export const saveTake = (
  state: ClipReducerState,
  take: TakeSave,
  exec: ClipReducerExec
): ClipReducerState => {
  const known = new Set(
    state.items.flatMap((i) => (i.type === "on-database" ? [i.databaseId] : []))
  );
  const fresh = take.clips.filter((c) => !known.has(c.id));
  if (fresh.length === 0) return state;

  const waiting = takesInProgress(state.items, take.sessionId);
  let items: TimelineItem[] = [...state.items];
  let insertionPoint = state.insertionPoint;
  let insertionOrder = state.insertionOrder;
  let recordingClipFrontendId = state.recordingClipFrontendId;

  const toArchive: DatabaseId[] = [];
  const stamps: [
    DatabaseId,
    { scene: string; profile: string; pauseType: PauseType },
  ][] = [];
  const pauses: { clipId: DatabaseId; pauseType: PauseType }[] = [];
  const snapshots: { diagramId: string; clipId: DatabaseId }[] = [];
  const webLinks: { clipId: DatabaseId; links: CapturedWebLink[] }[] = [];

  // Where the next Clip with no take of its own goes.
  let unpairedAt = take.unpaired.at;

  for (const clip of fresh) {
    const inProgress = waiting.shift();
    if (inProgress) {
      const filled: ClipOnDatabase = {
        ...clip,
        type: "on-database",
        frontendId: inProgress.frontendId,
        databaseId: clip.id,
        scene: inProgress.scene ?? clip.scene,
        profile: inProgress.profile ?? clip.profile,
        insertionOrder: inProgress.insertionOrder,
        pauseType: inProgress.pauseType,
        zoomType: resolveClipZoomType(clip.zoomType),
        diagramSnapshotId: clip.diagramSnapshotId ?? null,
        diagramName: null,
        webLinks: [],
        sessionId: inProgress.sessionId,
        ...(inProgress.shouldArchive ? { shouldArchive: true } : {}),
      };
      items = items.map((i) =>
        i.frontendId === inProgress.frontendId ? filled : i
      );
      if (recordingClipFrontendId === inProgress.frontendId) {
        recordingClipFrontendId = null;
      }

      if (inProgress.shouldArchive) toArchive.push(clip.id);
      if (inProgress.scene !== null && inProgress.profile !== null) {
        stamps.push([
          clip.id,
          {
            scene: inProgress.scene,
            profile: inProgress.profile,
            pauseType: inProgress.pauseType,
          },
        ]);
      } else if (inProgress.pauseType !== clip.pauseType) {
        pauses.push({ clipId: clip.id, pauseType: inProgress.pauseType });
      }
      const snapshot = inProgress.pendingSnapshot;
      if (snapshot?.activeDiagramId && snapshot.diagramFocused) {
        snapshots.push({
          diagramId: snapshot.activeDiagramId,
          clipId: clip.id,
        });
      }
      if (inProgress.pendingWebLinks?.length) {
        webLinks.push({ clipId: clip.id, links: inProgress.pendingWebLinks });
      }
      continue;
    }

    insertionOrder += 1;
    const unpaired: ClipOnDatabase = {
      ...clip,
      type: "on-database",
      frontendId: createFrontendId(),
      databaseId: clip.id,
      insertionOrder,
      pauseType: clip.pauseType as PauseType,
      zoomType: resolveClipZoomType(clip.zoomType),
      diagramSnapshotId: clip.diagramSnapshotId ?? null,
      diagramName: null,
      webLinks: [],
      ...(take.sessionId ? { sessionId: take.sessionId } : {}),
    };
    const placed = insertAtPoint(items, unpaired, unpairedAt);
    items = placed.items;
    unpairedAt = placed.insertionPoint;
    if (take.unpaired.insertionPointFollows)
      insertionPoint = placed.insertionPoint;
  }

  if (stamps.length > 0) exec({ type: "update-clips", clips: stamps });
  for (const pause of pauses) exec({ type: "update-pause", ...pause });
  exec({ type: "scroll-to-insertion-point" });
  if (toArchive.length > 0) exec({ type: "archive-clips", clipIds: toArchive });
  const savedIds = fresh.map((c) => c.id);
  if (take.requestTranscription) {
    exec({
      type: "transcribe-clips",
      jobId: take.transcriptionJobId,
      clipIds: savedIds,
    });
  }
  for (const snapshot of snapshots) {
    exec({ type: "snapshot-for-clip", ...snapshot });
  }
  for (const entry of webLinks) exec({ type: "persist-web-links", ...entry });

  // The Clips are transcribing, and belong to their Job, until its Job
  // Events settle them.
  return holdForRequestedJob(
    {
      ...state,
      items,
      insertionPoint,
      insertionOrder,
      recordingClipFrontendId,
    },
    savedIds,
    take.transcriptionJobId
  );
};

/**
 * No Clip will be saved for this session's takes still in progress: they
 * are orphaned. One deleted meanwhile stays archived.
 */
export const endUnsavedTakes = (
  state: ClipReducerState,
  sessionId: SessionId
): ClipReducerState => {
  let recordingClipFrontendId = state.recordingClipFrontendId;
  let changed = false;
  const items = state.items.map((item) => {
    if (!isInProgress(item, sessionId) || item.shouldArchive) return item;
    changed = true;
    if (recordingClipFrontendId === item.frontendId) {
      recordingClipFrontendId = null;
    }
    return { ...item, isOrphaned: true };
  });
  return changed ? { ...state, items, recordingClipFrontendId } : state;
};

/** The index of the first take still in progress in a session, or -1. */
export const firstTakeInProgress = (
  items: readonly TimelineItem[],
  sessionIds: ReadonlySet<SessionId>
) =>
  items.findIndex(
    (i) =>
      i.type === "optimistically-added" &&
      !i.isOrphaned &&
      sessionIds.has(i.sessionId)
  );

/**
 * A Recorder heard enough speech for a Clip. A CVM recorder take belongs to
 * the Recording Session it names; an OBS take to the session recording, or a
 * new one if the browser's detector heard it first.
 */
export const handleTakeStarted = (
  state: ClipReducerState,
  action: Extract<ClipReducerAction, { type: "take-started" }>,
  exec: ClipReducerExec
): ClipReducerState => {
  if (action.recordingSessionId !== undefined) {
    // A CVM recorder take: it belongs to the Recording Session it names.
    const sessionId = action.recordingSessionId as SessionId;
    if (!state.sessions.some((s) => s.id === sessionId)) return state;
    return startTake(state, { ...action, sessionId }, exec);
  }

  let sessions = state.sessions;
  let activeSession = sessions.find((s) => s.status === "recording");
  if (!activeSession) {
    activeSession = {
      id: createSessionId(),
      displayNumber: nextDisplayNumber(sessions),
      status: "recording",
      outputPath: "",
      startedAt: action.at,
      silenceLength: DEFAULT_SILENCE_LENGTH,
    };
    sessions = [...sessions, activeSession];
  }

  return startTake(
    { ...state, sessions },
    { ...action, sessionId: activeSession.id },
    exec
  );
};

export const nextDisplayNumber = (sessions: readonly RecordingSession[]) =>
  Math.max(0, ...sessions.map((s) => s.displayNumber)) + 1;
