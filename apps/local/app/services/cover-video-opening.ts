import type { AutofillChapterProposal } from "@/services/text-generation-service";

/** The title of the Chapter added when the model left the opening uncovered. */
export const OPENING_FALLBACK_TITLE = "Intro";

/**
 * Guarantees a proposed Chapter set opens the Video. A Chapter is anchored
 * BEFORE the Clip it names and runs until the next one, so the only Clips a
 * set can leave uncovered are those ahead of its earliest Chapter — and a
 * Video with no Chapter before its first Clip raises **Missing Chapters**.
 *
 * When no proposal names the first Clip (by `order`), an "Intro" Chapter is
 * prepended there. A set that already opens on it is returned unchanged.
 */
export const coverVideoOpening = (
  proposals: readonly AutofillChapterProposal[],
  clips: ReadonlyArray<{ readonly id: string; readonly order: string }>
): AutofillChapterProposal[] => {
  const firstClip = clips.reduce<(typeof clips)[number] | undefined>(
    (earliest, clip) =>
      earliest === undefined || clip.order < earliest.order ? clip : earliest,
    undefined
  );
  if (!firstClip) return [...proposals];
  if (proposals.some((p) => p.beforeClipId === firstClip.id)) {
    return [...proposals];
  }
  return [
    { beforeClipId: firstClip.id, title: OPENING_FALLBACK_TITLE },
    ...proposals,
  ];
};
