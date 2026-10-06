import { describe, it, expect } from "vitest";
import { getBeatsSection } from "./beats-instructions";

describe("getBeatsSection", () => {
  it("returns empty string for whitespace-only beats", () => {
    expect(getBeatsSection("  \n ")).toBe("");
  });
});
