import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ClipboardIcon } from "lucide-react";
import { useVideoFilePasteReducer } from "./use-video-file-paste-reducer";
import type { videoFilePasteReducer } from "./video-file-paste-reducer";

export function VideoFilePasteModal(props: {
  videoId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingFiles: Array<{ path: string }>;
  onFileCreated?: (path: string) => void;
  defaultTextFilename?: string;
}) {
  const { state, dispatch, pasteAreaRef, pathInputRef } =
    useVideoFilePasteReducer(props);
  const pastedContent = state.pasted;

  const contentPasted = (content: videoFilePasteReducer.PastedContent) =>
    dispatch({
      type: "content-pasted",
      content,
      existingPaths: props.existingFiles.map((f) => f.path),
      defaultTextFilename: props.defaultTextFilename,
    });

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();

    const clipboardData = e.clipboardData;

    // Check for images first
    const items = clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;

      if (item.type.startsWith("image/")) {
        const blob = item.getAsFile();
        if (blob) {
          // Convert blob to base64
          const reader = new FileReader();
          reader.onload = () => {
            contentPasted({ type: "image", data: reader.result as string });
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
    }

    // If no image, get text
    const text = clipboardData.getData("text/plain");
    if (text) contentPasted({ type: "text", data: text });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    dispatch({ type: "create-clicked", videoId: props.videoId });
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Paste from Clipboard</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {!pastedContent ? (
            <div
              ref={pasteAreaRef}
              tabIndex={0}
              onPaste={handlePaste}
              className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-12 flex flex-col items-center justify-center gap-4 hover:border-muted-foreground/50 focus:border-primary focus:outline-none transition-colors cursor-pointer"
            >
              <ClipboardIcon className="h-12 w-12 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">
                  Click here and paste (Ctrl+V or Cmd+V)
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Paste text or an image from your clipboard
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Pasted Content</Label>
                <div className="border rounded-lg p-4 bg-muted/50 overflow-hidden">
                  {pastedContent.type === "text" ? (
                    <pre className="text-sm whitespace-pre-wrap break-words max-h-48 overflow-y-auto font-mono">
                      {pastedContent.data}
                    </pre>
                  ) : (
                    <img
                      src={pastedContent.data}
                      alt="Pasted image preview"
                      className="max-h-96 max-w-full object-contain rounded"
                    />
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => dispatch({ type: "paste-cleared" })}
                  className="text-xs"
                >
                  Clear and paste again
                </Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="path">Path</Label>
                <Input
                  ref={pathInputRef}
                  id="path"
                  name="path"
                  value={state.path}
                  onChange={(e) =>
                    dispatch({ type: "path-edited", path: e.target.value })
                  }
                  required
                />
              </div>
            </>
          )}
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              type="button"
            >
              Cancel
            </Button>
            {pastedContent && (
              <Button type="submit" disabled={!state.path || state.creating}>
                {state.creating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Create File"
                )}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
