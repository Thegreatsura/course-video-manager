import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { useFetcher, useLocation } from "react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

export function FeedbackModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fetcher = useFetcher();
  const location = useLocation();
  const formRef = useRef<HTMLFormElement>(null);
  const prevState = useRef(fetcher.state);

  useEffect(() => {
    if (prevState.current === "loading" && fetcher.state === "idle") {
      if (fetcher.data && "success" in fetcher.data) {
        const openCount = (fetcher.data as { openIssueCount?: number | null })
          .openIssueCount;
        const countMsg = openCount != null ? ` ${openCount} open issues.` : "";
        toast(`Feedback submitted! Thank you.${countMsg}`);
        formRef.current?.reset();
        props.onOpenChange(false);
      }
    }
    prevState.current = fetcher.state;
  }, [fetcher.state, fetcher.data, props]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send Feedback</DialogTitle>
          <DialogDescription>
            Submit feedback as a GitHub issue. Describe what you'd like to see
            changed or report a bug.
          </DialogDescription>
        </DialogHeader>
        <fetcher.Form
          ref={formRef}
          method="post"
          action="/api/feedback"
          className="space-y-4"
        >
          <input type="hidden" name="url" value={location.pathname} />
          <div className="space-y-2">
            <Label htmlFor="feedback-description">Description</Label>
            <Textarea
              id="feedback-description"
              name="description"
              placeholder="Describe your feedback in detail..."
              rows={4}
              required
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  formRef.current?.requestSubmit();
                }
              }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              type="button"
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={fetcher.state !== "idle"}>
              {fetcher.state !== "idle" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                "Submit"
              )}
            </Button>
          </div>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
