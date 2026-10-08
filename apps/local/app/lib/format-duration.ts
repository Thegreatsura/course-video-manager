/**
 * The one way a duration reads on screen: `m:ss`, and `h:mm:ss` once it
 * reaches an hour — a Video's length, a timecode, an Animatic's run time, a
 * YouTube chapter. Seconds are floored, so a label never claims a second the
 * media doesn't have yet.
 *
 * `scripts/check-duration-format.sh` fails hand-rolled `m:ss` formatting
 * anywhere else, so every duration grows its hours field the same way.
 */
export function formatDuration(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = String(whole % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}
