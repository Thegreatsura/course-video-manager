import { useContext, useRef, useState, useEffect, useCallback } from "react";
import {
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Upload,
  X,
  ExternalLink,
  Cloud,
  Send,
  Copy,
  Film,
} from "lucide-react";
import { Link } from "react-router";
import { UploadContext } from "./upload-context";
import type { uploadReducer } from "./upload-reducer";
import { Badge } from "@/components/ui/badge";

export function GlobalUploadProgress() {
  const { uploads, dismissUpload } = useContext(UploadContext);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const uploadEntries = Object.values(uploads);
  const hasUploads = uploadEntries.length > 0;

  const activeUploads = uploadEntries.filter(
    (u) => u.status === "uploading" || u.status === "retrying"
  );
  const isActive = activeUploads.length > 0;

  const aggregateProgress =
    activeUploads.length > 0
      ? Math.round(
          activeUploads.reduce((sum, u) => sum + u.progress, 0) /
            activeUploads.length
        )
      : 100;

  // Auto-dismiss all uploads 5 seconds after all finish
  useEffect(() => {
    if (!hasUploads || isActive) return;

    const timer = setTimeout(() => {
      for (const upload of uploadEntries) {
        dismissUpload(upload.uploadId);
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, [hasUploads, isActive, uploadEntries, dismissUpload]);

  // Close dropdown on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  // Close dropdown on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const handleDismiss = useCallback(
    (e: React.MouseEvent, uploadId: string) => {
      e.stopPropagation();
      dismissUpload(uploadId);
    },
    [dismissUpload]
  );

  if (!hasUploads) return null;

  return (
    <div
      ref={dropdownRef}
      className="fixed top-[0px] left-[0px] right-[0px] z-50"
    >
      {/* Thin progress bar */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full h-1 bg-secondary cursor-pointer"
        aria-label="Toggle upload details"
        type="button"
      >
        <div
          className={`h-full rounded-r-full transition-all duration-300 ${
            isActive ? "bg-blue-500" : "bg-green-500"
          }`}
          style={{ width: `${aggregateProgress}%` }}
        />
      </button>

      {/* Expandable dropdown */}
      {isOpen && (
        <div className="mx-auto max-w-md mt-1 mr-4 ml-auto rounded-md border bg-popover text-popover-foreground shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b flex items-center justify-between">
            <span className="text-sm font-medium">Uploads</span>
            <button
              onClick={() => setIsOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              type="button"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {uploadEntries.map((upload) => (
              <UploadRow
                key={upload.uploadId}
                upload={upload}
                onDismiss={handleDismiss}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UploadRow({
  upload,
  onDismiss,
}: {
  upload: uploadReducer.UploadEntry;
  onDismiss: (e: React.MouseEvent, uploadId: string) => void;
}) {
  return (
    <div className="px-3 py-2 flex items-center gap-3 border-b last:border-b-0 hover:bg-accent/50">
      <StatusIcon upload={upload} />
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{upload.title}</p>
        <UploadStatusDetail upload={upload} />
      </div>
      <button
        onClick={(e) => onDismiss(e, upload.uploadId)}
        className="shrink-0 text-muted-foreground hover:text-foreground"
        type="button"
        aria-label="Dismiss upload"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function StatusIcon({ upload }: { upload: uploadReducer.UploadEntry }) {
  switch (upload.status) {
    case "uploading":
      if (upload.uploadType === "buffer") {
        switch (upload.bufferStage) {
          case "syncing":
            return <Cloud className="size-4 text-blue-500 shrink-0" />;
          case "sending-webhook":
            return <Send className="size-4 text-blue-500 shrink-0" />;
          default:
            return <Copy className="size-4 text-blue-500 shrink-0" />;
        }
      }
      if (upload.uploadType === "export") {
        return <Film className="size-4 text-blue-500 shrink-0" />;
      }
      return <Upload className="size-4 text-blue-500 shrink-0" />;
    case "retrying":
      return (
        <RefreshCw className="size-4 text-yellow-500 shrink-0 animate-spin" />
      );
    case "success":
      return <CheckCircle2 className="size-4 text-green-500 shrink-0" />;
    case "error":
      return <AlertCircle className="size-4 text-destructive shrink-0" />;
  }
}

const BUFFER_STAGE_LABELS: Record<uploadReducer.BufferStage, string> = {
  copying: "Copying to Dropbox",
  syncing: "Syncing to Dropbox",
  "sending-webhook": "Sending to Zapier",
};

const EXPORT_STAGE_LABELS: Record<uploadReducer.ExportStage, string> = {
  "concatenating-clips": "Concatenating clips",
  "normalizing-audio": "Normalizing audio",
};

function UploadStatusDetail({ upload }: { upload: uploadReducer.UploadEntry }) {
  switch (upload.status) {
    case "uploading":
      if (upload.uploadType === "buffer" && upload.bufferStage) {
        const stageLabel = BUFFER_STAGE_LABELS[upload.bufferStage];
        if (upload.bufferStage === "copying") {
          return (
            <div className="flex items-center gap-2 mt-0.5">
              <div className="flex-1 bg-secondary rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-blue-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${upload.progress}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground w-8 text-right">
                {upload.progress}%
              </span>
            </div>
          );
        }
        return (
          <p className="text-xs text-muted-foreground mt-0.5">
            {stageLabel}...
          </p>
        );
      }
      if (upload.uploadType === "export" && upload.exportStage) {
        const stageLabel = EXPORT_STAGE_LABELS[upload.exportStage];
        return (
          <p className="text-xs text-muted-foreground mt-0.5">
            {stageLabel}...
          </p>
        );
      }
      return (
        <div className="flex items-center gap-2 mt-0.5">
          <div className="flex-1 bg-secondary rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-blue-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${upload.progress}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground w-8 text-right">
            {upload.progress}%
          </span>
        </div>
      );
    case "retrying":
      return (
        <p className="text-xs text-yellow-500 mt-0.5">
          Retrying... (attempt {upload.retryCount + 1})
        </p>
      );
    case "success":
      if (upload.uploadType === "buffer") {
        return (
          <div className="flex items-center gap-2 mt-0.5">
            <Badge
              variant="secondary"
              className="text-green-500 text-[10px] px-1.5 py-0"
            >
              Sent to Buffer
            </Badge>
          </div>
        );
      }
      if (upload.uploadType === "youtube") {
        return (
          <div className="flex items-center gap-2 mt-0.5">
            <Badge
              variant="secondary"
              className="text-green-500 text-[10px] px-1.5 py-0"
            >
              Complete
            </Badge>
            {upload.youtubeVideoId && (
              <a
                href={`https://studio.youtube.com/video/${upload.youtubeVideoId}/edit`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                YouTube Studio
                <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        );
      }
      if (upload.uploadType === "ai-hero") {
        return (
          <div className="flex items-center gap-2 mt-0.5">
            <Badge
              variant="secondary"
              className="text-green-500 text-[10px] px-1.5 py-0"
            >
              Posted to AI Hero
            </Badge>
            {upload.aiHeroSlug && (
              <a
                href={`https://aihero.dev/${upload.aiHeroSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                View Post
                <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        );
      }
      if (upload.uploadType === "export") {
        return (
          <div className="flex items-center gap-2 mt-0.5">
            <Badge
              variant="secondary"
              className="text-green-500 text-[10px] px-1.5 py-0"
            >
              Exported
            </Badge>
          </div>
        );
      }
      return (
        <div className="flex items-center gap-2 mt-0.5">
          <Badge
            variant="secondary"
            className="text-green-500 text-[10px] px-1.5 py-0"
          >
            Complete
          </Badge>
        </div>
      );
    case "error":
      return (
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-destructive truncate">
            {upload.errorMessage}
          </span>
          <Link
            to={`/videos/${upload.videoId}/post`}
            className="text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
            onClick={(e) => e.stopPropagation()}
          >
            Go to Post
          </Link>
        </div>
      );
  }
}
