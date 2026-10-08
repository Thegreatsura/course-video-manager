/**
 * How long the Video runs so far, just right of the mic, top left of the glass.
 *
 * For a sense of the video's scope while filming. The editor works the number
 * out — the same live-Clip total it shows under its player — and this only
 * draws it. Tiny and nearly invisible on purpose: it is glanced at between
 * takes, never read during one. Positioned against the capture indicator
 * (`left-4`, `size-14`) so it sits beside the mic without moving it, and above
 * the session marks, which start at `top-20`.
 */
import { formatDuration } from "@/lib/format-duration";

export function VideoLength(props: { seconds: number | null }) {
  if (props.seconds === null) return null;

  return (
    <div
      className="pointer-events-none absolute left-20 top-4 z-40 flex h-14 select-none items-center font-mono text-xs tabular-nums text-white/30"
      aria-label="Video length"
    >
      {formatDuration(props.seconds)}
    </div>
  );
}
