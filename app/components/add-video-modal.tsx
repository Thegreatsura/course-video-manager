import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getVideoPath } from "@/lib/video-helpers";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useFetcher, useNavigate } from "react-router";

export function AddVideoModal(props: {
  lessonId?: string;
  videoCount: number;
  hasExplainerFolder: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const addVideoFetcher = useFetcher<{
    id: string;
    redirectTo: "edit" | "write";
  }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (addVideoFetcher.state === "idle" && addVideoFetcher.data?.id) {
      props.onOpenChange(false);
      navigate(
        `/videos/${addVideoFetcher.data.id}/${addVideoFetcher.data.redirectTo}`
      );
    }
  }, [
    addVideoFetcher.state,
    addVideoFetcher.data,
    props.onOpenChange,
    navigate,
  ]);

  // Don't render if no lessonId (standalone videos use different flow)
  if (!props.lessonId) return null;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Video</DialogTitle>
        </DialogHeader>
        <addVideoFetcher.Form
          method="post"
          action={`/api/lessons/${props.lessonId}/add-video`}
          className="space-y-4 py-4"
        >
          <input type="hidden" name="lessonId" value={props.lessonId} />
          <div className="space-y-2">
            <Label htmlFor="video-path">Video Name</Label>
            <Input
              id="video-path"
              placeholder="Problem, Solution, Explainer..."
              defaultValue={getVideoPath({
                videoCount: props.videoCount,
                hasExplainerFolder: props.hasExplainerFolder,
              })}
              name="path"
            />
          </div>
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              type="button"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={addVideoFetcher.state !== "idle"}>
              {addVideoFetcher.state !== "idle" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Add Video"
              )}
            </Button>
          </div>
        </addVideoFetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
