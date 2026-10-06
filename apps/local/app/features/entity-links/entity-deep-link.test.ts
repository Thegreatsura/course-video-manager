import { describe, expect, it } from "vitest";
import { entityDeepLink, type EntityRef } from "./entity-deep-link";

const ORIGIN = "http://localhost:5173";

const cases: [EntityRef, string][] = [
  [{ type: "course", id: "c1" }, "/courses/c1"],
  [{ type: "section", id: "s1", courseId: "c1" }, "/courses/c1/sections/s1"],
  [
    { type: "lesson", id: "l1", courseId: "c1", sectionId: "s1" },
    "/courses/c1/sections/s1#l1",
  ],
  [{ type: "video", id: "v1" }, "/videos/v1/edit"],
  [{ type: "clip", id: "k1", videoId: "v1" }, "/videos/v1/edit"],
  [{ type: "chapter", id: "ch1", videoId: "v1" }, "/videos/v1/edit"],
  [{ type: "beat", id: "b1", videoId: "v1" }, "/videos/v1/edit"],
  [{ type: "clip-mockup", id: "m1", videoId: "v1" }, "/videos/v1/animatic"],
  [
    { type: "clip-mockup-chapter", id: "mc1", videoId: "v1" },
    "/videos/v1/animatic",
  ],
  [
    { type: "clip-mockup-comment", id: "cm1", videoId: "v1" },
    "/videos/v1/animatic",
  ],
  [{ type: "thumbnail", id: "t1", videoId: "v1" }, "/videos/v1/thumbnails"],
  [{ type: "pitch", id: "p1" }, "/pitches/p1"],
  [{ type: "deliverable", id: "d1" }, "/"],
  [{ type: "diagram", id: "g1" }, "/diagram-playground/g1"],
];

describe("entityDeepLink", () => {
  it.each(cases)("links %o to its page", (entity, path) => {
    expect(entityDeepLink(entity, ORIGIN)).toBe(`${ORIGIN}${path}`);
  });

  it("does not double the slash when the origin ends in one", () => {
    expect(entityDeepLink({ type: "course", id: "c1" }, `${ORIGIN}/`)).toBe(
      `${ORIGIN}/courses/c1`
    );
  });

  it("encodes ids so an odd id cannot change the route", () => {
    expect(entityDeepLink({ type: "pitch", id: "a/b#c" }, ORIGIN)).toBe(
      `${ORIGIN}/pitches/a%2Fb%23c`
    );
  });
});
