/**
 * The transcript of the newest transcribed clip in the current recording
 * session, for the top-right corner of the teleprompter glass
 * (`app/features/teleprompter/latest-transcript.tsx`).
 *
 * The point is reading back a take you just got wrong, so deleted clips count:
 * the take you threw away is usually exactly the one you want to see. A clip
 * still waiting on its transcript is skipped rather than blanking the corner,
 * so the previous take's words stay up until the next take's arrive.
 *
 * Scoped to the newest recording session, like `session-clip-marks.ts`:
 * pressing record wipes the slate.
 */
import { useMemo } from "react";
import type { RecordingSession, TimelineItem } from "./clip-state-reducer";

export function getLatestSessionTranscript(
  items: TimelineItem[],
  sessions: RecordingSession[]
): string | null {
  const currentSessionId = sessions.at(-1)?.id ?? null;
  if (currentSessionId === null) return null;

  let latest: { insertionOrder: number; text: string } | null = null;

  for (const item of items) {
    if (item.type !== "on-database") continue;
    if (item.sessionId !== currentSessionId) continue;
    const text = item.text.trim();
    if (text === "") continue;
    // Paired clips inherit their optimistic clip's insertion order, which is
    // the order they were spoken in — timeline position is not.
    const insertionOrder = item.insertionOrder ?? 0;
    if (latest === null || insertionOrder > latest.insertionOrder) {
      latest = { insertionOrder, text };
    }
  }

  return latest?.text ?? null;
}

export function useLatestSessionTranscript(
  items: TimelineItem[],
  sessions: RecordingSession[]
): string | null {
  return useMemo(
    () => getLatestSessionTranscript(items, sessions),
    [items, sessions]
  );
}
