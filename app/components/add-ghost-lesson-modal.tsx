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
import { useState } from "react";

export function AddGhostLessonModal(props: {
  sectionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddLesson: (opts: {
    title: string;
    isReal: boolean;
    filePath?: string;
  }) => void;
  adjacentLessonId?: string | null;
  position?: "before" | "after" | null;
  courseFilePath?: string | null;
}) {
  const [title, setTitle] = useState("");
  const [filePath, setFilePath] = useState("");
  const [isReal, setIsReal] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("createOnFileSystem") === "true";
  });

  const handleSetIsReal = (value: boolean) => {
    setIsReal(value);
    localStorage.setItem("createOnFileSystem", String(value));
  };

  const isGhostCourse = isReal && !props.courseFilePath;
  const isValid =
    title.trim().length > 0 && (!isGhostCourse || filePath.trim().length > 0);

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
        }
        props.onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isValid) return;
            props.onAddLesson({
              title: capitalizeTitle(title.trim()),
              isReal,
              filePath: isGhostCourse ? filePath.trim() : undefined,
            });
            setTitle("");
            setFilePath("");
            props.onOpenChange(false);
          }}
        >
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
                onCheckedChange={(checked) => handleSetIsReal(checked === true)}
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
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => {
                setTitle("");
                setFilePath("");
                props.onOpenChange(false);
              }}
              type="button"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid}>
              {isGhostCourse ? "Materialize & Create" : "Add Lesson"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
