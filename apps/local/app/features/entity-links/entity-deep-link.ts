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

/** The entity's name in CONTEXT.md's words, for menu toasts. */
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
 * The app path that shows `entity`: its own page where it has one, otherwise
 * the nearest page that renders it. A Lesson has no page of its own, so it
 * links to its Section's page with the Lesson's anchor in the hash, which that
 * page scrolls into view.
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
      return `/videos/${enc(entity.videoId)}/edit`;
    case "clip-mockup":
    case "clip-mockup-chapter":
    case "clip-mockup-comment":
      return `/videos/${enc(entity.videoId)}/animatic`;
    case "thumbnail":
      return `/videos/${enc(entity.videoId)}/thumbnails`;
    case "pitch":
      return `/pitches/${enc(entity.id)}`;
    case "deliverable":
      // The Deliverables calendar is the home page; it has no per-Deliverable view.
      return `/`;
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
