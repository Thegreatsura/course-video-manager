import { toast } from "@/components/ui/toast";
import type { uploadReducer } from "./upload-reducer";

/**
 * Shows a toast notification when an upload transitions to "error".
 */
export function showErrorToast(upload: uploadReducer.UploadEntry): void {
  const postUrl = `/videos/${upload.videoId}/post`;

  toast.error(`"${upload.title}" upload failed: ${upload.errorMessage}`, {
    duration: Infinity,
    cancel: {
      label: "Go to Post",
      onClick: () => {
        window.location.href = postUrl;
      },
    },
  });
}
