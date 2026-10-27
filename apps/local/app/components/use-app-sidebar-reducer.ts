import { useEffectReducer } from "@/hooks/use-effect-reducer";
import { toast } from "@/components/ui/toast";
import { openPlaygroundWithDiagram } from "@/lib/diagram-window";
import {
  appSidebarReducer,
  createInitialAppSidebarState,
} from "./app-sidebar-reducer";

/** The app sidebar's effect runner for `appSidebarReducer`. */
export function useAppSidebarReducer() {
  const [state, dispatch] = useEffectReducer<
    appSidebarReducer.State,
    appSidebarReducer.Action,
    appSidebarReducer.Effect
  >(appSidebarReducer, createInitialAppSidebarState, {
    "create-diagram": (_state, _effect, dispatch) => {
      void (async () => {
        try {
          const res = await fetch("/api/diagrams/create", { method: "POST" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const { id } = (await res.json()) as { id: string };
          dispatch({ type: "diagram-created", diagramId: id });
        } catch {
          dispatch({ type: "diagram-create-failed" });
        }
      })();
    },
    "open-diagram": (_state, effect) => {
      openPlaygroundWithDiagram(effect.diagramId);
    },
    "wake-spacedesk": (_state, _effect, dispatch) => {
      void (async () => {
        try {
          const res = await fetch("/api/spacedesk/open", { method: "POST" });
          const body = (await res.json()) as
            { success: true } | { success: false; message: string };
          if (body.success) dispatch({ type: "spacedesk-woke" });
          else
            dispatch({ type: "spacedesk-wake-failed", message: body.message });
        } catch {
          dispatch({
            type: "spacedesk-wake-failed",
            message: "Couldn't reach CVM to wake Spacedesk",
          });
        }
      })();
    },
    "show-message": (_state, effect) => {
      toast(effect.message);
    },
    "show-error": (_state, effect) => {
      toast.error(effect.message);
    },
  });

  return { state, dispatch };
}
