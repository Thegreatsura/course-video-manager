import type { MotionPoint } from "./match";

/**
 * A CAMERA'S MOTION, as ffmpeg reads it: each frame scaled to 320x180 grey,
 * differenced with the one before (`tblend`) and averaged (`signalstats`
 * YAVG), printed by `metadata=print`. One chain, run by the offline pass
 * over the camera file and by an AV Calibration's capture as it records, so
 * the live clap marks and the result read the same motion.
 */
export const MOTION_FILTERS = [
  "scale=320:180",
  "format=gray",
  "tblend=all_mode=difference",
  "signalstats",
] as const;

/** The key `metadata=print` prints a frame's motion under. */
export const MOTION_KEY = "lavfi.signalstats.YAVG";

/**
 * Reads `metadata=print`'s lines, one at a time: `frame:N pts:P pts_time:T`,
 * then `key=value`. To stdout (`file=-`) they are bare; to the log each has
 * the filter's `[Parsed_metadata_N @ …] [info]` in front. Answers a frame's
 * motion on its value's line.
 */
export const motionLineReader = () => {
  let seconds: number | undefined;
  return (line: string): MotionPoint | undefined => {
    const time = line.match(/\bpts_time:\s*(-?[\d.]+)/);
    if (time) {
      seconds = Number(time[1]);
      return undefined;
    }
    const yavg = line.match(/\blavfi\.signalstats\.YAVG=(-?[\d.]+)/);
    if (!yavg || seconds === undefined) return undefined;
    const point = { seconds, level: Number(yavg[1]) };
    seconds = undefined;
    return point;
  };
};

/** Every frame's motion in `metadata=print`'s output. */
export const parseMotion = (output: string): MotionPoint[] => {
  const read = motionLineReader();
  return output
    .split(/\r?\n/)
    .map(read)
    .filter((p): p is MotionPoint => p !== undefined);
};
