import { describe, expect, it } from "vitest";
import { formatDuration } from "./format-duration";

describe("formatDuration", () => {
  it("reads as m:ss under an hour", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(7)).toBe("0:07");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(59 * 60 + 59)).toBe("59:59");
  });

  it("switches to h:mm:ss at exactly an hour", () => {
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(61 * 60 + 18)).toBe("1:01:18");
  });

  it("keeps a two-digit hours field unpadded at ten hours", () => {
    expect(formatDuration(10 * 3600)).toBe("10:00:00");
    expect(formatDuration(10 * 3600 - 1)).toBe("9:59:59");
  });

  it("floors fractional seconds rather than rounding up", () => {
    expect(formatDuration(59.9)).toBe("0:59");
    expect(formatDuration(3599.99)).toBe("59:59");
  });

  it("clamps negative input to zero", () => {
    expect(formatDuration(-5)).toBe("0:00");
  });
});
