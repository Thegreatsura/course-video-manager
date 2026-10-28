import { describe, expect, it } from "vitest";
import { resolveBeatTab } from "./beat-tab";

describe("resolveBeatTab", () => {
  it("honours a persisted Beats or Reference tab that still exists", () => {
    for (const persistedTab of ["beats", "reference"] as const) {
      expect(
        resolveBeatTab({
          persistedTab,
          hasBeats: true,
          hasReference: true,
          hasAnimatic: true,
        })
      ).toBe(persistedTab);
    }
  });

  it("falls back to script when the persisted tab no longer exists", () => {
    expect(
      resolveBeatTab({
        persistedTab: "reference",
        hasBeats: true,
        hasReference: false,
        hasAnimatic: true,
      })
    ).toBe("script");
    expect(
      resolveBeatTab({
        persistedTab: "beats",
        hasBeats: false,
        hasReference: true,
        hasAnimatic: true,
      })
    ).toBe("script");
  });

  it("defaults to script even when a reference is selected", () => {
    expect(
      resolveBeatTab({
        persistedTab: null,
        hasBeats: true,
        hasReference: true,
        hasAnimatic: true,
      })
    ).toBe("script");
  });

  it("falls back to script when neither beats nor reference is available", () => {
    expect(
      resolveBeatTab({
        persistedTab: null,
        hasBeats: false,
        hasReference: false,
        hasAnimatic: true,
      })
    ).toBe("script");
  });

  it("honours a persisted Animatic tab while the video has Clip Mockups", () => {
    expect(
      resolveBeatTab({
        persistedTab: "animatic",
        hasBeats: true,
        hasReference: false,
        hasAnimatic: true,
      })
    ).toBe("animatic");
  });

  it("falls back to script when the Clip Mockups are gone", () => {
    expect(
      resolveBeatTab({
        persistedTab: "animatic",
        hasBeats: true,
        hasReference: false,
        hasAnimatic: false,
      })
    ).toBe("script");
  });

  it("honours a remembered Suggestions tab on any Video, since it always exists", () => {
    // The choice is one for every Video (#2415): the next Video, with no
    // Beats, Reference or Animatic of its own, still opens on Suggestions.
    expect(
      resolveBeatTab({
        persistedTab: "suggestions",
        hasBeats: false,
        hasReference: false,
        hasAnimatic: false,
      })
    ).toBe("suggestions");
  });
});
