import { useMemo } from "react";
import { useRevalidator } from "react-router";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import {
  createInitialEditorModalsState,
  editorModalsReducer,
} from "../editor-modals-reducer";

/**
 * The video editor's effect runner for `editorModalsReducer`, and each
 * dialog's `onOpenChange` (stable, so a dialog may list it in an effect).
 */
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

  const onModalOpenChange = useMemo(() => {
    const dismiss = (modal: editorModalsReducer.Modal) => (open: boolean) => {
      if (!open) dispatch({ type: "modal-dismissed", modal });
    };
    return {
      "add-video": dismiss("add-video"),
      "paste-file": dismiss("paste-file"),
      "rename-video": dismiss("rename-video"),
      "copy-video": dismiss("copy-video"),
      "create-video-from-selection": dismiss("create-video-from-selection"),
      "mic-settings": dismiss("mic-settings"),
      "edit-transcript": dismiss("edit-transcript"),
    };
  }, [dispatch]);

  return { state, dispatch, onModalOpenChange };
}
