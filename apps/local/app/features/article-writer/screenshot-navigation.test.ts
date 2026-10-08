import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isScreenshotCapturePress,
  pickCurrentScreenshot,
  pickScreenshotTarget,
  screenshotNavDirection,
  screenshotStep,
  type PlaceholderSpan,
} from "./screenshot-navigation";

class FakeHTMLInputElement {}
class FakeHTMLTextAreaElement {}

const plain = { closest: () => null };

function press(
  key: string,
  overrides: Partial<{
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    target: unknown;
  }> = {}
) {
  return screenshotNavDirection({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: plain as unknown as EventTarget,
    ...overrides,
  } as KeyboardEvent);
}

describe("screenshotNavDirection", () => {
  const origInput = globalThis.HTMLInputElement;
  const origTextarea = globalThis.HTMLTextAreaElement;

  beforeAll(() => {
    (globalThis as any).HTMLInputElement = FakeHTMLInputElement;
    (globalThis as any).HTMLTextAreaElement = FakeHTMLTextAreaElement;
  });

  afterAll(() => {
    (globalThis as any).HTMLInputElement = origInput;
    (globalThis as any).HTMLTextAreaElement = origTextarea;
  });

  it("walks down on L and up on K", () => {
    expect([press("l"), press("k")]).toEqual([1, -1]);
  });

  it("ignores other keys", () => {
    expect(press("j")).toBeNull();
  });

  it.each(["ctrlKey", "metaKey", "altKey", "shiftKey"] as const)(
    "ignores the key while %s is held",
    (modifier) => {
      expect(press("l", { [modifier]: true })).toBeNull();
    }
  );

  it("still acts when focus is on a button, e.g. a placeholder's Capture", () => {
    const button = { tagName: "BUTTON", closest: () => null };
    expect(press("l", { target: button })).toBe(1);
  });

  it.each([
    ["an input", () => new FakeHTMLInputElement()],
    ["a textarea", () => new FakeHTMLTextAreaElement()],
    [
      "a contenteditable",
      () => ({ isContentEditable: true, closest: () => null }),
    ],
    [
      "the Monaco markdown editor",
      () => ({ closest: (s: string) => (s === ".monaco-editor" ? {} : null) }),
    ],
    [
      "a CodeMirror editor",
      () => ({ closest: (s: string) => (s === ".cm-editor" ? {} : null) }),
    ],
  ])("lets the key type normally in %s", (_name, makeTarget) => {
    expect(press("l", { target: makeTarget() })).toBeNull();
  });
});

describe("pickScreenshotTarget", () => {
  // Three placeholders in a 1000px-tall scroll box, scrolled to the top.
  const spans: PlaceholderSpan[] = [
    { top: 100, bottom: 300 },
    { top: 900, bottom: 1100 },
    { top: 1700, bottom: 1900 },
  ];
  const viewportHeight = 1000;

  it("goes to the first placeholder below the viewport centre", () => {
    expect(
      pickScreenshotTarget({
        spans,
        viewportHeight,
        lastVisited: null,
        direction: 1,
      })
    ).toBe(1);
  });

  it("goes to the last placeholder above the viewport centre", () => {
    expect(
      pickScreenshotTarget({
        spans,
        viewportHeight,
        lastVisited: null,
        direction: -1,
      })
    ).toBe(0);
  });

  it("treats a centred placeholder as the current one, not the next", () => {
    const centred = spans.map((s) => ({
      top: s.top - 500,
      bottom: s.bottom - 500,
    }));
    // Placeholder 1 now spans 400–600: centred on 500.
    expect([
      pickScreenshotTarget({
        spans: centred,
        viewportHeight,
        lastVisited: null,
        direction: 1,
      }),
      pickScreenshotTarget({
        spans: centred,
        viewportHeight,
        lastVisited: null,
        direction: -1,
      }),
    ]).toEqual([2, 0]);
  });

  it("steps from the last visited placeholder while it is still on screen", () => {
    // The last placeholder could not be centred (end of the document), so it
    // sits below centre — K must still go back one, not stay put.
    const atBottom: PlaceholderSpan[] = [
      { top: -900, bottom: -700 },
      { top: -100, bottom: 100 },
      { top: 700, bottom: 900 },
    ];
    expect(
      pickScreenshotTarget({
        spans: atBottom,
        viewportHeight,
        lastVisited: 2,
        direction: -1,
      })
    ).toBe(1);
  });

  it("re-anchors on the viewport once the last visited one is scrolled away", () => {
    // Author scrolled back to the top after visiting placeholder 2.
    expect(
      pickScreenshotTarget({
        spans,
        viewportHeight,
        lastVisited: 2,
        direction: 1,
      })
    ).toBe(1);
  });

  it("stops at the last placeholder rather than wrapping", () => {
    const atBottom = spans.map((s) => ({
      top: s.top - 1300,
      bottom: s.bottom - 1300,
    }));
    expect([
      pickScreenshotTarget({
        spans: atBottom,
        viewportHeight,
        lastVisited: 2,
        direction: 1,
      }),
      pickScreenshotTarget({
        spans: atBottom,
        viewportHeight,
        lastVisited: null,
        direction: 1,
      }),
    ]).toEqual([null, null]);
  });

  it("stops at the first placeholder rather than wrapping", () => {
    expect(
      pickScreenshotTarget({
        spans,
        viewportHeight,
        lastVisited: 0,
        direction: -1,
      })
    ).toBeNull();
  });

  it("has nowhere to go when there are no placeholders", () => {
    expect(
      pickScreenshotTarget({
        spans: [],
        viewportHeight,
        lastVisited: null,
        direction: 1,
      })
    ).toBeNull();
  });
});

