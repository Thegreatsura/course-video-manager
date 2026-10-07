import { useCallback, useEffect, useRef } from "react";
import { useEffectReducer } from "use-effect-reducer";
import { useNavigate } from "react-router";
import { loadSnapshot, type Editor, type TLStoreSnapshot } from "tldraw";
import { toast } from "sonner";
import { diagramChannel } from "@/lib/diagram-protocol";
import {
  createInitialDiagramPlaygroundState,
  diagramPlaygroundReducer,
  isCanvasEditable,
} from "./diagram-playground-reducer";
import {
  createHeadAutosaver,
  HEAD_AUTOSAVE_DEBOUNCE_MS,
  type HeadAutosaver,
} from "./head-autosaver";
import { centreCameraOnContent } from "./centre-camera-on-content";
import { renderThumbnailPngBase64 } from "./render-thumbnail";
import type { Snapshot } from "./snapshot-list";

/**
 * Straight to the store: the canvas is read-only until a head loads, and the
 * editor refuses to delete shapes on a read-only canvas.
 */
const clearCanvas = (ed: Editor) => {
  ed.store.remove([...ed.getCurrentPageShapeIds()]);
};

const saveHead = async (id: string, document: TLStoreSnapshot) => {
  try {
    const res = await fetch(`/api/diagrams/${id}/head`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(document),
    });
    return res.ok;
  } catch {
    // Network errors during autosave are non-fatal; the next flush retries.
    return false;
  }
};

/**
 * The Active Diagram page's effect runner: the tldraw editor, its head
 * autosaver, and the fetches `diagramPlaygroundReducer` asks for.
 */
