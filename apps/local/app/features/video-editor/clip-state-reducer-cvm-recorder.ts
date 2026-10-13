import type { InsertionPoint } from "@/services/clip-service";
import type {
  ChapterOnDatabase,
  ClipOnDatabase,
  ClipReducerAction,
  ClipReducerExec,
  ClipReducerState,
  FrontendInsertionPoint,
  SessionId,
  TimelineItem,
} from "./clip-state-reducer.types";
import {
  endUnsavedTakes,
  firstTakeInProgress,
  nextDisplayNumber,
  saveTake,
} from "./clip-state-reducer-take";

/**
 * The clip reducer's half of a CVM recorder Video. The app server saves the
 * Clips (speech the recorder heard, `recorder-client/`) and tells the editor.
 * Its facts map onto the Take (`clip-state-reducer-take.ts`), as OBS's do:
 * `take-started` (timed off `speech-started` by the CVM recorder reducer)
 * puts an Optimistic Clip at the insertion point, and `clips-saved` fills it
 * in where it stands. The app server is told to save it there.
 */

type CvmRecorderAction = Extract<
  ClipReducerAction,
  { type: "cvm-recorder-message-heard" }
>;

/** The editor item a saved item's id names, as an insertion point after it. */
const toFrontendPoint = (
  items: readonly TimelineItem[],
  point: InsertionPoint
): FrontendInsertionPoint | null => {
  if (point.type === "start") return { type: "start" };
  const id =
    point.type === "after-clip" ? point.databaseClipId : point.chapterId;
  const item = items.find(
    (i) =>
      (i.type === "on-database" || i.type === "chapter-on-database") &&
      i.databaseId === id
  );
  if (!item) return null;
  return item.type === "chapter-on-database"
    ? { type: "after-chapter", frontendChapterId: item.frontendId }
    : { type: "after-clip", frontendClipId: item.frontendId };
};

/**
 * The saved item the editor's insertion point comes after: what
 * `resolveInsertionPoint` sends the server, without its throw for an item
 * that is gone.
 */
export const savedItemBefore = (state: ClipReducerState): InsertionPoint => {
  const point = state.insertionPoint;
  const index =
    point.type === "start"
      ? -1
      : point.type === "end"
        ? state.items.length - 1
        : state.items.findIndex(
            (i) =>
              i.frontendId ===
              (point.type === "after-clip"
                ? point.frontendClipId
                : point.frontendChapterId)
          );
  return savedItemAtOrBefore(state.items, index);
};

const savedItemAtOrBefore = (
  items: readonly TimelineItem[],
  index: number
): InsertionPoint => {
  const saved = items
    .slice(0, index + 1)
    .findLast(
      (i): i is ClipOnDatabase | ChapterOnDatabase =>
        (i.type === "on-database" && !i.shouldArchive) ||
        i.type === "chapter-on-database"
    );
  if (!saved) return { type: "start" };
  return saved.type === "chapter-on-database"
    ? { type: "after-chapter", chapterId: saved.databaseId }
    : { type: "after-clip", databaseClipId: saved.databaseId };
};

const samePoint = (a: InsertionPoint, b: InsertionPoint) =>
  JSON.stringify(a) === JSON.stringify(b);

export const handleCvmRecorderMessage = (
  state: ClipReducerState,
  action: CvmRecorderAction,
  exec: ClipReducerExec
): ClipReducerState => {
  const message = action.message;
  switch (message.type) {
    case "recording-started": {
      const id = message.recordingSessionId as SessionId;
      if (state.sessions.some((s) => s.id === id)) return state;
      // Started from the Stream Deck, the app server has no insertion point
      // from this editor, or one from an earlier recording:
      // `tellRecorderOfInsertionPoint` sends it, as this starts recording.
      exec({ type: "scroll-to-insertion-point" });
      return {
        ...state,
        sessions: [
          ...state.sessions,
          {
            id,
            displayNumber: nextDisplayNumber(state.sessions),
            status: "recording",
            outputPath: message.micFile,
            startedAt: action.receivedAt,
            silenceLength: message.silenceLength,
            cvmRecorder: true,
          },
        ],
      };
    }
    case "speech-ended":
      // Its clips-saved, if the speech made any, came first.
      return endUnsavedTakes(state, message.recordingSessionId as SessionId);
    case "recording-stopped":
      return endUnsavedTakes(
        {
          ...state,
          sessions: state.sessions.map((s) =>
            s.id === message.recordingSessionId ? { ...s, status: "done" } : s
          ),
        },
        message.recordingSessionId as SessionId
      );
    case "clips-saved": {
      // Placed after an item this editor never heard of: a Clip whose
      // clips-saved it missed (before it subscribed, or while reconnecting),
      // saved where the editor pointed. A Clip with no take to fill in shows
      // where the editor points, so every later Clip has somewhere to go.
      const placedAt = toFrontendPoint(state.items, message.placedAt);
      return saveTake(
        state,
        {
          sessionId: message.recordingSessionId as SessionId,
          clips: message.clips,
          transcriptionJobId: message.transcriptionJobId,
          // The app server enqueued their transcribe-clips Job with them.
          requestTranscription: false,
          unpaired: {
            at: placedAt ?? state.insertionPoint,
            // The insertion point follows only Clips that went where it
            // pointed; one moved meanwhile stays where it was moved.
            insertionPointFollows:
              !placedAt || samePoint(savedItemBefore(state), message.placedAt),
          },
        },
        exec
      );
    }
    case "recorder-status":
      return joinRecordingInProgress(state, action, message, exec);
    case "camera-lost":
    case "camera-opening":
    case "camera-went-live":
    case "cam-link-not-starting":
    case "cam-link-busy":
    case "camera-closed":
    case "scene-changed":
    case "screen-changed":
    case "warmed-up":
    case "speech-started":
    case "recorder-failed":
      return state;
  }
};

