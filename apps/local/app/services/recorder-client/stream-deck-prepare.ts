import type { RecorderCommand } from "recorder-service/protocol";
import type {
  SilenceLength,
  SilenceThreshold,
} from "@/silence-detection-constants";

/**
 * What a Stream Deck Record on the open Video records with, as the recorder
 * client (`client.server.ts`) tells the recorder service: the Video's editor's
 * Silence Length, the recordings folder, and the silence threshold and its
 * Audio Calibration, read when the recorder is prepared. Sent again whenever
 * the Video or its Silence Length changes, the connection is new, or an Audio
 * Calibration is stored (`forget`, then `prepare`).
 */
export const streamDeckPreparation = (o: {
  send: (command: RecorderCommand) => void;
  silenceThreshold: () => Promise<SilenceThreshold>;
  folder: string;
}) => {
  /** Per Video: its editor's Silence Length. */
  const silenceLengths = new Map<string, SilenceLength>();
  /** The Video and Silence Length the recorder was last prepared with. */
  let prepared: string | undefined;
  /** Bumped whenever `prepared` is let go, so a slow threshold read is dropped. */
  let attempts = 0;

  const forget = () => {
    prepared = undefined;
    attempts++;
  };

  /** Prepares the recorder open for `videoId` (none: it is closed or unreachable). */
  const prepare = (videoId: string | undefined) => {
    if (!videoId) return forget();
    const silenceLength = silenceLengths.get(videoId);
    const key = `${videoId}:${silenceLength}`;
    if (!silenceLength || prepared === key) return;
    prepared = key;
    const attempt = ++attempts;
    void o
      .silenceThreshold()
      .then((threshold) => {
        if (attempt !== attempts) return;
        o.send({
          type: "prepare-record",
          videoId,
          silenceLength,
          folder: o.folder,
          ...threshold,
        });
      })
      .catch((error: unknown) => {
        if (attempt === attempts) prepared = undefined;
        console.error(
          "recorder client: could not read the silence threshold",
          error
        );
      });
  };

  return {
    prepare,
    forget,
    setSilenceLength: (videoId: string, silenceLength: SilenceLength) =>
      void silenceLengths.set(videoId, silenceLength),
    release: (videoId: string) => void silenceLengths.delete(videoId),
  };
};
