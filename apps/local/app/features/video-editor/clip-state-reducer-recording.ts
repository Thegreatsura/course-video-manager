import { WEB_LINK_DWELL_MS, type CapturedWebLink } from "@/lib/clip-web-link";
import type {
  ClipReducerAction,
  ClipReducerExec,
  ClipReducerState,
  RecordingSession,
  SessionId,
} from "./clip-state-reducer.types";
import { createSessionId } from "./clip-state-reducer.types";
import {
  effectiveWebLink,
  endUnsavedTakes,
  handleTakeStarted,
  nextDisplayNumber,
  saveTake,
} from "./clip-state-reducer-take";

type RecordingAction = Extract<
  ClipReducerAction,
  {
    type:
      | "recording-started"
      | "recording-stopped"
      | "session-polling-complete"
      | "take-started"
      | "new-database-clips"
      | "clip-audio-window-closed"
      | "browser-event";
  }
>;

const RECORDING_ACTION_TYPES: ReadonlySet<string> = new Set([
  "recording-started",
  "recording-stopped",
  "session-polling-complete",
  "take-started",
  "new-database-clips",
  "clip-audio-window-closed",
  "browser-event",
]);

export const isRecordingAction = (
  action: ClipReducerAction
): action is RecordingAction => {
  return RECORDING_ACTION_TYPES.has(action.type);
};

export const handleRecordingAction = (
  state: ClipReducerState,
  action: RecordingAction,
  exec: ClipReducerExec
): ClipReducerState => {
  switch (action.type) {
    case "recording-started":
      return handleRecordingStarted(state, action, exec);
    case "recording-stopped":
      return handleRecordingStopped(state, exec);
    case "session-polling-complete":
      return handleSessionPollingComplete(state, action, exec);
    case "take-started":
      return handleTakeStarted(state, action, exec);
    case "new-database-clips":
      return handleNewDatabaseClips(state, action, exec);
    case "clip-audio-window-closed":
      return handleClipAudioWindowClosed(state, action);
    case "browser-event":
      return handleBrowserEvent(state, action);
  }
};

/**
 * If the current candidate has been visible for at least WEB_LINK_DWELL_MS,
 * promote it into the recording clip's pendingWebLinks (deduped by URL).
 */
const promoteCandidate = (
  state: ClipReducerState,
  now: number
): ClipReducerState => {
  const candidate = state.browserLinkCandidate;
  const recordingId = state.recordingClipFrontendId;
  if (!candidate || !recordingId) return state;
  if (now - candidate.since < WEB_LINK_DWELL_MS) return state;

  return {
    ...state,
    items: state.items.map((item) => {
      if (
        item.frontendId !== recordingId ||
        item.type !== "optimistically-added"
      ) {
        return item;
      }
      const existing = item.pendingWebLinks ?? [];
      if (existing.some((l) => l.url === candidate.url)) return item;
      const captured: CapturedWebLink = {
        url: candidate.url,
        title: candidate.title,
        capturedAt: candidate.since,
      };
      return { ...item, pendingWebLinks: [...existing, captured] };
    }),
  };
};

const handleRecordingStarted = (
  state: ClipReducerState,
  action: Extract<ClipReducerAction, { type: "recording-started" }>,
  exec: ClipReducerExec
): ClipReducerState => {
  const newSession: RecordingSession = {
    id: createSessionId(),
    displayNumber: nextDisplayNumber(state.sessions),
    status: "recording",
    outputPath: action.outputPath,
    startedAt: Date.now(),
    silenceLength: action.silenceLength,
    silenceThresholdDb: action.silenceThresholdDb,
  };

  exec({
    type: "start-session-polling",
    sessionId: newSession.id,
    outputPath: action.outputPath,
    silenceLength: action.silenceLength,
    silenceThresholdDb: action.silenceThresholdDb,
  });

  exec({
    type: "scroll-to-insertion-point",
  });

  return {
    ...state,
    sessions: [...state.sessions, newSession],
  };
};

