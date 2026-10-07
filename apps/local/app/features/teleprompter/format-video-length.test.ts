import { describe, expect, it } from "vitest";
import { formatVideoLength } from "./format-video-length";

describe("formatVideoLength", () => {
  it("reads as m:ss under an hour", () => {
    expect(formatVideoLength(0)).toBe("0:00");
    expect(formatVideoLength(65)).toBe("1:05");
    expect(formatVideoLength(59 * 60 + 59)).toBe("59:59");
  });

  it("switches to h:mm:ss at an hour", () => {
    expect(formatVideoLength(3600)).toBe("1:00:00");
    expect(formatVideoLength(3600 + 5 * 60 + 9)).toBe("1:05:09");
  });

  it("floors fractional seconds rather than rounding up", () => {
    expect(formatVideoLength(59.9)).toBe("0:59");
    expect(formatVideoLength(3599.99)).toBe("59:59");
  });
});
