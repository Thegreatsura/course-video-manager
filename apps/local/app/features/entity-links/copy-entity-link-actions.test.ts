import { describe, expect, it } from "vitest";
import { copyEntityLinkActions } from "./copy-entity-link-actions";

describe("copyEntityLinkActions", () => {
  it("offers only Copy Link, never a raw Copy ID", () => {
    expect(
      copyEntityLinkActions({ type: "course", id: "c1" }).map((a) => a.label)
    ).toEqual(["Copy Link"]);
  });

  it("offers Copy Link disabled while the entity is still being saved", () => {
    expect(
      copyEntityLinkActions(null).map((a) => [a.label, a.disabled])
    ).toEqual([["Copy Link", true]]);
  });
});