const handleRecordingStopped = (
  state: ClipReducerState,
  exec: ClipReducerExec
): ClipReducerState => {
  const activeSession = state.sessions.find((s) => s.status === "recording");
  if (!activeSession) {
    return state;
  }

  exec({
    type: "start-session-timeout",
    sessionId: activeSession.id,
  });

  return {
    ...state,
    sessions: state.sessions.map((s) =>
      s.id === activeSession.id ? { ...s, status: "polling" } : s
    ),
  };
};

const handleSessionPollingComplete = (
  state: ClipReducerState,
  action: Extract<ClipReducerAction, { type: "session-polling-complete" }>,
  exec: ClipReducerExec
): ClipReducerState => {
  const session = state.sessions.find((s) => s.id === action.sessionId);
  if (!session || session.status === "done") {
    return state;
  }

  const allSessionsDone = state.sessions.every((s) =>
    s.id === action.sessionId ? true : s.status === "done"
  );

  if (allSessionsDone) {
    exec({ type: "revalidate-loader" });
  }

  return endUnsavedTakes(
    {
      ...state,
      sessions: state.sessions.map((s) =>
        s.id === action.sessionId ? { ...s, status: "done" } : s
      ),
    },
    action.sessionId
  );
};

/** OBS polling found saved Clips: they fill in this session's takes. */
const handleNewDatabaseClips = (
  state: ClipReducerState,
  action: Extract<ClipReducerAction, { type: "new-database-clips" }>,
  exec: ClipReducerExec
): ClipReducerState =>
  saveTake(
    state,
    {
      sessionId:
        action.outputPath === undefined
          ? undefined
          : (state.sessions.find((s) => s.outputPath === action.outputPath)
              ?.id ?? ("" as SessionId)),
      clips: action.clips,
      transcriptionJobId: action.transcriptionJobId,
      requestTranscription: true,
      unpaired: { at: state.insertionPoint, insertionPointFollows: true },
    },
    exec
  );

const handleClipAudioWindowClosed = (
  state: ClipReducerState,
  action: Extract<ClipReducerAction, { type: "clip-audio-window-closed" }>
): ClipReducerState => {
  const flushed = promoteCandidate(state, action.ts);

  const cleared: ClipReducerState = {
    ...flushed,
    recordingClipFrontendId: null,
  };

  let targetIndex = -1;
  for (let i = flushed.items.length - 1; i >= 0; i--) {
    const item = flushed.items[i]!;
    if (
      item.type === "optimistically-added" &&
      item.sessionId === action.sessionId &&
      item.pendingSnapshot === undefined
    ) {
      targetIndex = i;
      break;
    }
  }
  if (targetIndex === -1) return cleared;

  return {
    ...cleared,
    items: flushed.items.map((item, i) =>
      i === targetIndex && item.type === "optimistically-added"
        ? {
            ...item,
            pendingSnapshot: {
              activeDiagramId: action.activeDiagramId,
              diagramFocused: action.diagramFocused,
            },
          }
        : item
    ),
  };
};

/**
 * Fold a live browser link-capture event into the ambient focus/URL state and
 * track a dwell-time candidate. A page must remain visible for at least
 * WEB_LINK_DWELL_MS before it is promoted into the recording clip's
 * captured-links set.
 */
const handleBrowserEvent = (
  state: ClipReducerState,
  action: Extract<ClipReducerAction, { type: "browser-event" }>
): ClipReducerState => {
  const { event } = action;

  let browserFocus = state.browserFocus ?? false;
  let browserUrl = state.browserUrl ?? null;
  let browserTitle = state.browserTitle ?? null;
  if (event.type === "browser-focus") {
    browserFocus = event.focused;
  } else {
    browserUrl = event.url;
    browserTitle = event.title ?? null;
  }

  const withAmbient: ClipReducerState = {
    ...state,
    browserFocus,
    browserUrl,
    browserTitle,
  };

  const link = effectiveWebLink(browserFocus, browserUrl, browserTitle);
  const candidate = withAmbient.browserLinkCandidate;

  if (link?.url === candidate?.url) return withAmbient;

  const promoted = promoteCandidate(withAmbient, event.ts);

  return {
    ...promoted,
    browserLinkCandidate: link
      ? { url: link.url, title: link.title, since: event.ts }
      : null,
  };
};
