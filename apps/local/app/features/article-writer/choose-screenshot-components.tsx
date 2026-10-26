"use client";

import { createContext, useCallback, useContext } from "react";
import { History } from "lucide-react";
import {
  PreviewImageActionsContext,
  type PreviewImageActions,
} from "components/ui/kibo-ui/ai/response";
import { Button } from "@/components/ui/button";
import type { HTMLAttributes, ReactNode } from "react";
import type { Options } from "react-markdown";
import { ChooseScreenshot } from "./choose-screenshot";
import type { IndexedClip } from "./types";
import type { ClipFrame, ScreenCrop } from "@/packages/clip-source";
import {
  parseScreenshotCrop,
  parseScreenshotFace,
  type ScreenshotFace,
} from "./choose-screenshot-mutations";

/**
 * Everything a rendered `<ChooseScreenshot>` placeholder needs. It travels by
 * context rather than by closure so the component map below can stay frozen —
 * see {@link CHOOSE_SCREENSHOT_COMPONENTS} for why that matters.
 */
export interface ChooseScreenshotRuntime {
  clips: IndexedClip[];
  /** True while the writer is still producing text; placeholders wait. */
  isStreaming: boolean;
  /** Identifies the one placeholder whose capture is in flight, if any. */
  capturingKey: string | null;
  /**
   * Builds the key compared against `capturingKey`. The chat scopes keys by
   * message id; the document has one scope and ignores it.
   */
  keyFor: (clipIndex: number, alt: string, messageId: string) => string;
  onClipIndexChange: (
    messageId: string,
    currentIndex: number,
    newIndex: number,
    alt: string
  ) => void;
  onCapture: (
    messageId: string,
    clipIndex: number,
    alt: string,
    frame: ClipFrame,
    /** The placeholder's saved face and crop, as they were captured. */
    placeholder: { face: ScreenshotFace; crop: ScreenCrop | null }
  ) => Promise<boolean>;
  onRemove: (messageId: string, clipIndex: number, alt: string) => void;
  /** A face chosen (with Custom, its crop): saved on the placeholder's tag. */
  onFaceChange: (
    messageId: string,
    clipIndex: number,
    alt: string,
    face: ScreenshotFace,
    crop?: ScreenCrop
  ) => void;
  /**
   * Revive: a screenshot captured this session turned back into its
   * placeholder. Only the document has it; the chat's images get no button.
   */
  revive?: ScreenshotRevive;
}

export interface ScreenshotRevive {
  /** Whether this image, written with this alt, was captured this session. */
  canRevive: (imagePath: string, alt: string) => boolean;
  revive: (imagePath: string) => void;
  /** The frame a revived placeholder opens on. */
  startTime: (clipIndex: number, alt: string) => number | undefined;
}

const RuntimeContext = createContext<ChooseScreenshotRuntime | null>(null);

/** Wrap whatever renders the markdown; without it placeholders render nothing. */
export function ChooseScreenshotProvider({
  runtime,
  children,
}: {
  runtime: ChooseScreenshotRuntime;
  children: ReactNode;
}) {
  const revive = runtime.isStreaming ? undefined : runtime.revive;
  const imageActions = useCallback<PreviewImageActions>(
    ({ src, alt }) =>
      revive?.canRevive(src, alt) ? (
        <Button
          size="sm"
          variant="secondary"
          className="h-6 px-2 text-xs shadow-sm"
          title="Turn back into Choose Screenshot, as it was when captured"
          onClick={() => revive.revive(src)}
        >
          <History className="size-3" />
          Revive
        </Button>
      ) : null,
    [revive]
  );
  return (
    <RuntimeContext.Provider value={runtime}>
      <PreviewImageActionsContext.Provider value={revive ? imageActions : null}>
        {children}
      </PreviewImageActionsContext.Provider>
    </RuntimeContext.Provider>
  );
}

function ChooseScreenshotSlot(
  props: HTMLAttributes<HTMLElement> & Record<string, unknown>
) {
  const runtime = useContext(RuntimeContext);
  if (!runtime) return null;

  const clipIndex = parseInt(props.clipindex as string, 10);
  const alt = (props.alt as string) ?? "";
  const messageId = (props["data-message-id"] as string) ?? "";
  const face = parseScreenshotFace(props.face);
  const crop = parseScreenshotCrop(props.crop);

  return (
    <ChooseScreenshot
      clipIndex={clipIndex}
      alt={alt}
      clips={runtime.clips}
      onClipIndexChange={(current, next) =>
        runtime.onClipIndexChange(messageId, current, next, alt)
      }
      onCapture={(ci, a, frame) =>
        runtime.onCapture(messageId, ci, a, frame, { face, crop })
      }
      startTime={runtime.revive?.startTime(clipIndex, alt)}
      onRemove={(ci, a) => runtime.onRemove(messageId, ci, a)}
      face={face}
      crop={crop}
      onFaceChange={(next, nextCrop) =>
        runtime.onFaceChange(messageId, clipIndex, alt, next, nextCrop)
      }
      isCapturing={
        runtime.capturingKey === runtime.keyFor(clipIndex, alt, messageId)
      }
      isStreaming={runtime.isStreaming}
    />
  );
}

/**
 * The tag → component map handed to `AIResponse`. A module constant, and it
 * must stay one.
 *
 * react-markdown uses the mapped value as the React element *type*
 * (`hast-util-to-jsx-runtime`), so handing it a fresh arrow function is not a
 * re-render — React unmounts every rendered placeholder and mounts a new one,
 * throwing away each `<video>` and the button under the user's cursor. Building
 * this map inside a `useMemo` keyed on capture state did exactly that, twice
 * per capture (once when the spinner went on, once when it came off).
 *
 * Everything that changes reaches the placeholder through
 * {@link ChooseScreenshotProvider} instead. Context updates propagate through
 * `AIResponse`'s `memo`, so the spinner still appears without the map moving.
 */
export const CHOOSE_SCREENSHOT_COMPONENTS = {
  choosescreenshot: ChooseScreenshotSlot as unknown,
} as Options["components"];
