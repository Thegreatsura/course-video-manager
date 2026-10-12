import { Button } from "@/components/ui/button";
import { MonitorSmartphoneIcon, RotateCcwIcon } from "lucide-react";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";
import {
  recordNeedsScreenHint,
  screenStatusText,
} from "../cvm-recorder-screen";

/**
 * A Short's screen under the CVM recorder's controls: "Waking Spacedesk…",
 * or why the Spacedesk display cannot be used, with Wake Spacedesk again;
 * and, when Record is off because the scene needs that screen, the hint to
 * pick Camera. Nothing on a Landscape Video, or once the screen is ready.
 */
export const ShortScreenStatus = () => {
  const controls = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.cvmRecorder
  );
  const text = screenStatusText(controls.state);
  const hint = recordNeedsScreenHint(controls.state);
  if (!text && !hint) return null;
  const unavailable = controls.state.screen?.kind === "unavailable";
  return (
    <div
      className="flex max-w-xl flex-col items-center gap-1 text-center text-xs"
      data-testid="cvm-recorder-screen-status"
    >
      {text && (
        <div
          className={`flex items-center gap-2 ${unavailable ? "text-amber-500" : "text-muted-foreground"}`}
        >
          <MonitorSmartphoneIcon className="size-3.5 shrink-0" />
          <span>{text}</span>
          {unavailable && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!controls.canWakeSpacedeskAgain}
              onClick={controls.onWakeSpacedesk}
            >
              <RotateCcwIcon className="size-3.5 mr-1" />
              Wake Spacedesk again
            </Button>
          )}
        </div>
      )}
      {hint && <p className="text-muted-foreground">{hint}</p>}
    </div>
  );
};
