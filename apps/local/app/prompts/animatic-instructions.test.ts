import { describe, it, expect } from "vitest";
import { getAnimaticSection } from "./animatic-instructions";

describe("getAnimaticSection", () => {
  it("returns empty string for no Animatic", () => {
    expect(getAnimaticSection("")).toBe("");
    expect(getAnimaticSection("  \n ")).toBe("");
  });
});
