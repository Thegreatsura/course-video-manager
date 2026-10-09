import { describe, expect, it } from "vitest";
import { whisperAudioPath } from "./whisper-transcription-service";

describe("whisperAudioPath", () => {
  it("gives two calls for the same range their own file", () => {
    // Two Jobs for the same Clip at once: one's ffmpeg -y must not overwrite
    // the mp3 the other is uploading, nor its cleanup delete it.
    const range = { startTime: 10, duration: 5 };
    const first = whisperAudioPath("/tmp/whisper-audio", "a.mp4", range);
    const second = whisperAudioPath("/tmp/whisper-audio", "a.mp4", range);

    expect(first).not.toBe(second);
    expect(first.startsWith("/tmp/whisper-audio/")).toBe(true);
    expect(first.endsWith(".mp3")).toBe(true);
  });
});
