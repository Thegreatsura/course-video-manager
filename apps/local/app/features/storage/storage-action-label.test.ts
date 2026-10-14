import { describe, expect, it } from "vitest";
import { storageActionLabel } from "./storage-action";

const labelOf = (location: string) => (location === "/mnt/e" ? "E:" : "D:");

describe("storageActionLabel for a move (#2166)", () => {
  it("does not say Footage twice for Unused Footage", () => {
    expect(
      storageActionLabel(
        {
          type: "move",
          bucket: {
            id: "unused-footage",
            kind: "unused-footage",
            name: "Unused Footage",
          },
          kind: "footage",
          target: "/mnt/e",
          paths: null,
        },
        labelOf
      )
    ).toBe("Move Unused Footage to E:");
  });

  it("names a course bucket's Footage", () => {
    expect(
      storageActionLabel(
        {
          type: "move",
          bucket: { id: "course:1", kind: "course", name: "Crash Course" },
          kind: "footage",
          target: "/mnt/e",
          paths: null,
        },
        labelOf
      )
    ).toBe("Move Crash Course Footage to E:");
  });
});
