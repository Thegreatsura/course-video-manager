import { describe, expect, it } from "vitest";
import {
  ENTITY_LABELS,
  EntityRefParseError,
  deepLinkTarget,
  entityDeepLink,
  lessonPlaceFinder,
  parseEntityRef,
  withLessonPlace,
  resolveEntityId,
  type DeepLinkTargetType,
  type EntityRef,
  type EntityType,
} from "./entity-deep-link";

const ORIGIN = "http://localhost:5173";

const cases: [EntityRef, string][] = [
  [{ type: "course", id: "c1" }, "/courses/c1"],
  [{ type: "section", id: "s1", courseId: "c1" }, "/courses/c1/sections/s1"],
  [
    { type: "lesson", id: "l1", courseId: "c1", sectionId: "s1" },
    "/courses/c1/sections/s1#l1",
  ],
  [{ type: "video", id: "v1" }, "/videos/v1/edit"],
  [{ type: "clip", id: "k1", videoId: "v1" }, "/videos/v1/edit?clip=k1"],
  [
    { type: "chapter", id: "ch1", videoId: "v1" },
    "/videos/v1/edit?chapter=ch1",
  ],
  [{ type: "beat", id: "b1", videoId: "v1" }, "/videos/v1/edit?beat=b1"],
  [
    { type: "clip-mockup", id: "m1", videoId: "v1" },
    "/videos/v1/animatic?clip-mockup=m1",
  ],
  [
    { type: "clip-mockup-chapter", id: "mc1", videoId: "v1" },
    "/videos/v1/animatic?clip-mockup-chapter=mc1",
  ],
  [
    { type: "clip-mockup-comment", id: "cm1", videoId: "v1" },
    "/videos/v1/animatic?clip-mockup-comment=cm1",
  ],
  [
    { type: "thumbnail", id: "t1", videoId: "v1" },
    "/videos/v1/thumbnails?thumbnail=t1",
  ],
  [{ type: "pitch", id: "p1" }, "/pitches/p1"],
  [{ type: "deliverable", id: "d1" }, "/?deliverable=d1"],
  [{ type: "diagram", id: "g1" }, "/diagram-playground/g1"],
];

const inLesson = { courseId: "c1", sectionId: "s1", lessonId: "l1" };
const PLACE = "course=c1&section=s1&lesson=l1";

/** A Video in a Lesson, and everything on its pages: the link names the whole hierarchy. */
const placedCases: [EntityRef, string][] = [
  [{ type: "video", id: "v1", inLesson }, `/videos/v1/edit?${PLACE}`],
  [
    { type: "clip", id: "k1", videoId: "v1", inLesson },
    `/videos/v1/edit?${PLACE}&clip=k1`,
  ],
  [
    { type: "chapter", id: "ch1", videoId: "v1", inLesson },
    `/videos/v1/edit?${PLACE}&chapter=ch1`,
  ],
  [
    { type: "beat", id: "b1", videoId: "v1", inLesson },
    `/videos/v1/edit?${PLACE}&beat=b1`,
  ],
  [
    { type: "clip-mockup", id: "m1", videoId: "v1", inLesson },
    `/videos/v1/animatic?${PLACE}&clip-mockup=m1`,
  ],
  [
    { type: "clip-mockup-chapter", id: "mc1", videoId: "v1", inLesson },
    `/videos/v1/animatic?${PLACE}&clip-mockup-chapter=mc1`,
  ],
  [
    { type: "clip-mockup-comment", id: "cm1", videoId: "v1", inLesson },
    `/videos/v1/animatic?${PLACE}&clip-mockup-comment=cm1`,
  ],
  [
    { type: "thumbnail", id: "t1", videoId: "v1", inLesson },
    `/videos/v1/thumbnails?${PLACE}&thumbnail=t1`,
  ],
];

