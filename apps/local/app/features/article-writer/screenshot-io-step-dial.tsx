// TODO(remove dial): a temporary dial for feeling out the I / O step. Once the
// step is settled, delete this file and use a constant in choose-screenshot.tsx.
import { useEffect } from "react";
import { useLocalStorage } from "@/hooks/use-local-storage";

const STORAGE_KEY = "choose-screenshot-io-step-seconds";
/** Tells every other mounted placeholder's dial that the value moved. */
const CHANGED_EVENT = "choose-screenshot-io-step-changed";
const DEFAULT_STEP = 2.5;

/** The I / O step in seconds, and the dial that edits it. */
export function useScreenshotIoStep() {
  const [raw, setRaw] = useLocalStorage(STORAGE_KEY, String(DEFAULT_STEP));
  // Bridge: keep every placeholder's dial on the one shared value.
  useEffect(() => {
    const onChanged = (e: Event) => setRaw((e as CustomEvent<string>).detail);
    window.addEventListener(CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CHANGED_EVENT, onChanged);
  }, [setRaw]);

  const parsed = Number(raw);
  const step = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STEP;

  const dial = (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      I/O step (s)
      <input
        type="number"
        step={0.1}
        min={0.1}
        value={raw}
        onChange={(e) =>
          window.dispatchEvent(
            new CustomEvent(CHANGED_EVENT, { detail: e.target.value })
          )
        }
        className="w-16 rounded border border-border bg-background px-1 py-0.5 tabular-nums text-foreground"
      />
    </label>
  );

  return { step, dial };
}
