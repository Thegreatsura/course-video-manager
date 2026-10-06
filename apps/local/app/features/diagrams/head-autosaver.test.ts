import { afterEach, describe, expect, it } from "vitest";
import {
  createShapeId,
  createTLStore,
  defaultShapeUtils,
  GeoShapeUtil,
  PageRecordType,
  type IndexKey,
  type TLGeoShape,
  type TLStoreSnapshot,
} from "tldraw";
import { createHeadAutosaver, type HeadAutosaver } from "./head-autosaver";

const DEBOUNCE_MS = 10;
/** Past the store's next-frame listener flush and the debounce together. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

const PAGE_ID = PageRecordType.createId("page");

const newStore = () => {
  const store = createTLStore({ shapeUtils: defaultShapeUtils });
  store.put([
    PageRecordType.create({
      id: PAGE_ID,
      name: "Page",
      index: "a1" as IndexKey,
    }),
  ]);
  return store;
};

const box = (x: number): TLGeoShape => ({
  id: createShapeId(`box-${x}`),
  typeName: "shape",
  type: "geo",
  parentId: PAGE_ID,
  index: "a1" as IndexKey,
  x,
  y: 0,
  rotation: 0,
  isLocked: false,
  opacity: 1,
  meta: {},
  props: GeoShapeUtil.prototype.getDefaultProps.call({} as GeoShapeUtil),
});

/** A stored head holding one shape, as the server would hand it back. */
const storedHead = (): TLStoreSnapshot => {
  const source = newStore();
  source.put([box(0)]);
  return source.getStoreSnapshot("document");
};

let autosaver: HeadAutosaver | null = null;
afterEach(() => autosaver?.dispose());

/** Opens `d1` the way the Diagram page does: detach, load, mark loaded. */
const openDiagram = () => {
  const store = newStore();
  const saves: { diagramId: string; document: TLStoreSnapshot }[] = [];
  autosaver = createHeadAutosaver({
    store,
    debounceMs: DEBOUNCE_MS,
    save: async (diagramId, document) => {
      saves.push({ diagramId, document });
      return true;
    },
  });
  autosaver.markLoaded(null);
  // What `loadSnapshot` does to the document, minus the session state that
  // only a mounted Editor has.
  store.loadStoreSnapshot(storedHead());
  autosaver.markLoaded("d1");
  return { store, saves, autosaver };
};

describe("createHeadAutosaver", () => {
  it("does not save a diagram that was only opened", async () => {
    const { saves, autosaver } = openDiagram();
    await settle();
    await autosaver.flush();
    expect(saves).toEqual([]);
  });

  it("saves an edit once after the debounce", async () => {
    const { store, saves } = openDiagram();
    await settle();
    store.put([box(100)]);
    store.put([box(200)]);
    await settle();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.diagramId).toBe("d1");
    expect(Object.keys(saves[0]!.document.store)).toContain(
      createShapeId("box-200")
    );
  });
});
