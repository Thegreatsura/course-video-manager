import type { TLStore, TLStoreSnapshot } from "tldraw";

export const HEAD_AUTOSAVE_DEBOUNCE_MS = 500;

/**
 * Where the open diagram's head stands. Only a `ready` canvas holds the
 * stored head, so only a `ready` canvas may be edited or saved.
 */
export type HeadStatus = "loading" | "failed" | "ready";

/**
 * Debounced autosave of the open diagram's head, which writes only when the
 * canvas differs from the head it last loaded or saved.
 *
 * A store change is not an edit. `loadSnapshot` puts the loaded records under
 * the `"user"` source, and the store delivers them to listeners on the next
 * frame, after the load has returned — so a listener cannot tell opening a
 * diagram from drawing on it. The comparison against what was loaded is what
 * keeps a page that is only opened from writing.
 *
 * It also owns whether the canvas is editable: `onStatusChange` reports every
 * change of {@link HeadStatus}, starting with `"loading"` on creation, and the
 * page makes the canvas read-only for anything but `"ready"`. Saving and
 * editing are gated on the same state, so the user can never draw on a canvas
 * that will not be saved.
 */
export function createHeadAutosaver(opts: {
  store: TLStore;
  /** Resolves `true` once the head is stored; `false` leaves it to retry. */
  save: (diagramId: string, document: TLStoreSnapshot) => Promise<boolean>;
  debounceMs: number;
  onStatusChange: (status: HeadStatus) => void;
}) {
  const { store } = opts;
  /** The diagram the canvas holds, and its head as last loaded or saved. */
  let head: { diagramId: string; serialized: string } | null = null;
  let status: HeadStatus = "loading";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const setStatus = (next: HeadStatus) => {
    if (next === status) return;
    status = next;
    opts.onStatusChange(next);
  };

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const flush = async () => {
    cancel();
    if (!head) return;
    const document = store.getStoreSnapshot("document");
    const serialized = JSON.stringify(document);
    if (serialized === head.serialized) return;
    const target = head;
    if (await opts.save(target.diagramId, document)) {
      target.serialized = serialized;
    }
  };

  const unlisten = store.listen(
    () => {
      if (!head) return;
      cancel();
      timer = setTimeout(() => {
        timer = null;
        // Nothing awaits a debounced save; `save` reports failure, never throws.
        void flush();
      }, opts.debounceMs);
    },
    { source: "user", scope: "document" }
  );

  opts.onStatusChange(status);

  /** Forget the head: nothing is saved, and the canvas is read-only. */
  const detach = (next: "loading" | "failed") => {
    cancel();
    head = null;
    setStatus(next);
  };

  return {
    /**
     * A head load has started — call before touching the canvas. Until
     * `markLoaded`, nothing is saved over the stored diagram.
     */
    markLoading: () => detach("loading"),
    /**
     * The head load failed. The canvas stays read-only and unsaved until a
     * later load succeeds.
     */
    markFailed: () => detach("failed"),
    /**
     * The canvas now holds `diagramId`'s stored head — call right after
     * loading or restoring it. Edits from here on are saved.
     */
    markLoaded(diagramId: string) {
      cancel();
      head = {
        diagramId,
        serialized: JSON.stringify(store.getStoreSnapshot("document")),
      };
      setStatus("ready");
    },
    /** Save now if the canvas has changed; resolves once the save has landed. */
    flush,
    dispose() {
      cancel();
      unlisten();
    },
  };
}

export type HeadAutosaver = ReturnType<typeof createHeadAutosaver>;
