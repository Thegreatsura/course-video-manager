/**
 * The Video's length as it reads on the glass beside the mic: `m:ss`, and
 * `h:mm:ss` once it passes an hour. Seconds are floored, like the editor's own
 * timecodes, so the glass never claims a second the Video doesn't have yet.
 */
export function formatVideoLength(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = String(whole % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}
