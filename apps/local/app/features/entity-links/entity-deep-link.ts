/**
 * A reference to one entity the app renders, carrying exactly the ids its
 * page needs. `id` is always the entity's own id — the value "Copy ID" puts
 * on the clipboard and the one `cvm` takes as its positional `<id>`.
 */
export type EntityRef =
  | { type: "course"; id: string }
  | { type: "section"; id: string; courseId: string }
  | { type: "lesson"; id: string; courseId: string; sectionId: string }
  | { type: "video"; id: string }
  | { type: "clip"; id: string; videoId: string }
  | { type: "chapter"; id: string; videoId: string }
  | { type: "beat"; id: string; videoId: string }
  | { type: "clip-mockup"; id: string; videoId: string }
  | { type: "clip-mockup-chapter"; id: string; videoId: string }
  | { type: "clip-mockup-comment"; id: string; videoId: string }
  | { type: "thumbnail"; id: string; videoId: string }
  | { type: "pitch"; id: string }
  | { type: "deliverable"; id: string }
  | { type: "diagram"; id: string };

export type EntityType = EntityRef["type"];

/** The entity's name in GLOSSARY.md's words, for menu toasts. */
export const ENTITY_LABELS: Record<EntityType, string> = {
  course: "Course",
  section: "Section",
  lesson: "Lesson",
  video: "Video",
  clip: "Clip",
  chapter: "Chapter",
  beat: "Beat",
  "clip-mockup": "Clip Mockup",
  "clip-mockup-chapter": "Clip Mockup Chapter",
  "clip-mockup-comment": "Clip Mockup Comment",
  thumbnail: "Thumbnail",
  pitch: "Pitch",
  deliverable: "Deliverable",
  diagram: "Diagram",
};

const enc = encodeURIComponent;

/**
 * The query param that names a child entity on the page of the Video (or, for
 * a Deliverable, the calendar) that renders it. The page path alone only
 * identifies the parent, so the param is what makes the link point at the
 * exact entity — and what `parseEntityRef` reads back.
 */
const CHILD_PARAM = {
  clip: "clip",
  chapter: "chapter",
  beat: "beat",
  "clip-mockup": "clip-mockup",
  "clip-mockup-chapter": "clip-mockup-chapter",
  "clip-mockup-comment": "clip-mockup-comment",
  thumbnail: "thumbnail",
  deliverable: "deliverable",
} as const satisfies Partial<Record<EntityType, string>>;

type ChildType = keyof typeof CHILD_PARAM;

const childQuery = (type: ChildType, id: string) =>
  `?${CHILD_PARAM[type]}=${enc(id)}`;

/**
 * The app path that shows `entity`: its own page where it has one, otherwise
 * the nearest page that renders it, with the entity's id in a query param
 * (see CHILD_PARAM). A Lesson has no page of its own, so it links to its
 * Section's page with the Lesson's anchor in the hash, which that page
 * scrolls into view.
 */
function entityPath(entity: EntityRef): string {
  switch (entity.type) {
    case "course":
      return `/courses/${enc(entity.id)}`;
    case "section":
      return `/courses/${enc(entity.courseId)}/sections/${enc(entity.id)}`;
    case "lesson":
      return `/courses/${enc(entity.courseId)}/sections/${enc(entity.sectionId)}#${enc(entity.id)}`;
    case "video":
      return `/videos/${enc(entity.id)}/edit`;
    case "clip":
    case "chapter":
    case "beat":
      return `/videos/${enc(entity.videoId)}/edit${childQuery(entity.type, entity.id)}`;
    case "clip-mockup":
    case "clip-mockup-chapter":
    case "clip-mockup-comment":
      return `/videos/${enc(entity.videoId)}/animatic${childQuery(entity.type, entity.id)}`;
    case "thumbnail":
      return `/videos/${enc(entity.videoId)}/thumbnails${childQuery(entity.type, entity.id)}`;
    case "pitch":
      return `/pitches/${enc(entity.id)}`;
    case "deliverable":
      // The Deliverables calendar is the home page; it has no per-Deliverable view.
      return `/${childQuery(entity.type, entity.id)}`;
    case "diagram":
      return `/diagram-playground/${enc(entity.id)}`;
  }
}

/**
 * The full app URL for `entity` — the one place in the app that builds a
 * deep link. Pasted into a browser it opens the entity's page on `origin`.
 */
export function entityDeepLink(entity: EntityRef, origin: string): string {
  return `${origin.replace(/\/+$/, "")}${entityPath(entity)}`;
}

// ---------------------------------------------------------------------------
// Parsing: the inverse of entityDeepLink
// ---------------------------------------------------------------------------

/** A bare id: it names one entity but does not say which type. */
export type BareIdRef = { type: "id"; id: string };

/** What a pasted CVM link or id resolves to. */
export type ParsedEntityRef = EntityRef | BareIdRef;