describe("pickCurrentScreenshot", () => {
  const spans: PlaceholderSpan[] = [
    { top: -300, bottom: -100 },
    { top: 100, bottom: 300 },
    { top: 400, bottom: 600 },
  ];

  it("prefers the last visited placeholder, else the on-screen one nearest centre", () => {
    expect([
      pickCurrentScreenshot({ spans, viewportHeight: 1000, lastVisited: 1 }),
      pickCurrentScreenshot({ spans, viewportHeight: 1000, lastVisited: 0 }),
      pickCurrentScreenshot({
        spans: [],
        viewportHeight: 1000,
        lastVisited: null,
      }),
    ]).toEqual([1, 2, null]);
  });
});

describe("screenshotStep and isScreenshotCapturePress", () => {
  const origInput = globalThis.HTMLInputElement;
  const origTextarea = globalThis.HTMLTextAreaElement;
  beforeAll(() => {
    (globalThis as any).HTMLInputElement = FakeHTMLInputElement;
    (globalThis as any).HTMLTextAreaElement = FakeHTMLTextAreaElement;
  });
  afterAll(() => {
    (globalThis as any).HTMLInputElement = origInput;
    (globalThis as any).HTMLTextAreaElement = origTextarea;
  });

  const event = (key: string, target: unknown = plain, repeat = false) =>
    ({
      key,
      repeat,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      target,
    }) as unknown as KeyboardEvent;

  it("I / O take the large step, the arrows the small one, never while typing", () => {
    expect([
      screenshotStep(event("o")),
      screenshotStep(event("ArrowLeft")),
      screenshotStep(event("ArrowRight", new FakeHTMLInputElement())),
    ]).toEqual([
      { direction: 1, size: "large" },
      { direction: -1, size: "small" },
      null,
    ]);
  });

  it("captures on Return, but not while typing, on a repeat, or on a control outside the preview", () => {
    const inPreview = { closest: () => null };
    const applyButton = {
      closest: (s: string) => (s.includes("button") ? {} : null),
    };
    const preview = { contains: (n: unknown) => n === inPreview };
    expect([
      isScreenshotCapturePress(event("Enter"), preview),
      isScreenshotCapturePress(event("Enter", inPreview), preview),
      isScreenshotCapturePress(
        event("Enter", new FakeHTMLTextAreaElement()),
        preview
      ),
      isScreenshotCapturePress(event("Enter", plain, true), preview),
      isScreenshotCapturePress(event("Enter", applyButton), preview),
    ]).toEqual([true, true, false, false, false]);
  });
});
