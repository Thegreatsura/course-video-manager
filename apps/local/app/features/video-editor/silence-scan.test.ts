import { describe, expect, it } from "vitest";
import {
  DEFAULT_SILENCE_THRESHOLD_DB,
  silenceRule,
} from "@/silence-detection-constants";
import { createSilenceScanState, scanForSilence } from "./silence-scan";

/**
 * The browser's silence scan measures as silencedetect (mono=0) does: a
 * per-sample peak on every channel, not ch0's RMS. Real footage agreed to the
 * sample count and within 1 ms per edge (PR description); this pins the rule.
 */
describe("scanForSilence", () => {
  it("is silencedetect's rule: every channel's peak below the noise level for the Silence Length, in blocks", () => {
    const rate = 1000;
    const rule = silenceRule("short", DEFAULT_SILENCE_THRESHOLD_DB); // -38 dB (≈0.0126), 0.8 s
    const seconds = 6;
    const left = new Float32Array(rate * seconds);
    const right = new Float32Array(rate * seconds);
    // 0–1 s: speech whose RMS is below -38 dB but whose peaks are not.
    for (let i = 0; i < rate; i += 50) left[i] = right[i] = 0.05;
    // 1–2 s silent; 2–3 s: only the RIGHT channel speaks.
    for (let i = 2 * rate; i < 3 * rate; i += 50) right[i] = 0.05;
    // 3–6 s silent but for one sample at 4.5 s exactly at the noise level,
    // which is not below it, so it splits the silence.
    left[4.5 * rate] = 10 ** (-38 / 20);

    let state = createSilenceScanState();
    const events = [];
    for (let o = 0; o < left.length; o += 256) {
      const r = scanForSilence(
        state,
        [left.subarray(o, o + 256), right.subarray(o, o + 256)],
        rule,
        rate
      );
      state = r.state;
      events.push(...r.events);
    }

    expect(events).toEqual([
      { type: "silence-started", startSeconds: 0.951, heardAtSeconds: 1.751 },
      { type: "silence-ended", endSeconds: 2 },
      { type: "silence-started", startSeconds: 2.951, heardAtSeconds: 3.751 },
      { type: "silence-ended", endSeconds: 4.5 },
      { type: "silence-started", startSeconds: 4.501, heardAtSeconds: 5.301 },
    ]);
  });
});
