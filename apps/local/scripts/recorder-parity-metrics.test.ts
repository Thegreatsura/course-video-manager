import { describe, expect, it } from "vitest";
import {
  compareSides,
  parseBlurMean,
  parseIntegratedLufs,
  parseLumaLevels,
  parseProbe,
  parseRmsLevel,
  type SideMetrics,
} from "./recorder-parity-metrics";

/** Trimmed from real ffmpeg 7 output on a Recording Session's Footage. */
const PICTURE_LOG = `
[Parsed_metadata_2 @ 0x5937d8b5a7c0] frame:0    pts:0       pts_time:0
[Parsed_metadata_2 @ 0x5937d8b5a7c0] lavfi.blur=8.1
[Parsed_metadata_2 @ 0x5937d8b5a7c0] lavfi.signalstats.YMIN=13
[Parsed_metadata_2 @ 0x5937d8b5a7c0] lavfi.signalstats.YLOW=20
[Parsed_metadata_2 @ 0x5937d8b5a7c0] lavfi.signalstats.YAVG=64.5
[Parsed_metadata_2 @ 0x5937d8b5a7c0] lavfi.signalstats.YMAX=240
[Parsed_metadata_2 @ 0x5937d8b5a7c0] frame:1    pts:256     pts_time:0.0166667
[Parsed_metadata_2 @ 0x5937d8b5a7c0] lavfi.signalstats.YMIN=15
[Parsed_metadata_2 @ 0x5937d8b5a7c0] lavfi.signalstats.YAVG=65.5
[Parsed_metadata_2 @ 0x5937d8b5a7c0] lavfi.signalstats.YMAX=238
[out#0/null @ 0x5937d81815c0] video:14kB audio:0kB subtitle:0kB
[Parsed_blurdetect_0 @ 0x5937d82b1840] blur mean: 8.4665759
`;

const LOUDNESS_LOG = `
[Parsed_ebur128_0 @ 0x5f23b2c2e5c0] Summary:

  Integrated loudness:
    I:         -37.8 LUFS
    Threshold: -47.8 LUFS

  Loudness range:
    LRA:         0.0 LU
`;

const ASTATS_LOG = `
[Parsed_astats_2 @ 0x58cbe1655140] Overall
[Parsed_astats_2 @ 0x58cbe1655140] RMS level dB: -59.317619
`;

describe("recorder parity metrics", () => {
  it("reads signalstats, blurdetect, ebur128, astats and ffprobe output", () => {
    expect(parseLumaLevels(PICTURE_LOG)).toEqual({
      ymin: 14,
      ymax: 239,
      yavg: 65,
    });
    expect(parseBlurMean(PICTURE_LOG)).toBeCloseTo(8.4666, 3);
    expect(parseIntegratedLufs(LOUDNESS_LOG)).toBe(-37.8);
    expect(parseRmsLevel(ASTATS_LOG)).toBeCloseTo(-59.32, 2);
    expect(
      parseRmsLevel("[Parsed_astats_2 @ 0x1] Overall\nRMS level dB: -inf")
    ).toBe(-Infinity);
    expect(
      parseProbe(
        JSON.stringify({
          streams: [
            {
              codec_type: "video",
              width: 1080,
              height: 1920,
              r_frame_rate: "60/1",
              pix_fmt: "yuv420p",
              color_range: "tv",
              color_space: "bt709",
              color_primaries: "bt709",
              color_transfer: "bt709",
              duration: "2.683333",
            },
            { codec_type: "audio", duration: "2.666667" },
          ],
        })
      )
    ).toEqual({
      picture: {
        width: 1080,
        height: 1920,
        fps: "60/1",
        pixFmt: "yuv420p",
        colorRange: "tv",
        colorSpace: "bt709",
        colorPrimaries: "bt709",
        colorTransfer: "bt709",
      },
      avDurationSkewMs: 17,
    });
    expect(() => parseIntegratedLufs("no summary")).toThrow(
      /integrated loudness/
    );

    // The verdict reads those numbers against the thresholds.
    const side: SideMetrics = {
      picture: parseProbe(
        JSON.stringify({
          streams: [{ codec_type: "video", width: 1080, height: 1920 }],
        })
      ).picture,
      levels: parseLumaLevels(PICTURE_LOG),
      blurMean: parseBlurMean(PICTURE_LOG),
      lufs: -19.9,
      bands: { lowDb: -20, midDb: -30, highDb: -48 },
      avDurationSkewMs: 0,
    };
    const checks = compareSides({
      obs: side,
      cvm: { ...side, lufs: -37.8 },
      cvmRawMicBands: { lowDb: -20, midDb: -30, highDb: -44 },
      micEq: { lowDb: 0, midDb: 0, highDb: -6.1 },
    });
    expect(checks.filter((c) => !c.pass).map((c) => c.name)).toEqual([
      "integrated loudness (LUFS)",
      "Mic EQ high band applied (dB, export − raw mic)",
    ]);
  });
});
