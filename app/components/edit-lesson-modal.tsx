import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseLessonPath, toSlug } from "@/services/lesson-path-service";
import { useEffect, useState } from "react";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function EditLessonModal(props: {
  lessonId: string;
  currentPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (newSlug: string) => void;
}) {
  const parsed = parseLessonPath(props.currentPath);
  const prefix = parsed
    ? props.currentPath.slice(0, props.currentPath.length - parsed.slug.length)
    : "";
  const currentSlug = parsed?.slug ?? props.currentPath;

  const [input, setInput] = useState(currentSlug);

  useEffect(() => {
    const p = parseLessonPath(props.currentPath);
    setInput(p?.slug ?? props.currentPath);
  }, [props.currentPath]);

  const slug = toSlug(input);
  const isValid = slug.length > 0 && SLUG_PATTERN.test(slug);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) setInput(currentSlug);
        props.onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isValid) return;
            props.onRename(slug);
            props.onOpenChange(false);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="lesson-slug">Lesson Slug</Label>
            <div className="flex items-center space-x-1">
              {parsed && (
                <span className="text-sm text-muted-foreground font-mono shrink-0">
                  {prefix}
                </span>
              )}
              <Input
                id="lesson-slug"
                placeholder="e.g. my-lesson-name"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                autoFocus
                className="flex-1"
              />
            </div>
            {input.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Slug:{" "}
                <code className="bg-muted px-1 py-0.5 rounded">{slug}</code>
                {!isValid && (
                  <span className="text-destructive ml-2">Invalid slug</span>
                )}
              </p>
            )}
          </div>
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => {
                setInput(currentSlug);
                props.onOpenChange(false);
              }}
              type="button"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
