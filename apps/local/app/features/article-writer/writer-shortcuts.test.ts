import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  writerShortcutFor,
  type WriterShortcutState,
} from "./writer-shortcuts";

const plain = { closest: () => null } as unknown as EventTarget;
const codeMirror = {
  closest: (s: string) => (s === ".cm-editor" ? {} : null),
} as unknown as EventTarget;

const ready: WriterShortcutState = {
  isGenerating: false,
  canFix: true,
  canApply: true,
  bodyIsEmpty: false,
};

function press(
  key: string,
  mods: Partial<KeyboardEvent> = {},
  target: EventTarget = plain
) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    target,
    ...mods,
  } as KeyboardEvent;
}

describe("writerShortcutFor", () => {
  // `isTypingTarget` checks `instanceof`; the unit project has no DOM.
  const g = globalThis as Record<string, unknown>;
  const orig = [g.HTMLInputElement, g.HTMLTextAreaElement];
  beforeAll(() => {
    g.HTMLInputElement = class {};
    g.HTMLTextAreaElement = class {};
  });
  afterAll(() => {
    [g.HTMLInputElement, g.HTMLTextAreaElement] = orig;
  });

  it("F fixes and Ctrl+Enter goes or applies, only outside a text box and only when the button would act", () => {
    const ctrlEnter = press("Enter", { ctrlKey: true });

    expect(writerShortcutFor(press("f"), ready)).toBe("fix");
    expect(writerShortcutFor(ctrlEnter, ready)).toBe("apply");
    expect(writerShortcutFor(press("Enter", { metaKey: true }), ready)).toBe(
      "apply"
    );
    expect(writerShortcutFor(ctrlEnter, { ...ready, bodyIsEmpty: true })).toBe(
      "go"
    );

    // Streaming: Ctrl+Enter does nothing, even on an empty Body.
    expect(
      writerShortcutFor(ctrlEnter, {
        ...ready,
        isGenerating: true,
        bodyIsEmpty: true,
      })
    ).toBeNull();
    // A disabled or hidden button means a dead key.
    expect(
      writerShortcutFor(ctrlEnter, { ...ready, canApply: false })
    ).toBeNull();
    expect(writerShortcutFor(press("f"), { ...ready, canFix: false })).toBe(
      null
    );

    // Inside a text box, a modifier on F, or a held-down key: nothing.
    expect(writerShortcutFor(press("f", {}, codeMirror), ready)).toBeNull();
    expect(
      writerShortcutFor(press("Enter", { ctrlKey: true }, codeMirror), ready)
    ).toBeNull();
    expect(writerShortcutFor(press("f", { ctrlKey: true }), ready)).toBeNull();
    expect(writerShortcutFor(press("f", { repeat: true }), ready)).toBeNull();
    expect(
      writerShortcutFor(press("Enter", { ctrlKey: true, repeat: true }), ready)
    ).toBeNull();
  });
});
