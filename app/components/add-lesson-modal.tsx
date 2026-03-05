import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toSlug } from "@/services/lesson-path-service";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useFetcher } from "react-router";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function AddLessonModal(props: {
  sectionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fetcher = useFetcher();
  const [input, setInput] = useState("");
  const slug = toSlug(input);
  const isValid = slug.length > 0 && SLUG_PATTERN.test(slug);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) setInput("");
        props.onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Lesson</DialogTitle>
        </DialogHeader>
        <fetcher.Form
          method="post"
          action="/api/lessons/add"
          className="space-y-4 py-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!isValid) return;
            await fetcher.submit(e.currentTarget);
            setInput("");
            props.onOpenChange(false);
          }}
        >
          <input type="hidden" name="sectionId" value={props.sectionId} />
          <input type="hidden" name="slug" value={slug} />
          <div className="space-y-2">
            <Label htmlFor="lesson-name">Lesson Name</Label>
            <Input
              id="lesson-name"
              placeholder="e.g. Introduction to TypeScript"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoFocus
            />
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
                setInput("");
                props.onOpenChange(false);
              }}
              type="button"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid}>
              {fetcher.state === "submitting" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
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
