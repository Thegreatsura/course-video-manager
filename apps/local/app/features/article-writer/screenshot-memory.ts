import type { ScreenCrop } from "@/packages/clip-source";
import {
  writeChooseScreenshotTag,
  type ScreenshotFace,
} from "./choose-screenshot-mutations";

/**
 * What a `<ChooseScreenshot>` held when its screenshot was captured: the
 * Clip, the frame (a source time), the face and, with Custom, the crop.
 */
export interface ChosenScreenshot {
  readonly clipIndex: number;
  readonly alt: string;
  readonly face: ScreenshotFace;
  readonly crop?: ScreenCrop | null;
  readonly time: number;
}

/**
 * The screenshots captured in this tab, remembered so each can be revived:
 * its image turned back into the placeholder it came from, with everything
 * that placeholder held. Memory only: a reload forgets them, and an image
 * it does not remember cannot be revived.
 *
 * An image is known by its Video and its path (`./screenshot-N.png`): each
 * capture writes the Video's next free file, so the pair is unique.
 */
export interface ScreenshotMemory {
  remember(videoId: string, imagePath: string, chosen: ChosenScreenshot): void;
  /** Whether `imagePath` in this Video, shown with `alt`, can be revived. */
  canRevive(videoId: string, imagePath: string, alt: string): boolean;
  /**
   * `document` with the image put back as its placeholder, or null when the
   * image is not remembered or is no longer in the document. The revived
   * placeholder then opens on the remembered frame (`startTime`).
   */
  revive(videoId: string, document: string, imagePath: string): string | null;
  /** The frame a revived placeholder opens on, if it is one. */
  startTime(
    videoId: string,
    clipIndex: number,
    alt: string
  ): number | undefined;
}

export function createScreenshotMemory(): ScreenshotMemory {
  const chosen = new Map<string, ChosenScreenshot>();
  const starts = new Map<string, number>();
  const imageKey = (videoId: string, imagePath: string) =>
    JSON.stringify([videoId, imagePath]);
  const placeholderKey = (videoId: string, clipIndex: number, alt: string) =>
    JSON.stringify([videoId, clipIndex, alt]);

  return {
    remember(videoId, imagePath, shot) {
      chosen.set(imageKey(videoId, imagePath), shot);
    },
    canRevive(videoId, imagePath, alt) {
      return chosen.get(imageKey(videoId, imagePath))?.alt === alt;
    },
    revive(videoId, document, imagePath) {
      const shot = chosen.get(imageKey(videoId, imagePath));
      if (!shot) return null;
      const image = `![${shot.alt}](${imagePath})`;
      const at = document.indexOf(image);
      if (at === -1) return null;
      starts.set(placeholderKey(videoId, shot.clipIndex, shot.alt), shot.time);
      const tag = writeChooseScreenshotTag(
        shot.clipIndex,
        shot.alt,
        shot.face,
        shot.crop
      );
      return document.slice(0, at) + tag + document.slice(at + image.length);
    },
    startTime(videoId, clipIndex, alt) {
      return starts.get(placeholderKey(videoId, clipIndex, alt));
    },
  };
}

/** This tab's memory: every writer in it shares one. */
export const screenshotMemory = createScreenshotMemory();