describe("entityDeepLink", () => {
  it.each(cases)("links %o to its page", (entity, path) => {
    expect(entityDeepLink(entity, ORIGIN)).toBe(`${ORIGIN}${path}`);
  });

  it.each(placedCases)(
    "names the Course, Section and Lesson of %o",
    (entity, path) => {
      expect(entityDeepLink(entity, ORIGIN)).toBe(`${ORIGIN}${path}`);
    }
  );

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

describe("parseEntityRef", () => {
  it("covers every entity type", () => {
    expect(new Set(cases.map(([e]) => e.type))).toEqual(
      new Set(Object.keys(ENTITY_LABELS))
    );
  });

  it.each([...cases, ...placedCases])(
    "reads %o back from its link",
    (entity) => {
      expect(parseEntityRef(entityDeepLink(entity, ORIGIN))).toEqual(entity);
    }
  );

  it("ignores a partial place rather than guessing", () => {
    expect(
      parseEntityRef(`${ORIGIN}/videos/v1/edit?course=c1&clip=k1`)
    ).toEqual({ type: "clip", id: "k1", videoId: "v1" });
  });

  it.each(cases)("reads %o back from its unplaced link", (entity) => {
    expect(parseEntityRef(entityDeepLink(entity, ORIGIN))).toEqual(entity);
  });

  it.each([
    "https://cvm.example.com",
    "http://localhost:5200/",
    "http://192.168.1.4:3000",
  ])("is origin-agnostic (%s)", (origin) => {
    for (const [entity] of cases) {
      expect(parseEntityRef(entityDeepLink(entity, origin))).toEqual(entity);
    }
  });

  it("round-trips ids that need encoding", () => {
    const entity: EntityRef = {
      type: "lesson",
      id: "l#1",
      courseId: "c/1",
      sectionId: "s?1",
    };
    expect(parseEntityRef(entityDeepLink(entity, ORIGIN))).toEqual(entity);
    const clip: EntityRef = { type: "clip", id: "k&1=2", videoId: "v 1" };
    expect(parseEntityRef(entityDeepLink(clip, ORIGIN))).toEqual(clip);
  });

  it("passes a bare id through untyped", () => {
    expect(parseEntityRef(" 6dda48d5-b7c1 ")).toEqual({
      type: "id",
      id: "6dda48d5-b7c1",
    });
  });

  it("accepts a link without a scheme, or just its path", () => {
    expect(parseEntityRef("localhost:5173/pitches/p1")).toEqual({
      type: "pitch",
      id: "p1",
    });
    expect(parseEntityRef("/videos/v1/edit")).toEqual({
      type: "video",
      id: "v1",
    });
  });

  it("reads a Video from any of its tabs", () => {
    expect(parseEntityRef(`${ORIGIN}/videos/v1/post`)).toEqual({
      type: "video",
      id: "v1",
    });
    expect(parseEntityRef(`${ORIGIN}/videos/v1`)).toEqual({
      type: "video",
      id: "v1",
    });
  });

  it.each<[string, EntityRef]>([
    ["course:c1", { type: "course", id: "c1" }],
    ["course:c1/section:s1", { type: "section", id: "s1", courseId: "c1" }],
    [
      "course:c1/section:s1/lesson:l1",
      { type: "lesson", id: "l1", courseId: "c1", sectionId: "s1" },
    ],
    ["course:c1/section:s1/video:v1", { type: "video", id: "v1" }],
    [
      "course:c1/section:s1/video:v1/beat:b1",
      { type: "beat", id: "b1", videoId: "v1" },
    ],
  ])("reads the legacy deep link %s", (input, entity) => {
    expect(parseEntityRef(input)).toEqual(entity);
  });

  it.each([
    `${ORIGIN}/`,
    `${ORIGIN}/shorts`,
    `${ORIGIN}/videos/v1/edit?clip=k1&beat=b1`,
    "",
  ])("rejects %j, which names no single entity", (input) => {
    expect(() => parseEntityRef(input)).toThrow(EntityRefParseError);
  });
});

describe("resolveEntityId", () => {
  const link = (entity: EntityRef) => entityDeepLink(entity, ORIGIN);

  it("returns a bare id as-is, whatever the command wants", () => {
    expect(resolveEntityId("abc", "video")).toBe("abc");
  });

  it.each(cases)("returns the id of a %o link", (entity) => {
    expect(resolveEntityId(link(entity), entity.type)).toBe(entity.id);
  });

  it("accepts any of several wanted types", () => {
    const wanted: EntityType[] = ["clip", "chapter"];
    expect(
      resolveEntityId(
        link({ type: "chapter", id: "ch1", videoId: "v1" }),
        wanted
      )
    ).toBe("ch1");
  });

  it("names both types when the link is for the wrong entity", () => {
    expect(() =>
      resolveEntityId(link({ type: "pitch", id: "p1" }), "video")
    ).toThrow("that's a Pitch link, this command wants a Video");
    expect(() =>
      resolveEntityId(link({ type: "video", id: "v1" }), ["clip", "chapter"])
    ).toThrow("that's a Video link, this command wants a Clip or Chapter");
  });
});

describe("withLessonPlace", () => {
  const find = lessonPlaceFinder("c1", [
    { id: "s1", lessons: [{ id: "l1", videos: [{ id: "v1" }] }] },
  ]);

  it.each(placedCases)("fills in the place of %o", (placed) => {
    const { inLesson: _, ...bare } = placed as EntityRef & {
      inLesson?: unknown;
    };
    expect(withLessonPlace(bare as EntityRef, find)).toEqual(placed);
  });

  it("leaves a standalone Video, and anything not on a Video, alone", () => {
    const standalone: EntityRef = { type: "clip", id: "k9", videoId: "v9" };
    expect(withLessonPlace(standalone, find)).toEqual(standalone);
    const pitch: EntityRef = { type: "pitch", id: "p1" };
    expect(withLessonPlace(pitch, find)).toEqual(pitch);
  });

  it("keeps a place the caller already gave", () => {
    const given: EntityRef = {
      type: "video",
      id: "v1",
      inLesson: { courseId: "c2", sectionId: "s2", lessonId: "l2" },
    };
    expect(withLessonPlace(given, find)).toEqual(given);
  });
});

describe("deepLinkTarget", () => {
  const search = (entity: EntityRef) =>
    new URL(entityDeepLink(entity, ORIGIN)).search;
  const ALL: DeepLinkTargetType[] = [
    "clip",
    "chapter",
    "beat",
    "clip-mockup",
    "clip-mockup-chapter",
    "clip-mockup-comment",
    "thumbnail",
    "deliverable",
  ];
  const childCases = [...cases, ...placedCases].filter(([entity]) =>
    (ALL as string[]).includes(entity.type)
  );

  it.each(childCases)("reads the item %o its page should focus", (entity) => {
    expect(deepLinkTarget(search(entity), ALL)).toEqual({
      type: entity.type,
      id: entity.id,
    });
  });

  it("round-trips an id that needs encoding", () => {
    const entity: EntityRef = { type: "clip", id: "a&b=c", videoId: "v1" };
    expect(deepLinkTarget(search(entity), ["clip"])).toEqual({
      type: "clip",
      id: "a&b=c",
    });
  });

  it("is null for a type this part of the page does not show", () => {
    const beat: EntityRef = { type: "beat", id: "b1", videoId: "v1" };
    expect(deepLinkTarget(search(beat), ["clip", "chapter"])).toBeNull();
  });

  it("is null for a plain Video link, or one naming two items", () => {
    const video: EntityRef = { type: "video", id: "v1", inLesson };
    expect(deepLinkTarget(search(video), ALL)).toBeNull();
    expect(deepLinkTarget("?clip=k1&beat=b1", ALL)).toBeNull();
  });
});