/** The input looked like a link but no CVM entity could be read from it. */
export class EntityRefParseError extends Error {
  override name = "EntityRefParseError";
}

const dec = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/**
 * The legacy "Copy Deep Link" string the app put on the clipboard before it
 * copied URLs: `course:C/section:S[/lesson:L | /video:V[/beat:B]]`. It always
 * names its deepest entity.
 */
function parseLegacy(input: string): EntityRef | null {
  if (!/^course:/.test(input)) return null;
  const parts: Record<string, string> = {};
  for (const segment of input.split("/")) {
    const at = segment.indexOf(":");
    if (at <= 0) return null;
    parts[segment.slice(0, at)] = segment.slice(at + 1);
  }
  const { course, section, lesson, video, beat } = parts;
  if (!course) return null;
  if (beat && video) return { type: "beat", id: beat, videoId: video };
  if (video) return { type: "video", id: video };
  if (lesson && section)
    return { type: "lesson", id: lesson, courseId: course, sectionId: section };
  if (section) return { type: "section", id: section, courseId: course };
  return { type: "course", id: course };
}

function parseUrl(raw: string, input: string): EntityRef {
  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
        ? raw
        : raw.startsWith("/")
          ? `http://cvm${raw}`
          : `http://${raw}`
    );
  } catch {
    throw new EntityRefParseError(`"${input}" is not a CVM link or id`);
  }
  const segments = url.pathname.split("/").filter(Boolean).map(dec);
  const hash = dec(url.hash.replace(/^#/, ""));
  const childOf = (types: ChildType[]) => {
    const found = types.flatMap((type) => {
      const id = url.searchParams.get(CHILD_PARAM[type]);
      return id ? [{ type, id }] : [];
    });
    if (found.length > 1) {
      throw new EntityRefParseError(
        `"${input}" names more than one entity (${found
          .map((f) => ENTITY_LABELS[f.type])
          .join(", ")})`
      );
    }
    return found[0];
  };

  const [head, first, second, third] = segments;

  if (head === "courses" && first) {
    if (second === "sections" && third) {
      return hash
        ? { type: "lesson", id: hash, courseId: first, sectionId: third }
        : { type: "section", id: third, courseId: first };
    }
    return { type: "course", id: first };
  }
  if (head === "videos" && first) {
    const child = childOf([
      "clip",
      "chapter",
      "beat",
      "clip-mockup",
      "clip-mockup-chapter",
      "clip-mockup-comment",
      "thumbnail",
    ]);
    return child
      ? ({ type: child.type, id: child.id, videoId: first } as EntityRef)
      : { type: "video", id: first };
  }
  if (head === "pitches" && first) return { type: "pitch", id: first };
  if (head === "diagram-playground" && first)
    return { type: "diagram", id: first };
  if (segments.length === 0) {
    const child = childOf(["deliverable"]);
    if (child) return { type: "deliverable", id: child.id };
    throw new EntityRefParseError(
      `"${input}" is the Deliverables calendar, not a single entity`
    );
  }
  throw new EntityRefParseError(`"${input}" is not a link to a CVM entity`);
}

/**
 * Read back whatever Matt pasted: a bare id, any URL `entityDeepLink` builds
 * (on any origin — localhost or deployed — and any Video tab), or the legacy
 * `course:…/section:…/video:…` string. The inverse of `entityDeepLink`:
 * `parseEntityRef(entityDeepLink(e, origin))` deep-equals `e`.
 *
 * Throws EntityRefParseError when the input is a link but names no entity.
 */
export function parseEntityRef(input: string): ParsedEntityRef {
  const raw = input.trim();
  if (raw === "") throw new EntityRefParseError("expected an id or CVM link");
  const legacy = parseLegacy(raw);
  if (legacy) return legacy;
  // An id never contains a slash; anything that does is a link.
  if (!raw.includes("/")) return { type: "id", id: raw };
  return parseUrl(raw, input);
}

/** "a Video", "an Animatic"… for error messages. */
const withArticle = (label: string) =>
  `${/^[AEIOU]/.test(label) ? "an" : "a"} ${label}`;

/**
 * Resolve a pasted link or id to the id of an entity of one of `expected`
 * types. A bare id passes through untouched; a link of any other type throws
 * EntityRefParseError naming both types, e.g. "that's a Pitch link, this
 * command wants a Video".
 */
export function resolveEntityId(
  input: string,
  expected: EntityType | ReadonlyArray<EntityType>
): string {
  const ref = parseEntityRef(input);
  if (ref.type === "id") return ref.id;
  const wanted: ReadonlyArray<EntityType> =
    typeof expected === "string" ? [expected] : expected;
  if (wanted.includes(ref.type)) return ref.id;
  throw new EntityRefParseError(
    `that's ${withArticle(ENTITY_LABELS[ref.type])} link, this command wants ${withArticle(
      wanted.map((t) => ENTITY_LABELS[t]).join(" or ")
    )}`
  );
}
