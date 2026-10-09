/** What `diagramPlaygroundReducer` puts in the status line. */

export const PRESERVE_ERRORS = {
  "thumbnail-failed": "Failed to render thumbnail",
  "empty-diagram": "Cannot preserve an empty diagram",
  "request-failed": "Failed to preserve snapshot",
} as const;

export const SAVE_FAILED = "Couldn't save your edits. The next change retries.";
export const KEEP_CANVAS_FAILED =
  "Couldn't keep your edits as a snapshot, so this diagram stays open. Reload or keep your edits first.";
export const SAVE_BEFORE_LEAVING_FAILED =
  "Couldn't save your last edit, so this diagram stays open. Try again.";
export const KEPT_EDITS_REFUSED =
  "Your edits weren't saved: this diagram changed elsewhere again.";
export const SAVE_BEFORE_RESTORING_FAILED =
  "Couldn't save your last edit, so the snapshot wasn't restored. Try again.";
export const KEEP_CANVAS_BEFORE_RESTORING_FAILED =
  "Couldn't keep the canvas as a snapshot, so the snapshot wasn't restored. Try again.";
export const RESTORE_BEFORE_LOADED =
  "The diagram hasn't loaded, so the snapshot wasn't restored.";
