import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryAutosaver,
  MEMORY_AUTOSAVE_DEBOUNCE_MS,
} from "./memory-autosaver";

describe("createMemoryAutosaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (initial = "loaded") => {
    const saved: string[] = [];
    const saver = createMemoryAutosaver({
      initial,
      save: (m) => saved.push(m),
    });
    return { saved, saver };
  };

  it("does not save when mounted with the loaded value", () => {
    const { saved, saver } = setup();
    saver.update("loaded");
    vi.advanceTimersByTime(MEMORY_AUTOSAVE_DEBOUNCE_MS * 2);
    expect(saved).toEqual([]);
  });

  it("saves an edit once after the debounce", () => {
    const { saved, saver } = setup();
    saver.update("e");
    saver.update("ed");
    saver.update("edited");
    vi.advanceTimersByTime(MEMORY_AUTOSAVE_DEBOUNCE_MS * 2);
    expect(saved).toEqual(["edited"]);
  });

  it("does not save when the edit is reverted to the saved value", () => {
    const { saved, saver } = setup();
    saver.update("edited");
    saver.update("loaded");
    vi.advanceTimersByTime(MEMORY_AUTOSAVE_DEBOUNCE_MS * 2);
    expect(saved).toEqual([]);
  });

  it("does not re-save a value already saved", () => {
    const { saved, saver } = setup();
    saver.update("edited");
    vi.advanceTimersByTime(MEMORY_AUTOSAVE_DEBOUNCE_MS);
    saver.update("edited");
    vi.advanceTimersByTime(MEMORY_AUTOSAVE_DEBOUNCE_MS);
    expect(saved).toEqual(["edited"]);
  });
});
