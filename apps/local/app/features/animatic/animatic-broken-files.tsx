import type { AnimaticClipMockup } from "./animatic-timeline";

/**
 * A file the row names is not on disk. A voice that is not `ready` names no
 * file yet — that is the voice's own mark, not a broken file.
 */
export const isFileMissing = (m: AnimaticClipMockup): boolean =>
  m.imageMissing || (m.voiceStatus === "ready" && m.audioMissing);

/**
 * The Clip Mockups that cannot play in full, listed above the rows: a frame or
 * speech file missing from disk, or a voice the Sidecar gave up on. A pending
 * voice is not listed — it is on its way, and its row says so.
 */
export const AnimaticBrokenFiles = (props: {
  mockups: readonly AnimaticClipMockup[];
}) => {
  const broken = props.mockups.filter(
    (m) => isFileMissing(m) || m.voiceStatus === "failed"
  );
  if (broken.length === 0) return null;

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-200">
      <div className="font-semibold">
        {broken.length} Clip Mockup{broken.length === 1 ? "" : "s"} cannot play
        in full
      </div>
      <ul className="mt-1 space-y-0.5">
        {broken.map((m) => (
          <li key={m.id}>
            #{m.position}:{" "}
            {[
              m.imageMissing ? "frame file missing" : null,
              m.voiceStatus === "failed"
                ? `voice failed${m.voiceError ? ` (${m.voiceError})` : ""}`
                : m.audioMissing
                  ? "speech file missing"
                  : null,
            ]
              .filter(Boolean)
              .join(", ")}
          </li>
        ))}
      </ul>
    </div>
  );
};
