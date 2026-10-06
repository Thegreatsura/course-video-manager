import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getFieldMessagesStorageKey,
  loadFieldMessages,
  saveFieldMessages,
  constrainModes,
  defaultModeForRole,
  FIELD_MODES,
} from "./writer-engine-utils";

function createMockLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (_index: number) => null,
  } satisfies Storage;
}

describe("conversation keying by (videoId, fieldId, mode)", () => {
  it("generates distinct message keys for different modes on the same field", () => {
    const k1 = getFieldMessagesStorageKey("v1", "ai-hero-body", "article");
    const k2 = getFieldMessagesStorageKey("v1", "ai-hero-body", "article-plan");
    expect(k1).not.toBe(k2);
  });

  it("generates distinct message keys for different videos on the same field", () => {
    const k1 = getFieldMessagesStorageKey("v1", "ai-hero-body", "article");
    const k2 = getFieldMessagesStorageKey("v2", "ai-hero-body", "article");
    expect(k1).not.toBe(k2);
  });
});

describe("field messages localStorage persistence", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads empty array when nothing stored", () => {
    const msgs = loadFieldMessages("v1", "ai-hero-body", "article");
    expect(msgs).toEqual([]);
  });

  it("round-trips messages through save and load", () => {
    const messages = [{ role: "user", text: "hello" }];
    saveFieldMessages("v1", "ai-hero-body", "article", messages);
    const loaded = loadFieldMessages("v1", "ai-hero-body", "article");
    expect(loaded).toEqual(messages);
  });

  it("does not bleed between fields", () => {
    saveFieldMessages("v1", "ai-hero-body", "article", [{ id: 1 }]);
    saveFieldMessages("v1", "skills-changelog-body", "article", [{ id: 2 }]);
    expect(loadFieldMessages("v1", "ai-hero-body", "article")).toEqual([
      { id: 1 },
    ]);
    expect(loadFieldMessages("v1", "skills-changelog-body", "article")).toEqual(
      [{ id: 2 }]
    );
  });
});

describe("constrainModes", () => {
  it("returns the current mode if it is in the allowed list", () => {
    const result = constrainModes(["article", "article-plan"], "article");
    expect(result).toEqual({ mode: "article", isConstrained: true });
  });

  it("falls back to the first allowed mode if current is not allowed", () => {
    const result = constrainModes(["article", "article-plan"], "newsletter");
    expect(result).toEqual({ mode: "article", isConstrained: true });
  });

  it("returns current mode unconstrained when modes list is empty", () => {
    const result = constrainModes([], "newsletter");
    expect(result).toEqual({ mode: "newsletter", isConstrained: false });
  });
});

describe("FIELD_MODES", () => {
  it("only includes document modes", () => {
    const documentModes = [
      "article",
      "article-plan",
      "newsletter",
      "skill-building",
      "seo-description-document",
    ];
    for (const fieldModes of Object.values(FIELD_MODES)) {
      for (const mode of fieldModes) {
        expect(documentModes).toContain(mode);
      }
    }
  });
});

describe("defaultModeForRole", () => {
  it("opens a Problem video on skill-building", () => {
    expect(defaultModeForRole("problem")).toBe("skill-building");
  });

  it("opens a Solution video on article", () => {
    expect(defaultModeForRole("solution")).toBe("article");
  });

  it("opens everything else on article", () => {
    expect(defaultModeForRole("explainer")).toBe("article");
    expect(defaultModeForRole("unknown")).toBe("article");
    expect(defaultModeForRole(undefined)).toBe("article");
  });

  it("falls back to the field's first mode when skill-building isn't offered", () => {
    expect(
      constrainModes(["article", "article-plan"], defaultModeForRole("problem"))
        .mode
    ).toBe("article");
  });

  it("lands a Problem on skill-building in the lesson body modes", () => {
    expect(
      constrainModes(
        ["article", "skill-building"],
        defaultModeForRole("problem")
      ).mode
    ).toBe("skill-building");
  });
});
