import { describe, expect, it } from "vitest";
import {
  ESTIMATED_LEAD_SECONDS,
  ESTIMATED_SECONDS_PER_WORD,
  countSpokenWords,
  estimateSpokenSeconds,
} from "./estimate-spoken-seconds.js";

describe("estimateSpokenSeconds", () => {
  it("is a lead-in plus a time per word", () => {
    expect(estimateSpokenSeconds("Here's the problem.")).toBe(
      Math.round(
        (ESTIMATED_LEAD_SECONDS + 3 * ESTIMATED_SECONDS_PER_WORD) * 100
      ) / 100
    );
  });

  it("grows with the words, never shrinks", () => {
    const short = estimateSpokenSeconds("One two.");
    const long = estimateSpokenSeconds("One two three four five six seven.");
    expect(long).toBeGreaterThan(short);
  });

  it("counts words by whitespace, however much of it", () => {
    expect(countSpokenWords("  a\tb \n c  ")).toBe(3);
    expect(estimateSpokenSeconds("a  b")).toBe(estimateSpokenSeconds("a b"));
  });

  it("is 0 for a line with no words", () => {
    expect(estimateSpokenSeconds("   ")).toBe(0);
  });

  // The guess an agent reports as a Lesson's run time: a typical 30-word
  // line is about ten seconds of Kokoro (af_heart), not two and not thirty.
  it("puts a typical line in the right range", () => {
    const line = Array.from({ length: 30 }, () => "word").join(" ");
    expect(estimateSpokenSeconds(line)).toBeGreaterThan(8);
    expect(estimateSpokenSeconds(line)).toBeLessThan(15);
  });
});
