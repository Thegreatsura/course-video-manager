import { describe, expect, it } from "vitest";
import { copyEntityLinkActions } from "./copy-entity-link-items";

describe("copyEntityLinkActions", () => {
  it("offers Copy Link and Copy ID disabled while the entity is still being saved", () => {
    expect(
      copyEntityLinkActions(null).map((a) => [a.label, a.disabled])
    ).toEqual([
      ["Copy Link", true],
      ["Copy ID", true],
    ]);
  });
});
