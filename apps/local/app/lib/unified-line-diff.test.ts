import { describe, expect, it } from "vitest";
import { unifiedLineDiff } from "./unified-line-diff";

describe("unifiedLineDiff", () => {
  it("marks every line in the first column, keeping the unchanged ones as context", () => {
    expect(
      unifiedLineDiff(
        ["Client", "Server", "Database"],
        ["Client", "API Gateway", "Server", "Cache"]
      )
    ).toBe(
      [" Client", "+API Gateway", " Server", "-Database", "+Cache"].join("\n")
    );
  });
});
