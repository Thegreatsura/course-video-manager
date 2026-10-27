import { useEffect } from "react";
import { useFetcher } from "react-router";
import { useEffectReducer } from "use-effect-reducer";
import {
  autofillDescriptionReducer,
  createInitialAutofillDescriptionState,
} from "./autofill-description-reducer";

/**
 * The SEO Description modal's effect runner for `autofillDescriptionReducer`.
 * Save goes through a fetcher, so the page revalidates once it lands, even
 * though the modal unmounts as it closes.
 */
export function useAutofillDescriptionReducer(props: {
  videoId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const saveFetcher = useFetcher();

  // The initial state is an object, not a function: given a function,
  // useEffectReducer flushes on mount, and StrictMode's second mount pass
  // would flush away the effect this modal declares as it opens.
  const [state, dispatch] = useEffectReducer<
    autofillDescriptionReducer.State,
    autofillDescriptionReducer.Action,
    autofillDescriptionReducer.Effect
  >(autofillDescriptionReducer, createInitialAutofillDescriptionState(), {
    "load-lesson-writer-data": (_state, effect, dispatch) => {
      fetch(`/api/videos/${effect.videoId}/lesson-writer`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as {
            description: string | null;
            body: string | null;
          };
          dispatch({
            type: "lesson-writer-data-loaded",
            videoId: effect.videoId,
            description: data.description,
            body: data.body,
          });
        })
        .catch(() => dispatch({ type: "lesson-writer-data-load-failed" }));
    },
    "autofill-description": (_state, effect, dispatch) => {
      fetch(`/api/videos/${effect.videoId}/autofill-description`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as { text?: string; error?: string };
          dispatch(
            data.text != null
              ? { type: "autofill-succeeded", text: data.text }
              : {
                  type: "autofill-failed",
                  error: data.error ?? AUTOFILL_FAILED,
                }
          );
        })
        .catch(() =>
          dispatch({ type: "autofill-failed", error: AUTOFILL_FAILED })
        );
    },
    "save-description": (_state, effect) => {
      void saveFetcher.submit(
        { intent: "updateDescription", description: effect.description },
        {
          method: "post",
          action: `/api/videos/${effect.videoId}/lesson-writer`,
        }
      );
    },
    "close-modal": () => {
      props.onOpenChange(false);
    },
  });

  // Bridge: the modal opening.
  useEffect(() => {
    if (props.open) dispatch({ type: "modal-opened", videoId: props.videoId });
  }, [dispatch, props.open, props.videoId]);

  return { state, dispatch };
}

const AUTOFILL_FAILED = "Autofill failed. Try again.";