export function useDiagramPlaygroundReducer() {
  const navigate = useNavigate();
  const editorRef = useRef<Editor | null>(null);
  const autosaver = useRef<HeadAutosaver | null>(null);
  /** Callers of `requestRestore` waiting for the head to move. */
  const restoreWaiters = useRef(new Map<number, () => void>());
  const nextRestoreRequestId = useRef(0);

  // Saves only what differs from the head last loaded or saved, so opening a
  // diagram never writes it back. Every flow that leaves the current diagram
  // must call this first, or up to 500ms of debounced edits is silently lost.
  const flushPendingSave = useCallback(async () => {
    await autosaver.current?.flush();
  }, []);

  const releaseRestoreRequest = (requestId: number | null) => {
    if (requestId === null) return;
    restoreWaiters.current.get(requestId)?.();
    restoreWaiters.current.delete(requestId);
  };

  const [state, dispatch] = useEffectReducer<
    diagramPlaygroundReducer.State,
    diagramPlaygroundReducer.Action,
    diagramPlaygroundReducer.Effect
  >(
    diagramPlaygroundReducer,
    () =>
      createInitialDiagramPlaygroundState({
        windowFocused:
          typeof document !== "undefined" ? document.hasFocus() : false,
      }),
    {
      "load-head": (_state, effect, dispatch) => {
        void (async () => {
          if (effect.saveOpenHeadFirst) await autosaver.current?.flush();
          autosaver.current?.detach();
          try {
            const res = await fetch(`/api/diagrams/${effect.diagramId}/head`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: { headScene: TLStoreSnapshot | null } =
              await res.json();
            dispatch({
              type: "head-loaded",
              diagramId: effect.diagramId,
              scene: data.headScene,
            });
          } catch {
            dispatch({ type: "head-load-failed", diagramId: effect.diagramId });
          }
        })();
      },
      "show-head": (_state, effect) => {
        const ed = editorRef.current;
        if (!ed) return;
        if (effect.scene) {
          loadSnapshot(ed.store, { document: effect.scene });
          centreCameraOnContent(ed);
        } else {
          clearCanvas(ed);
        }
        autosaver.current?.attach(effect.diagramId);
      },
      "clear-canvas": () => {
        if (editorRef.current) clearCanvas(editorRef.current);
      },
      "restore-snapshot": (_state, effect, dispatch) => {
        fetch(`/api/diagrams/${effect.diagramId}/restore-to-head`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snapshotId: effect.snapshot.id }),
        })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            dispatch({
              type: "restore-succeeded",
              diagramId: effect.diagramId,
              snapshot: effect.snapshot,
            });
          })
          .catch(() => dispatch({ type: "restore-failed" }))
          .finally(() => releaseRestoreRequest(effect.requestId));
      },
      "release-restore-request": (_state, effect) => {
        releaseRestoreRequest(effect.requestId);
      },
      "preserve-snapshot": (_state, effect, dispatch) => {
        void (async () => {
          try {
            await flushPendingSave();
            const ed = editorRef.current;
            let thumbnailPngBase64: string | null = null;
            try {
              thumbnailPngBase64 = ed
                ? await renderThumbnailPngBase64(ed, "current-page")
                : null;
            } catch {
              dispatch({ type: "preserve-failed", reason: "thumbnail-failed" });
              return;
            }
            if (!thumbnailPngBase64) {
              dispatch({ type: "preserve-failed", reason: "empty-diagram" });
              return;
            }
            const res = await fetch(
              `/api/diagrams/${effect.diagramId}/snapshots`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ preserved: true, thumbnailPngBase64 }),
              }
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            dispatch({ type: "snapshot-preserved", created: !!data.snapshot });
          } catch {
            dispatch({ type: "preserve-failed", reason: "request-failed" });
          }
        })();
      },
      "create-diagram": (_state, _effect, dispatch) => {
        void (async () => {
          try {
            await flushPendingSave();
            const res = await fetch("/api/diagrams/create", { method: "POST" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const { id } = await res.json();
            dispatch({ type: "diagram-created", diagramId: id });
          } catch {
            dispatch({ type: "create-failed" });
          }
        })();
      },
      "go-to-diagram": (_state, effect) => {
        navigate(`/diagram-playground/${effect.diagramId}`);
      },
      "take-clip-snapshot": (_state, effect, dispatch) => {
        const { clipId, diagramId, diagramName } = effect;
        void (async () => {
          try {
            await flushPendingSave();
            const ed = editorRef.current;
            // Auto-pin thumbnails are best-effort; proceed without one if rendering fails.
            const thumbnailPngBase64 = ed
              ? await renderThumbnailPngBase64(ed, "current-page").catch(
                  () => null
                )
              : null;
            const res = await fetch(`/api/diagrams/${diagramId}/snapshots`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ clipId, thumbnailPngBase64 }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json().catch(() => null);
            dispatch({
              type: "clip-snapshot-taken",
              clipId,
              diagramName,
              snapshotId: body?.snapshot?.id ?? null,
            });
          } catch {
            dispatch({ type: "clip-snapshot-failed", clipId, diagramName });
          }
        })();
      },
      "report-clip-snapshot": (_state, effect) => {
        diagramChannel.sendToParent({
          type: "snapshotForClipDone",
          clipId: effect.clipId,
          ok: effect.ok,
          snapshotId: effect.snapshotId,
          diagramName: effect.diagramName,
        });
      },
      "show-error": (_state, effect) => {
        toast.error(effect.message);
      },
    }
  );

  // The one place the canvas's editability is set.
  const editable = isCanvasEditable(state);
  useEffect(() => {
    editorRef.current?.updateInstanceState({ isReadonly: !editable });
  }, [editable, state.editorMounted]);

  useEffect(() => () => autosaver.current?.dispose(), []);

  /** Wire a freshly mounted tldraw editor to the page. */
  const attachEditor = useCallback((editor: Editor) => {
    editorRef.current = editor;
    // No head yet, so nothing drawn now could be saved.
    editor.updateInstanceState({ isReadonly: true });
    autosaver.current?.dispose();
    autosaver.current = createHeadAutosaver({
      store: editor.store,
      debounceMs: HEAD_AUTOSAVE_DEBOUNCE_MS,
      save: saveHead,
    });
  }, []);

  /**
   * Asks to restore `snapshot`. Resolves once the head has moved, or at once
   * if the confirmation dialog takes over — so a Snapshot Step can wait for
   * one restore before aiming the next.
   */
  const requestRestore = useCallback(
    (snapshot: Snapshot, headIsCaptured: boolean) => {
      const ed = editorRef.current;
      const requestId = nextRestoreRequestId.current++;
      return new Promise<void>((resolve) => {
        restoreWaiters.current.set(requestId, resolve);
        dispatch({
          type: "restore-requested",
          snapshot,
          headIsCaptured,
          canvasIsEmpty: ed ? ed.getCurrentPageShapeIds().size === 0 : false,
          requestId,
        });
      });
    },
    [dispatch]
  );

  return {
    state,
    dispatch,
    editorRef,
    attachEditor,
    flushPendingSave,
    requestRestore,
  };
}
