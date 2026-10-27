"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Loader2Icon, SparklesIcon } from "lucide-react";
import { useAutofillDescriptionReducer } from "./use-autofill-description-reducer";

/**
 * A focused modal for the video's SEO description: shows the current value, a
 * Autofill button (driven by the lesson body only), and Save. Mount
 * conditionally so each open starts from a fresh fetch.
 */
export function AutofillDescriptionModal({
  videoId,
  open,
  onOpenChange,
}: {
  videoId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { state, dispatch } = useAutofillDescriptionReducer({
    videoId,
    open,
    onOpenChange,
  });
  const value = state.description;
  const isLoading = state.status === "unloaded" || state.status === "loading";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>SEO Description</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Loading…
          </div>
        ) : state.status === "failed" ? (
          <p className="py-10 text-center text-sm text-destructive">
            Couldn't load the description. Close and try again.
          </p>
        ) : (
          <div className="space-y-3 py-2">
            <Textarea
              value={value}
              onChange={(e) =>
                dispatch({
                  type: "description-edited",
                  description: e.target.value,
                })
              }
              placeholder="A short, compelling SEO description…"
              className="min-h-[120px] text-sm"
              disabled={state.autofilling}
              autoFocus
            />
            <div className="flex items-center justify-between text-xs">
              <span
                className={cn(
                  "text-muted-foreground",
                  value.length > 160 && "text-destructive"
                )}
              >
                {value.length}/160 characters
              </span>
            </div>

            {state.bodyIsEmpty && (
              <p className="text-sm text-destructive">
                The lesson body is empty. Write a lesson body before
                autofilling.
              </p>
            )}
            {state.autofillError && (
              <p className="text-sm text-destructive">{state.autofillError}</p>
            )}

            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="secondary"
                onClick={() => dispatch({ type: "autofill-clicked", videoId })}
                disabled={state.bodyIsEmpty || state.autofilling}
              >
                {state.autofilling ? (
                  <Loader2Icon className="mr-1 size-4 animate-spin" />
                ) : (
                  <SparklesIcon className="mr-1 size-4" />
                )}
                Autofill
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => dispatch({ type: "save-clicked", videoId })}
                  disabled={state.autofilling}
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
