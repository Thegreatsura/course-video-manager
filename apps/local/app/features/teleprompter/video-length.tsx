/**
 * How long the Video runs so far, just right of the mic, top left of the glass.
 *
 * For a sense of the video's scope while filming. The editor works the number
 * out — the same live-Clip total it shows under its player — and this only
 * draws it. Tiny and dim on purpose, a secondary element: it is glanced at
 * between takes, never read during one — but light enough to read on the black
 * glass at a glance. Positioned against the capture indicator (`left-4`,
 * `size-14`, so its right edge is at 72px) with a 24px gap so it sits beside
 * the mic without crowding it, and above the session marks, which start at
 * `top-20`.
 */
import { formatDuration } from "@/lib/format-duration";

export function VideoLength(props: { seconds: number | null }) {
  if (props.seconds === null) return null;

  return (
    <div
      className="pointer-events-none absolute left-24 top-4 z-40 flex h-14 select-none items-center font-mono text-xs tabular-nums text-white/50"
      aria-label="Video length"
    >
      {formatDuration(props.seconds)}
    </div>
  );
}
