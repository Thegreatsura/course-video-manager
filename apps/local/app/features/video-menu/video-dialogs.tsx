import { RenameVideoModal } from "@/components/rename-video-modal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useState, type ReactNode } from "react";
import { useFetcher } from "react-router";

interface VideoRef {
  id: string;
  title: string;
}

type Pending =
  | { kind: "rename"; video: VideoRef }
  | { kind: "delete"; video: VideoRef; onDelete: () => void }
  | { kind: "purge-export"; video: VideoRef };

/**
 * The dialogs a Video's action menu opens: Rename, and the confirmations in
 * front of its two irreversible actions — Delete and Purge Export
 * (CODING_STANDARDS.md, "Action menus", rule 6). Render `dialogs` OUTSIDE the
 * menu: a menu's content unmounts as it closes, and a dialog inside it would
 * go with it.
 */
export function useVideoDialogs() {
  const [pending, setPending] = useState<Pending | null>(null);
  const fetcher = useFetcher();
  const close = () => setPending(null);

  const submit = (action: string, body: Record<string, string>) => {
    void fetcher.submit(body, { method: "post", action });
  };

  let dialogs: ReactNode = null;
  if (pending?.kind === "rename") {
    dialogs = (
      <RenameVideoModal
        videoId={pending.video.id}
        currentName={pending.video.title}
        open
        onOpenChange={(open) => !open && close()}
      />
    );
  } else if (pending?.kind === "delete") {
    dialogs = (
      <ConfirmDialog
        title="Delete Video"
        description={`Delete "${pending.video.title}"? The Video and its Clips are archived.`}
        confirmLabel="Delete"
        onConfirm={pending.onDelete}
        onClose={close}
      />
    );
  } else if (pending?.kind === "purge-export") {
    const videoId = pending.video.id;
    dialogs = (
      <ConfirmDialog
        title="Purge Export"
        description={`Delete the exported file of "${pending.video.title}" from disk? This cannot be undone; export again to get it back.`}
        confirmLabel="Purge Export"
        onConfirm={() => submit(`/api/videos/${videoId}/purge-export`, {})}
        onClose={close}
      />
    );
  }

  return {
    rename: (video: VideoRef) => setPending({ kind: "rename", video }),
    /** Confirms, then archives the Video — via `onDelete` if the surface deletes optimistically. */
    confirmDelete: (video: VideoRef, onDelete?: () => void) =>
      setPending({
        kind: "delete",
        video,
        onDelete:
          onDelete ??
          (() => submit("/api/videos/delete", { videoId: video.id })),
      }),
    confirmPurgeExport: (video: VideoRef) =>
      setPending({ kind: "purge-export", video }),
    dialogs,
  };
}

function ConfirmDialog(props: {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              props.onConfirm();
              props.onClose();
            }}
          >
            {props.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
