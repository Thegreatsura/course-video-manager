/** The Active Diagram page's data, as `diagramPlaygroundReducer` holds it. */

/**
 * Where the open diagram's head stands. Only a `ready` canvas holds the
 * stored head, so only a `ready` canvas may be edited or saved.
 */
export type HeadStatus = "loading" | "failed" | "ready";

/**
 * A Diagram's head as the server stores it: the content hash of its drawing
 * (`null` when it has never been drawn on) and when it was last written.
 */
export interface StoredHead {
  hash: string | null;
  /** ISO time. */
  updatedAt: string;
}

/** The Active Diagram's head, as the canvas holds it. */
export interface CanvasHead {
  diagramId: string;
  status: HeadStatus;
  /** The stored head this tab last loaded or saved; `null` until it loads. */
  seen: StoredHead | null;
  /** One of this tab's autosaves is on its way to the server. */
  saving: boolean;
  /**
   * The stored head changed elsewhere while the canvas had unsaved edits, so
   * neither was overwritten: the author picks which one to keep.
   */
  changedElsewhere: boolean;
  /** A reload in place: the new head keeps the camera where it is. */
  keepCamera: boolean;
  /**
   * The author answered "changed elsewhere" with "Keep my edits", and no head
   * has loaded since. A save refused now means their choice didn't stick.
   */
  keptMyEdits: boolean;
  /**
   * The canvas, edits the server refused and all, is kept as a preserved
   * snapshot: leaving it now loses nothing.
   */
  keptAsSnapshot: boolean;
}

/** Where a held navigation was going, so it can be sent on its way. */
export interface LeaveDestination {
  to: string;
  replace: boolean;
}

/**
 * How the save made before leaving settled. `saved` also covers a canvas that
 * turned out to have nothing new to save.
 */
export type LeaveSaveOutcome = "saved" | "refused" | "failed";

/**
 * The one error the page's status line shows. Toasts are off on this page
 * (`handle = NO_TOASTS`), so every failure is reported here and nowhere else;
 * a success is never shown, it only clears the error.
 */
export interface StatusError {
  message: string;
  /** Tells this error's timeout apart from a later error's. */
  id: number;
  /**
   * An autosave's own failure. Autosaves run on every pause in drawing, so
   * only an autosave error clears on the next autosave that lands; any other
   * error waits for a success the author asked for.
   */
  fromAutosave: boolean;
}
