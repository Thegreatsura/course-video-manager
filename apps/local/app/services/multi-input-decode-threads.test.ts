import { describe, expect, it } from "vitest";
import { buildAnimaticEncodeArgs } from "./animatic-encode-args";
import { buildClipConcatArgs } from "./clip-concat-args";

/**
 * Every input of a many-input encode is decoded on two threads (#2424). The
 * concat reads one Clip at a time, but ffmpeg starts every input's decoder up
 * front, each with `nproc + 1` frame threads and their buffers: 104 Clips
 * peaked at 10.65 GB, and two side by side ran the machine out of memory.
 * On two threads each, 4.04 GB, as fast, byte-identical output.
 */
const inputsOpenedOnTwoThreads = (args: readonly string[]) => {
  const inputs = args.flatMap((arg, i) => (arg === "-i" ? [i] : []));
  return {
    inputs: inputs.length,
    onTwoThreads: inputs.filter((i) => {
      // Input options sit between the previous input and this `-i`.
      const from = args.lastIndexOf("-i", i - 1) + 1;
      const opts = args.slice(from, i);
      const at = opts.lastIndexOf("-threads");
      return at !== -1 && opts[at + 1] === "2";
    }).length,
  };
};

describe("many-input encodes decode each input on two threads", () => {
  it("the concat of a Video's Clips (export and Shorts)", () => {
    const { args } = buildClipConcatArgs({
      clips: [
        {
          inputVideo: "/footage/a.mkv",
          startTime: 1,
          duration: 5,
          pauseType: "none",
        },
        {
          inputVideo: "/footage/a.mkv",
          startTime: 9,
          duration: 4,
          pauseType: "long",
        },
        {
          inputVideo: "/footage/b.mkv",
          startTime: 0,
          duration: 3,
          pauseType: "none",
          zoomType: "zoom-1",
        },
      ],
      dimensions: { width: 1920, height: 1080 },
      outputFile: "/tmp/out.mp4",
    });
    expect(inputsOpenedOnTwoThreads(args)).toEqual({
      inputs: 3,
      onTwoThreads: 3,
    });
  });

  it("the Animatic, a frame and a voice per Clip Mockup", () => {
    const args = buildAnimaticEncodeArgs({
      segments: [1, 2].map((n) => ({
        imageFile: `/mockups/${n}.png`,
        audioFile: `/mockups/${n}.wav`,
        speechStartSeconds: 0.1,
        durationInFrames: 60,
      })),
      dimensions: { width: 1920, height: 1080 },
      outputFile: "/tmp/animatic.mp4",
    });
    expect(inputsOpenedOnTwoThreads(args)).toEqual({
      inputs: 4,
      onTwoThreads: 4,
    });
  });
});
