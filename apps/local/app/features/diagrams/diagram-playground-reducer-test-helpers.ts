import type { TLStoreSnapshot } from "tldraw";
import { ReducerTester } from "@/test-utils/reducer-tester";
import type { Snapshot } from "./snapshot-list";
import {
  createInitialDiagramPlaygroundState,
  diagramPlaygroundReducer,
  type StoredHead,
} from "./diagram-playground-reducer";

/** Events and fixtures the `diagramPlaygroundReducer` tests share. */

export const scene = (name: string) => ({ name }) as unknown as TLStoreSnapshot;

export const T0 = "2026-10-09T10:00:00.000Z";
export const T1 = "2026-10-09T10:00:05.000Z";
export const T2 = "2026-10-09T10:00:10.000Z";

export const storedHead = (
  hash: string | null,
  updatedAt: string
): StoredHead => ({
  hash,
  updatedAt,
});

/** `diagramId`'s head arrived from the server, as last written at T0. */
export const loaded = (
  diagramId: string,
  headScene: TLStoreSnapshot | null,
  stored = storedHead(`head-${diagramId}`, T0)
) => ({
  type: "head-loaded" as const,
  diagramId,
  scene: headScene,
  stored,
});

/** The Active Diagram page, its editor just mounted on `d1`. */
export const openPage = () =>
  new ReducerTester(
    diagramPlaygroundReducer,
    createInitialDiagramPlaygroundState({ windowFocused: true })
  ).send({ type: "editor-mounted", diagramId: "d1", isFocusMode: false });

/** The `show-head` effect for `diagramId`. */
export const shown = (
  diagramId: string,
  headScene: TLStoreSnapshot | null,
  opts: { stored?: StoredHead; centreCamera?: boolean } = {}
) => ({
  type: "show-head" as const,
  diagramId,
  scene: headScene,
  stored: opts.stored ?? storedHead(`head-${diagramId}`, T0),
  centreCamera: opts.centreCamera ?? true,
});

/** Snapshot `id` of d1, preserved, its scene and hash named after it. */
export const snapshot = (id: string): Snapshot => ({
  id,
  diagramId: "d1",
  scene: scene(id),
  contentHash: `hash-${id}`,
  preserved: true,
  createdAt: "2026-10-07T00:00:00.000Z",
});
