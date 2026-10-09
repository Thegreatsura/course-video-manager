import { useRevalidator } from "react-router";
import { useEffectReducer } from "use-effect-reducer";
import {
  createInitialEditorModalsState,
  editorModalsReducer,
} from "../editor-modals-reducer";

/** The video editor's effect runner for `editorModalsReducer`. */
export function useEditorModalsReducer() {
  const revalidator = useRevalidator();

  const [state, dispatch] = useEffectReducer<
    editorModalsReducer.State,
    editorModalsReducer.Action,
    editorModalsReducer.Effect
  >(editorModalsReducer, createInitialEditorModalsState, {
    "refresh-video-files": () => {
      void revalidator.revalidate();
    },
  });

  return { state, dispatch };
}
