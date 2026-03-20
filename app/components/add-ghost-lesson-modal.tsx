import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { capitalizeTitle } from "@/utils/capitalize-title";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

export function AddGhostLessonModal(props: {
  sectionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fetcher?: ReturnType<typeof useFetcher>;
  adjacentLessonId?: string | null;
  position?: "before" | "after" | null;
  courseFilePath?: string | null;
}) {
  const internalFetcher = useFetcher<{ error?: string }>();
  const fetcher = props.fetcher ?? internalFetcher;
  const [title, setTitle] = useState("");
  const [filePath, setFilePath] = useState("");
  const [isReal, setIsReal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wasSubmitting = useRef(false);

  // Reset isReal and error when modal opens/closes
  useEffect(() => {
    if (!props.open) {
      setIsReal(false);
    }
    if (props.open) {
      setError(null);
    }
  }, [props.open]);

  // Close modal when fetcher completes successfully, or show error
  useEffect(() => {
    if (fetcher.state === "submitting" || fetcher.state === "loading") {
      wasSubmitting.current = true;
    }
    if (wasSubmitting.current && fetcher.state === "idle") {
      wasSubmitting.current = false;
      const errorMsg = (fetcher.data as { error?: string } | undefined)?.error;
      if (errorMsg) {
        setError(errorMsg);
        return;
      }
      setTitle("");
      setFilePath("");
      setIsReal(false);
      setError(null);
      props.onOpenChange(false);
    }
  }, [fetcher.state, props.onOpenChange, fetcher.data]);
  const isGhostCourse = isReal && !props.courseFilePath;
  const isValid =
    title.trim().length > 0 && (!isGhostCourse || filePath.trim().length > 0);
  const actionUrl = isReal
    ? "/api/lessons/create-real"
    : "/api/lessons/add-ghost";

  const dialogTitle =
    props.position === "before"
      ? "Add Lesson Before"
      : props.position === "after"
        ? "Add Lesson After"
        : "Add Lesson";

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          setTitle("");
          setFilePath("");
          setIsReal(false);
        }
        props.onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <fetcher.Form
          method="post"
          action={actionUrl}
          className="space-y-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isValid) return;
            setError(null);
            const formData = new FormData(e.currentTarget);
            formData.set("title", capitalizeTitle(title.trim()));
            if (isGhostCourse) {
              formData.set("filePath", filePath.trim());
            }
            fetcher.submit(formData, {
              method: "post",
              action: actionUrl,
            });
          }}
        >
          <input type="hidden" name="sectionId" value={props.sectionId} />
          {props.adjacentLessonId && (
            <input
              type="hidden"
              name="adjacentLessonId"
              value={props.adjacentLessonId}
            />
          )}
          {props.position && (
            <input type="hidden" name="position" value={props.position} />
          )}
          <div className="space-y-2">
            <Label htmlFor="ghost-lesson-title">Title</Label>
            <Input
              id="ghost-lesson-title"
              name="title"
              placeholder="e.g. Understanding Generics"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus={!isGhostCourse}
            />
          </div>
          {props.courseFilePath !== undefined && (
            <div className="flex items-start space-x-2">
              <Checkbox
                id="real-lesson-checkbox"
                checked={isReal}
                onCheckedChange={(checked) => setIsReal(checked === true)}
              />
              <div className="grid gap-1 leading-none">
                <Label
                  htmlFor="real-lesson-checkbox"
                  className="cursor-pointer"
                >
                  Create on filesystem
                </Label>
                <p className="text-xs text-muted-foreground">
                  Creates a directory for this lesson on disk. Leave unchecked
                  to create a ghost lesson that exists only in the database.
                </p>
              </div>
            </div>
          )}
          {isGhostCourse && (
            <div className="space-y-2">
              <Label htmlFor="course-file-path">Course File Path</Label>
              <Input
                id="course-file-path"
                name="filePath"
                placeholder="e.g. /path/to/existing/directory"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Must point to an existing directory. This will permanently
                assign a file path to the course.
              </p>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => {
                setTitle("");
                setFilePath("");
                setIsReal(false);
                props.onOpenChange(false);
              }}
              type="button"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isValid || fetcher.state !== "idle"}
            >
              {fetcher.state !== "idle" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isGhostCourse ? (
                "Materialize & Create"
              ) : (
                "Add Lesson"
              )}
            </Button>
          </div>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
