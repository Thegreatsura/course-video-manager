import { describe, expect, it } from "vitest";
import { storageMoveSubject, storageMoveTitle } from "../client";

describe("storage move titles (#2166)", () => {
  it("names a course bucket's Footage", () => {
    expect(storageMoveTitle("AI Coding Crash Course", "footage", "E:")).toBe(
      "Move AI Coding Crash Course Footage to E:"
    );
  });

  it("does not say Footage twice for Unused Footage", () => {
    expect(storageMoveTitle("Unused Footage", "footage", "E:")).toBe(
      "Move Unused Footage to E:"
    );
    expect(storageMoveSubject("Unused Footage", "footage")).toBe(
      "Unused Footage"
    );
  });

  it("names Exported Videos and Clip Mockups once", () => {
    expect(storageMoveTitle("Crash Course", "exported-videos", "D:")).toBe(
      "Move Crash Course Exported Videos to D:"
    );
    expect(storageMoveTitle("Clip Mockups", "clip-mockups", "D:")).toBe(
      "Move Clip Mockups to D:"
    );
  });

  it("names the files of a per-file move", () => {
    expect(
      storageMoveTitle("Unused Footage", "footage", "E:", ["raw-footage/a.mkv"])
    ).toBe("Move a.mkv to E:");
  });
});
