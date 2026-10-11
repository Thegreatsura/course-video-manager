import { DEFAULT_SCENE, type Scene } from "./layout-definition";

/** One scene change in a Recording Session, in the session's file time. */
export interface SceneEvent {
  readonly scene: Scene;
  readonly atSeconds: number;
}

/** A stretch of a Clip drawn in one scene, in the session's file time. */
export interface SceneSegment {
  readonly scene: Scene;
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface SceneSegmentsInput {
  readonly events: readonly SceneEvent[];
  readonly clip: { readonly startSeconds: number; readonly endSeconds: number };
  /** The Clip's Scene Override: when set, the whole Clip is drawn in it. */
  readonly override?: Scene | null;
}

/**
 * The scene segments that draw a Clip: one per scene the Recording Session was
 * in during the Clip's time range, or just the Scene Override when it has one.
 */
export const sceneSegments = ({
  events,
  clip,
  override,
}: SceneSegmentsInput): SceneSegment[] => {
  const { startSeconds, endSeconds } = clip;
  if (override) return [{ scene: override, startSeconds, endSeconds }];

  const sorted = [...events].sort((a, b) => a.atSeconds - b.atSeconds);
  let scene = DEFAULT_SCENE;
  for (const e of sorted) if (e.atSeconds <= startSeconds) scene = e.scene;

  const segments: SceneSegment[] = [];
  let from = startSeconds;
  for (const e of sorted) {
    if (e.atSeconds <= startSeconds || e.atSeconds >= endSeconds) continue;
    if (e.scene === scene) continue;
    segments.push({ scene, startSeconds: from, endSeconds: e.atSeconds });
    scene = e.scene;
    from = e.atSeconds;
  }
  segments.push({ scene, startSeconds: from, endSeconds });
  return segments;
};