/**
 * An editor opened (or reconnected) mid-take hears the take only through
 * `recorder-status`: it missed `recording-started`, and may miss
 * `recording-stopped`. It joins the take, so the Recorder cannot switch, and
 * leaves it once no take is recording. Every `recorder-status` naming a take
 * re-sends the insertion point: a restarted app server has forgotten it.
 */
const joinRecordingInProgress = (
  state: ClipReducerState,
  action: CvmRecorderAction,
  message: Extract<CvmRecorderAction["message"], { type: "recorder-status" }>,
  exec: ClipReducerExec
): ClipReducerState => {
  const recording = message.recordingSessionId as SessionId | null;
  const sessions = state.sessions.map((s) =>
    s.cvmRecorder && s.status === "recording" && s.id !== recording
      ? { ...s, status: "done" as const }
      : s
  );
  if (recording) {
    exec({
      type: "send-recorder-insertion-point",
      insertionPoint: savedItemBefore(state),
    });
  }
  if (!recording || sessions.some((s) => s.id === recording)) {
    const left = sessions.filter((s, i) => s !== state.sessions[i]);
    return left.reduce(
      (next, s) => endUnsavedTakes(next, s.id),
      left.length > 0 ? { ...state, sessions } : state
    );
  }
  return {
    ...state,
    sessions: [
      ...sessions,
      {
        id: recording,
        displayNumber: nextDisplayNumber(sessions),
        status: "recording",
        startedAt: action.receivedAt,
        cvmRecorder: true,
      },
    ],
  };
};

/**
 * Where the app server places the CVM recorder's next Clip changed: the
 * editor's insertion point moved, or a chapter added there was saved (a
 * Stream Deck "add chapter" mid-recording), or recording started. A
 * `recorder-status` re-sends it itself.
 *
 * The editor's point is the one truth; the app server only moves its own
 * after each Clip it saves (for a Stream Deck take with no editor). So
 * after `clips-saved` the server's point is after the last Clip saved, and
 * the editor's is sent if it is anywhere else: a take deleted before its
 * Clip was saved leaves the editor's point where it was, while the server's
 * would name the deleted Clip (#2163).
 */
export const tellRecorderOfInsertionPoint = (
  before: InsertionPoint | null,
  after: ClipReducerState,
  action: ClipReducerAction,
  exec: ClipReducerExec
) => {
  if (action.type !== "cvm-recorder-message-heard") {
    send(before, after, exec);
    return;
  }
  const message = action.message;
  if (message.type === "recorder-status") return;
  const last = message.type === "clips-saved" ? message.clips.at(-1) : null;
  send(
    last ? { type: "after-clip", databaseClipId: last.id } : before,
    after,
    exec
  );
};

/** Tells the app server the editor's point, unless it already has it. */
const send = (
  server: InsertionPoint | null,
  after: ClipReducerState,
  exec: ClipReducerExec
) => {
  const point = recorderInsertionPoint(after);
  if (!point || (server && samePoint(server, point))) return;
  exec({ type: "send-recorder-insertion-point", insertionPoint: point });
};

/**
 * Where the app server should save the CVM recorder's next Clip, while a CVM
 * recorder Recording Session records; null otherwise. While a take is in
 * progress that is where its Optimistic Clip stands, so the saved Clip
 * fills it in where the server put it. Read before an action is reduced:
 * some reducers change items in place.
 */
export const recorderInsertionPoint = (
  state: ClipReducerState
): InsertionPoint | null => {
  const recording = new Set(
    state.sessions
      .filter((s) => s.cvmRecorder && s.status === "recording")
      .map((s) => s.id)
  );
  if (recording.size === 0) return null;
  const take = firstTakeInProgress(state.items, recording);
  return take === -1
    ? savedItemBefore(state)
    : savedItemAtOrBefore(state.items, take - 1);
};
