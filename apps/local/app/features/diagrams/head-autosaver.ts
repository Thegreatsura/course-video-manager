import type { TLStore, TLStoreSnapshot } from "tldraw";

export const HEAD_AUTOSAVE_DEBOUNCE_MS = 500;

/**
 * Debounced autosave of the open diagram's head, which writes only when the
 * canvas differs from the head it last loaded or saved.
 *
 * A store change is not an edit. `loadSnapshot` puts the loaded records under
 * the `"user"` source, and the store delivers them to listeners on the next
 * frame, after the load has returned — so a listener cannot tell opening a
 * diagram from drawing on it. The comparison against what was loaded is what
 * keeps a page that is only opened from writing.
 */
export function createHeadAutosaver(opts: {
  store: TLStore;
  /** Resolves `true` once the head is stored; `false` leaves it to retry. */
  save: (diagramId: string, document: TLStoreSnapshot) => Promise<boolean>;
  debounceMs: number;
}) {
  const { store } = opts;
  /** The diagram the canvas holds, and its head as last loaded or saved. */
  let head: { diagramId: string; serialized: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

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

  return {
    /**
     * The canvas now holds `diagramId`'s stored head — call right after
     * loading or restoring it. `null` while no head is known (a load in
     * flight, or one that failed), so nothing is saved over a diagram whose
     * head never reached the canvas.
     */
    markLoaded(diagramId: string | null) {
      cancel();
      head = diagramId
        ? {
            diagramId,
            serialized: JSON.stringify(store.getStoreSnapshot("document")),
          }
        : null;
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
