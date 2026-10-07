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

/** A Diagram page's autosaver, recording its saves. */
const mount = () => {
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
  return { store, saves, autosaver };
};

/** Opens `d1` the way the Diagram page does: detach, load, attach. */
const openDiagram = () => {
  const mounted = mount();
  mounted.autosaver.detach();
  // What `loadSnapshot` does to the document, minus the session state that
  // only a mounted Editor has.
  mounted.store.loadStoreSnapshot(storedHead());
  mounted.autosaver.attach("d1");
  return mounted;
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

  it("saves nothing while detached, then saves edits once a head is attached", async () => {
    const { store, saves, autosaver } = mount();
    autosaver.detach();
    store.put([box(100)]);
    await settle();
    await autosaver.flush();
    expect(saves).toEqual([]);

    store.loadStoreSnapshot(storedHead());
    autosaver.attach("d1");
    store.put([box(200)]);
    await settle();
    expect(saves.map((s) => s.diagramId)).toEqual(["d1"]);
  });
});
