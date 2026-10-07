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
 *
 * It saves only while attached to a head. When to attach and detach — and so
 * whether the canvas may be edited — is the page reducer's decision
 * (`diagram-playground-reducer.ts`); this module only keeps the store honest.
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
     * Stop saving — call before a head load touches the canvas, and leave it
     * detached if the load fails, so nothing is saved over the stored diagram.
     */
    detach() {
      cancel();
      head = null;
    },
    /**
     * The canvas now holds `diagramId`'s stored head — call right after
     * loading or restoring it. Edits from here on are saved.
     */
    attach(diagramId: string) {
      cancel();
      head = {
        diagramId,
        serialized: JSON.stringify(store.getStoreSnapshot("document")),
      };
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
