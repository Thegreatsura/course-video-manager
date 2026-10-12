/**
 * One mark per clip in the current recording session, oldest first, for the
 * teleprompter's session display (`app/features/teleprompter/session-marks.tsx`).
 *
 * This exists to catch one specific failure: the frontend speech detector and
 * the backend's FFmpeg silence detection disagreeing. The microphone picks up a
 * little audio, an optimistic clip is created, and no database clip ever
 * arrives to match it. On the glass that shows up as a mark that never fills
 * in — every other mark fills as its clip lands, so a hollow one left behind is
 * the leak.
 *
 * Derived here rather than on the glass because clips live in this window's
 * reducer and the popup is a pure slave (see `teleprompter-protocol.ts`).
 *
 * Scoped to the newest recording session, so pressing record wipes the slate:
 * what's on the glass is always this take's exposure, never last take's.
 */
import { useMemo } from "react";
import type {
  CaptureStatus,
  ClipMarkIds,
  ClipMarks,
  ClipMarkState,
} from "@/lib/teleprompter-protocol";
import type {
  FrontendId,
  RecordingSession,
  TimelineItem,
} from "./clip-state-reducer";

/** One mark, and the Clip it stands for, so a dot on the glass can name it. */
export type SessionClipMark = { clipId: FrontendId; state: ClipMarkState };

export function getSessionClipMarks(
  items: TimelineItem[],
  sessions: RecordingSession[],
  capture: CaptureStatus = "not-recording"
): ClipMarks {
  return getSessionClipMarksWithIds(items, sessions, capture).map(
    (mark) => mark.state
  );
}

/**
 * A New recorder take has no Optimistic Clip: its Clips are saved by the app
 * server once the speech ends. So the speech the recorder is hearing, once it
 * is long enough for a Clip, is shown as a pending mark, as OBS's Optimistic
 * Clip is, until the saved Clip lands in its place. Never orphaned: the one
 * silence detection that heard it is the one that saves it.
 */
const newRecorderSpeechMark = (
  session: RecordingSession,
  capture: CaptureStatus
): SessionClipMark | null =>
  session.newRecorder &&
  session.status === "recording" &&
  capture === "long-enough-speaking-for-clip-detected"
    ? {
        clipId: `new-recorder-speech:${session.id}` as FrontendId,
        state: "pending",
      }
    : null;

export function getSessionClipMarksWithIds(
  items: TimelineItem[],
  sessions: RecordingSession[],
  capture: CaptureStatus = "not-recording"
): SessionClipMark[] {
  // The newest session is the one being filmed. Until there is one, there is
  // nothing to report.
  const currentSession = sessions.at(-1);
  if (!currentSession) return [];
  const currentSessionId = currentSession.id;

  const marks: (SessionClipMark & { insertionOrder: number })[] = [];

  for (const item of items) {
    // A database clip keeps the `sessionId` of the optimistic clip it was
    // paired from, so this follows a clip across both halves of its life.
    // Clips loaded from the database on page load carry no session and are
    // correctly invisible here.
    if (item.type === "optimistically-added") {
      if (item.sessionId !== currentSessionId) continue;
      // Deleted wins over orphaned: a clip you chose to throw away not
      // arriving is not a failure, so it shouldn't read as one.
      marks.push({
        clipId: item.frontendId,
        insertionOrder: item.insertionOrder,
        state: item.shouldArchive
          ? "deleted-pending"
          : item.isOrphaned
            ? "orphaned"
            : "pending",
      });
    } else if (item.type === "on-database") {
      if (item.sessionId !== currentSessionId) continue;
      marks.push({
        clipId: item.frontendId,
        // Paired clips inherit their optimistic clip's insertion order, so this
        // stays comparable with the pending ones above and a mark fills in
        // where it already sat rather than jumping position.
        insertionOrder: item.insertionOrder ?? 0,
        state: item.shouldArchive ? "deleted-landed" : "landed",
      });
    }
  }

  const sorted = marks
    .sort((a, b) => a.insertionOrder - b.insertionOrder)
    .map(({ clipId, state }) => ({ clipId, state }));
  const speech = newRecorderSpeechMark(currentSession, capture);
  return speech ? [...sorted, speech] : sorted;
}

export function useSessionClipMarks(
  items: TimelineItem[],
  sessions: RecordingSession[],
  capture: CaptureStatus
): { marks: ClipMarks; markClipIds: ClipMarkIds } {
  return useMemo(() => {
    const withIds = getSessionClipMarksWithIds(items, sessions, capture);
    return {
      marks: withIds.map((mark) => mark.state),
      markClipIds: withIds.map((mark) => mark.clipId),
    };
  }, [items, sessions, capture]);
}
