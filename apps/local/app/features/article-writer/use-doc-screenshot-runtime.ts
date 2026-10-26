import { useCallback, useMemo, useState } from "react";
import { toastError } from "@/components/ui/toast";
import {
  removeChooseScreenshot,
  replaceChooseScreenshotWithImage,
  setChooseScreenshotFace,
  updateChooseScreenshotClipIndex,
  type ScreenshotFace,
} from "./choose-screenshot-mutations";
import type { ChooseScreenshotRuntime } from "./choose-screenshot-components";
import type { IndexedClip } from "./types";
import type { ClipFrame, ScreenCrop } from "@/packages/clip-source";
import { screenshotMemory } from "./screenshot-memory";

/**
 * The document pane's `<ChooseScreenshot>` runtime: capturing a frame from the
 * video and folding it into the working document, re-pointing a placeholder at
 * another clip, or removing it. Each capture is remembered for this session
 * (`screenshot-memory.ts`), so its image can be revived back into the
 * placeholder it came from. `isCapturing` holds sends back while a capture
 * is in flight (see `use-message-queue.ts`).
 */
export function useDocScreenshotRuntime(opts: {
  videoId: string;
  indexedClips: IndexedClip[];
  isGenerating: boolean;
  documentRef: React.RefObject<string | undefined>;
  updateDocument: (content: string) => void;
}) {
  const { videoId, indexedClips, isGenerating, documentRef, updateDocument } =
    opts;
  const [docCapturingKey, setDocCapturingKey] = useState<string | null>(null);

  const handleDocCapture = useCallback(
    async (
      clipIndex: number,
      alt: string,
      frame: ClipFrame,
      placeholder: { face: ScreenshotFace; crop: ScreenCrop | null }
    ) => {
      const key = `doc-${clipIndex}-${alt}`;
      setDocCapturingKey(key);
      try {
        const res = await fetch(`/api/videos/${videoId}/capture-screenshot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(frame),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Failed to capture screenshot");
        }
        const { imagePath } = await res.json();
        screenshotMemory.remember(videoId, imagePath, {
          clipIndex,
          alt,
          ...placeholder,
          time: frame.time,
        });
        const currentDoc = documentRef.current;
        if (currentDoc) {
          updateDocument(
            replaceChooseScreenshotWithImage(
              currentDoc,
              clipIndex,
              alt,
              imagePath
            )
          );
        }
        return true;
      } catch (err) {
        console.error("Screenshot capture failed:", err);
        toastError(err, "Screenshot capture failed");
        return false;
      } finally {
        setDocCapturingKey(null);
      }
    },
    [videoId, documentRef, updateDocument]
  );

  const handleDocClipIndexChange = useCallback(
    (currentIndex: number, newIndex: number, alt: string) => {
      const currentDoc = documentRef.current;
      if (currentDoc) {
        updateDocument(
          updateChooseScreenshotClipIndex(
            currentDoc,
            currentIndex,
            newIndex,
            alt
          )
        );
      }
    },
    [documentRef, updateDocument]
  );

  const handleDocRemove = useCallback(
    (clipIndex: number, alt: string) => {
      const currentDoc = documentRef.current;
      if (currentDoc) {
        updateDocument(removeChooseScreenshot(currentDoc, clipIndex, alt));
      }
    },
    [documentRef, updateDocument]
  );

  const handleDocFaceChange = useCallback(
    (
      clipIndex: number,
      alt: string,
      face: ScreenshotFace,
      crop?: ScreenCrop
    ) => {
      const currentDoc = documentRef.current;
      if (currentDoc) {
        updateDocument(
          setChooseScreenshotFace(currentDoc, clipIndex, alt, face, crop)
        );
      }
    },
    [documentRef, updateDocument]
  );

  const handleDocRevive = useCallback(
    (imagePath: string) => {
      const currentDoc = documentRef.current;
      const revived =
        currentDoc && screenshotMemory.revive(videoId, currentDoc, imagePath);
      if (revived) updateDocument(revived);
    },
    [videoId, documentRef, updateDocument]
  );

  // The document is a single scope, so the message id plays no part in its keys.
  const docScreenshotRuntime = useMemo(
    (): ChooseScreenshotRuntime => ({
      clips: indexedClips,
      isStreaming: isGenerating,
      capturingKey: docCapturingKey,
      keyFor: (clipIndex, alt) => `doc-${clipIndex}-${alt}`,
      onClipIndexChange: (_messageId, current, next, alt) =>
        handleDocClipIndexChange(current, next, alt),
      // The capture toasts its own failure; Return waits on the result.
      onCapture: (_messageId, clipIndex, alt, frame, placeholder) =>
        handleDocCapture(clipIndex, alt, frame, placeholder),
      onRemove: (_messageId, clipIndex, alt) => handleDocRemove(clipIndex, alt),
      onFaceChange: (_messageId, clipIndex, alt, face, crop) =>
        handleDocFaceChange(clipIndex, alt, face, crop),
      revive: {
        canRevive: (imagePath, alt) =>
          screenshotMemory.canRevive(videoId, imagePath, alt),
        revive: handleDocRevive,
        startTime: (clipIndex, alt) =>
          screenshotMemory.startTime(videoId, clipIndex, alt),
      },
    }),
    [
      indexedClips,
      isGenerating,
      docCapturingKey,
      handleDocClipIndexChange,
      handleDocCapture,
      handleDocRemove,
      handleDocFaceChange,
      handleDocRevive,
      videoId,
    ]
  );

  return { docScreenshotRuntime, isCapturing: docCapturingKey !== null };
}
