/**
 * Turns the camera+mic process's silencedetect lines into speech starting and
 * ending, in mic file time. The one silence detector (#1993, Q3): speech is
 * what lies between a silence's end and the next silence's start, the rule
 * `getClipsOfSpeakingFromFFmpeg` applies to OBS recordings.
 *
 * Every Recording Session opens in silence (the mic's first 1.5 s are padded
 * with it, capture-args.ts), so its first speech is a `silence_end`.
 */
export type Speech = {
  type: "speech-started" | "speech-ended";
  fileTime: number;
};

const LINE = /\[silencedetect @[^\]]*\].*?silence_(start|end):\s*(-?[\d.]+)/;

export const createSpeechDetector = () => {
  let speaking = false;
  let stopping = false;
  return {
    /**
     * From here on no new speech starts: ffmpeg ends a file that closes in
     * silence with one last `silence_end`, which is not speech.
     */
    stopRequested() {
      stopping = true;
    },
    /** The speech change one stderr line reports, if any. */
    line(line: string): Speech | undefined {
      const m = line.match(LINE);
      if (!m) return undefined;
      // A file that opens in silence reports silence_start: -0.0001.
      const fileTime = Math.max(0, Number(m[2]));
      if (m[1] === "end" && !speaking && !stopping) {
        speaking = true;
        return { type: "speech-started", fileTime };
      }
      if (m[1] === "start" && speaking) {
        speaking = false;
        return { type: "speech-ended", fileTime };
      }
      return undefined;
    },
    /**
     * Speech still going when the recording stopped ends where the file
     * does, so the last take is not lost for want of a silence after it.
     */
    stop(fileTime: number): Speech | undefined {
      if (!speaking) return undefined;
      speaking = false;
      return { type: "speech-ended", fileTime };
    },
  };
};
