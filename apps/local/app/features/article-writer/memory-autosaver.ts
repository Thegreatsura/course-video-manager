export const MEMORY_AUTOSAVE_DEBOUNCE_MS = 750;

/**
 * Debounced saver that only writes when the text differs from the last value
 * loaded or saved. Seeded with the loaded value, so opening never writes.
 */
export function createMemoryAutosaver(opts: {
  initial: string;
  save: (memory: string) => void;
  debounceMs?: number;
}) {
  let baseline = opts.initial;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    if (timeout) clearTimeout(timeout);
    timeout = undefined;
  };

  return {
    update(text: string) {
      cancel();
      if (text === baseline) return;
      timeout = setTimeout(() => {
        timeout = undefined;
        baseline = text;
        opts.save(text);
      }, opts.debounceMs ?? MEMORY_AUTOSAVE_DEBOUNCE_MS);
    },
    cancel,
  };
}
