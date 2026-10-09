import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useEffectReducer } from "use-effect-reducer";
import {
  createInitialDuplicateCourseState,
  duplicateCourseReducer,
} from "@/features/course-view/duplicate-course-reducer";

/** The error the action answered with: `{ error }`, or a plain message. */
const errorOf = async (response: Response): Promise<string> => {
  const text = await response.text();
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === "string") return body;
    if (body && typeof body === "object" && "error" in body) {
      return String(body.error);
    }
  } catch {
    // Not JSON: the text is the message.
  }
  return text || "Failed to duplicate course";
};

/** Duplicate a Course: name the copy, and a `duplicate-course` Job makes it. */
export function DuplicateCourseModal(props: {
  courseId: string;
  currentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, dispatch] = useEffectReducer<
    duplicateCourseReducer.State,
    duplicateCourseReducer.Action,
    duplicateCourseReducer.Effect
  >(duplicateCourseReducer, createInitialDuplicateCourseState(), {
    "request-duplicate": (_state, effect, dispatch) => {
      const body = new FormData();
      body.set("name", effect.name);
      fetch(`/api/courses/${effect.courseId}/duplicate`, {
        method: "POST",
        body,
      })
        .then(async (response) =>
          dispatch(
            response.ok
              ? { type: "duplicate-enqueued" }
              : { type: "duplicate-refused", message: await errorOf(response) }
          )
        )
        .catch(() =>
          dispatch({
            type: "duplicate-refused",
            message: "Failed to duplicate course",
          })
        );
    },
    "close-modal": () => props.onOpenChange(false),
  });

  const onOpenChange = (open: boolean) => {
    if (!open) dispatch({ type: "modal-closed" });
    props.onOpenChange(open);
  };

  return (
    <Dialog open={props.open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Duplicate Course</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            dispatch({
              type: "duplicate-pressed",
              courseId: props.courseId,
              name: String(formData.get("name") ?? ""),
              currentName: props.currentName,
            });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="duplicate-course-name">Course Name</Label>
            <Input
              id="duplicate-course-name"
              name="name"
              defaultValue={`${props.currentName} (Copy)`}
              required
            />
          </div>
          {state.status === "error" && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              type="button"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={state.status === "submitting"}>
              {state.status === "submitting" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Duplicate"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
