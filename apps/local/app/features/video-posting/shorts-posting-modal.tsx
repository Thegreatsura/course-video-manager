"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LinkIcon, Loader2Icon, SendIcon, SparklesIcon } from "lucide-react";
import {
  selectDescriptionRequest,
  selectMetadataProblem,
  selectShowsDescription,
  type ShortsPostingMode,
} from "./shorts-posting-reducer";
import { useShortsPostingReducer } from "./use-shorts-posting-reducer";

export type { ShortsPostingMode };

export function ShortsPostingModal({
  open,
  onOpenChange,
  videoId,
  videoTitle,
  mode = "both",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoId: string;
  videoTitle: string;
  mode?: ShortsPostingMode;
}) {
  const { state, dispatch, description, editDescription } =
    useShortsPostingReducer({ open, onOpenChange, videoId, videoTitle, mode });

  const { title, postedStatus } = state;
  const showDescription = selectShowsDescription(mode);
  const metadataProblem = selectMetadataProblem(state, mode, description);
  const isGeneratingDescription = state.fields.generating !== null;
  const isConvertingShortLinks = state.convertingShortLinks !== null;
  const isCheckingExport = state.checkingExport !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "youtube"
              ? "Post to YouTube"
              : mode === "tiktok"
                ? "Post to TikTok"
                : "Post Short"}
          </DialogTitle>
          <DialogDescription>
            {mode === "youtube"
              ? "Post to YouTube Shorts. The exported vertical video will be used."
              : mode === "tiktok"
                ? "Post to TikTok via Buffer. The title is used as the caption."
                : "Post to YouTube Shorts and Buffer (TikTok / X / Bluesky). The exported vertical video will be used."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {postedStatus && (postedStatus.youtube || postedStatus.tiktok) && (
            <div className="flex gap-2 text-xs text-muted-foreground">
              {postedStatus.youtube && (
                <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
                  Posted to YouTube
                </span>
              )}
              {postedStatus.tiktok && (
                <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
                  Posted to TikTok
                </span>
              )}
            </div>
          )}

          <div className="space-y-1">
            <Label
              htmlFor="shorts-title"
              className="text-muted-foreground text-xs"
            >
              {mode === "tiktok" ? "Title / Caption" : "Title"}
            </Label>
            <Input
              id="shorts-title"
              value={title}
              onChange={(e) =>
                dispatch({ type: "title-edited", title: e.target.value })
              }
              onBlur={() => dispatch({ type: "title-blurred", videoId })}
              placeholder="Short title..."
            />
            {metadataProblem?.field === "title" && (
              <p className="text-sm text-destructive">
                {metadataProblem.message}
              </p>
            )}
          </div>

          {showDescription && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="shorts-description">YouTube Description</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    dispatch({
                      type: "generate-clicked",
                      field: "description",
                      currentText: description,
                      askToReplace: false,
                      request: selectDescriptionRequest(videoId),
                    })
                  }
                  disabled={isGeneratingDescription}
                >
                  {isGeneratingDescription ? (
                    <Loader2Icon className="h-3 w-3 animate-spin" />
                  ) : (
                    <SparklesIcon className="h-3 w-3" />
                  )}
                </Button>
              </div>
              <Textarea
                id="shorts-description"
                value={description}
                onChange={(e) => editDescription(e.target.value)}
                placeholder="YouTube description..."
                className="min-h-[80px] resize-y"
              />
              {metadataProblem?.field === "description" && (
                <p className="text-sm text-destructive">
                  {metadataProblem.message}
                </p>
              )}
            </div>
          )}

          {showDescription && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                dispatch({ type: "convert-short-links-clicked", description })
              }
              disabled={isConvertingShortLinks || !description.trim()}
            >
              {isConvertingShortLinks ? (
                <Loader2Icon className="h-3 w-3 animate-spin" />
              ) : (
                <LinkIcon className="h-3 w-3" />
              )}
              Convert to short links
            </Button>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              dispatch({ type: "post-clicked", videoId, mode, description })
            }
            disabled={
              (showDescription && !description.trim()) ||
              !title.trim() ||
              !!metadataProblem ||
              isCheckingExport
            }
          >
            {isCheckingExport ? (
              <>
                <Loader2Icon className="w-4 h-4 mr-2 animate-spin" />
                Checking export...
              </>
            ) : (
              <>
                <SendIcon className="w-4 h-4 mr-2" />
                Post Short
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
