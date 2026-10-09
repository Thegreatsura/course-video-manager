import { describe, expect, it } from "vitest";
import {
  CLIP_MOCKUP_VOICE_JOB_KIND,
  CLIP_MOCKUP_VOICE_STATUSES,
} from "@cvm/core/features/clip-mockups/voice-status";
import { estimateSpokenSeconds } from "@cvm/core/features/clip-mockups/estimate-spoken-seconds";
import { JOB_KIND_SPECS } from "../../../sidecar/job-specs";
import { ADD_HELP, HELP, LIST_HELP, UPDATE_HELP } from "./clip-mockup.help";
import { withVoiceDuration } from "./clip-mockup.voice";

// ===========================================================================
// The help is what an authoring agent learns `cvm clip-mockup` from. These
// tests hold it to the code on the one thing that changed under it: the
// voice is made in the background, so the help must never again promise that
// `add` waits for it, or teach a field or status the rows do not carry.
// ===========================================================================

const VOICE_FIELDS = ["voiceStatus", "voiceError", "durationEstimated"];

describe("cvm clip-mockup --help on the voice", () => {
  it("names the Job kind the Sidecar really runs", () => {
    expect(Object.keys(JOB_KIND_SPECS)).toContain(CLIP_MOCKUP_VOICE_JOB_KIND);
    for (const help of [HELP, ADD_HELP]) {
      expect(help).toContain(`'${CLIP_MOCKUP_VOICE_JOB_KIND}'`);
    }
  });

  it("teaches every voice status, and no other", () => {
    for (const status of CLIP_MOCKUP_VOICE_STATUSES) {
      expect(HELP).toContain(`"${status}"`);
    }
    const taught = [...HELP.matchAll(/voiceStatus\s+"(\w+)"/g)].map(
      (m) => m[1]
    );
    for (const status of taught) {
      expect(CLIP_MOCKUP_VOICE_STATUSES).toContain(status);
    }
  });

  it("documents exactly the voice fields a printed row carries", () => {
    const printed = withVoiceDuration({
      line: "Two words.",
      durationSeconds: null,
      voiceStatus: "pending",
      voiceError: null,
    });
    for (const field of VOICE_FIELDS) {
      expect(Object.keys(printed)).toContain(field);
      expect(HELP).toContain(field);
      expect(ADD_HELP).toContain(field);
    }
    expect(LIST_HELP).toContain("durationEstimated");
    expect(UPDATE_HELP).toContain("voiceStatus");
    // The guess it documents is the shared one.
    expect(printed.durationSeconds).toBe(estimateSpokenSeconds("Two words."));
  });

  it("never says a write waits for, or fails on, the voice", () => {
    for (const help of [HELP, ADD_HELP, UPDATE_HELP]) {
      expect(help).not.toContain("SpeechSynthesisError");
      expect(help).not.toContain("RE-SYNTHESISED");
      expect(help).toMatch(/AT ONCE|in the background|BACKGROUND/);
    }
    expect(ADD_HELP).not.toMatch(/speech failure/i);
  });

  it("tells an agent how to re-queue a failed voice", () => {
    expect(HELP).toMatch(/failed voice is retried by 'update'/i);
    expect(UPDATE_HELP).toMatch(/FAILED[\s\S]*queued again/);
  });
});
