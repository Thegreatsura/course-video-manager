import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * Edit Transcript: fix a Clip's text by hand (#2184). The landscape editor and
 * a Short's editor share the Clip timeline, so this one dialog serves both.
 *
 * The textarea is uncontrolled and read on submit, so the dialog holds no
 * state of its own; it is keyed on the Clip so each opening starts from that
 * Clip's current text. Saving its Transcript Words to match is the server's
 * job (`writeClipText`).
 */
export function EditClipTranscriptModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The Clip's id and text, or null when the dialog has no Clip. */
  clip: { frontendId: string; text: string } | null;
  onSubmit: (text: string) => void;
}) {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = new FormData(e.currentTarget).get("text");
    if (typeof text === "string") props.onSubmit(text);
    props.onOpenChange(false);
  };

  return (
    <Dialog open={props.open && !!props.clip} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Transcript</DialogTitle>
          <DialogDescription>
            Changes this Clip's text everywhere it is used, a Short's subtitles
            included. Word timings are kept in step; the footage is untouched.
          </DialogDescription>
        </DialogHeader>
        <form
          key={props.clip?.frontendId}
          className="space-y-4"
          onSubmit={handleSubmit}
        >
          <Textarea
            name="text"
            aria-label="Clip transcript"
            autoFocus
            defaultValue={props.clip?.text ?? ""}
            className="min-h-32"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              type="button"
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
