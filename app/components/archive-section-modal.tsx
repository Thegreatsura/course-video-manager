import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Archive } from "lucide-react";

export function ArchiveSectionModal(props: {
  sectionId: string;
  sectionTitle: string;
  lessonCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onArchive: () => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="w-5 h-5 text-destructive" />
            Archive Section
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to archive "{props.sectionTitle}"?
            {props.lessonCount > 0 && (
              <>
                {" "}
                This section has {props.lessonCount} ghost{" "}
                {props.lessonCount === 1 ? "lesson" : "lessons"} that will no
                longer be visible.
              </>
            )}{" "}
            The section will be hidden from the course editor.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end space-x-2 pt-4">
          <Button
            variant="outline"
            onClick={() => props.onOpenChange(false)}
            type="button"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              props.onArchive();
              props.onOpenChange(false);
            }}
          >
            Archive Section
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
