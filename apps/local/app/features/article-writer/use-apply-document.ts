"use client";

import { useCallback, type RefObject } from "react";
import { toast } from "@/components/ui/toast";
import { useImageUploadJob } from "@/features/image-upload/use-image-upload-job";
import { hasUnresolvedScreenshots } from "./choose-screenshot-mutations";

/**
 * Apply: the document's local images go to Cloudinary as an `upload-images`
 * Job, then the URLs are swapped into the document as it is when the Job
 * settles — edits made while it ran survive — and the result is applied.
 * Local files are removed only once their URLs are in the document.
 */
export function useApplyDocument(
  videoId: string,
  documentRef: RefObject<string | undefined>,
  updateDocument: (content: string) => void,
  onApply?: (finalDocument: string) => void
) {
  const { isUploading, upload } = useImageUploadJob(videoId, {
    read: () => documentRef.current ?? "",
    write: updateDocument,
    onFinished: (finalDocument) => onApply?.(finalDocument),
  });

  const handleApply = useCallback(() => {
    const doc = documentRef.current ?? "";
    if (hasUnresolvedScreenshots(doc)) {
      toast.error("Resolve all screenshot placeholders before applying");
      return;
    }
    upload(true);
  }, [documentRef, upload]);

  return { isApplying: isUploading, handleApply };
}
