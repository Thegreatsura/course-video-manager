import { useCallback, type MutableRefObject } from "react";
import type { RemoveBlockHandler } from "components/ui/kibo-ui/ai/response";
import {
  mapDocumentPreviewOffsetToSource,
  type DocumentPreviewOptions,
} from "./document-preview-markdown";
import { removeMarkdownBlock } from "./remove-markdown-block";

/**
 * Builds the document preview's per-block remove handler — the X button that
 * appears when hovering a paragraph, heading or list item.
 *
 * It works while the model is writing too: `updateDocument` queues the cut
 * until the turn ends (`document-flow-reducer.ts`).
 */
export function useRemoveDocumentBlock({
  documentRef,
  updateDocument,
  previewOptions,
}: {
  documentRef: MutableRefObject<string | undefined>;
  updateDocument: (content: string) => void;
  /**
   * What the preview rewrote before parsing. The offsets it reports index into
   * the rewritten string, so they need mapping back before they can cut the
   * stored document.
   */
  previewOptions: DocumentPreviewOptions;
}): RemoveBlockHandler {
  const removeBlock = useCallback<RemoveBlockHandler>(
    ({ start, end }) => {
      const currentDoc = documentRef.current;
      if (!currentDoc) return;

      const from = mapDocumentPreviewOffsetToSource(
        currentDoc,
        start,
        previewOptions
      );
      const to = mapDocumentPreviewOffsetToSource(
        currentDoc,
        end,
        previewOptions
      );
      // Either end landing inside a rewritten span means the block overlaps a
      // quiz, which is cut by its own control rather than by this one.
      if (from === undefined || to === undefined) return;

      updateDocument(removeMarkdownBlock(currentDoc, from, to));
    },
    [documentRef, updateDocument, previewOptions]
  );

  return removeBlock;
}
