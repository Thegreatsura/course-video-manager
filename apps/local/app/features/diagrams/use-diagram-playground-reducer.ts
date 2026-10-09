import { useCallback, useEffect, useMemo, useRef } from "react";
import { useEffectReducer } from "use-effect-reducer";
import { useBlocker, useNavigate } from "react-router";
import { loadSnapshot, type Editor, type TLStoreSnapshot } from "tldraw";
import { diagramChannel } from "@/lib/diagram-protocol";
import {
  createInitialDiagramPlaygroundState,
  diagramPlaygroundReducer,
  isCanvasEditable,
  mustKeepCanvasBeforeLeaving,
  type StoredHead,
} from "./diagram-playground-reducer";
import {
  createHeadAutosaver,
  EXPECTED_HEAD_HASH_HEADER,
  HEAD_AUTOSAVE_DEBOUNCE_MS,
  type HeadAutosaver,
  type HeadSaveResult,
} from "./head-autosaver";
import { centreCameraOnContent } from "./centre-camera-on-content";
import { renderThumbnailPngBase64 } from "./render-thumbnail";
import type { PlaygroundStatus } from "./playground-status";
import type { Snapshot } from "./snapshot-list";

/**
 * Straight to the store: the canvas is read-only until a head loads, and the
 * editor refuses to delete shapes on a read-only canvas.
 */
const clearCanvas = (ed: Editor) => {
  ed.store.remove([...ed.getCurrentPageShapeIds()]);
};

/** Store `document` as `id`'s head, over the head hashed `expectedHash`. */
const saveHead = async (
  id: string,
  document: TLStoreSnapshot,
  expectedHash: string | null | undefined
): Promise<
  | { outcome: "saved"; stored: StoredHead }
  | Exclude<HeadSaveResult, { outcome: "saved" }>
> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (expectedHash !== undefined) {
    headers[EXPECTED_HEAD_HASH_HEADER] = expectedHash ?? "none";
  }
  try {
    const res = await fetch(`/api/diagrams/${id}/head`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(document),
    });
    if (res.status === 409) return { outcome: "refused" };
    if (!res.ok) return { outcome: "failed" };
    const body: { headHash: string | null; updatedAt: string } =
      await res.json();
    return {
      outcome: "saved",
      stored: { hash: body.headHash, updatedAt: body.updatedAt },
    };
  } catch {
    // Network errors during autosave are non-fatal; the next flush retries.
    return { outcome: "failed" };
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
  /**
   * Read by the navigation blocker, which React Router may call before this
   * render's effects run: set during render so it is never a render behind.
   */
  const mustKeepCanvasRef = useRef(false);
  /** Whether the navigation the blocker last held was a replace. */
  const heldReplace = useRef(false);

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
            const data: {
              headScene: TLStoreSnapshot | null;
              headHash: string | null;
              updatedAt: string;
            } = await res.json();
            dispatch({
              type: "head-loaded",
              diagramId: effect.diagramId,
              scene: data.headScene,
              stored: { hash: data.headHash, updatedAt: data.updatedAt },
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
          if (effect.centreCamera) centreCameraOnContent(ed);
        } else {
          clearCanvas(ed);
        }
        autosaver.current?.attach(effect.diagramId, effect.stored.hash);
      },
      "overwrite-stored-head": () => {
        void autosaver.current?.flush({ overwrite: true });
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
          .then(async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body: {
              diagram: { updatedAt: string };
              headHash: string | null;
            } = await res.json();
            dispatch({
              type: "restore-succeeded",
              diagramId: effect.diagramId,
              snapshot: effect.snapshot,
              stored: {
                hash: body.headHash,
                updatedAt: body.diagram.updatedAt,
              },
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
      "keep-canvas-as-snapshot": (_state, effect, dispatch) => {
        const { diagramId } = effect;
        void (async () => {
          try {
            const ed = editorRef.current;
            if (!ed) throw new Error("No editor");
            const thumbnailPngBase64 = await renderThumbnailPngBase64(
              ed,
              "current-page"
            );
            if (!thumbnailPngBase64) {
              dispatch({
                type: "keep-canvas-failed",
                diagramId,
                reason: "empty-canvas",
              });
              return;
            }
            const res = await fetch(`/api/diagrams/${diagramId}/snapshots`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                preserved: true,
                thumbnailPngBase64,
                scene: ed.store.getStoreSnapshot("document"),
              }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            dispatch({ type: "canvas-kept", diagramId });
          } catch {
            dispatch({
              type: "keep-canvas-failed",
              diagramId,
              reason: "request-failed",
            });
          }
        })();
      },
      "continue-leaving": (_state, effect) => {
        navigate(effect.destination.to, {
          replace: effect.destination.replace,
        });
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
      "time-out-error": (_state, effect, dispatch) => {
        const timer = setTimeout(
          () => dispatch({ type: "error-timed-out", id: effect.id }),
          effect.ms
        );
        return () => clearTimeout(timer);
      },
      // The store listener on the route reports the flip back as
      // `focus-mode-changed`.
      "set-focus-mode": (_state, effect) => {
        editorRef.current?.updateInstanceState({
          isFocusMode: effect.isFocusMode,
        });
      },
    }
  );

  // The one place the canvas's editability is set.
  const editable = isCanvasEditable(state);
  useEffect(() => {
    editorRef.current?.updateInstanceState({ isReadonly: !editable });
  }, [editable, state.editorMounted]);

  useEffect(() => () => autosaver.current?.dispose(), []);

  // Every way out of the open diagram — another diagram, the index, another
  // page — is held while its canvas holds edits the server refused. The
  // blocker is released at once, since a held blocker didn't survive the
  // snapshot's round trip in the browser; the reducer gets the destination,
  // keeps the canvas, then sends the navigation on with `continue-leaving`.
  const mustKeepCanvas = mustKeepCanvasBeforeLeaving(state);
  mustKeepCanvasRef.current = mustKeepCanvas;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation, historyAction }) => {
      const hold =
        mustKeepCanvasRef.current &&
        currentLocation.pathname !== nextLocation.pathname;
      if (hold) heldReplace.current = historyAction === "REPLACE";
      return hold;
    }
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const { pathname, search, hash } = blocker.location;
    dispatch({
      type: "leave-requested",
      destination: {
        to: `${pathname}${search}${hash}`,
        replace: heldReplace.current,
      },
    });
    blocker.reset();
  }, [blocker, dispatch]);

  // Closing or reloading the tab can't wait for a snapshot: the browser asks.
  useEffect(() => {
    if (!mustKeepCanvas) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [mustKeepCanvas]);

  /** Wire a freshly mounted tldraw editor to the page. */
  const attachEditor = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      // No head yet, so nothing drawn now could be saved.
      editor.updateInstanceState({ isReadonly: true });
      autosaver.current?.dispose();
      autosaver.current = createHeadAutosaver({
        store: editor.store,
        debounceMs: HEAD_AUTOSAVE_DEBOUNCE_MS,
        save: async (diagramId, document, expectedHash) => {
          dispatch({ type: "head-save-started", diagramId });
          const result = await saveHead(diagramId, document, expectedHash);
          switch (result.outcome) {
            case "saved":
              dispatch({
                type: "head-saved",
                diagramId,
                stored: result.stored,
              });
              return { outcome: "saved", headHash: result.stored.hash };
            case "refused":
              dispatch({ type: "head-save-refused", diagramId });
              return result;
            case "failed":
              dispatch({ type: "head-save-failed", diagramId });
              return result;
          }
        },
      });
    },
    [dispatch]
  );

  /**
   * Report a refetch of `diagramId`'s stored head, with whether the canvas
   * holds edits the server hasn't got.
   */
  const reportStoredHead = useCallback(
    (diagramId: string, stored: StoredHead) => {
      dispatch({
        type: "stored-head-reported",
        diagramId,
        stored,
        canvasHasUnsavedEdits: autosaver.current?.hasUnsavedEdits() ?? false,
      });
    },
    [dispatch]
  );

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

  const status = useMemo<PlaygroundStatus>(
    () => ({
      reportError: (message) => dispatch({ type: "error-reported", message }),
      reportSuccess: () => dispatch({ type: "operation-succeeded" }),
    }),
    [dispatch]
  );

  return {
    state,
    dispatch,
    status,
    editorRef,
    attachEditor,
    flushPendingSave,
    requestRestore,
    reportStoredHead,
  };
}
