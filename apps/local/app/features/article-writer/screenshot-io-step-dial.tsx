// TODO(remove dial): temporary dials for feeling out the frame steps. Once the
// steps are settled, delete this file and use constants in choose-screenshot.tsx.
import { useEffect } from "react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import type { ScreenshotStepSize } from "./screenshot-navigation";

/** Tells every other mounted placeholder's dial that a value moved. */
const CHANGED_EVENT = "choose-screenshot-step-changed";

const DIALS = {
  // "-v2": the old key holds the 2.5s default this replaces.
  large: { key: "choose-screenshot-io-step-seconds-v2", fallback: 1 },
  small: { key: "choose-screenshot-arrow-step-seconds", fallback: 0.2 },
} as const;

function useStepDial(
  size: ScreenshotStepSize,
  label: string,
  inputStep: number
) {
  const { key, fallback } = DIALS[size];
  const [raw, setRaw] = useLocalStorage(key, String(fallback));

  // Bridge: keep every placeholder's dial on the one shared value.
  useEffect(() => {
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string; value: string }>).detail;
      if (detail.key === key) setRaw(detail.value);
    };
    window.addEventListener(CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CHANGED_EVENT, onChanged);
  }, [key, setRaw]);

  const parsed = Number(raw);
  const step = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;

  const dial = (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      {label}
      <input
        type="number"
        step={inputStep}
        min={inputStep}
        value={raw}
        onChange={(e) =>
          window.dispatchEvent(
            new CustomEvent(CHANGED_EVENT, {
              detail: { key, value: e.target.value },
            })
          )
        }
        className="w-16 rounded border border-border bg-background px-1 py-0.5 tabular-nums text-foreground"
      />
    </label>
  );

  return { step, dial };
}

/** The frame steps in seconds, and the dials that edit them. */
export function useScreenshotSteps() {
  const large = useStepDial("large", "I/O step (s)", 0.1);
  const small = useStepDial("small", "←/→ step (s)", 0.05);

  const steps: Record<ScreenshotStepSize, number> = {
    large: large.step,
    small: small.step,
  };
  const dials = (
    <>
      {large.dial}
      {small.dial}
    </>
  );

  return { steps, dials };
}
