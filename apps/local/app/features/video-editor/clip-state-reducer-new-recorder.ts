import { resolveClipZoomType } from "@/features/videos/clip-zoom";
import type { InsertionPoint } from "@/services/clip-service";
import type { PauseType } from "@/services/video-processing-service";
import { holdForRequestedJob } from "./clip-state-reducer-transcription-jobs";
import type {
  ChapterOnDatabase,
  ClipOnDatabase,
  ClipReducerAction,
  ClipReducerExec,
  ClipReducerState,
  DatabaseId,
  FrontendInsertionPoint,
  SessionId,
  TimelineItem,
} from "./clip-state-reducer.types";
import { createFrontendId } from "./clip-state-reducer.types";
import { insertAtPoint } from "./insert-at-point";

/**
 * The clip reducer's half of a New recorder Video. The app server saves the
 * Clips (speech the recorder heard, `recorder-client/`) and tells the editor;
 * the Clip shown is the saved Clip, placed where the server placed it. No
 * Optimistic Clip, no pairing, no polling.
 */

type NewRecorderAction = Extract<
  ClipReducerAction,
  { type: "new-recorder-message-heard" }
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
  const saved = state.items
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

export const handleNewRecorderMessage = (
  state: ClipReducerState,
  action: NewRecorderAction,
  exec: ClipReducerExec
): ClipReducerState => {
  const message = action.message;
  switch (message.type) {
    case "recording-started": {
      const id = message.recordingSessionId as SessionId;
      if (state.sessions.some((s) => s.id === id)) return state;
      exec({ type: "scroll-to-insertion-point" });
      return {
        ...state,
        sessions: [
          ...state.sessions,
          {
            id,
            displayNumber:
              Math.max(0, ...state.sessions.map((s) => s.displayNumber)) + 1,
            status: "recording",
            outputPath: message.micFile,
            startedAt: action.receivedAt,
            silenceLength: message.silenceLength,
            newRecorder: true,
          },
        ],
      };
    }
    case "recording-stopped":
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === message.recordingSessionId ? { ...s, status: "done" } : s
        ),
      };
    case "clips-saved": {
      const known = new Set(
        state.items.flatMap((i) =>
          i.type === "on-database" ? [i.databaseId] : []
        )
      );
      const fresh = message.clips.filter((c) => !known.has(c.id as DatabaseId));
      const placedAt = toFrontendPoint(state.items, message.placedAt);
      if (fresh.length === 0 || !placedAt) return state;
      // The editor's insertion point follows the new Clips only when they
      // went where it pointed; one moved meanwhile stays where it was moved.
      const followsEditor = samePoint(savedItemBefore(state), message.placedAt);
      const session = state.sessions.find(
        (s) => s.id === message.recordingSessionId
      );
      let items = state.items;
      let point = placedAt;
      let insertionOrder = state.insertionOrder;
      for (const clip of fresh) {
        insertionOrder += 1;
        const saved: ClipOnDatabase = {
          ...clip,
          type: "on-database",
          frontendId: createFrontendId(),
          databaseId: clip.id as DatabaseId,
          insertionOrder,
          pauseType: clip.pauseType as PauseType,
          zoomType: resolveClipZoomType(clip.zoomType),
          diagramSnapshotId: clip.diagramSnapshotId ?? null,
          diagramName: null,
          webLinks: [],
          sessionId: session?.id,
        };
        ({ items, insertionPoint: point } = insertAtPoint(items, saved, point));
      }
      exec({ type: "scroll-to-insertion-point" });
      // The app server enqueued their transcribe-clips Job with them.
      return holdForRequestedJob(
        {
          ...state,
          items,
          insertionOrder,
          insertionPoint: followsEditor ? point : state.insertionPoint,
        },
        fresh.map((c) => c.id as DatabaseId),
        message.transcriptionJobId
      );
    }
    case "recorder-status":
    case "camera-opening":
    case "camera-went-live":
    case "cam-link-not-starting":
    case "cam-link-busy":
    case "camera-closed":
    case "speech-started":
    case "speech-ended":
    case "recorder-failed":
      return state;
  }
};

/**
 * The editor's insertion point moved while a New recorder Recording Session
 * records: the app server must place the next Clip there too.
 */
export const tellRecorderOfInsertionPoint = (
  before: ClipReducerState,
  after: ClipReducerState,
  action: ClipReducerAction,
  exec: ClipReducerExec
) => {
  if (action.type === "new-recorder-message-heard") return;
  if (before.insertionPoint === after.insertionPoint) return;
  if (!after.sessions.some((s) => s.newRecorder && s.status === "recording"))
    return;
  exec({
    type: "send-recorder-insertion-point",
    insertionPoint: savedItemBefore(after),
  });
};
