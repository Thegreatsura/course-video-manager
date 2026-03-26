import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { courseViewReducer } from "@/features/course-view/course-view-reducer";
import { useState, useCallback } from "react";

export function SectionDescriptionEditor({
  sectionId,
  description,
  isReadOnly,
  dispatch,
}: {
  sectionId: string;
  description: string;
  isReadOnly: boolean;
  dispatch: (action: courseViewReducer.Action) => void;
}) {
  const currentDescription = description;
  const [editingDesc, setEditingDesc] = useState(false);
  const [descValue, setDescValue] = useState(currentDescription);

  const saveDescription = useCallback(
    (value: string) => {
      setEditingDesc(false);
      if (value !== currentDescription) {
        dispatch({
          type: "update-section-description",
          frontendId: sectionId,
          description: value,
        } as any);
      }
    },
    [currentDescription, sectionId, dispatch]
  );

  if (!isReadOnly && editingDesc) {
    return (
      <div className="mt-1.5 pl-10 pr-4 pb-2">
        <Textarea
          value={descValue}
          onChange={(e) => setDescValue(e.target.value)}
          placeholder="What does this section cover?"
          className="text-sm min-h-[60px]"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDescValue(currentDescription);
              setEditingDesc(false);
            }
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              saveDescription(descValue);
            }
          }}
          onBlur={() => saveDescription(descValue)}
        />
      </div>
    );
  }

  if (currentDescription) {
    return (
      <div
        className={cn(
          "text-xs text-muted-foreground px-4 pb-2 pt-1 whitespace-pre-line max-w-[65ch]",
          !isReadOnly && "pl-10 cursor-pointer hover:text-foreground/70"
        )}
        onClick={() => {
          if (isReadOnly) return;
          setDescValue(currentDescription);
          setEditingDesc(true);
        }}
      >
        {currentDescription}
      </div>
    );
  }

  if (!isReadOnly) {
    return (
      <div className="pl-10 pr-4 pb-2">
        <button
          className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          onClick={() => {
            setDescValue("");
            setEditingDesc(true);
          }}
        >
          + Add description
        </button>
      </div>
    );
  }

  return null;
}
