import { useCallback, useMemo, useState } from "react";
import { toastError } from "@/components/ui/toast";
import {
  removeChooseScreenshot,
  replaceChooseScreenshotWithImage,
  updateChooseScreenshotClipIndex,
} from "./choose-screenshot-mutations";
import type { ChooseScreenshotRuntime } from "./choose-screenshot-components";
import type { IndexedClip } from "./types";

/**
 * The document pane's `<ChooseScreenshot>` runtime: capturing a frame from the
 * video and folding it into the working document, re-pointing a placeholder at
 * another clip, or removing it. `isCapturing` holds sends back while a capture
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
      timestamp: number,
      videoFilename: string
    ) => {
      const key = `doc-${clipIndex}-${alt}`;
      setDocCapturingKey(key);
      try {
        const res = await fetch(`/api/videos/${videoId}/capture-screenshot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timestamp, videoFilename }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Failed to capture screenshot");
        }
        const { imagePath } = await res.json();
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
      onCapture: (_messageId, clipIndex, alt, timestamp, videoFilename) =>
        handleDocCapture(clipIndex, alt, timestamp, videoFilename),
      onRemove: (_messageId, clipIndex, alt) => handleDocRemove(clipIndex, alt),
    }),
    [
      indexedClips,
      isGenerating,
      docCapturingKey,
      handleDocClipIndexChange,
      handleDocCapture,
      handleDocRemove,
    ]
  );

  return { docScreenshotRuntime, isCapturing: docCapturingKey !== null };
}
