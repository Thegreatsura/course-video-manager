/**
 * Keep the teleprompter popup in step with this editor.
 *
 * The popup has no picker, so this is the only way it learns which video to
 * show, what capture is doing, which of Script or Beats you're looking at, and
 * what this recording session's clips are doing, and how long the Video runs.
 *
 * Two effects, doing two different jobs:
 *
 *   - The first answers the popup's heartbeat and its join handshake. State is
 *     read through a ref rather than captured in the dependencies: the
 *     speech-detector state changes constantly mid-take, and re-subscribing the
 *     channel on every change is the one failure mode a teleprompter can't have.
 *   - The second *pushes* state the moment it changes, so the glass is never a
 *     heartbeat behind the editor. Its dependencies are the primitives rather
 *     than the state object, so a re-render that produces an identical
 *     `{ videoId, capture, tab }` sends nothing — which matters, because the
 *     speech detector re-renders far more often than it actually transitions.
 */
import { useEffect, useMemo, useRef } from "react";
import {
  enableTeleprompterEditorMode,
  pushTeleprompterState,
} from "@/lib/teleprompter-window";
import type { CaptureStatus, ClipMarks } from "@/lib/teleprompter-protocol";
import type { BeatTab } from "../beat-tab";
import type { RecordingSession, TimelineItem } from "../clip-state-reducer";
import { useSessionClipMarks } from "../session-clip-marks";
import { useLatestSessionTranscript } from "../session-latest-transcript";
import { getTimelineItems, getTotalDuration } from "../video-editor-selectors";
import { isClip } from "../clip-utils";

export type TeleprompterEditorInput = {
  videoId: string | null;
  capture: CaptureStatus;
  tab: BeatTab;
  /** The editor's clips and sessions, from which the session state is derived. */
  items: TimelineItem[];
  sessions: RecordingSession[];
};

export function useTeleprompterEditorMode(input: TeleprompterEditorInput) {
  const { videoId, capture, tab } = input;
  // One per clip in the current session — see `session-clip-marks.ts`.
  const marks = useSessionClipMarks(input.items, input.sessions);
  // See `session-latest-transcript.ts`.
  const latestTranscript = useLatestSessionTranscript(
    input.items,
    input.sessions
  );

  // The same length the editor shows under its player: the same items, the
  // same filter and the same sum as `clips` / `totalDuration` in video-editor.tsx.
  const videoLengthSeconds = useMemo(
    () => getTotalDuration(getTimelineItems(input.items).filter(isClip)),
    [input.items]
  );

  const state = {
    videoId,
    capture,
    tab,
    marks,
    latestTranscript,
    videoLengthSeconds,
  };
  const ref = useRef(state);
  ref.current = state;

  useEffect(() => enableTeleprompterEditorMode(() => ref.current), []);

  // A fresh array every render would push on every frame of a take, so the
  // dependency is the array's *content*, flattened to a string.
  const marksKey = marks.join(",");
  useEffect(() => {
    pushTeleprompterState({
      videoId,
      capture,
      tab,
      marks: marksKey === "" ? [] : (marksKey.split(",") as ClipMarks),
      latestTranscript,
      videoLengthSeconds,
    });
  }, [videoId, capture, tab, marksKey, latestTranscript, videoLengthSeconds]);
}
