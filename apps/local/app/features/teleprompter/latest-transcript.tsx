/**
 * The transcript of the clip you just recorded, top right of the glass.
 *
 * For reading back a take you got wrong: the words that actually came out,
 * next to the words you meant to say. The editor picks the clip (see
 * `session-latest-transcript.ts`) — the newest transcribed one in this
 * recording session, deleted ones included — and this only draws it.
 *
 * Small and dim, for the same reason the controls are: anything bright on the
 * glass is something you read around for the whole take. Clamped so a long
 * clip can't creep down over the script.
 */
import { TYPE } from "./teleprompter-settings";

export function LatestTranscript(props: { text: string | null }) {
  if (!props.text) return null;

  return (
    <div
      className="pointer-events-none absolute right-4 top-4 z-40 w-80 select-none rounded-lg border border-white/10 bg-neutral-950/80 px-3 py-2"
      aria-label="Latest clip transcript"
    >
      <p
        className="line-clamp-6 text-sm leading-snug text-white/60"
        style={{ fontFamily: TYPE.fontFamily }}
      >
        {props.text}
      </p>
    </div>
  );
}
