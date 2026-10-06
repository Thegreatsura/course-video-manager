import { describe, expect, it } from "vitest";
import { effectiveAuthoringStatus, isTodoLesson } from "./authoring-status.js";

describe("effectiveAuthoringStatus", () => {
  it("reads null as done", () => {
    expect(effectiveAuthoringStatus(null)).toBe("done");
    expect(isTodoLesson({ authoringStatus: null })).toBe(false);
  });
  it("keeps todo and done", () => {
    expect(effectiveAuthoringStatus("todo")).toBe("todo");
    expect(effectiveAuthoringStatus("done")).toBe("done");
    expect(isTodoLesson({ authoringStatus: "todo" })).toBe(true);
  });
});
