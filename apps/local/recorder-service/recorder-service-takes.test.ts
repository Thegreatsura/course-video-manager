import path from "node:path";
import { describe, expect, it } from "vitest";
import { readLog, recordOnce } from "./test-utils/service-harness";

/**
 * The recorder service alone decides that speech is a Take
 * (speech-detector.ts), by the rule its Clip is cut with
 * (`isLongEnoughForClip`), on the mic file's own clock.
 */
describe("a Take", () => {
  it("starts a Take only for speech provably as long as the minimum Clip length: once the file passes its start + that + the Silence Length unsilenced", async () => {
    // Silence Length long: 2 s.
    const { windows, client, started } = await recordOnce();
    const camera = windows.recorder("camera");
    const at = (seconds: number) =>
      camera.stdout(
        `frame=${Math.round(seconds * 30)}\nout_time_us=${Math.round(seconds * 1e6)}\nprogress=continue\n`
      );
    const line = (text: string) =>
      camera.stderr(`[silencedetect @ 1] ${text}\r\n`);
    line("silence_start: -0.0001");
    line("silence_end: 3 | silence_duration: 3");
    at(5.95);
    // Speaking from 3 s: a Take at 3 + 1 + 2, not before.
    at(6);
    line("silence_start: 8");
    // A 0.5 s "um": its silence is reported at 12.5, before 13.
    line("silence_end: 10 | silence_duration: 2");
    at(12.45);
    line("silence_start: 10.5");
    at(13.5);
    // 1.2 s of speech whose silence is heard before the file time that
    // would start it reaches the detector: a Take at its end.
    line("silence_end: 14 | silence_duration: 3.5");
    line("silence_start: 15.2");
    client.send({ type: "stop" });
    await client.next("recording-stopped");

    const speech = readLog(
      path.join(path.dirname(started.files.mic), "events.jsonl")
    )
      .filter((e) => e.type.startsWith("speech-") || e.type === "take-started")
      .map((e) => [e.type, "fileTime" in e ? e.fileTime : null]);
    expect(speech).toEqual([
      ["speech-started", 3],
      ["take-started", 6],
      ["speech-ended", 8],
      ["speech-started", 10],
      ["speech-ended", 10.5],
      ["speech-started", 14],
      ["take-started", 15.2],
      ["speech-ended", 15.2],
    ]);
  });
});
